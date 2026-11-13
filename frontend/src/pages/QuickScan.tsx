import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";

/* Requirement Hub (desktop ui/screen_requirement_hub.py) and Quick Scan (ui/screen_quick_scan.py) on
   db/quick_scan.py. Filters (always must) and targets (must / weighted / distance) -> trials that fulfil them,
   ranked by score. Rulesets save / load / delete; ad-hoc fields from any allowed table column.
   The browser only sends field references; the server builds the SQL. No Athena advisor (no AI in the web). */

type FieldRef = { field_id?: number; adhoc?: { table: string; column: string; label: string; unit: string | null; tension: number | null } };
type Field = { ref: FieldRef; key: string; label: string; unit: string; data_type: string; tension: number | null; equal_default: boolean; adhoc: boolean };
type Row = { id: number; field: Field; operator: string; value1: string; value2: string; tension: string; target_type: string;
  weight: string; direction: string; target_val: string; ids: (string | number)[]; idLabels: string[] };
type Dyn = { key: string; label: string; weighted: boolean };
type ResRow = { experiment_id: string; trial_nr: number; series_name: string; jet_name: string | null; yarn_name: string | null;
  titer: number | null; filamente: number | null; series_id: number; trial_id: number; score: number | null;
  values: Record<string, number | null>; contrib: Record<string, number | null> };
type Result = { rows: ResRow[]; has_score: boolean; dynamic: Dyn[]; n_filters: number; n_targets: number; n_weighted: number; n_distance: number; debug: string };
type RuleSet = { id: number; name: string; description: string; created_by: string };
type Section = "filter" | "target";

let nextId = 1;
const OPS = ["=", ">=", "<=", "between"];

function newRow(field: Field, section: Section): Row {
  return { id: nextId++, field, operator: section === "filter" && field.equal_default ? "=" : "between", value1: "", value2: "",
    tension: field.tension != null ? String(field.tension) : "", target_type: "must", weight: "1.0", direction: "higher",
    target_val: "", ids: [], idLabels: [] };
}

function payload(r: Row) {
  const ref: FieldRef = r.field.ref.adhoc ? { adhoc: { ...r.field.ref.adhoc, tension: r.tension !== "" ? Number(r.tension) : r.field.ref.adhoc.tension } }
    : { field_id: r.field.ref.field_id, ...(r.tension !== "" ? { tension: r.tension } : {}) } as FieldRef;
  const num = (s: string) => (s.trim() === "" ? null : s.trim().replace(",", "."));
  return { field: ref, operator: r.operator, value1: r.field.data_type === "lookup" ? r.ids : num(r.value1), value2: num(r.value2),
    target_type: r.target_type, weight: num(r.weight), direction: r.direction, target_val: num(r.target_val) };
}

export function RequirementHub() {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="page-head"><h1>{t("qs.hub")}</h1></div>
      <section className="jr-card qs-hub">
        <h2>{t("qs.hub")}</h2>
        <p className="muted">{t("qs.hubText")}</p>
        <div className="qs-hub-btns">
          <Link className="btn-green qs-hub-btn" to="/tools/requirement-hub/quick-scan">{t("qs.title")}</Link>
          <span className="muted">{t("qs.quickScanText")}</span>
        </div>
      </section>
    </div>
  );
}

