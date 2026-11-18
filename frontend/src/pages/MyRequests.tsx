import { useCallback, useEffect, useMemo, useState, type MouseEvent as RME } from "react";
import { isTouch, tapOnControl } from "../media";
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
};
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
  const [status, setStatus] = useState("");
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
    if (status) q.set("status", status);
    if (project) q.set("project", project);
    if (owner) q.set("owner", owner);
    request<ListData>("GET", `/api/requests?${q}`).then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [status, project, owner]);
  useEffect(() => { load(); }, [load, tick]);

  // search over every displayed text, also the hidden detail columns (like the desktop)
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!data) return [];
    return s ? data.rows.filter((r) => [String(r.id), r.owner ?? "", ...Object.values(r.cells).map((v) => String(v ?? ""))]
      .some((v) => v.toLowerCase().includes(s))) : data.rows;
  }, [data, search]);

  const detailCols = useMemo(() => (data?.columns ?? []).filter((c) => c.detail), [data]);
  const colLabel = (c: Column) => { const k = `rqf.${c.key}`; const v = t(k); return v === k ? c.label : v; };

  const resetFilters = () => { setSearch(""); setStatus(""); setProject(""); setOwner(""); };

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
        <select className="search narrow" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("rq.allStatuses")}</option>
          {[1, 2, 3, 4].map((s) => <option key={s} value={s}>{t(`rqs.${s}`)}</option>)}
        </select>
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
            {rows.map((r) => (
              <tr key={r.id} onDoubleClick={() => navigate(`/requests/${r.open_id}`)} title={r.tooltip || t("exp.open")}
                onClick={(e) => { if (isTouch() && !tapOnControl(e)) navigate(`/requests/${r.open_id}`); }}
                onContextMenu={(e) => menu(e, r)}>
                <td className="nowrap">{r.id}</td>
                <td>
                  {r.has_pending_change && <span className="rq-mark change" title={t("rq.pendingChange")}>Δ</span>}
                  {r.is_new_unreviewed && <span className="rq-mark new" title={t("rq.newRequest")}>NEW</span>}
                  {r.title}
                </td>
                <td>{r.project}</td>
                <td className="nowrap">{String(r.cells["Wunschtermin"] ?? "").slice(0, 10)}</td>
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
            ))}
          </tbody>
        </table>
      </div>
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
    </div>
  );
}
