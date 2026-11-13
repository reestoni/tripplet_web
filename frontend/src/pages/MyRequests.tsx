import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import StatusDialog, { type StatusAsk } from "../components/StatusDialog";

type Row = {
  id: number; status_id: number | null; status_label: string; status_options: [string, number, boolean][];
  status_editable: boolean; owner: string; title: string; project: string; denial_reason: string | null;
  has_pending_change: boolean; is_new_unreviewed: boolean; experiment_id: string | null; tooltip: string;
  open_id: number; review: boolean; pending_change_id: number | null; cells: Record<string, unknown>;
};
type ListData = { is_superuser: boolean; total: number; rows: Row[]; projects: string[]; owners: string[];
  statuses: [number, string][] | { id: number; label: string }[] };

export default function MyRequests() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [owner, setOwner] = useState("");
  const [ask, setAsk] = useState<StatusAsk | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (project) q.set("project", project);
    if (owner) q.set("owner", owner);
    request<ListData>("GET", `/api/requests?${q}`).then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [status, project, owner]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!data) return [];
    return s ? data.rows.filter((r) => [r.title, r.project, r.owner, String(r.id), r.experiment_id ?? ""]
      .some((v) => v.toLowerCase().includes(s))) : data.rows;
  }, [data, search]);

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

  const st = (id: number | null, label: string) => (id ? t(`rqs.${id}`) : label) || label;

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>{t("rq.listTitle")}</h1>
        <span className="muted">{data ? t("rq.count", { n: rows.length, total: data.total }) : t("app.loading")}</span>
        <span style={{ flex: 1 }} />
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
      </div>
      {error && <div className="card error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th><th>{t("rqf.Titel")}</th><th>{t("rqf.Projekt")}</th><th>{t("rqf.Wunschtermin")}</th>
              {data?.is_superuser && <th>{t("exp.col.owner")}</th>}
              <th>{t("exp.col.status_id")}</th><th>{t("exp.col.experiment_id")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onDoubleClick={() => navigate(`/requests/${r.open_id}`)} title={r.tooltip || t("exp.open")}>
                <td className="nowrap">{r.id}</td>
                <td>
                  {r.has_pending_change && <span className="rq-mark change" title={t("rq.pendingChange")}>Δ</span>}
                  {r.is_new_unreviewed && <span className="rq-mark new" title={t("rq.newRequest")}>NEW</span>}
                  {r.title}
                </td>
                <td>{r.project}</td>
                <td className="nowrap">{String(r.cells["Wunschtermin"] ?? "").slice(0, 10)}</td>
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
                <td className="nowrap">{r.experiment_id ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ask && (
        <StatusDialog ask={ask} onCancel={() => { setAsk(null); load(); }}
          onOk={(reason) => {
            const r = data?.rows.find((x) => x.id === ask.row);
            if (r) changeStatus(r, ask.newId, reason, ask.mode === "confirm");
          }} />
      )}
      {toast && <div className="toast ok" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  );
}