function LookupPicker({ row, onChange }: { row: Row; onChange: (ids: (string | number)[], labels: string[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<{ value: string | number; label: string }[] | null>(null);
  const [sel, setSel] = useState<(string | number)[]>(row.ids);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open && opts === null && row.field.ref.field_id != null)
      request<{ options: { value: string | number; label: string }[] }>("GET", `/api/quick-scan/fields/${row.field.ref.field_id}/options`).then((r) => setOpts(r.options));
  }, [open, opts, row.field.ref.field_id]);
  const text = !row.idLabels.length ? t("qs.allSel") : row.idLabels.length <= 2 ? row.idLabels.join(", ") : t("qs.nSel", { n: row.idLabels.length });
  return (<>
    <button className="qs-lookup" onClick={() => { setSel(row.ids); setOpen(true); }}>{text} ▾</button>
    {open && <Modal title={t("qs.select", { f: row.field.label })} onClose={() => setOpen(false)}>
      <input className="qs-in qs-wide" placeholder={t("qs.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="qs-optlist">
        {opts === null ? <p className="muted">…</p> : opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).map((o) => (
          <label key={String(o.value)}><input type="checkbox" checked={sel.includes(o.value)}
            onChange={(e) => setSel(e.target.checked ? [...sel, o.value] : sel.filter((x) => x !== o.value))} /> {o.label}</label>))}
      </div>
      <div className="modal-buttons">
        <button className="btn-plain" onClick={() => setSel([])}>{t("qs.none")}</button>
        <span style={{ flex: 1 }} />
        <button className="btn-plain" onClick={() => setOpen(false)}>{t("qs.cancel")}</button>
        <button className="btn-green" onClick={() => {
          onChange(sel, (opts ?? []).filter((o) => sel.includes(o.value)).map((o) => o.label)); setOpen(false);
        }}>{t("qs.ok")}</button>
      </div>
    </Modal>}
  </>);
}

function RowEditor({ row, section, set, remove }: { row: Row; section: Section; set: (r: Row) => void; remove: () => void }) {
  const { t } = useI18n();
  const lookup = row.field.data_type === "lookup";
  return (
    <div className="qs-row">
      <div className="qs-line">
        <span className="qs-label" title={row.field.adhoc ? t("qs.adhocTip") : ""}>{row.field.label}{row.field.unit ? ` [${row.field.unit}]` : ""}{row.field.adhoc ? " ⚙" : ""}</span>
        {lookup ? <LookupPicker row={row} onChange={(ids, idLabels) => set({ ...row, ids, idLabels })} /> : (<>
          <select className="qs-in" value={row.operator} onChange={(e) => set({ ...row, operator: e.target.value })}>
            {OPS.map((o) => <option key={o} value={o}>{o === "between" ? t("qs.between") : o}</option>)}</select>
          <input className="qs-in qs-num" placeholder={t("qs.value")} value={row.value1} onChange={(e) => set({ ...row, value1: e.target.value })} />
          {row.operator === "between" && <><span className="muted">{t("qs.to")}</span>
            <input className="qs-in qs-num" placeholder={t("qs.value")} value={row.value2} onChange={(e) => set({ ...row, value2: e.target.value })} /></>}
          {row.field.tension != null && <><span className="muted">@</span>
            <input className="qs-in qs-small" title={t("qs.tensionTip")} value={row.tension} onChange={(e) => set({ ...row, tension: e.target.value })} /></>}
          {section === "target" && <select className="qs-in" value={row.target_type} title={t("qs.typeTip")} onChange={(e) => set({ ...row, target_type: e.target.value })}>
            {["must", "weighted", "distance"].map((x) => <option key={x} value={x}>{t(`qs.type.${x}`)}</option>)}</select>}
        </>)}
        <span style={{ flex: 1 }} />
        <button className="qs-x" onClick={remove} title={t("qs.remove")}>✕</button>
      </div>
      {section === "target" && row.target_type === "weighted" && !lookup && (
        <div className="qs-line qs-sub">
          <span className="muted">{t("qs.goal")}</span>
          <input className="qs-in qs-num" placeholder={t("qs.goalPh")} value={row.target_val} onChange={(e) => set({ ...row, target_val: e.target.value })} />
          <span className="muted">{t("qs.direction")}</span>
          <select className="qs-in" value={row.direction} onChange={(e) => set({ ...row, direction: e.target.value })}>
            {["higher", "lower", "exact"].map((d) => <option key={d} value={d}>{t(`qs.dir.${d}`)}</option>)}</select>
          <span className="muted">{t("qs.weight")}</span>
          <input className="qs-in qs-small" value={row.weight} onChange={(e) => set({ ...row, weight: e.target.value })} />
        </div>)}
    </div>
  );
}

function AdhocDialog({ tables, onClose, onPick }: { tables: string[]; onClose: () => void; onPick: (f: Field) => void }) {
  const { t } = useI18n();
  const [table, setTable] = useState(tables[0] ?? "");
  const [cols, setCols] = useState<{ name: string; type: string }[]>([]);
  const [col, setCol] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [useT, setUseT] = useState(false);
  const [tension, setTension] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!table) return;
    request<{ columns: { name: string; type: string }[] }>("GET", `/api/quick-scan/adhoc/columns?table=${encodeURIComponent(table)}`)
      .then((r) => { setCols(r.columns); setCol(r.columns[0]?.name ?? ""); });
  }, [table]);
  const ok = () => {
    request<{ field: Field }>("POST", "/api/quick-scan/adhoc/field", { table, column: col, label, unit: unit || null, tension: useT && tension ? tension.replace(",", ".") : null })
      .then((r) => { onPick(r.field); onClose(); })
      .catch((e) => setErr(e instanceof ApiError && e.code ? t(`qs.err.${e.code}`) : String(e)));
  };
  return (
    <Modal title={t("qs.adhocTitle")} onClose={onClose}>
      <p className="muted">{t("qs.adhocHint")}</p>
      <div className="jr-form">
        <label>{t("qs.table")}<select value={table} onChange={(e) => setTable(e.target.value)}>{tables.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>{t("qs.column")}<select value={col} onChange={(e) => setCol(e.target.value)}>{cols.map((c) => <option key={c.name} value={c.name}>{c.name}  [{c.type}]</option>)}</select></label>
        <label>{t("qs.labelF")}<input value={label} placeholder={t("qs.labelPh")} onChange={(e) => setLabel(e.target.value)} /></label>
        <label>{t("qs.unit")}<input value={unit} placeholder="% / 1/m / cN/dtex" onChange={(e) => setUnit(e.target.value)} /></label>
        <label><span><input type="checkbox" checked={useT} onChange={(e) => setUseT(e.target.checked)} /> {t("qs.tension")}</span>
          <input value={tension} disabled={!useT} placeholder="1.3" onChange={(e) => setTension(e.target.value)} /></label>
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons"><span style={{ flex: 1 }} />
        <button className="btn-plain" onClick={onClose}>{t("qs.cancel")}</button>
        <button className="btn-green" disabled={!col} onClick={ok}>{t("qs.ok")}</button></div>
    </Modal>
  );
}

