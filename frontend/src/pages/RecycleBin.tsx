import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";

/* Recycle Bin (desktop ui/widgets/recycle_bin_dialog.py) on db/recycle_bin.py - superusers only. Deleted trial
   series and trials: restore, delete permanently, or open a series read only in Show Experiment to decide there
   (banner in pages/SeriesView.tsx). */

type Entry = { id: number; deleted_at: string; user: string; type: string; object_id: number; label: string; summary: string };
type Data = { retention_days: number; entries: Entry[]; previews: { series_id: number; label: string; mine: boolean }[] };

export default function RecycleBin() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const errText = (e: unknown) => (e instanceof ApiError && e.code === "superuser_only" ? t("rb.err.superuser_only")
    : e instanceof ApiError && e.code === "not_available" ? t("rb.err.not_available") : e instanceof Error ? e.message : String(e));
  const load = () => request<Data>("GET", "/api/superuser/recycle-bin").then((d) => { setData(d); setSel(null); })
    .catch((e) => setMsg({ text: errText(e), err: true }));
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const cur = data?.entries.find((e) => e.id === sel) ?? null;
  const isSeries = cur?.type === "trial series";
  const typeText = (ty: string) => (ty === "trial series" ? t("rb.type.series") : ty === "trials" ? t("rb.type.trials") : ty);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { setMsg({ text: errText(e), err: true }); } finally { setBusy(false); }
  };
  const restore = () => cur && window.confirm(t("rb.restoreQ", { name: cur.label || String(cur.object_id) })) && run(async () => {
    const r = await request<{ label: string }>("POST", `/api/superuser/recycle-bin/${cur.id}/restore`);
    setMsg({ text: t("rb.restored", { name: r.label }) });
    await load();
  });
  const remove = () => cur && window.confirm(t("rb.deleteQ2", { name: cur.label || String(cur.object_id) })) && run(async () => {
    await request("DELETE", `/api/superuser/recycle-bin/${cur.id}`);
    setMsg({ text: t("rb.deleted") });
    await load();
  });
  const preview = (e: Entry | null = cur) => e && e.type === "trial series" && window.confirm(t("rb.previewQ", { name: e.label })) && run(async () => {
    const r = await request<{ series_id: number }>("POST", `/api/superuser/recycle-bin/${e.id}/preview`);
    navigate(`/series/${r.series_id}`);
  });

  return (
    <div className="page">
      <div className="page-head"><h1>{t("rb.title")}</h1>
        <button className="btn-plain" onClick={load}>{t("mj.reload")}</button></div>
      {data && <p className="muted">{t("rb.info", { n: data.retention_days })}</p>}
      {msg && <div className={"mj-msg" + (msg.err ? " err" : "")} onClick={() => setMsg(null)}>{msg.text}</div>}
      {data && data.previews.length > 0 && (
        <div className="rb-banner">{t("rb.openPreviews")}{" "}
          {data.previews.map((p) => <button key={p.series_id} className="btn-plain" disabled={!p.mine}
            onClick={() => navigate(`/series/${p.series_id}`)}>{p.label}</button>)}</div>)}
      {data && (<>
        <div className="toolbar">
          <button className="btn-green" disabled={!isSeries || busy} title={t("rb.previewTip")} onClick={() => preview()}>{t("rb.preview")}</button>
          <button className="btn-plain" disabled={!cur || busy} onClick={restore}>{t("rb.restore")}</button>
          <button className="btn-plain danger" disabled={!cur || busy} onClick={remove}>{t("rb.delete")}</button>
        </div>
        {!data.entries.length ? <p className="muted">{t("rb.empty")}</p> : (
          <div className="rb-wrap">
            <table className="pp-table">
              <thead><tr><th>{t("rb.col.when")}</th><th>{t("rb.col.by")}</th><th>{t("rb.col.type")}</th><th>{t("rb.col.what")}</th><th>{t("rb.col.summary")}</th></tr></thead>
              <tbody>{data.entries.map((e) => (
                <tr key={e.id} className={sel === e.id ? "sel" : ""} onClick={() => setSel(e.id)}
                  onDoubleClick={() => { setSel(e.id); preview(e); }}>
                  <td>{e.deleted_at}</td><td>{e.user}</td><td>{typeText(e.type)}</td><td>{e.label}</td><td className="muted">{e.summary}</td>
                </tr>))}</tbody>
            </table>
          </div>)}
      </>)}
    </div>
  );
}
