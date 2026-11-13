import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import AdminTable, { ColumnOrderDialog, type FkItems, type Row } from "../components/AdminTable";
import { HelpButton } from "../components/Help";

/* Manage Jets (desktop ui/screen_manage_jets.py + ui/screen_new_jet.py) on backend/app/admin_jets.py.
   Table edit -> "Save Changes"; New / Copy / Edit in Form open the jet form (fields + files).
   Without the Admin card right everything is read-only (form = "View in Form"). */

type JetsData = {
  columns: string[];
  editable: string[];
  form_columns: string[];
  bool_columns: string[];
  numeric_columns: string[];
  fk: Record<string, FkItems>;
  rows: Row[];
  can_edit: boolean;
  column_order: string[];
};

export type Usage = {
  series_id: number; label: string; machine_name: string | null;
  trial_numbers: { vno: number; yarn?: string | null; jet?: string | null; is_aty: boolean; of_pct: string | null; core_of: string | null;
    effect_of: string | null; speed: string | null }[];
};

const ID = "ID";
const FILES = "__has_files__";
const USED = "UsedInTrial";

export function errText(t: (k: string, v?: Record<string, string | number>) => string, e: unknown, area = "mj"): string {
  if (e instanceof ApiError && e.code) {
    const key = `${area}.err.${e.code}`;
    const s = t(key, (e.data?.vars ?? {}) as Record<string, string | number>);
    if (s !== key) return e.code === "bad_value" || e.code === "delete_failed" ? `${s} ${e.message}` : s;
  }
  return e instanceof Error ? e.message : String(e);
}

function trialLabel(tr: Usage["trial_numbers"][number]): string {
  const parts: string[] = [];
  if (tr.yarn) parts.push(tr.yarn);
  if (tr.jet) parts.push(tr.jet);
  if (tr.is_aty) {
    if (tr.core_of !== null) parts.push(`${tr.core_of}% Core OF`);
    if (tr.effect_of !== null) parts.push(`${tr.effect_of}% Effect OF`);
  } else if (tr.of_pct !== null) parts.push(`${tr.of_pct}% OF`);
  if (tr.speed !== null) parts.push(`${tr.speed}m/min`);
  return `V${tr.vno}${parts.length ? " - " + parts.join(", ") : ""}`;
}

