import { useCallback, useEffect, useMemo, useState, type MouseEvent as RME } from "react";
import { isTouch, PHONE, tapOnControl, useMedia } from "../media";
import { useNavigate } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import StatusDialog, { type StatusAsk } from "../components/StatusDialog";
import { useContextMenu, type MenuItem } from "../components/ContextMenu";
import { Overlay, VersionHistory } from "../components/RequestPopup";
import { Picker } from "../components/SeriesLinks";
import RequestHelp from "../components/RequestHelp";

type Row = {
  id: number; status_id: number | null; status_label: string; status_options: [string, number, boolean][];
  status_editable: boolean; owner: string; title: string; project: string; denial_reason: string | null;
  has_pending_change: boolean; is_new_unreviewed: boolean; experiment_id: string | null; tooltip: string;
  open_id: number; review: boolean; pending_change_id: number | null; cells: Record<string, unknown>;
  has_history: boolean;
  due?: Due; needs_review?: boolean;
};
// db/experiment_requests.due_info: days until the wish date (negative = overdue), only for open requests
type Due = { group: "overdue" | "today" | "week" | "later" | "none"; days: number | null };
const DUE_ORDER = ["overdue", "today", "week", "later", "none"];
const dueKey = (d?: Due): [number, number] => [DUE_ORDER.indexOf(d?.group ?? "none"), d?.days ?? 1e6];
type Tab = "all" | "review" | "1" | "3" | "4" | "2";
const TABS: Tab[] = ["all", "review", "1", "3", "4", "2"];
type Column = { key: string; label: string; detail: boolean };
type ListData = { is_superuser: boolean; total: number; rows: Row[]; projects: string[]; owners: string[];
  columns: Column[]; statuses: [number, string][] | { id: number; label: string }[] };
type Series = { id: number; name: string; trials: number };

const newTab = (e: RME) => e.ctrlKey || e.metaKey || e.button === 1;