export default function QuickScan() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [fields, setFields] = useState<Field[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [filters, setFilters] = useState<Row[]>([]);
  const [targets, setTargets] = useState<Row[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [tab, setTab] = useState<"table" | "rank">("table");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [adhoc, setAdhoc] = useState<Section | null>(null);
  const [dlg, setDlg] = useState<null | "save" | "load" | "sql">(null);
  const [sets, setSets] = useState<RuleSet[]>([]);
  const [loadSel, setLoadSel] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [panel, setPanel] = useState(true);

  useEffect(() => {
    request<{ fields: Field[]; adhoc_tables: string[] }>("GET", "/api/quick-scan/fields")
      .then((r) => { setFields(r.fields); setTables(r.adhoc_tables); })
      .catch((e) => setMsg({ text: String(e.message || e), err: true }));
  }, []);

  const errText = (e: unknown) => (e instanceof ApiError && e.code ? t(`qs.err.${e.code}`) : String((e as Error)?.message || e));
  const add = (section: Section, f: Field) => (section === "filter" ? setFilters((l) => [...l, newRow(f, "filter")]) : setTargets((l) => [...l, newRow(f, "target")]));
  const pick = (section: Section, v: string) => {
    if (v === "__adhoc__") { setAdhoc(section); return; }
    const f = fields.find((x) => x.key === v);
    if (f) add(section, f);
  };
  const body = () => ({ filters: filters.map(payload), targets: targets.map(payload) });

  const run = () => {
    setBusy(true);
    setMsg(null);
    request<Result>("POST", "/api/quick-scan/run", body())
      .then((r) => { setRes(r); setSort(null); })
      .catch((e) => setMsg({ text: errText(e), err: true }))
      .finally(() => setBusy(false));
  };
  const clearAll = () => { setFilters([]); setTargets([]); setRes(null); setMsg(null); };

  const openLoad = () => {
    request<{ rulesets: RuleSet[] }>("GET", "/api/quick-scan/rulesets").then((r) => {
      if (!r.rulesets.length) { setMsg({ text: t("qs.noSets") }); return; }
      setSets(r.rulesets); setLoadSel(r.rulesets[0].id); setDlg("load");
    }).catch((e) => setMsg({ text: errText(e), err: true }));
  };
  const doLoad = () => {
    if (loadSel == null) return;
    request<{ rules: { section: Section; field: Field; target_type: string; operator: string; value1: number | null; value2: number | null;
      weight: number | null; direction: string; target_val: number | null }[] }>("GET", `/api/quick-scan/rulesets/${loadSel}`)
      .then((r) => {
        if (!r.rules.length) { setMsg({ text: t("qs.emptySet") }); return; }
        const s = (v: number | null) => (v == null ? "" : String(v));
        const rows = r.rules.map((x) => ({ ...newRow(x.field, x.section), operator: x.operator === "in" ? "between" : x.operator, value1: s(x.value1),
          value2: x.operator === "between" ? s(x.value2) : "", target_type: x.section === "target" ? x.target_type : "must",
          weight: x.weight != null ? String(x.weight) : "1.0", direction: x.direction, target_val: s(x.target_val), section: x.section }));
        setFilters(rows.filter((x) => x.section === "filter"));
        setTargets(rows.filter((x) => x.section === "target"));
        setRes(null);
        setDlg(null);
      }).catch((e) => setMsg({ text: errText(e), err: true }));
  };
  const doDelete = () => {
    const s = sets.find((x) => x.id === loadSel);
    if (!s || !window.confirm(t("qs.deleteQ", { name: s.name }))) return;
    request("DELETE", `/api/quick-scan/rulesets/${s.id}`).then(() => {
      const rest = sets.filter((x) => x.id !== s.id);
      setSets(rest); setLoadSel(rest[0]?.id ?? null);
      if (!rest.length) setDlg(null);
    }).catch((e) => setMsg({ text: errText(e), err: true }));
  };
  const doSave = () => {
    request<{ id: number; rules: number }>("POST", "/api/quick-scan/rulesets", { ...body(), name: saveName, description: saveDesc })
      .then((r) => { setDlg(null); setMsg({ text: t("qs.saved", { name: saveName.trim(), n: r.rules }) }); setSaveName(""); setSaveDesc(""); })
      .catch((e) => setMsg({ text: errText(e), err: true }));
  };

  const rows = useMemo(() => {
    if (!res) return [];
    if (!sort) return res.rows;
    const get = (r: ResRow) => (sort.key.startsWith("v:") ? r.values[sort.key.slice(2)] : (r as unknown as Record<string, unknown>)[sort.key]);
    return [...res.rows].sort((a, b) => {
      const x = get(a), y = get(b);
      const c = x == null ? 1 : y == null ? -1 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [res, sort]);
  const th = (key: string, label: string) => (
    <th key={key} onClick={() => setSort((s) => (s && s.key === key ? { key, desc: !s.desc } : { key, desc: key === "score" }))}>
      {label}{sort?.key === key ? (sort.desc ? " ▼" : " ▲") : ""}</th>);
  const fmt = (v: number | null | undefined) => (v == null ? "–" : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const scoreClass = (s: number | null) => (s == null ? "" : s >= 80 ? "qs-good" : s >= 50 ? "qs-mid" : "qs-bad");

  const sectionUi = (section: Section, list: Row[], setList: (f: (l: Row[]) => Row[]) => void) => (
    <>
      <div className="qs-sep">{section === "filter" ? t("qs.secFilter") : t("qs.secTarget")}</div>
      {list.map((r) => <RowEditor key={r.id} row={r} section={section} set={(nr) => setList((l) => l.map((x) => (x.id === r.id ? nr : x)))}
        remove={() => setList((l) => l.filter((x) => x.id !== r.id))} />)}
      <select className="qs-in qs-add" value="" onChange={(e) => pick(section, e.target.value)}>
        <option value="">{section === "filter" ? t("qs.addFilter") : t("qs.addTarget")}</option>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        <option disabled>──────────</option>
        <option value="__adhoc__">⚙ {t("qs.custom")}</option>
      </select>
    </>
  );

  return (
    <div className="page qs-page">
      <div className="page-head">
        <button className="btn-plain" onClick={() => navigate("/tools/requirement-hub")} title={t("qs.hub")}>←</button>
        <h1>{t("qs.title")}</h1>
      </div>
      {msg && <div className={"mj-msg" + (msg.err ? " err" : "")} onClick={() => setMsg(null)}>{msg.text}</div>}
      <div className={"qs-grid" + (panel ? "" : " closed")}>
        {panel && <section className="jr-card qs-left">
          <div className="qs-head">
            <h2>{t("qs.ft")}</h2><span style={{ flex: 1 }} />
            <button className="btn-plain" onClick={clearAll}>{t("qs.clear")}</button>
            <button className="btn-plain" onClick={openLoad} title={t("qs.loadTip")}>📂 {t("qs.load")}</button>
            <button className="btn-plain" onClick={() => {
              if (!filters.length && !targets.length) { setMsg({ text: t("qs.err.empty") }); return; }
              setDlg("save");
            }} title={t("qs.saveTip")}>💾 {t("qs.save")}</button>
          </div>
          {sectionUi("filter", filters, setFilters)}
          {sectionUi("target", targets, setTargets)}
          <div className="qs-runbar">
            <button className="btn-green qs-run" onClick={run} disabled={busy}>{busy ? t("qs.searching") : t("qs.run")}</button>
            <button className="btn-plain" disabled={!res} onClick={() => setDlg("sql")} title={t("qs.sqlTip")}>{t("qs.sql")}</button>
          </div>
        </section>}
        <button className="qs-toggle" onClick={() => setPanel(!panel)} title={panel ? t("qs.collapse") : t("qs.expand")}>{panel ? "◀" : "▶"}</button>
        <section className="jr-card qs-right">
          <h2>{res ? t("qs.resultsN", { n: res.rows.length }) : t("qs.results")}</h2>
          <div className="se-tabs">
            <button className={"se-tab" + (tab === "table" ? " on" : "")} onClick={() => setTab("table")}>{t("qs.tabTable")}</button>
            <button className={"se-tab" + (tab === "rank" ? " on" : "")} onClick={() => setTab("rank")}>{t("qs.tabRank")}</button>
          </div>
          {!res ? <p className="muted qs-empty">{t("qs.start")}</p> : !res.rows.length ? <p className="muted qs-empty">{t("qs.noHits")}</p> : tab === "table" ? (
            <div className="qs-tablewrap">
              <table className="pp-table qs-table">
                <thead><tr>
                  {res.has_score && th("score", t("qs.col.score"))}
                  {th("experiment_id", t("qs.col.experiment"))}{th("trial_nr", t("qs.col.trial"))}{th("series_name", t("qs.col.series"))}
                  {th("jet_name", t("qs.col.jet"))}{th("yarn_name", t("qs.col.yarn"))}{th("titer", t("qs.col.titer"))}{th("filamente", t("qs.col.fil"))}
                  {res.dynamic.map((d) => th(`v:${d.key}`, d.label))}
                </tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.trial_id} onClick={() => navigate(`/series/${r.series_id}`)} title={t("qs.openTip")}>
                    {res.has_score && <td className={"num b " + scoreClass(r.score)}>{r.score == null ? "–" : `${r.score.toFixed(1)}%`}</td>}
                    <td>{r.experiment_id}</td><td className="num">{r.trial_nr}</td><td>{r.series_name}</td><td>{r.jet_name ?? "–"}</td>
                    <td>{r.yarn_name ?? "–"}</td><td className="num">{fmt(r.titer)}</td><td className="num">{fmt(r.filamente)}</td>
                    {res.dynamic.map((d) => {
                      const v = r.values[d.key], c = r.contrib[d.key];
                      return <td key={d.key} className="num">{v == null ? "–" : v.toFixed(1)}{d.weighted && c != null && v != null ? ` (→ ${c.toFixed(1)}%)` : ""}</td>;
                    })}
                  </tr>))}</tbody>
              </table>
            </div>
          ) : (
            <div className="qs-rank">
              {res.rows.slice(0, 25).map((r) => (
                <div key={r.trial_id} className="qs-bar-row" onClick={() => navigate(`/series/${r.series_id}`)}>
                  <span className="qs-bar-label">{`${r.experiment_id} T${r.trial_nr} ${r.jet_name ?? ""}`.slice(0, 35)}</span>
                  <span className="qs-bar-bg">
                    <span className={"qs-bar " + (res.has_score ? scoreClass(r.score) : "qs-none")} style={{ width: res.has_score ? `${Math.max(1, r.score ?? 0)}%` : "100%" }} />
                  </span>
                  <span className="qs-bar-val">{res.has_score && r.score != null ? `${r.score.toFixed(0)}%` : "–"}</span>
                </div>))}
            </div>
          )}
          <div className="muted pp-hint">{res ? t("qs.status", { n: res.rows.length, f: res.n_filters, tg: res.n_targets })
            + (res.n_weighted ? ` · ${t("qs.nWeighted", { n: res.n_weighted })}` : "") + (res.n_distance ? ` · ${t("qs.nDistance", { n: res.n_distance })}` : "") : t("qs.start")}</div>
        </section>
      </div>
      {adhoc && <AdhocDialog tables={tables} onClose={() => setAdhoc(null)} onPick={(f) => add(adhoc, f)} />}
      {dlg === "save" && <Modal title={t("qs.saveTitle")} onClose={() => setDlg(null)}>
        <div className="jr-form">
          <label>{t("qs.name")}<input autoFocus value={saveName} placeholder={t("qs.namePh")} onChange={(e) => setSaveName(e.target.value)} /></label>
          <label>{t("qs.desc")}<textarea rows={3} value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} /></label>
        </div>
        <div className="modal-buttons"><span style={{ flex: 1 }} />
          <button className="btn-plain" onClick={() => setDlg(null)}>{t("qs.cancel")}</button>
          <button className="btn-green" disabled={!saveName.trim()} onClick={doSave}>{t("qs.save")}</button></div>
      </Modal>}
      {dlg === "load" && <Modal title={t("qs.loadTitle")} onClose={() => setDlg(null)}>
        <div className="qs-sets">{sets.map((s) => (
          <div key={s.id} className={"qs-set" + (loadSel === s.id ? " sel" : "")} onClick={() => setLoadSel(s.id)} onDoubleClick={() => { setLoadSel(s.id); doLoad(); }}>
            <b>{s.name}</b>{s.created_by ? <span className="muted">  ({s.created_by})</span> : null}{s.description ? <div className="muted">{s.description}</div> : null}
          </div>))}</div>
        <div className="modal-buttons">
          <button className="btn-plain danger" onClick={doDelete}>🗑 {t("qs.delete")}</button><span style={{ flex: 1 }} />
          <button className="btn-plain" onClick={() => setDlg(null)}>{t("qs.cancel")}</button>
          <button className="btn-green" disabled={loadSel == null} onClick={doLoad}>{t("qs.load")}</button></div>
      </Modal>}
      {dlg === "sql" && res && <Modal title={t("qs.sql")} onClose={() => setDlg(null)}>
        <pre className="qs-pre">{res.debug}</pre>
        <div className="modal-buttons"><span style={{ flex: 1 }} /><button className="btn-green" onClick={() => setDlg(null)}>{t("qs.ok")}</button></div>
      </Modal>}
    </div>
  );
}