export default function ManageJets() {
  const { t } = useI18n();
  const [data, setData] = useState<JetsData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ mode: "new" | "copy" | "edit"; row: Row | null } | null>(null);
  const [usage, setUsage] = useState<Record<number, Usage[] | "loading">>({});
  const [shownCount, setShownCount] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);

  const dirtyCount = Object.keys(changes).length;

  const load = useCallback((selectId?: number) => {
    setLoadErr(null);
    request<JetsData>("GET", "/api/admin/jets").then((d) => {
      setData(d);
      setChanges({});
      setUsage({});
      // movable columns: saved order first, new columns at their place after
      const rest = d.columns.filter((c) => c !== ID && c !== "Jet");
      const movable = [FILES, ...rest];   // desktop: the files column right after "Jet"
      const saved = d.column_order.filter((c) => movable.includes(c));
      setOrder([...saved, ...movable.filter((c) => !saved.includes(c))]);
      setSelected(selectId ? new Set([selectId]) : new Set());
    }).catch((e) => setLoadErr(errText(t, e)));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // warn before leaving with unsaved table changes (desktop asks the same on navigation)
  useEffect(() => {
    if (!dirtyCount) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirtyCount]);

  const columns = useMemo(() => [ID, "Jet", ...order], [order]);
  const sets = useMemo(() => data && {
    bool: new Set(data.bool_columns), numeric: new Set(data.numeric_columns), editable: new Set(data.editable),
  }, [data]);

  const onEdit = (id: number, col: string, v: unknown) => {
    const orig = data?.rows.find((r) => Number(r[ID]) === id)?.[col];
    setChanges((c) => {
      const row = { ...(c[id] ?? {}) };
      if (String(orig ?? "") === String(v ?? "")) delete row[col];
      else row[col] = v;
      const next = { ...c };
      if (Object.keys(row).length) next[id] = row; else delete next[id];
      return next;
    });
  };

  const save = async () => {
    if (!dirtyCount) { setMsg({ kind: "ok", text: t("mj.no_changes") }); return; }
    setBusy(true);
    try {
      const r = await request<{ saved: number }>("POST", "/api/admin/jets/save",
        { rows: Object.entries(changes).map(([id, values]) => ({ id: Number(id), values })) });
      setData((d) => d && { ...d, rows: d.rows.map((row) => changes[Number(row[ID])] ? { ...row, ...changes[Number(row[ID])] } : row) });
      setChanges({});
      setMsg({ kind: "ok", text: t("mj.saved", { n: r.saved }) });
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); } finally { setBusy(false); }
  };

  // Ctrl+S saves like the other edit pages
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && data?.can_edit && !form) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const firstSelected = (): Row | null => {
    if (!data || !selected.size) return null;
    const id = [...selected][0];
    const row = data.rows.find((r) => Number(r[ID]) === id);
    return row ? { ...row, ...(changes[id] ?? {}) } : null;
  };

  const openForm = (mode: "copy" | "edit", row?: Row | null) => {
    const r = row ?? firstSelected();
    if (!r) { setMsg({ kind: "err", text: t("mj.select_row") }); return; }
    setForm({ mode, row: r });
  };

  const doDelete = async () => {
    setConfirmDel(false);
    setBusy(true);
    try {
      const r = await request<{ deleted: number }>("POST", "/api/admin/jets/delete", { ids: [...selected] });
      setMsg({ kind: "ok", text: t("mj.deleted", { n: r.deleted }) });
      load();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); } finally { setBusy(false); }
  };

  const toggleUsage = (id: number) => {
    if (usage[id]) { setUsage((u) => { const n = { ...u }; delete n[id]; return n; }); return; }
    setUsage((u) => ({ ...u, [id]: "loading" }));
    request<{ series: Usage[] }>("GET", `/api/admin/jets/${id}/usage`)
      .then((r) => setUsage((u) => ({ ...u, [id]: r.series })))
      .catch((e) => { setUsage((u) => { const n = { ...u }; delete n[id]; return n; }); setMsg({ kind: "err", text: errText(t, e) }); });
  };

  if (loadErr) return <div className="card error">{loadErr}</div>;
  if (!data || !sets) return <div className="muted">{t("app.loading")}</div>;
  const ro = !data.can_edit;

  return (
    <div className="mj-page">
      <div className="page-head">
        <h1>{t("mj.title")}</h1>
        <span className="muted">{t("mj.count", { n: shownCount, total: data.rows.length })}</span>
        <HelpButton screen="manage_jets" />
      </div>
      <div className="toolbar">
        <input className="mj-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mj.search")} />
        <button className="btn-plain" onClick={() => { if (!dirtyCount || window.confirm(t("mj.discard"))) load(); }}>{t("mj.reload")}</button>
        <span className="mj-sep" />
        <button className="btn-green" disabled={ro} title={ro ? t("mj.read_only") : ""} onClick={() => setForm({ mode: "new", row: null })}>{t("mj.new")}</button>
        <button className="btn-plain" disabled={ro} title={ro ? t("mj.read_only") : ""} onClick={() => openForm("copy")}>{t("mj.copy")}</button>
        <button className="btn-plain" onClick={() => openForm("edit")}>{ro ? t("mj.view_form") : t("mj.edit_form")}</button>
        <button className="btn-plain" disabled={ro || !selected.size} title={ro ? t("mj.read_only") : ""}
          onClick={() => selected.size ? setConfirmDel(true) : setMsg({ kind: "err", text: t("mj.select_row") })}>{t("mj.delete")}</button>
        <button className="btn-green mj-save" disabled={ro || busy || !dirtyCount} title={ro ? t("mj.read_only") : "Ctrl+S"} onClick={save}>
          {t("mj.save")}{dirtyCount ? ` (${dirtyCount})` : ""}
        </button>
        <button className="btn-plain" onClick={() => setColsOpen(true)}>{t("mj.columns")}</button>
        {ro && <span className="muted">🔒 {t("mj.read_only")}</span>}
        {msg && <span className={msg.kind === "err" ? "mj-msg err" : "mj-msg"} onClick={() => setMsg(null)}>{msg.text}</span>}
      </div>

      <AdminTable
        columns={columns} frozen={2} idCol={ID} rows={data.rows} fk={data.fk}
        boolCols={sets.bool} numericCols={sets.numeric} editable={sets.editable} canEdit={!ro}
        changes={changes} onEdit={onEdit} selected={selected} onSelect={setSelected}
        onOpen={(id) => openForm("edit", data.rows.find((r) => Number(r[ID]) === id))}
        search={search} searchCols={["Jet", "Bemerkungen"]} onCount={setShownCount}
        narrow={new Set([FILES])}
        header={(c) => c === FILES ? "📎" : c}
        cell={(c, row) => {
          const id = Number(row[ID]);
          if (c === FILES) return row.has_files ? <span title={t("mj.has_files")}>📎</span> : "";
          if (c === USED) {
            if (!row[USED]) return t("mj.no");
            return (
              <button className="mj-used" title={t("mj.used_hint")} onClick={(e) => { e.stopPropagation(); toggleUsage(id); }}>
                {usage[id] ? "▾" : "▸"} {t("mj.yes")}
              </button>
            );
          }
          if (c === "CreatedBy") return (row.CreatedByName as string) ?? (row.CreatedBy == null ? "" : String(row.CreatedBy));
          return undefined;
        }}
        detail={(row) => {
          const u = usage[Number(row[ID])];
          if (!u) return null;
          if (u === "loading") return <span className="muted">{t("app.loading")}</span>;
          if (!u.length) return <span className="muted">{t("mj.usage_none")}</span>;
          return <UsageList series={u} />;
        }}
      />

      {colsOpen && (
        <ColumnOrderDialog columns={order} onChange={setOrder} label={(c) => c === FILES ? `📎 ${t("mj.files")}` : c}
          onSave={() => request("POST", "/api/admin/jets/column-order", { columns: order }).catch((e) => setMsg({ kind: "err", text: errText(t, e) }))}
          onClose={() => setColsOpen(false)} />
      )}

      {confirmDel && (
        <div className="modal-back" onClick={() => setConfirmDel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>{t("mj.delete")}</h2>
            <p>{t("mj.confirm_delete", { n: selected.size })}</p>
            <p className="muted">{data.rows.filter((r) => selected.has(Number(r[ID]))).map((r) => String(r.Jet ?? r[ID])).join(", ")}</p>
            <div className="modal-buttons">
              <button className="btn-plain" onClick={() => setConfirmDel(false)}>{t("mj.cancel")}</button>
              <button className="btn-danger" onClick={doDelete}>{t("mj.delete")}</button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <JetForm data={data} mode={form.mode} row={form.row} readOnly={ro}
          onFkAdded={(col, items) => setData((d) => d && { ...d, fk: { ...d.fk, [col]: items } })}
          onClose={() => setForm(null)}
          onSaved={(id, text) => { setForm(null); setMsg({ kind: "ok", text }); load(id); }} />
      )}
    </div>
  );
}

