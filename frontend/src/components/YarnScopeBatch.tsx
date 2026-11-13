import { useEffect, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";

type Row = { trial_id: number; label: string; file: string; status: string; error: string; values: Record<string, number | null> | null };
type Job = { id: string; total: number; done: number; current: string | null; finished: boolean; stop: boolean;
  save: boolean; rows: Row[]; columns: string[] };

const STATUS_CLASS: Record<string, string> = { saved: "ok", analysed: "ok", error: "err", running: "run" };

/** Batch analysis of all (pending) trials of the series on the server - like the desktop "Batch". */
export default function YarnScopeBatch({ seriesId, canWrite, onClose, onDone }: {
  seriesId: number; canWrite: boolean; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [job, setJob] = useState<Job | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const [save, setSave] = useState(canWrite);
  const [error, setError] = useState<string | null>(null);

  // show a running / the last batch of this series again
  useEffect(() => {
    request<Job | { job: null }>("GET", `/api/series/${seriesId}/yarnscope/batch/current`)
      .then((j) => { if ("id" in j) setJob(j); })
      .catch(() => undefined);
  }, [seriesId]);

  useEffect(() => {
    if (!job || job.finished) return;
    const id = window.setInterval(() => {
      request<Job>("GET", `/api/yarnscope/batch/${job.id}`).then((j) => {
        setJob(j);
        if (j.finished) onDone();
      }).catch((e) => setError(e.message));
    }, 1500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.finished]);

  const start = () => {
    setError(null);
    request<{ job_id: string }>("POST", `/api/series/${seriesId}/yarnscope/batch`, { only_pending: onlyPending, save })
      .then((r) => request<Job>("GET", `/api/yarnscope/batch/${r.job_id}`))
      .then(setJob)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  };
  const stop = () => {
    if (job) request("POST", `/api/yarnscope/batch/${job.id}/stop`).catch(() => undefined);
  };

  const running = !!job && !job.finished;
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const fmt = (v: number | null | undefined) => (v == null ? "" : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
  const count = (st: string) => (job ? job.rows.filter((r) => r.status === st).length : 0);

  return (
    <div className="ys-batch">
      <div className="ys-head">
        <h3>{t("ysb.title")}</h3>
        <button className="btn-plain" onClick={onClose}>{t("at.close")}</button>
      </div>
      <div className="md-bar">
        <label className="md-radio">
          <input type="checkbox" checked={onlyPending} disabled={running} onChange={(e) => setOnlyPending(e.target.checked)} />
          {" "}{t("ysb.onlyPending")}
        </label>
        <label className="md-radio" title={canWrite ? "" : t("ysb.readOnly")}>
          <input type="checkbox" checked={save} disabled={running || !canWrite} onChange={(e) => setSave(e.target.checked)} />
          {" "}{t("ysb.save")}
        </label>
        {!running ? (
          <button className="btn-green" onClick={start}>{t("ysb.start")}</button>
        ) : (
          <button className="btn-plain" onClick={stop} disabled={job?.stop}>{job?.stop ? t("ysb.stopping") : t("ysb.stop")}</button>
        )}
      </div>
      {error && <div className="card error">{error}</div>}
      {job && (
        <>
          <div className="ys-progress">
            <div className="ys-bar"><div style={{ width: `${pct}%` }} /></div>
            <span className="muted">
              {job.total === 0 ? t("ysb.nothing")
                : job.finished ? t("ysb.finished", { done: job.done, total: job.total, saved: count("saved") + count("analysed"), errors: count("error") })
                : t("ysb.running", { done: job.done, total: job.total, current: job.current ?? "" })}
            </span>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t("nt.trial")}</th><th>{t("ysb.file")}</th><th>{t("exp.col.status_id")}</th>
                  {job.columns.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {job.rows.map((r) => (
                  <tr key={r.trial_id} title={r.error || undefined}>
                    <td className="nowrap">{r.label}</td>
                    <td className="nowrap muted">{r.file}</td>
                    <td className={"nowrap ysb-st " + (STATUS_CLASS[r.status] ?? "")}>{t(`ysb.st.${r.status.replace(" ", "_")}`)}</td>
                    {job.columns.map((c) => <td key={c} className="nowrap">{fmt(r.values?.[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
