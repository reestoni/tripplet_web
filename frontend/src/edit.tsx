import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as RME } from "react";
import { request, ApiError } from "./api";
import { useI18n } from "./i18n";

/* Editing Show Experiment like the desktop: unsaved values are yellow, "Save (n)" / Ctrl+S writes
   them through the server (same rules as the desktop: db/series_save), Ctrl+Z undoes the last
   unsaved change, the plausibility check asks before unusual values are saved.
   Cells can be selected (click, Shift+click = rectangle, Ctrl+click = add); Ctrl+C copies them as
   tab-separated text (Excel), Ctrl+V pastes from the top-left selected cell, Delete clears them. */

export type CellAddr = { tab: string; r: number; c: number };
type Pending = CellAddr & { value: string | number | null; display: string };
export type Change = CellAddr & { value: string | number | null; display: string; original?: string };
export const cellKey = (a: CellAddr) => `${a.tab}|${a.r}|${a.c}`;
const key = cellKey;

type CellInfo = { addr: CellAddr; text: string; raw?: string | null; editable: boolean;
  options?: [number | string, string][] | null };

type Ctx = {
  canWrite: boolean;
  dirtyCount: number;
  pending: (a: CellAddr) => Pending | undefined;
  set: (a: CellAddr, value: string | number | null, display: string, original: string) => void;
  setMany: (changes: Change[]) => void;
  invalid: (a: CellAddr) => boolean;
  hasDirty: (tab: string) => boolean;
  reloadKey: number;
  isSelected: (a: CellAddr) => boolean;
  select: (td: HTMLElement, a: CellAddr, e: SelMods) => void;
  selectedAddrs: () => CellAddr[];
  register: (info: CellInfo) => void;
  info: (a: CellAddr) => CellInfo | undefined;
  flash: (kind: "ok" | "err", text: string) => void;
};

type SelMods = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; button?: number };

/** Neighbour cell (Excel-like keyboard moves): next td with data-k in that direction. */
export function neighbour(td: HTMLElement, dr: number, dc: number): HTMLElement | null {
  const table = td.closest("table") as HTMLTableElement | null;
  if (!table) return null;
  let r = (td.parentElement as HTMLTableRowElement).rowIndex, c = (td as HTMLTableCellElement).cellIndex;
  for (let i = 0; i < 500; i++) {
    r += dr; c += dc;
    const row = table.rows[r];
    if (!row) return null;
    const cell = row.cells[c] as HTMLElement | undefined;
    if (!cell) return null;
    if (cell.dataset.k) return cell;
  }
  return null;
}

const EditCtx = createContext<Ctx | null>(null);
export const useEdit = () => useContext(EditCtx);

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** td elements of the rectangle between two cells of the same table (DOM positions). */
function rectCells(a: HTMLElement, b: HTMLElement): HTMLElement[] {
  const ta = a.closest("table"), tb = b.closest("table");
  if (!ta || ta !== tb) return [b];
  const ra = (a.parentElement as HTMLTableRowElement).rowIndex, rb = (b.parentElement as HTMLTableRowElement).rowIndex;
  const ca = (a as HTMLTableCellElement).cellIndex, cb = (b as HTMLTableCellElement).cellIndex;
  const out: HTMLElement[] = [];
  for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) {
    const row = (ta as HTMLTableElement).rows[r];
    for (let c = Math.min(ca, cb); c <= Math.max(ca, cb); c++) {
      const td = row?.cells[c] as HTMLElement | undefined;
      if (td?.dataset.k) out.push(td);
    }
  }
  return out;
}