export function UsageList({ series }: { series: Usage[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <ul className="mj-usage">
      {series.map((s) => {
        const n = s.trial_numbers.length;
        const isOpen = open.has(s.series_id);
        return (
          <li key={s.series_id}>
            <button className="mj-used" onClick={() => setOpen((o) => { const x = new Set(o); if (x.has(s.series_id)) x.delete(s.series_id); else x.add(s.series_id); return x; })}>
              {isOpen ? "▾" : "▸"}
            </button>{" "}
            <Link to={`/series/${s.series_id}`}>{s.label}</Link>
            <span className="muted"> ({t("mj.trials", { n })}){s.machine_name ? ` - ${s.machine_name}` : ""}</span>
            {isOpen && (
              <ul>{s.trial_numbers.map((tr) => <li key={tr.vno}>• {trialLabel(tr)}</li>)}</ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ the jet form (desktop NewJetScreen) */
type JetFile = { id: number; name: string; type: string | null; kb: number | null; notes: string; exists: boolean };

function JetForm(props: { data: JetsData; mode: "new" | "copy" | "edit"; row: Row | null; readOnly: boolean;
  onClose: () => void; onSaved: (id: number, text: string) => void; onFkAdded: (col: string, items: FkItems) => void }) {
  const { t } = useI18n();
  const { data, mode, row } = props;
  const ro = props.readOnly;
  const cols = data.form_columns;
  const bool = new Set(data.bool_columns);
  const initial = useMemo(() => {
    const v: Record<string, string | boolean> = {};
    for (const c of cols) {
      const x = row?.[c];
      if (bool.has(c)) v[c] = x === 1 || x === true;
      else v[c] = x === null || x === undefined ? "" : String(x);
    }
    if (mode === "copy") v.Jet = "";
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [vals, setVals] = useState(initial);
  const [tab, setTab] = useState<"fields" | "files">("fields");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ col: string; name: string } | null>(null);
  const jetId = mode === "edit" && row ? Number(row[ID]) : null;
  const name = String(row?.Jet ?? "");
  const title = mode === "new" ? t("mj.f_new") : mode === "copy" ? t("mj.f_copy", { name })
    : ro ? t("mj.f_view", { name }) : t("mj.f_edit", { name });
  const changed = cols.some((c) => vals[c] !== initial[c]);

  const close = () => { if (!changed || ro || window.confirm(t("mj.discard"))) props.onClose(); };

  const submit = async () => {
    if (!String(vals.Jet ?? "").trim()) { setErr(t("mj.err.name_missing")); return; }
    const values: Record<string, unknown> = {};
    for (const c of cols) {
      if (mode === "edit" && vals[c] === initial[c]) continue;
      values[c] = bool.has(c) ? (vals[c] ? 1 : 0) : vals[c];
    }
    setBusy(true);
    setErr(null);
    try {
      if (mode === "edit" && jetId !== null) {
        if (Object.keys(values).length) await request("POST", `/api/admin/jets/${jetId}/update`, { values });
        props.onSaved(jetId, t("mj.f_saved", { name: String(vals.Jet) }));
      } else {
        const r = await request<{ id: number }>("POST", "/api/admin/jets/new", { values });
        props.onSaved(r.id, t("mj.f_created", { name: String(vals.Jet) }));
      }
    } catch (e) { setErr(errText(t, e)); } finally { setBusy(false); }
  };

  const quickAdd = async () => {
    if (!adding || !adding.name.trim()) return;
    try {
      const r = await request<{ id: number; items: FkItems }>("POST", "/api/admin/jets/fk", { column: adding.col, name: adding.name.trim() });
      props.onFkAdded(adding.col, r.items);
      setVals((v) => ({ ...v, [adding.col]: String(r.id) }));
      setAdding(null);
    } catch (e) { setErr(errText(t, e)); }
  };

  const half = Math.ceil(cols.length / 2);
  const field = (c: string) => {
    const items = data.fk[c];
    let input;
    if (bool.has(c)) {
      input = <input type="checkbox" checked={Boolean(vals[c])} disabled={ro} onChange={(e) => setVals((v) => ({ ...v, [c]: e.target.checked }))} />;
    } else if (items) {
      input = (
        <span className="mj-fk">
          <select value={String(vals[c] ?? "")} disabled={ro} onChange={(e) => setVals((v) => ({ ...v, [c]: e.target.value }))}>
            <option value="" />
            {items.map(([i, n]) => <option key={String(i)} value={String(i)}>{n}</option>)}
          </select>
          {!ro && <button className="btn-green mj-plus" title={t("mj.f_add_value", { col: c })} onClick={() => setAdding({ col: c, name: "" })}>+</button>}
        </span>
      );
    } else {
      input = <input value={String(vals[c] ?? "")} disabled={ro} inputMode={data.numeric_columns.includes(c) ? "decimal" : undefined}
        onChange={(e) => setVals((v) => ({ ...v, [c]: e.target.value }))} />;
    }
    return (
      <label key={c} className={vals[c] !== initial[c] ? "mj-changed" : ""}>
        <span>{c}{c === "Jet" ? " *" : ""}</span>{input}
      </label>
    );
  };

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal modal-wide mj-form" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <div className="se-tabs">
          <button className={"se-tab" + (tab === "fields" ? " on" : "")} onClick={() => setTab("fields")}>{t("mj.f_fields")}</button>
          <button className={"se-tab" + (tab === "files" ? " on" : "")} disabled={jetId === null}
            title={jetId === null ? t("mj.files_after_save") : ""} onClick={() => setTab("files")}>{t("mj.files")}</button>
        </div>
        {tab === "fields" ? (
          <div className="mj-fields">
            <div>
              <label><span>{ID}</span><i className="muted">{jetId ?? t("mj.f_auto")}</i></label>
              {cols.slice(0, half).map(field)}
            </div>
            <div>
              {cols.slice(half).map(field)}
              {mode === "edit" && "CreatedByName" in (row ?? {}) && (
                <>
                  <label><span>CreatedBy</span><i className="muted">{String(row?.CreatedByName ?? row?.CreatedBy ?? "")}</i></label>
                  <label><span>CreationDate</span><i className="muted">{String(row?.CreationDate ?? "")}</i></label>
                </>
              )}
            </div>
          </div>
        ) : jetId !== null && <JetFiles jetId={jetId} readOnly={ro} />}
        {adding && (
          <div className="mj-add">
            <b>{t("mj.f_add_value", { col: adding.col })}</b>
            <input autoFocus value={adding.name} placeholder={t("mj.f_add_name", { col: adding.col })}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") quickAdd(); if (e.key === "Escape") setAdding(null); }} />
            <button className="btn-green" disabled={!adding.name.trim()} onClick={quickAdd}>{t("mj.f_add")}</button>
            <button className="btn-plain" onClick={() => setAdding(null)}>{t("mj.cancel")}</button>
          </div>
        )}
        {err && <div className="mj-msg err">{err}</div>}
        <div className="modal-buttons">
          <button className="btn-plain" onClick={close}>{ro ? t("mj.close") : t("mj.cancel")}</button>
          {!ro && <button className="btn-green" disabled={busy} onClick={submit}>{t("mj.f_save")}</button>}
        </div>
      </div>
    </div>
  );
}

const IMG = /\.(png|jpe?g|bmp|gif|webp)$/i;

function JetFiles({ jetId, readOnly }: { jetId: number; readOnly: boolean }) {
  const { t } = useI18n();
  const [files, setFiles] = useState<JetFile[] | null>(null);
  const [sel, setSel] = useState<JetFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    request<{ files: JetFile[] }>("GET", `/api/admin/jets/${jetId}/files`).then((r) => setFiles(r.files)).catch((e) => setErr(errText(t, e)));
  }, [jetId, t]);
  useEffect(() => { load(); }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append("files", f));
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jets/${jetId}/files`, { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new ApiError(res.status, j.detail ?? res.statusText, j.code, j);
      setErr(j.errors?.length ? j.errors.join("\n") : null);
      load();
    } catch (e) { setErr(errText(t, e)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!sel || !window.confirm(t("mj.file_confirm_delete", { name: sel.name }))) return;
    try {
      await request("DELETE", `/api/admin/jets/files/${sel.id}`);
      setSel(null);
      load();
    } catch (e) { setErr(errText(t, e)); }
  };

  const url = (f: JetFile) => `/api/admin/jets/files/${f.id}`;
  return (
    <div className="mj-files">
      <p className="muted">{t("mj.files_info")}</p>
      <div className="mj-files-grid">
        <div>
          <ul className="mj-filelist">
            {files === null ? <li className="muted">{t("app.loading")}</li>
              : !files.length ? <li className="muted">{t("mj.files_none")}</li>
              : files.map((f) => (
                <li key={f.id} className={sel?.id === f.id ? "sel" : ""} onClick={() => setSel(f)}
                  onDoubleClick={() => f.exists && window.open(url(f), "_blank")}>
                  {f.type === "image" ? "🖼" : f.type === "pdf" ? "📄" : "📎"} {f.name}
                  {!f.exists && <span className="mj-missing" title={t("mj.file_missing")}> ⚠</span>}
                </li>
              ))}
          </ul>
          <div className="toolbar">
            {!readOnly && (
              <label className="btn-green mj-upload">
                {busy ? t("app.loading") : t("mj.file_upload")}
                <input type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              </label>
            )}
            <button className="btn-plain" disabled={!sel?.exists} onClick={() => sel && window.open(url(sel), "_blank")}>{t("mj.file_open")}</button>
            {!readOnly && <button className="btn-plain" disabled={!sel} onClick={remove}>{t("mj.delete")}</button>}
          </div>
        </div>
        <div className="mj-preview">
          {!sel ? <span className="muted">{t("mj.file_no_sel")}</span>
            : !sel.exists ? <span className="muted">{t("mj.file_missing")}</span>
            : IMG.test(sel.name) ? <img src={url(sel)} alt={sel.name} />
            : <span className="muted">{sel.name}{sel.kb ? ` · ${sel.kb} KB` : ""}</span>}
          {sel?.notes && <div className="muted">{sel.notes}</div>}
        </div>
      </div>
      {err && <div className="mj-msg err" style={{ whiteSpace: "pre-wrap" }}>{err}</div>}
    </div>
  );
}