/** Assign an experiment without request (superusers, status Approved) - desktop _assign_experiment_to_request. */
function AssignDialog({ row, onDone, onClose }: { row: Row; onDone: (msg: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [opts, setOpts] = useState<{ pk: number; label: string }[] | null>(null);
  const [pk, setPk] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<{ options: { pk: number; label: string }[] }>("GET", `/api/requests/${row.id}/assign-options`)
      .then((d) => setOpts(d.options)).catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [row.id]);
  const label = opts?.find((o) => String(o.pk) === pk)?.label ?? "";
  const ok = async () => {
    if (!pk || !window.confirm(t("rqa.confirm", { exp: label, id: row.id }))) return;
    setBusy(true);
    try {
      const r = await request<{ kind: string; message: string }>("POST", `/api/requests/${row.id}/assign`, { experiment_pk: Number(pk) });
      if (r.kind === "linked") onDone(t("rqa.done", { exp: label, id: row.id }));
      else setErr(r.kind === "not_available" ? t("rqa.taken") : r.message);
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Overlay onClose={onClose}>
      <h2>{t("rqa.title")}</h2>
      <p>{t("rqa.hint", { id: row.id })}<br /><small className="muted">{t("rqa.only")}</small></p>
      {opts && opts.length === 0 && <p className="muted">{t("rqa.none")}</p>}
      {opts && opts.length > 0 && (
        <label className="rq-field"><span>{t("rqa.experiment")}</span>
          <select className="search" value={pk} onChange={(e) => setPk(e.target.value)} autoFocus>
            <option value="">{t("rqa.select")}</option>
            {opts.map((o) => <option key={o.pk} value={o.pk}>{o.label}</option>)}
          </select>
        </label>
      )}
      {!opts && !err && <p className="muted">{t("app.loading")}</p>}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("bl.machine.cancel")}</button>
        <button className="btn-green" disabled={!pk || busy} onClick={ok}>{t("rqa.ok")}</button>
      </div>
    </Overlay>
  );
}

export default function MyRequests() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [byDue, setByDue] = useState(() => { try { return localStorage.getItem("tripplet.rq.byDue") === "1"; } catch { return false; } });
  const phone = useMedia(PHONE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [project, setProject] = useState("");
  const [owner, setOwner] = useState("");
  const [details, setDetails] = useState(false);
  const [ask, setAsk] = useState<StatusAsk | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [history, setHistory] = useState<number | null>(null);
  const [assign, setAssign] = useState<Row | null>(null);
  const [pick, setPick] = useState<{ exp: string; series: Series[] } | null>(null);
  const [tick, setTick] = useState(0);
  const cm = useContextMenu();

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (project) q.set("project", project);
    if (owner) q.set("owner", owner);
    request<ListData>("GET", `/api/requests?${q}`).then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [project, owner]);
  useEffect(() => { load(); }, [load, tick]);

  // search over every displayed text, also the hidden detail columns (like the desktop)
  const searched = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!data) return [];
    return s ? data.rows.filter((r) => [String(r.id), r.owner ?? "", ...Object.values(r.cells).map((v) => String(v ?? ""))]
      .some((v) => v.toLowerCase().includes(s))) : data.rows;
  }, [data, search]);
  const su = !!data?.is_superuser;
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: searched.length, review: 0, "1": 0, "2": 0, "3": 0, "4": 0 };
    for (const r of searched) { if (r.needs_review) c.review++; if (r.status_id != null) c[String(r.status_id)] = (c[String(r.status_id)] ?? 0) + 1; }
    return c;
  }, [searched]);
  // tab filter, then: "to review" first (superusers), with "urgent first" by due date (db/experiment_requests.due_sort_key)
  const rows = useMemo(() => {
    const list = searched.filter((r) => tab === "all" || (tab === "review" ? r.needs_review : String(r.status_id) === tab));
    const idx = new Map(list.map((r, i) => [r.id, i]));
    return [...list].sort((a, b) => {
      if (su && !!a.needs_review !== !!b.needs_review) return a.needs_review ? -1 : 1;
      if (byDue) { const x = dueKey(a.due), y = dueKey(b.due); if (x[0] !== y[0]) return x[0] - y[0]; if (x[1] !== y[1]) return x[1] - y[1]; }
      return (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0);
    });
  }, [searched, tab, byDue, su]);
  // section titles between the rows: "To review" block, and with "urgent first" the due groups
  const sectionOf = (r: Row): string => {
    if (su && tab === "all" && counts.review > 0 && r.needs_review) return t("rq.secReview");
    if (byDue) return t(`rq.grp.${r.due?.group ?? "none"}`);
    if (su && tab === "all" && counts.review > 0) return t("rq.secRest");
    return "";
  };
  const dueText = (d?: Due) => {
    const n = d?.days;
    if (n == null) return "";
    if (n < 0) return n === -1 ? t("rq.due.over1") : t("rq.due.overN", { n: -n });
    if (n === 0) return t("rq.due.today");
    if (n === 1) return t("rq.due.tomorrow");
    return t("rq.due.inN", { n });
  };
  const dueCell = (r: Row) => {
    const date = String(r.cells["Wunschtermin"] ?? "").slice(0, 10);
    const tx = dueText(r.due);
    return <>{date}{tx && <span className={"rq-due " + (r.due?.group ?? "")}>{date ? " · " : ""}{tx}</span>}</>;
  };
  const toggleByDue = () => setByDue((v) => { try { localStorage.setItem("tripplet.rq.byDue", v ? "0" : "1"); } catch { /* blocked */ } return !v; });
  const tabsBar = (
    <div className="rq-tabs" role="tablist">
      {TABS.filter((k) => k !== "review" || su).map((k) => (
        <button key={k} role="tab" aria-selected={tab === k} className={"rq-tab" + (tab === k ? " on" : "") + (k === "review" && counts.review ? " hot" : "")}
          onClick={() => setTab(k)}>
          {k === "all" ? t("rq.tabAll") : k === "review" ? t("rq.tabReview") : t(`rqs.${k}`)} <span className="rq-tab-n">{counts[k] ?? 0}</span>
        </button>))}
      <label className="rq-bydue"><input type="checkbox" checked={byDue} onChange={toggleByDue} /> {t("rq.byDue")}</label>
    </div>
  );

  const detailCols = useMemo(() => (data?.columns ?? []).filter((c) => c.detail), [data]);
  const colLabel = (c: Column) => { const k = `rqf.${c.key}`; const v = t(k); return v === k ? c.label : v; };

  const resetFilters = () => { setSearch(""); setTab("all"); setProject(""); setOwner(""); };

  const changeStatus = (r: Row, newId: number, reason?: string, confirmed = false) => {
    request<{ kind: string; message: string }>("POST", `/api/requests/${r.id}/status`,
      { status_id: newId, reason: reason ?? null, confirmed })
      .then((res) => {
        if (res.kind === "needs_reason") setAsk({ row: r.id, title: r.title, newId, mode: "reason", message: res.message });
        else if (res.kind === "needs_confirmation") setAsk({ row: r.id, title: r.title, newId, mode: "confirm", message: res.message });
        else { setAsk(null); setToast(res.message || t("rq.statusChanged")); load(); window.dispatchEvent(new Event("tripplet:nav-changed")); }
      })
      .catch((e) => setToast(e instanceof ApiError ? e.message : String(e)));
  };

  /** Experiment ID -> its series: one = open, several = pick (desktop _open_experiment_series). */
  const openExperiment = (e: RME, exp: string) => {
    e.stopPropagation();
    const tab = newTab(e);
    request<{ series: Series[] }>("GET", `/api/experiment-series?exp_id=${encodeURIComponent(exp)}`).then((d) => {
      if (d.series.length === 1) goSeries(d.series[0].id, tab);
      else if (d.series.length > 1) setPick({ exp, series: d.series });
    }).catch((err) => setToast(err instanceof ApiError ? err.message : String(err)));
  };
  const goSeries = (id: number, tab: boolean) => {
    if (tab) window.open(`/series/${id}`, "_blank", "noopener");
    else navigate(`/series/${id}`);
  };

  /** right-click menu like the desktop _on_context_menu */
  const menu = (e: RME, r: Row) => {
    const su = !!data?.is_superuser;
    const items: MenuItem[] = [];
    if (su && r.status_id === 3) items.push({ label: t("rqm.assign"), onClick: () => setAssign(r) });
    if (su && r.pending_change_id != null) {
      if (items.length) items.push({ sep: true });
      items.push({ label: t("rqm.review"), onClick: () => navigate(`/requests/${r.id}`) });
      items.push({ label: t("rqm.viewProposal"), onClick: () => navigate(`/requests/${r.pending_change_id}`) });
    }
    if (r.has_history) {
      if (items.length) items.push({ sep: true });
      items.push({ label: t("rqm.history"), onClick: () => setHistory(r.id) });
    }
    if (items.length) cm.open(e, items);
    else e.preventDefault();
  };

  const st = (id: number | null, label: string) => (id ? t(`rqs.${id}`) : label) || label;

  const dialogs = (
    <>
      {cm.menu}
      {ask && (
        <StatusDialog ask={ask} onCancel={() => { setAsk(null); load(); }}
          onOk={(reason) => {
            const r = data?.rows.find((x) => x.id === ask.row);
            if (r) changeStatus(r, ask.newId, reason, ask.mode === "confirm");
          }} />
      )}
      {help && <RequestHelp onClose={() => setHelp(false)} />}
      {history != null && <VersionHistory requestId={history} onClose={() => setHistory(null)} />}
      {assign && (
        <AssignDialog row={assign} onClose={() => setAssign(null)}
          onDone={(msg) => { setAssign(null); setToast(msg); load(); window.dispatchEvent(new Event("tripplet:nav-changed")); }} />
      )}
      {pick && (
        <Picker title={t("rq.pickSeries", { exp: pick.exp })} hint={t("rq.pickSeriesHint", { exp: pick.exp })}
          items={pick.series.map((s) => ({ key: s.id, label: t("rq.seriesItem", { name: s.name, n: s.trials }) }))}
          onPick={(id, e) => { setPick(null); goSeries(id, newTab(e)); }} onClose={() => setPick(null)} />
      )}
      {toast && <div className="toast ok" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );

  if (phone) {
    const nFilters = (project ? 1 : 0) + (owner ? 1 : 0);
    return (
      <div className="page rq-m">
        <div className="page-head">
          <h1>{t("rq.listTitle")}</h1>
          <span className="muted">{data ? t("rq.count", { n: rows.length, total: data.total }) : t("app.loading")}</span>
          <button className="rq-help" onClick={() => setHelp(true)} title={t("rqh.tip")}>?</button>
        </div>
        <div className="exp-m-bar">
          <input className="search" type="search" placeholder={t("rq.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className={"btn-plain" + (nFilters ? " on" : "")} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
            {t("exp.filters")}{nFilters ? ` (${nFilters})` : ""} {filtersOpen ? "▴" : "▾"}</button>
        </div>
        {filtersOpen && (
          <div className="exp-m-filters">
            <div className="exp-m-row">
              {data && data.projects.length > 0 && (
                <select value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">{t("rq.allProjects")}</option>
                  {data.projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              {su && (
                <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">{t("rq.allOwners")}</option>
                  {data?.owners.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </div>
            <div className="exp-m-row">
              <button className="btn-plain" onClick={() => setTick((x) => x + 1)}>{t("rq.refresh")}</button>
              <button className="btn-plain" onClick={resetFilters}>{t("rq.resetFilters")}</button>
            </div>
          </div>
        )}
        {tabsBar}
        {error && <div className="card error">{error}</div>}
        <div className="exp-m-list">
          {rows.flatMap((r, i) => {
            const sec = sectionOf(r);
            const head = sec && (i === 0 || sectionOf(rows[i - 1]) !== sec) ? [<div key={"sec" + i} className="rq-m-sec">{sec}</div>] : [];
            return [...head, (
              <div key={r.id} className={"exp-card rq-card" + (r.needs_review ? " review" : "")} role="link" tabIndex={0}
                onClick={(e) => { if (!tapOnControl(e)) navigate(`/requests/${r.open_id}`); }}
                onContextMenu={(e) => menu(e, r)}>
                <div className="exp-card-top">
                  <span className="exp-card-id">#{r.id}</span>
                  <span className="muted rq-card-proj">{r.project}</span>
                  <span className="exp-card-grow" />
                  {r.status_editable ? (
                    // superusers change the status right on the card (same rules/dialogs as the table)
                    <select className={`rq-status s${r.status_id ?? 0}`} value={r.status_id ?? ""}
                      onChange={(e) => changeStatus(r, Number(e.target.value))}>
                      {r.status_options.map(([label, id, enabled]) => (
                        <option key={id} value={id} disabled={!enabled}>{st(id, label)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`rq-status s${r.status_id ?? 0}`} title={r.denial_reason ?? undefined}>{st(r.status_id, r.status_label)}</span>
                  )}
                </div>
                <div className="exp-card-name">
                  {r.has_pending_change && <span className="rq-mark change" title={t("rq.pendingChange")}>Δ</span>}
                  {r.is_new_unreviewed && <span className="rq-mark new" title={t("rq.newRequest")}>NEW</span>}
                  {r.title}
                </div>
                <div className="exp-card-foot">
                  <span>{dueCell(r)}</span>
                  {su && r.owner && <span className="muted">· {r.owner}</span>}
                  <span className="exp-card-grow" />
                  {r.experiment_id && (
                    <button className="link-btn rq-exp-chip" onClick={(e) => openExperiment(e, String(r.experiment_id))}>→ {r.experiment_id}</button>
                  )}
                </div>
              </div>
            )];
          })}
        </div>
        <button className="rq-fab" onClick={() => navigate("/requests/new")} title={t("rq.new")} aria-label={t("rq.new")}>+</button>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>{t("rq.listTitle")}</h1>
        <button className="rq-help" onClick={() => setHelp(true)} title={t("rqh.tip")}>?</button>
        <span className="muted">{data ? t("rq.count", { n: rows.length, total: data.total }) : t("app.loading")}</span>
        <span style={{ flex: 1 }} />
        <button className="btn-plain" onClick={() => setDetails((d) => !d)} title={t("rq.detailsTip")}>
          {details ? t("rq.hideDetails") : t("rq.showDetails")}
        </button>
        <button className="btn-plain" onClick={() => setTick((x) => x + 1)}>{t("rq.refresh")}</button>
        <button className="btn-green" onClick={() => navigate("/requests/new")}>{t("rq.new")}</button>
      </div>
      <div className="toolbar">
        <input className="search" placeholder={t("rq.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        {data && data.projects.length > 0 && (
          <select className="search" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{t("rq.allProjects")}</option>
            {data.projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {data?.is_superuser && (
          <select className="search narrow" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t("rq.allOwners")}</option>
            {data.owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <button className="btn-plain" onClick={resetFilters}>{t("rq.resetFilters")}</button>
      </div>
      {tabsBar}
      {error && <div className="card error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th><th>{t("rqf.Titel")}</th><th>{t("rqf.Projekt")}</th><th>{t("rqf.Wunschtermin")}</th>
              {details && detailCols.map((c) => <th key={c.key}>{colLabel(c)}</th>)}
              {data?.is_superuser && <th>{t("exp.col.owner")}</th>}
              <th>{t("exp.col.status_id")}</th><th>{t("exp.col.experiment_id")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r, i) => {
              const sec = sectionOf(r);
              const head = sec && (i === 0 || sectionOf(rows[i - 1]) !== sec)
                ? [<tr key={"sec" + i} className="rq-sec"><td colSpan={99}>{sec}</td></tr>] : [];
              return [...head, (
              <tr key={r.id} className={r.needs_review ? "rq-review" : undefined} onDoubleClick={() => navigate(`/requests/${r.open_id}`)} title={r.tooltip || t("exp.open")}
                onClick={(e) => { if (isTouch() && !tapOnControl(e)) navigate(`/requests/${r.open_id}`); }}
                onContextMenu={(e) => menu(e, r)}>
                <td className="nowrap">{r.id}</td>
                <td>
                  {r.has_pending_change && <span className="rq-mark change" title={t("rq.pendingChange")}>Δ</span>}
                  {r.is_new_unreviewed && <span className="rq-mark new" title={t("rq.newRequest")}>NEW</span>}
                  {r.title}
                </td>
                <td>{r.project}</td>
                <td className="nowrap">{dueCell(r)}</td>
                {details && detailCols.map((c) => <td key={c.key} className="rq-detail">{String(r.cells[c.key] ?? "")}</td>)}
                {data?.is_superuser && <td>{r.owner}</td>}
                <td className="nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                  {r.status_editable ? (
                    <select className={`rq-status s${r.status_id ?? 0}`} value={r.status_id ?? ""}
                      onChange={(e) => changeStatus(r, Number(e.target.value))}>
                      {r.status_options.map(([label, id, enabled]) => (
                        <option key={id} value={id} disabled={!enabled}>{st(id, label)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`rq-status s${r.status_id ?? 0}`} title={r.denial_reason ?? undefined}>{st(r.status_id, r.status_label)}</span>
                  )}
                </td>
                <td className="nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                  {r.experiment_id ? (
                    <button className="link-btn" title={t("rq.openExpTip")} onClick={(e) => openExperiment(e, String(r.experiment_id))}
                      onAuxClick={(e) => { if (e.button === 1) openExperiment(e, String(r.experiment_id)); }}>
                      {r.experiment_id}
                    </button>
                  ) : ""}
                </td>
              </tr>
            )];
            })}
          </tbody>
        </table>
      </div>
      {dialogs}
    </div>
  );
}