export function EditProvider({ seriesId, canWrite, children, machineMode, jetUnit, onSaved }: {
  seriesId: number; canWrite: boolean; children: ReactNode; machineMode: () => string; jetUnit: () => string;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [dirty, setDirty] = useState<Map<string, Pending>>(new Map());
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ k: string; prev: Pending | undefined }[][]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<HTMLElement | null>(null);
  const registry = useRef<Map<string, CellInfo>>(new Map());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const selRef = useRef(sel);
  selRef.current = sel;

  const setMany = useCallback((changes: Change[]) => {
    if (!changes.length) return;
    setDirty((d) => {
      const next = new Map(d);
      const group: { k: string; prev: Pending | undefined }[] = [];
      for (const ch of changes) {
        const k = key(ch);
        group.push({ k, prev: d.get(k) });
        // back to the stored value = no longer unsaved (dropdown rows compare the stored ID)
        const info = registry.current.get(k);
        const orig = ch.original ?? (info ? (info.options ? (info.raw ?? "") : info.text) : undefined);
        if (orig !== undefined && String(ch.value ?? "") === orig) next.delete(k);
        else next.set(k, { tab: ch.tab, r: ch.r, c: ch.c, value: ch.value, display: ch.display });
      }
      setUndo((u) => [...u, group]);
      return next;
    });
    setBad((b) => {
      const n = new Set(b);
      changes.forEach((ch) => n.delete(key(ch)));
      return n;
    });
  }, []);

  const set = useCallback((a: CellAddr, value: string | number | null, display: string, original: string) => {
    setMany([{ ...a, value, display, original }]);
  }, [setMany]);

  const doUndo = useCallback(() => {
    setUndo((u) => {
      if (!u.length) return u;
      const last = u[u.length - 1];
      setDirty((d) => {
        const n = new Map(d);
        for (const { k, prev } of [...last].reverse()) {
          if (prev) n.set(k, prev); else n.delete(k);
        }
        return n;
      });
      return u.slice(0, -1);
    });
  }, []);

  const save = useCallback(async (confirmed = false) => {
    const edits = [...dirtyRef.current.values()].map(({ tab, r, c, value }) => ({ tab, r, c, value }));
    if (!edits.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await request<{ kind: string; saved?: number; warnings?: string[]; failed?: string[] }>(
        "POST", `/api/series/${seriesId}/save`, { edits, mode: machineMode(), unit: jetUnit(), confirmed });
      if (res.kind === "confirm") { setWarn(res.warnings ?? []); return; }
      setWarn(null); setDirty(new Map()); setUndo([]); setBad(new Set());
      setMsg(res.failed?.length ? { kind: "err", text: t("ed.partly", { tabs: res.failed.join(", ") }) } : { kind: "ok", text: t("ed.saved") });
      setReloadKey((k) => k + 1);
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_cells") {
        const cells = (e.data?.cells as CellAddr[] | undefined) ?? [];
        setBad(new Set(cells.map(key)));
        setMsg({ kind: "err", text: t("ed.invalid") });
      } else setMsg({ kind: "err", text: e instanceof ApiError ? e.message : String(e) });
    } finally { setBusy(false); }
  }, [busy, seriesId, machineMode, jetUnit, t, onSaved]);

  const select = useCallback((td: HTMLElement, a: CellAddr, e: SelMods) => {
    const k = key(a);
    if (e.shiftKey && anchor.current && document.body.contains(anchor.current)) {
      setSel(new Set(rectCells(anchor.current, td).map((x) => x.dataset.k as string)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => {
        const n = new Set(s);
        if (n.has(k)) n.delete(k); else n.add(k);
        return n;
      });
    } else if (!(e.button === 2 && selRef.current.has(k))) {
      setSel(new Set([k]));   // right-click inside the selection keeps it (desktop _GridView)
    }
    anchor.current = td;
  }, []);

  const parse = (k: string): CellAddr => {
    const [tab, r, c] = k.split("|");
    return { tab, r: Number(r), c: Number(c) };
  };

  // value a pasted/typed text means for a cell (dropdown rows: by name or id)
  const valueFor = (info: CellInfo, text: string): Change | null => {
    const v = text.trim();
    if (info.options) {
      if (v === "") return { ...info.addr, value: null, display: "" };
      const hit = info.options.find(([id, name]) => name.toLowerCase() === v.toLowerCase() || String(id) === v);
      return hit ? { ...info.addr, value: String(hit[0]), display: hit[1] } : null;
    }
    return { ...info.addr, value: v, display: v };
  };

  // Ctrl+S / Ctrl+Z / Delete, copy + paste (not while typing in an input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
      if (e.key === "Delete" && canWrite && selRef.current.size) {
        const changes: Change[] = [];
        for (const k of selRef.current) {
          const info = registry.current.get(k);
          if (info?.editable) changes.push({ ...info.addr, value: info.options ? null : "", display: "" });
        }
        if (changes.length) { e.preventDefault(); setMany(changes); }
      }
      if (e.key === "Escape") setSel(new Set());
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !selRef.current.size) return;
      const tds = [...document.querySelectorAll<HTMLElement>("td[data-k]")].filter((td) => selRef.current.has(td.dataset.k as string));
      if (!tds.length) return;
      // rows of the table in DOM order, columns in DOM order; gaps stay empty
      const rows = new Map<HTMLTableRowElement, HTMLElement[]>();
      tds.forEach((td) => {
        const tr = td.parentElement as HTMLTableRowElement;
        rows.set(tr, [...(rows.get(tr) ?? []), td]);
      });
      const cols = [...new Set(tds.map((td) => (td as HTMLTableCellElement).cellIndex))].sort((a, b) => a - b);
      const text = [...rows.entries()].sort((a, b) => a[0].rowIndex - b[0].rowIndex).map(([, cells]) =>
        cols.map((ci) => cells.find((td) => (td as HTMLTableCellElement).cellIndex === ci)?.innerText.trim() ?? "").join("\t"),
      ).join("\n");
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !canWrite || !selRef.current.size) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
      const tds = [...document.querySelectorAll<HTMLTableCellElement>("td[data-k]")].filter((td) => selRef.current.has(td.dataset.k as string));
      if (!tds.length) return;
      const top = tds.reduce((m, td) => {
        const r = (td.parentElement as HTMLTableRowElement).rowIndex, mr = (m.parentElement as HTMLTableRowElement).rowIndex;
        return r < mr || (r === mr && td.cellIndex < m.cellIndex) ? td : m;
      });
      const table = top.closest("table") as HTMLTableElement;
      const r0 = (top.parentElement as HTMLTableRowElement).rowIndex, c0 = top.cellIndex;
      // a single value into a bigger selection fills every selected cell (like Excel)
      const fillAll = grid.length === 1 && grid[0].length === 1 && tds.length > 1;
      const targets: [HTMLElement, string][] = fillAll ? tds.map((td) => [td, grid[0][0]])
        : grid.flatMap((line, i) => line.map((v, j) => [table.rows[r0 + i]?.cells[c0 + j] as HTMLElement, v] as [HTMLElement, string]));
      const changes: Change[] = [];
      let skipped = 0;
      for (const [td, v] of targets) {
        const info = td?.dataset.k ? registry.current.get(td.dataset.k) : undefined;
        if (!info?.editable) { if (td) skipped++; continue; }
        const ch = valueFor(info, v);
        if (ch) changes.push(ch); else skipped++;
      }
      e.preventDefault();
      setMany(changes);
      setMsg(skipped ? { kind: "err", text: t("ed.pasteSkipped", { n: changes.length, skipped }) } : null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [save, doUndo, canWrite, setMany, t]);

  // warn before leaving with unsaved values
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (dirtyRef.current.size) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const ctx = useMemo<Ctx>(() => ({
    canWrite,
    dirtyCount: dirty.size,
    pending: (a) => dirty.get(key(a)),
    set,
    setMany,
    invalid: (a) => bad.has(key(a)),
    hasDirty: (tab) => [...dirty.values()].some((p) => p.tab === tab),
    reloadKey,
    isSelected: (a) => sel.has(key(a)),
    select,
    selectedAddrs: () => [...selRef.current].map(parse),
    register: (info) => { registry.current.set(key(info.addr), info); },
    info: (a) => registry.current.get(key(a)),
    flash: (kind, text) => setMsg({ kind, text }),
  }), [canWrite, dirty, set, setMany, bad, reloadKey, sel, select]);

  return (
    <EditCtx.Provider value={ctx}>
      <div className="ed-bar">
        {canWrite && (
          <>
            <button className="btn-green" disabled={!dirty.size || busy} onClick={() => save()} title="Ctrl+S">
              {busy ? t("ed.saving") : t("ed.save", { n: dirty.size })}
            </button>
            <button className="btn-plain" disabled={!undo.length} onClick={doUndo} title="Ctrl+Z">{t("ed.undo")}</button>
            <button className="btn-plain" disabled={!dirty.size} onClick={() => { setDirty(new Map()); setUndo([]); setBad(new Set()); }}>
              {t("ed.discard")}
            </button>
          </>
        )}
        {msg && <span className={msg.kind === "ok" ? "rq-ok" : "login-error"}>{msg.text}</span>}
        {!msg && <span className="muted">{canWrite ? t("ed.hint") : t("ed.hintRo")}</span>}
      </div>
      {children}
      {warn && (
        <div className="modal-back" onClick={() => setWarn(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>{t("ed.unusualTitle")}</h2>
            <p className="muted">{t("ed.unusualText")}</p>
            <ul className="ed-warn">{warn.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <div className="modal-buttons">
              <button className="btn-plain" onClick={() => setWarn(null)}>{t("ed.goBack")}</button>
              <button className="btn-green" onClick={() => save(true)}>{t("ed.saveAnyway")}</button>
            </div>
          </div>
        </div>
      )}
    </EditCtx.Provider>
  );
}

const addrOf = (k: string): CellAddr => {
  const [tab, r, c] = k.split("|");
  return { tab, r: Number(r), c: Number(c) };
};

/** One table cell, Excel-like: click selects it, typing starts editing right away (the first key
    replaces the value), Enter/F2/double-click edits the current value, Enter/Tab/arrows take over
    and move on, Escape cancels. Dropdown rows open their list on any key. */
export function EditCell({ addr, text, raw, editable, options, className, title, onContextMenu }: {
  addr: CellAddr; text: string; raw?: string | null; editable: boolean;
  options?: [number | string, string][] | null; className?: string; title?: string;
  onContextMenu?: (e: RME, addr: CellAddr) => void;
}) {
  const ed = useEdit();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const tdRef = useRef<HTMLTableCellElement>(null);
  const after = useRef<[number, number] | "stay" | null>(null);
  const closing = useRef(false);          // the editor is closing - ignore the blur of the removed input
  const p = ed?.pending(addr);
  const can = !!ed?.canWrite && editable;
  const shown = p ? p.display : text;
  const selected = !!ed?.isSelected(addr);
  const cls = (className ?? "") + (p ? " dirty" : "") + (ed?.invalid(addr) ? " invalid" : "") + (can ? " editable" : "")
    + (selected ? " sel" : "");
  ed?.register({ addr, text, raw, editable: can, options });

  const move = (dr: number, dc: number, extend = false) => {
    const td = tdRef.current;
    const n = td && neighbour(td, dr, dc);
    if (!n) { td?.focus(); return; }
    n.focus();
    n.scrollIntoView({ block: "nearest", inline: "nearest" });
    ed?.select(n, addrOf(n.dataset.k as string), { shiftKey: extend });
  };
  // after the editor closed: back to this cell or on to the next one
  useEffect(() => {
    if (editing || !after.current) return;
    const a = after.current;
    after.current = null;
    if (a === "stay") tdRef.current?.focus(); else move(a[0], a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const start = (initial?: string) => {
    if (!can) return;
    closing.current = false;
    setVal(initial !== undefined ? initial : p ? String(p.value ?? "") : options ? (raw ?? "") : text);
    setEditing(true);
  };
  const commit = (v: string, then: [number, number] | "stay" | null = null) => {
    if (closing.current) return;
    closing.current = true;
    after.current = then;
    setEditing(false);
    if (!ed) return;
    if (options) {
      const opt = options.find(([id]) => String(id) === v);
      ed.set(addr, v === "" ? null : v, opt ? opt[1] : "", raw ?? "");
    } else {
      ed.set(addr, v, v, text);
    }
  };
  const cancel = () => { closing.current = true; after.current = "stay"; setEditing(false); };

  if (editing) {
    return (
      <td ref={tdRef} className={cls + " editing"} data-k={cellKey(addr)}>
        {options ? (
          <select autoFocus value={val} onChange={(e) => commit(e.target.value, "stay")} onBlur={() => { closing.current = true; setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              else if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLSelectElement).value, [1, 0]); }
              else if (e.key === "Tab") { e.preventDefault(); commit((e.target as HTMLSelectElement).value, [0, e.shiftKey ? -1 : 1]); }
            }}>
            <option value="">–</option>
            {options.map(([id, name]) => <option key={String(id)} value={String(id)}>{name}</option>)}
          </select>
        ) : (
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => commit(val)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(val, [e.shiftKey ? -1 : 1, 0]); }
              else if (e.key === "Tab") { e.preventDefault(); commit(val, [0, e.shiftKey ? -1 : 1]); }
              else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); commit(val, [e.key === "ArrowUp" ? -1 : 1, 0]); }
              else if (e.key === "Escape") cancel();
            }} />
        )}
      </td>
    );
  }
  return (
    <td ref={tdRef} className={cls} title={title} tabIndex={0} data-k={cellKey(addr)}
      onMouseDown={(e) => { if (e.button === 0 || e.button === 2) ed?.select(e.currentTarget, addr, e); }}
      onDoubleClick={() => start()}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, addr) : undefined}
      onKeyDown={(e) => {
        const k = e.key;
        if (k === "Enter" || k === "F2") { e.preventDefault(); start(); }
        else if (k === "ArrowUp") { e.preventDefault(); move(-1, 0, e.shiftKey); }
        else if (k === "ArrowDown") { e.preventDefault(); move(1, 0, e.shiftKey); }
        else if (k === "ArrowLeft") { e.preventDefault(); move(0, -1, e.shiftKey); }
        else if (k === "ArrowRight") { e.preventDefault(); move(0, 1, e.shiftKey); }
        else if (k === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
        else if (k === "Backspace" && can) { e.preventDefault(); start(""); }
        else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && can) {
          e.preventDefault();
          if (options) start(); else start(k);     // typing replaces the value (Excel)
        }
      }}>
      {shown}
    </td>
  );
}
