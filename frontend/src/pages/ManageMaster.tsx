import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";
import AdminTable, { ColumnOrderDialog, type Row } from "../components/AdminTable";
import { Modal } from "../components/SeriesTools";
import { errText, JetFiles } from "./ManageJets";

/* The small Admin master tables (desktop ui/screen_manage_order_types.py, screen_manage_product_groups.py,
   screen_manage_material.py, screen_manage_top_plates.py + screen_new_top_plate.py) on
   backend/app/admin_master.py -> db/master_tables.py. One page, `kind` picks the table:
   edit in the table, New, Delete, Save (Ctrl+S), column order; Material: "Used in yarn" opens the yarns;
   Top Plates: New / Copy with a unique name, files per top plate. Writing = Admin card right. */

export type MasterKind = "order_types" | "product_groups" | "material" | "top_plates" | "projects";
type Data = { columns: string[]; editable: string[]; numeric_columns: string[]; int_columns: string[]; bool_columns: string[];
  name_column: string | null; rows: Row[]; can_edit: boolean; column_order: string[] };

const ID = "ID";
const FILES = "__files__";
const USED = "UsedInYarn";
const USED_BY = "UsedBy";             // projects: experiments + requests that use it (shown only)
const BASE = "/api/admin/master";

export default function ManageMaster({ kind }: { kind: MasterKind }) {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shownCount, setShownCount] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);
  const [usage, setUsage] = useState<Record<number, { id: number; label: string }[] | "loading">>({});
  const [nameForm, setNameForm] = useState<{ name: string; copyOf: Row | null } | null>(null);
  const [filesFor, setFilesFor] = useState<Row | null>(null);
  const plates = kind === "top_plates";
  const dirtyCount = Object.keys(changes).length;

  const load = useCallback((selectId?: number) => {
    setLoadErr(null);
    request<Data>("GET", `${BASE}/${kind}`).then((d) => {
      setData(d);
      setChanges({});
      setUsage({});
      const first = d.name_column;
      const rest = d.columns.filter((c) => c !== ID && c !== first);
      const movable = plates ? [FILES, ...rest] : rest;
      const saved = d.column_order.filter((c) => movable.includes(c));
      setOrder([...saved, ...movable.filter((c) => !saved.includes(c))]);
      setSelected(selectId ? new Set([selectId]) : new Set());
    }).catch((e) => setLoadErr(errText(t, e)));
  }, [kind, plates, t]);
  useEffect(() => { setSearch(""); setMsg(null); load(); }, [load]);

  useEffect(() => {
    if (!dirtyCount) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirtyCount]);

  const columns = useMemo(() => (data ? [ID, ...(data.name_column ? [data.name_column] : []), ...order] : []), [data, order]);
  const sets = useMemo(() => data && {
    bool: new Set(data.bool_columns), numeric: new Set(data.numeric_columns), editable: new Set(data.editable),
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

  const save = async () => {
    if (!dirtyCount) { setMsg({ kind: "ok", text: t("mj.no_changes") }); return; }
    setBusy(true);
    try {
      const r = await request<{ saved: number }>("POST", `${BASE}/${kind}/save`,
        { rows: Object.entries(changes).map(([id, values]) => ({ id: Number(id), values })) });
      setData((d) => d && { ...d, rows: d.rows.map((row) => changes[Number(row[ID])] ? { ...row, ...changes[Number(row[ID])] } : row) });
      setChanges({});
      setMsg({ kind: "ok", text: t("mj.saved", { n: r.saved }) });
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); } finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && data?.can_edit && !nameForm) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const create = async (values: Row = {}) => {
    if (dirtyCount && !window.confirm(t("mj.discard"))) return;
    setBusy(true);
    try {
      const r = await request<{ id: number }>("POST", `${BASE}/${kind}/new`, { values });
      setNameForm(null);
      setMsg({ kind: "ok", text: t("mm.created") });
      load(r.id);
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); } finally { setBusy(false); }
  };

  const firstSelected = (): Row | null => {
    if (!data || !selected.size) return null;
    const id = [...selected][0];
    const row = data.rows.find((r) => Number(r[ID]) === id);
    return row ? { ...row, ...(changes[id] ?? {}) } : null;
  };

  const doDelete = async () => {
    setConfirmDel(false);
    setBusy(true);
    try {
      const r = await request<{ deleted: number }>("POST", `${BASE}/${kind}/delete`, { ids: [...selected] });
      setMsg({ kind: "ok", text: t("mj.deleted", { n: r.deleted }) });
      load();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); } finally { setBusy(false); }
  };

  const toggleUsage = (id: number) => {
    if (usage[id]) { setUsage((u) => { const n = { ...u }; delete n[id]; return n; }); return; }
    setUsage((u) => ({ ...u, [id]: "loading" }));
    request<{ yarns: { id: number; label: string }[] }>("GET", `${BASE}/material/${id}/usage`)
      .then((r) => setUsage((u) => ({ ...u, [id]: r.yarns })))
      .catch((e) => { setUsage((u) => { const n = { ...u }; delete n[id]; return n; }); setMsg({ kind: "err", text: errText(t, e) }); });
  };

  if (loadErr) return <div className="card error">{loadErr}</div>;
  if (!data || !sets) return <div className="muted">{t("app.loading")}</div>;
  const ro = !data.can_edit;
  const nameOf = (r: Row) => String((data.name_column ? r[data.name_column] : null) ?? r[ID]);

  return (
    <div className="mj-page">
      <div className="page-head">
        <h1>{t(`mm.title.${kind}`)}</h1>
        <span className="muted">{t("mm.count", { n: shownCount, total: data.rows.length })}</span>
      </div>
      <div className="toolbar">
        <input className="mj-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mm.search")} />
        <button className="btn-plain" onClick={() => { if (!dirtyCount || window.confirm(t("mj.discard"))) load(); }}>{t("mj.reload")}</button>
        <span className="mj-sep" />
        <button className="btn-green" disabled={ro || busy} title={ro ? t("mj.read_only") : ""}
          onClick={() => (plates ? setNameForm({ name: "", copyOf: null }) : create())}>{t("mm.new")}</button>
        {plates && <button className="btn-plain" disabled={ro} title={ro ? t("mj.read_only") : ""} onClick={() => {
          const r = firstSelected();
          if (!r) { setMsg({ kind: "err", text: t("mj.select_row") }); return; }
          setNameForm({ name: `${nameOf(r)} (copy)`, copyOf: r });
        }}>{t("mj.copy")}</button>}
        {plates && <button className="btn-plain" onClick={() => {
          const r = firstSelected();
          if (!r) { setMsg({ kind: "err", text: t("mj.select_row") }); return; }
          setFilesFor(r);
        }}>📎 {t("mj.files")}</button>}
        <button className="btn-plain" disabled={ro || !selected.size} title={ro ? t("mj.read_only") : ""}
          onClick={() => setConfirmDel(true)}>{t("mj.delete")}</button>
        <button className="btn-green mj-save" disabled={ro || busy || !dirtyCount} title={ro ? t("mj.read_only") : "Ctrl+S"} onClick={save}>
          {t("mj.save")}{dirtyCount ? ` (${dirtyCount})` : ""}
        </button>
        <button className="btn-plain" onClick={() => setColsOpen(true)}>{t("mj.columns")}</button>
        {ro && <span className="muted">🔒 {t("mj.read_only")}</span>}
        {msg && <span className={msg.kind === "err" ? "mj-msg err" : "mj-msg"} onClick={() => setMsg(null)}>{msg.text}</span>}
      </div>

      <AdminTable
        columns={columns} frozen={data.name_column ? 2 : 1} idCol={ID} rows={data.rows} fk={{}}
        boolCols={sets.bool} numericCols={sets.numeric} editable={sets.editable} canEdit={!ro}
        changes={changes} onEdit={onEdit} selected={selected} onSelect={setSelected}
        onOpen={plates ? (id) => setFilesFor(data.rows.find((r) => Number(r[ID]) === id) ?? null) : undefined}
        search={search} searchCols={data.name_column ? [data.name_column] : [ID]} onCount={setShownCount}
        narrow={new Set([FILES])}
        header={(c) => (c === FILES ? "📎" : c === USED ? t("mm.used_in_yarn") : c === USED_BY ? t("mm.used_by") : c)}
        cell={(c, row) => {
          const id = Number(row[ID]);
          if (c === FILES) return row.has_files ? <span title={t("mj.has_files")}>📎</span> : "";
          if (c === USED) {
            if (!row[USED]) return t("mj.no");
            return <button className="mj-used" title={t("mm.used_hint")} onClick={(e) => { e.stopPropagation(); toggleUsage(id); }}>
              {usage[id] ? "▾" : "▸"} {t("mj.yes")}</button>;
          }
          return undefined;
        }}
        detail={kind === "material" ? (row) => {
          const u = usage[Number(row[ID])];
          if (!u) return null;
          if (u === "loading") return <span className="muted">{t("app.loading")}</span>;
          if (!u.length) return <span className="muted">{t("mm.usage_none")}</span>;
          return <ul className="mm-usage">{u.map((y) => <li key={y.id}>• {y.label}</li>)}</ul>;
        } : undefined}
      />

      {colsOpen && (
        <ColumnOrderDialog columns={order} onChange={setOrder}
          label={(c) => (c === FILES ? `📎 ${t("mj.files")}` : c === USED ? t("mm.used_in_yarn") : c === USED_BY ? t("mm.used_by") : c)}
          onSave={() => request("POST", `${BASE}/${kind}/column-order`, { columns: order }).catch((e) => setMsg({ kind: "err", text: errText(t, e) }))}
          onClose={() => setColsOpen(false)} />
      )}

      {confirmDel && (
        <Modal title={t("mj.delete")} onClose={() => setConfirmDel(false)}>
          <p>{t("mm.confirm_delete", { n: selected.size })}</p>
          <p className="muted">{data.rows.filter((r) => selected.has(Number(r[ID]))).map(nameOf).join(", ")}</p>
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => setConfirmDel(false)}>{t("mj.cancel")}</button>
            <button className="btn-danger" onClick={doDelete}>{t("mj.delete")}</button>
          </div>
        </Modal>
      )}

      {nameForm && (
        <Modal title={nameForm.copyOf ? t("mm.copy_title") : t("mm.new_title")} onClose={() => setNameForm(null)}>
          <div className="jr-form">
            <label>{t("mm.name")}<input autoFocus value={nameForm.name} onChange={(e) => setNameForm({ ...nameForm, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && nameForm.name.trim()) create({ ...stripRow(nameForm.copyOf), Name: nameForm.name.trim() }); }} /></label>
          </div>
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => setNameForm(null)}>{t("mj.cancel")}</button>
            <button className="btn-green" disabled={!nameForm.name.trim() || busy}
              onClick={() => create({ ...stripRow(nameForm.copyOf), Name: nameForm.name.trim() })}>{t("mj.save")}</button>
          </div>
        </Modal>
      )}

      {filesFor && (
        <Modal wide title={`${t("mj.files")} – ${nameOf(filesFor)}`} onClose={() => { setFilesFor(null); load(Number(filesFor[ID])); }}>
          <JetFiles jetId={Number(filesFor[ID])} readOnly={ro} base={`${BASE}/top_plates`} />
          <div className="modal-buttons"><button className="btn-plain" onClick={() => { setFilesFor(null); load(Number(filesFor[ID])); }}>{t("mj.close")}</button></div>
        </Modal>
      )}
    </div>
  );
}

/** copy: every real value except ID, GlobalID and the computed flags (the server drops them anyway) */
function stripRow(r: Row | null): Row {
  if (!r) return {};
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) if (!["ID", "GlobalID", "has_files"].includes(k)) out[k] = v;
  return out;
}
