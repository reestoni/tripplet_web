import { useCallback, useEffect, useMemo, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import AdminTable, { ColumnOrderDialog, type FkItems, type Row } from "../components/AdminTable";
import { HelpButton } from "../components/Help";
import { useContextMenu } from "../components/ContextMenu";
import { errText as errTextFor, UsageList, type Usage } from "./ManageJets";

/* Manage Yarn (desktop ui/screen_manage_yarn.py + ui/screen_new_yarn.py) on backend/app/admin_yarn.py.
   Rights like the desktop: everyone may edit / create, MinStock only superusers, Delete only with the
   Admin card right. Every save checks for duplicate yarns and asks "Save anyway?". */

type Special = Record<"dpf" | "endtiter" | "filaments" | "minstock" | "garntyp" | "material" | "yarngroup" | "colour"
  | "createdby" | "creationdate" | "usedintrial" | "stockkg" | "name", string | null>;

type YarnData = {
  columns: string[];
  labels: Record<string, string>;
  special: Special;
  editable: string[];
  form_columns: string[];
  numeric_columns: string[];
  fk: Record<string, FkItems>;
  colour_css: Record<string, string | null>;
  rows: Row[];
  can_delete: boolean;
  can_edit_minstock: boolean;
  kb: Record<string, Record<string, string>>;   // column -> value id -> Knowledge Base route (Material / Garntyp)
  column_order: string[];
};

const ID = "ID";
type T = (k: string, v?: Record<string, string | number>) => string;
const errText = (t: T, e: unknown) => errTextFor(t, e, "my");

function dpf(endtiter: unknown, fils: unknown): string {
  const e = parseFloat(String(endtiter ?? "").replace(",", "."));
  const f = parseFloat(String(fils ?? "").replace(",", "."));
  return Number.isFinite(e) && Number.isFinite(f) && e && f ? (e / f).toFixed(3) : "";
}

function Square({ css }: { css: string | null | undefined }) {
  return css ? <span className="ce-dot my-sq" style={{ background: css }} /> : null;
}

/* "Possible duplicate yarn" - default answer is No (desktop QMessageBox default button) */
function DuplicateAsk({ err, onYes, onNo }: { err: ApiError; onYes: () => void; onNo: () => void }) {
  const { t } = useI18n();
  const v = (err.data?.vars ?? {}) as Record<string, string | number>;
  return (
    <div className="modal-back" onClick={onNo}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>⚠ {t("my.dup_title")}</h2>
        <p>{err.code === "duplicate_identical" ? t("my.dup_identical", v) : t("my.dup_similar", v)}</p>
        <p>{t("my.dup_ask")}</p>
        <div className="modal-buttons">
          <button className="btn-plain" autoFocus onClick={onNo}>{t("my.no")}</button>
          <button className="btn-green" onClick={onYes}>{t("my.yes")}</button>
        </div>
      </div>
    </div>
  );
}

/* "+ Add new colour…": same name -> existing colour; similar -> use it / create anyway / cancel */
function ColourAdd({ onDone, onClose }: { onDone: (r: { id: number; name: string; items: FkItems; css: string | null }) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [similar, setSimilar] = useState<{ id: number; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async (force: boolean) => {
    try {
      onDone(await request("POST", "/api/admin/yarn/colour", { name: name.trim(), force }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "colour_similar") setSimilar(e.data?.match as { id: number; name: string });
      else setErr(errText(t, e));
    }
  };
  const useExisting = async () => {
    // the server returns the list again for an existing name
    try { onDone(await request("POST", "/api/admin/yarn/colour", { name: similar!.name, force: false })); } catch (e) { setErr(errText(t, e)); }
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{t("my.colour_new")}</h2>
        {!similar ? (
          <>
            <label className="my-colour-in">{t("my.colour_name")}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) send(false); if (e.key === "Escape") onClose(); }} />
            </label>
            {err && <div className="mj-msg err">{err}</div>}
            <div className="modal-buttons">
              <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
              <button className="btn-green" disabled={!name.trim()} onClick={() => send(false)}>{t("mj.f_add")}</button>
            </div>
          </>
        ) : (
          <>
            <p>{t("my.colour_similar", { name: name.trim(), match: similar.name })}</p>
            {err && <div className="mj-msg err">{err}</div>}
            <div className="modal-buttons">
              <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
              <button className="btn-plain" onClick={() => send(true)}>{t("my.colour_create_anyway", { name: name.trim() })}</button>
              <button className="btn-green" autoFocus onClick={useExisting}>{t("my.colour_use", { match: similar.name })}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ManageYarn() {
  const { t } = useI18n();
  const [data, setData] = useState<YarnData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ mode: "new" | "edit"; row: Row | null } | null>(null);
  const [usage, setUsage] = useState<Record<number, Usage[] | "loading">>({});
  const [shownCount, setShownCount] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dup, setDup] = useState<ApiError | null>(null);
  const [colourFor, setColourFor] = useState<{ col: string; id: number } | null>(null);
  const dirtyCount = Object.keys(changes).length;
  const cm = useContextMenu();

  const load = useCallback((selectId?: number) => {
    setLoadErr(null);
    request<YarnData>("GET", "/api/admin/yarn").then((d) => {
      setData(d);
      setChanges({});
      setUsage({});
      const movable = d.columns.filter((c) => c !== ID && c !== d.special.name);
      const saved = d.column_order.filter((c) => movable.includes(c));
      setOrder([...saved, ...movable.filter((c) => !saved.includes(c))]);
      setSelected(selectId ? new Set([selectId]) : new Set());
    }).catch((e) => setLoadErr(errText(t, e)));
  }, [t]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!dirtyCount) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirtyCount]);

  const sp = data?.special;
  const columns = useMemo(() => (sp ? [ID, sp.name ?? "Name", ...order] : []), [order, sp]);
  const sets = useMemo(() => data && {
    numeric: new Set(data.numeric_columns), editable: new Set(data.editable),
  }, [data]);

  const onEdit = (id: number, col: string, v: unknown) => {
    const orig = data?.rows.find((r) => Number(r[ID]) === id)?.[col];
    setChanges((c) => {
      const row = { ...(c[id] ?? {}) };
      if (String(orig ?? "") === String(v ?? "")) delete row[col]; else row[col] = v;
      const next = { ...c };
      if (Object.keys(row).length) next[id] = row; else delete next[id];
      return next;
    });
  };

  const save = async (confirmed = false) => {
    if (!dirtyCount) { setMsg({ kind: "ok", text: t("mj.no_changes") }); return; }
    setBusy(true);
    try {
      const r = await request<{ saved: number }>("POST", "/api/admin/yarn/save",
        { rows: Object.entries(changes).map(([id, values]) => ({ id: Number(id), values })), confirmed });
      setMsg({ kind: "ok", text: t("mj.saved", { n: r.saved }) });
      load([...selected][0]);
    } catch (e) {
      if (e instanceof ApiError && e.code?.startsWith("duplicate_")) setDup(e);
      else setMsg({ kind: "err", text: errText(t, e) });
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !form) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openEdit = (row?: Row | null) => {
    let r = row;
    if (!r && data && selected.size) {
      const id = [...selected][0];
      r = data.rows.find((x) => Number(x[ID]) === id) ?? null;
    }
    if (!r) { setMsg({ kind: "err", text: t("mj.select_row") }); return; }
    setForm({ mode: "edit", row: r });
  };

  const doDelete = async () => {
    setConfirmDel(false);
    setBusy(true);
    try {
      const r = await request<{ deleted: number }>("POST", "/api/admin/yarn/delete", { ids: [...selected] });
      setMsg({ kind: "ok", text: t("my.deleted", { n: r.deleted }) });
      load();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); } finally { setBusy(false); }
  };

  const toggleUsage = (id: number) => {
    if (usage[id]) { setUsage((u) => { const n = { ...u }; delete n[id]; return n; }); return; }
    setUsage((u) => ({ ...u, [id]: "loading" }));
    request<{ series: Usage[] }>("GET", `/api/admin/yarn/${id}/usage`)
      .then((r) => setUsage((u) => ({ ...u, [id]: r.series })))
      .catch((e) => { setUsage((u) => { const n = { ...u }; delete n[id]; return n; }); setMsg({ kind: "err", text: errText(t, e) }); });
  };

  const colourAdded = (r: { id: number; items: FkItems; css: string | null }) => {
    if (!data || !sp?.colour) return;
    setData({ ...data, fk: { ...data.fk, [sp.colour]: r.items }, colour_css: { ...data.colour_css, [String(r.id)]: r.css } });
  };

  if (loadErr) return <div className="card error">{loadErr}</div>;
  if (!data || !sets || !sp) return <div className="muted">{t("app.loading")}</div>;
  const label = (c: string) => data.labels[c] ?? c;
  const css = (id: unknown) => (id === null || id === undefined || id === "" ? null : data.colour_css[String(id)]);

  return (
    <div className="mj-page">
      <div className="page-head">
        <h1>{t("my.title")}</h1>
        <span className="muted">{t("my.count", { n: shownCount, total: data.rows.length })}</span>
        <HelpButton screen="manage_yarn" />
      </div>
      <div className="toolbar">
        <input className="mj-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("my.search")} />
        <button className="btn-plain" onClick={() => { if (!dirtyCount || window.confirm(t("mj.discard"))) load(); }}>{t("mj.reload")}</button>
        <span className="mj-sep" />
        <button className="btn-green" onClick={() => setForm({ mode: "new", row: null })}>{t("my.new")}</button>
        <button className="btn-plain" onClick={() => openEdit()}>{t("mj.edit_form")}</button>
        <button className="btn-plain" onClick={() => setColsOpen(true)}>{t("mj.columns")}</button>
        <button className="btn-plain" disabled={!data.can_delete || !selected.size} title={data.can_delete ? "" : t("my.no_delete")}
          onClick={() => setConfirmDel(true)}>{t("mj.delete")}</button>
        <button className="btn-green mj-save" disabled={busy || !dirtyCount} title="Ctrl+S" onClick={() => save()}>
          {t("mj.save")}{dirtyCount ? ` (${dirtyCount})` : ""}
        </button>
        {!data.can_edit_minstock && <span className="muted" title={t("my.minstock_locked")}>🔒 MinStock</span>}
        {msg && <span className={msg.kind === "err" ? "mj-msg err" : "mj-msg"} onClick={() => setMsg(null)}>{msg.text}</span>}
      </div>

      <AdminTable
        columns={columns} frozen={2} frozenWidths={[60, 300]} idCol={ID} rows={data.rows} fk={data.fk}
        boolCols={new Set()} numericCols={sets.numeric} editable={sets.editable} canEdit
        changes={changes} onEdit={onEdit} selected={selected} onSelect={setSelected}
        onOpen={(id) => openEdit(data.rows.find((r) => Number(r[ID]) === id))}
        search={search} searchCols={[sp.name ?? "Name"]} onCount={setShownCount}
        onCellMenu={(e, col, v) => {
          const url = v === null || v === undefined ? undefined : data.kb?.[col]?.[String(v)];
          if (url) cm.open(e, [{ label: t("kb.learnMore"), onClick: () => window.open(url, "_blank") }]);
        }}
        header={label}
        prefix={(c, _row, val) => (c === sp.name || c === sp.colour) && sp.colour ? <Square css={css(val(sp.colour))} /> : null}
        addNew={sp.colour ? { cols: new Set([sp.colour]), label: t("my.colour_add"), onAdd: (col, id) => setColourFor({ col, id }) } : undefined}
        cell={(c, row, val) => {
          const id = Number(row[ID]);
          if (c === sp.dpf) return dpf(sp.endtiter ? val(sp.endtiter) : null, sp.filaments ? val(sp.filaments) : null);
          if (c === sp.stockkg) return Number(row[c] ?? 0).toFixed(1);
          if (c === sp.usedintrial) {
            if (!row[c]) return t("mj.no");
            return (
              <button className="mj-used" title={t("my.used_hint")} onClick={(e) => { e.stopPropagation(); toggleUsage(id); }}>
                {t("mj.yes")} {usage[id] ? "▾" : "▸"}
              </button>
            );
          }
          if (c === sp.createdby) return (row.CreatedByName as string) ?? (row[c] == null ? "" : String(row[c]));
          return undefined;
        }}
        detail={(row) => {
          const u = usage[Number(row[ID])];
          if (!u) return null;
          if (u === "loading") return <span className="muted">{t("app.loading")}</span>;
          if (!u.length) return <span className="muted">{t("my.usage_none")}</span>;
          return <UsageList series={u} />;
        }}
      />

      {cm.menu}
      {colsOpen && (
        <ColumnOrderDialog columns={order} onChange={setOrder} label={label}
          onSave={() => request("POST", "/api/admin/yarn/column-order", { columns: [ID, sp.name, ...order] }).catch((e) => setMsg({ kind: "err", text: errText(t, e) }))}
          onClose={() => setColsOpen(false)} />
      )}

      {confirmDel && (
        <div className="modal-back" onClick={() => setConfirmDel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>{t("mj.delete")}</h2>
            <p>{t("my.confirm_delete", { n: selected.size })}</p>
            <p className="muted">{data.rows.filter((r) => selected.has(Number(r[ID]))).map((r) => String(r[sp.name ?? "Name"] ?? r[ID])).join(", ")}</p>
            <div className="modal-buttons">
              <button className="btn-plain" onClick={() => setConfirmDel(false)}>{t("mj.cancel")}</button>
              <button className="btn-danger" onClick={doDelete}>{t("mj.delete")}</button>
            </div>
          </div>
        </div>
      )}

      {dup && <DuplicateAsk err={dup} onNo={() => { setDup(null); setMsg({ kind: "err", text: t("my.dup_cancelled") }); }}
        onYes={() => { setDup(null); save(true); }} />}

      {colourFor && (
        <ColourAdd onClose={() => setColourFor(null)} onDone={(r) => {
          colourAdded(r);
          onEdit(colourFor.id, colourFor.col, r.id);
          setColourFor(null);
        }} />
      )}

      {form && (
        <YarnForm data={data} mode={form.mode} row={form.row} onColourAdded={colourAdded}
          onClose={() => setForm(null)}
          onSaved={(id, text) => { setForm(null); setMsg({ kind: "ok", text }); load(id); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the yarn form (desktop NewYarnScreen) */
function YarnForm(props: { data: YarnData; mode: "new" | "edit"; row: Row | null; onClose: () => void;
  onSaved: (id: number, text: string) => void; onColourAdded: (r: { id: number; items: FkItems; css: string | null }) => void }) {
  const { t } = useI18n();
  const { data, mode, row } = props;
  const sp = data.special;
  const cols = data.form_columns;
  const editable = new Set(data.editable);
  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const c of cols) { const x = row?.[c]; v[c] = x === null || x === undefined ? "" : String(x); }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [vals, setVals] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<ApiError | null>(null);
  const [addColour, setAddColour] = useState(false);
  const yarnId = mode === "edit" && row ? Number(row[ID]) : null;
  const changed = cols.some((c) => vals[c] !== initial[c]);
  const label = (c: string) => data.labels[c] ?? c;
  const close = () => { if (!changed || window.confirm(t("mj.discard"))) props.onClose(); };

  const submit = async (confirmed = false) => {
    const values: Record<string, unknown> = {};
    for (const c of cols) {
      if (!editable.has(c)) continue;                         // DPF, locked MinStock
      if (mode === "edit" && vals[c] === initial[c]) continue;
      values[c] = vals[c];
    }
    setBusy(true);
    setErr(null);
    try {
      const name = vals[sp.name ?? "Name"] || "New Yarn";
      if (yarnId !== null) {
        if (Object.keys(values).length) await request("POST", `/api/admin/yarn/${yarnId}/update`, { values, confirmed });
        props.onSaved(yarnId, t("my.f_saved", { name }));
      } else {
        const r = await request<{ id: number }>("POST", "/api/admin/yarn/new", { values, confirmed });
        props.onSaved(r.id, t("my.f_created", { name }));
      }
    } catch (e) {
      if (e instanceof ApiError && e.code?.startsWith("duplicate_")) setDup(e);
      else setErr(errText(t, e));
    } finally { setBusy(false); }
  };

  const half = Math.ceil(cols.length / 2);
  const field = (c: string) => {
    let input;
    if (c === sp.dpf) {
      input = <i className="muted">{dpf(sp.endtiter ? vals[sp.endtiter] : "", sp.filaments ? vals[sp.filaments] : "")}</i>;
    } else if (data.fk[c]) {
      input = (
        <span className="mj-fk">
          {c === sp.colour && <Square css={vals[c] ? data.colour_css[vals[c]] : null} />}
          <select value={vals[c]} disabled={!editable.has(c)} onChange={(e) => {
            if (e.target.value === "__add__") { setAddColour(true); return; }
            setVals((v) => ({ ...v, [c]: e.target.value }));
          }}>
            <option value="" />
            {data.fk[c].map(([i, n]) => <option key={String(i)} value={String(i)}>{n}</option>)}
            {c === sp.colour && <option value="__add__">{t("my.colour_add")}</option>}
          </select>
        </span>
      );
    } else {
      const locked = !editable.has(c);
      input = <input value={vals[c]} disabled={locked} title={c === sp.minstock && locked ? t("my.minstock_locked") : ""}
        inputMode={data.numeric_columns.includes(c) ? "decimal" : undefined}
        onChange={(e) => setVals((v) => ({ ...v, [c]: e.target.value }))} />;
    }
    return (
      <label key={c} className={vals[c] !== initial[c] ? "mj-changed" : ""}>
        <span>{label(c)}</span>{input}
      </label>
    );
  };

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal modal-wide mj-form" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{mode === "new" ? t("my.new") : t("my.f_edit", { name: String(row?.[sp.name ?? "Name"] ?? "") })}</h2>
        <div className="mj-fields">
          <div>
            <label><span>{ID}</span><i className="muted">{yarnId ?? t("mj.f_auto")}</i></label>
            {cols.slice(0, half).map(field)}
          </div>
          <div>
            {cols.slice(half).map(field)}
            {mode === "edit" && sp.createdby && row && (
              <>
                <label><span>{sp.createdby}</span><i className="muted">{String(row.CreatedByName ?? row[sp.createdby] ?? "")}</i></label>
                {sp.creationdate && <label><span>{sp.creationdate}</span><i className="muted">{String(row[sp.creationdate] ?? "")}</i></label>}
              </>
            )}
          </div>
        </div>
        {err && <div className="mj-msg err">{err}</div>}
        <div className="modal-buttons">
          <button className="btn-plain" onClick={close}>{t("mj.cancel")}</button>
          <button className="btn-green" disabled={busy} onClick={() => submit()}>{t("mj.save")}</button>
        </div>
        {dup && <DuplicateAsk err={dup} onNo={() => setDup(null)} onYes={() => { setDup(null); submit(true); }} />}
        {addColour && sp.colour && (
          <ColourAdd onClose={() => setAddColour(false)} onDone={(r) => {
            props.onColourAdded(r);
            setVals((v) => ({ ...v, [sp.colour!]: String(r.id) }));
            setAddColour(false);
          }} />
        )}
      </div>
    </div>
  );
}
