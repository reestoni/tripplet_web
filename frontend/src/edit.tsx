import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { request, ApiError } from "./api";
import { useI18n } from "./i18n";

/* Editing Show Experiment like the desktop: unsaved values are yellow, "Save (n)" / Ctrl+S writes
   them through the server (same rules as the desktop: db/series_save), Ctrl+Z undoes the last
   unsaved change, the plausibility check asks before unusual values are saved. */

export type CellAddr = { tab: string; r: number; c: number };
type Pending = CellAddr & { value: string | number | null; display: string };
const key = (a: CellAddr) => `${a.tab}|${a.r}|${a.c}`;

type Ctx = {
  canWrite: boolean;
  dirtyCount: number;
  pending: (a: CellAddr) => Pending | undefined;
  set: (a: CellAddr, value: string | number | null, display: string, original: string) => void;
  invalid: (a: CellAddr) => boolean;
  hasDirty: (tab: string) => boolean;
  reloadKey: number;
};

const EditCtx = createContext<Ctx | null>(null);
export const useEdit = () => useContext(EditCtx);

export function EditProvider({ seriesId, canWrite, children, machineMode, jetUnit, onSaved }: {
  seriesId: number; canWrite: boolean; children: ReactNode; machineMode: () => string; jetUnit: () => string;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [dirty, setDirty] = useState<Map<string, Pending>>(new Map());
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ k: string; prev: Pending | undefined }[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const set = useCallback((a: CellAddr, value: string | number | null, display: string, original: string) => {
    setDirty((d) => {
      const k = key(a);
      const next = new Map(d);
      setUndo((u) => [...u, { k, prev: d.get(k) }]);
      if (display === original && value !== null && String(value) === original) next.delete(k);
      else next.set(k, { ...a, value, display });
      return next;
    });
    setBad((b) => { const n = new Set(b); n.delete(key(a)); return n; });
  }, []);

  const doUndo = useCallback(() => {
    setUndo((u) => {
      if (!u.length) return u;
      const last = u[u.length - 1];
      setDirty((d) => {
        const n = new Map(d);
        if (last.prev) n.set(last.k, last.prev); else n.delete(last.k);
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

  // Ctrl+S / Ctrl+Z (not while typing in an input - the input handles its own undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); doUndo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, doUndo]);

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
    invalid: (a) => bad.has(key(a)),
    hasDirty: (tab) => [...dirty.values()].some((p) => p.tab === tab),
    reloadKey,
  }), [canWrite, dirty, set, bad, reloadKey]);

  return (
    <EditCtx.Provider value={ctx}>
      {canWrite && (
        <div className="ed-bar">
          <button className="btn-green" disabled={!dirty.size || busy} onClick={() => save()} title="Ctrl+S">
            {busy ? t("ed.saving") : t("ed.save", { n: dirty.size })}
          </button>
          <button className="btn-plain" disabled={!undo.length} onClick={doUndo} title="Ctrl+Z">{t("ed.undo")}</button>
          <button className="btn-plain" disabled={!dirty.size} onClick={() => { setDirty(new Map()); setUndo([]); setBad(new Set()); }}>
            {t("ed.discard")}
          </button>
          {msg && <span className={msg.kind === "ok" ? "rq-ok" : "login-error"}>{msg.text}</span>}
          {!msg && <span className="muted">{t("ed.hint")}</span>}
        </div>
      )}
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

/** One table cell that can be edited (double-click or Enter; Escape cancels). */
export function EditCell({ addr, text, raw, editable, options, className, title }: {
  addr: CellAddr; text: string; raw?: string | null; editable: boolean;
  options?: [number | string, string][] | null; className?: string; title?: string;
}) {
  const ed = useEdit();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const p = ed?.pending(addr);
  const can = !!ed?.canWrite && editable;
  const shown = p ? p.display : text;
  const cls = (className ?? "") + (p ? " dirty" : "") + (ed?.invalid(addr) ? " invalid" : "") + (can ? " editable" : "");

  const start = () => {
    if (!can) return;
    setVal(p ? String(p.value ?? "") : options ? (raw ?? "") : text);
    setEditing(true);
  };
  const commit = (v: string) => {
    setEditing(false);
    if (!ed) return;
    if (options) {
      const opt = options.find(([id]) => String(id) === v);
      ed.set(addr, v === "" ? null : v, opt ? opt[1] : "", raw ?? "");
    } else {
      ed.set(addr, v, v, text);
    }
  };

  if (editing) {
    return (
      <td className={cls + " editing"}>
        {options ? (
          <select autoFocus value={val} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}>
            <option value="">–</option>
            {options.map(([id, name]) => <option key={String(id)} value={String(id)}>{name}</option>)}
          </select>
        ) : (
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => commit(val)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(val); if (e.key === "Escape") setEditing(false); }} />
        )}
      </td>
    );
  }
  return (
    <td className={cls} title={title} tabIndex={can ? 0 : undefined} onDoubleClick={start}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "F2") start(); }}>
      {shown}
    </td>
  );
}
