import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, img, request } from "../api";
import { OutcomeDot } from "./ConclusionTab";
import { useI18n } from "../i18n";

/* Read-only Experiment Request popup like the desktop _ExperimentRequestReadOnlyDialog
   (fields, images, version history) - opened from the ER icons in All Experiments, Backlog,
   Show Experiment and the Report. Data: GET /api/requests/{id}/view (db/experiment_requests.popup_data),
   who may see it: db/experiment_requests.can_view. */

type Field = { name: string; label: string; text: string; multiline: boolean };
type View = { id: number; title: string; display: Field[]; images: { id: number; name: string }[];
  history_target_id: number; has_versions: boolean;
  /** conclusions of the series linked to this request (db/series_conclusion.for_request) */
  conclusions?: { series_id: number; series_name: string; experiment_id: string; outcome: string | null; summary: string;
    recommendation: string | null; recommendation_text: string }[] };
export type Version = { id: number; version: number; current: boolean; timestamp: string | null; user: string };
type Compare = { title: string; rows: { field: string; left: string; right: string; changed: boolean }[]; any_changes: boolean };
export type ImgItem = { id: number; name: string; can_rename?: boolean };

/** stops mouse events of a popup from reaching the row/card it was opened from (React bubbles through portals) */
const stop = (e: SyntheticEvent) => e.stopPropagation();
const guard = { onClick: stop, onDoubleClick: stop, onMouseDown: stop, onContextMenu: stop, onDragStart: stop, onKeyDown: stop };

export function Overlay({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" {...guard} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className={"modal rqp " + (wide ?? "")} onClick={stop} role="dialog" aria-modal="true">{children}</div>
    </div>,
    document.body,
  );
}

function useFieldLabel() {
  const { t } = useI18n();
  return (name: string, fallback: string) => { const k = `rqf.${name}`; const v = t(k); return v === k ? fallback : v; };
}

export default function RequestPopup({ id, prefix, onClose }: { id: number; prefix?: string; onClose: () => void }) {
  const { t } = useI18n();
  const label = useFieldLabel();
  const [data, setData] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    setData(null); setErr(null);
    request<View>("GET", `/api/requests/${id}/view`).then(setData)
      .catch((e) => setErr(e instanceof ApiError && e.status === 404 ? t("rq.notFound")
        : e instanceof ApiError && e.status === 403 ? t("rqp.forbidden") : String(e.message || e)));
  }, [id, t]);
  return (
    <Overlay onClose={onClose} wide="rqp-wide">
      <div className="rqp-head">
        <h2>{prefix ?? ""}{data?.title ?? t("rqp.title")}</h2>
        {data && data.images.length > 0 && (
          <button className="tb-icon" title={t("rqp.images")} onClick={() => setShowImages(true)}>
            <img src={img("picture.png")} alt={t("rqp.images")} />
          </button>
        )}
        {data?.has_versions && (
          <button className="btn-plain" title={t("rqp.historyTip")} onClick={() => setShowHistory(true)}>{t("rqp.history")}</button>
        )}
      </div>
      <div className="rqp-body">
        {err && <div className="login-error">{err}</div>}
        {!data && !err && <div className="muted">{t("app.loading")}</div>}
        {data && (
          <dl className="rqp-fields">
            {data.display.map((f) => (
              <div key={f.name} className="rqp-row">
                <dt>{label(f.name, f.label)}</dt>
                <dd className={f.multiline ? "multi" : ""}>{f.text || <span className="muted">–</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        {data && data.conclusions && data.conclusions.length > 0 && (
          <div className="rqp-concl">
            <h3>{t("cc.requestResults")}</h3>
            {data.conclusions.map((c) => (
              <div key={c.series_id} className="rqp-concl-row">
                <a href={`/series/${c.series_id}?tab=conclusion`} onClick={(e) => { if (!(e.ctrlKey || e.metaKey)) { e.preventDefault(); onClose(); window.location.assign(`/series/${c.series_id}?tab=conclusion`); } }}>
                  {c.experiment_id} – {c.series_name}</a>
                <div><OutcomeDot outcome={c.outcome} />{c.outcome ? <b>{t(`cc.o.${c.outcome}`)}</b> : null}{c.summary ? ` ${c.summary}` : ""}</div>
                {(c.recommendation || c.recommendation_text) && (
                  <div className="muted">{t("cc.recommendation")}: {c.recommendation ? t(`cc.r.${c.recommendation}`) : ""}{c.recommendation_text ? ` – ${c.recommendation_text}` : ""}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button></div>
      {showImages && data && <ImageViewer requestId={data.id} images={data.images} onClose={() => setShowImages(false)} />}
      {showHistory && data && <VersionHistory requestId={data.history_target_id} onClose={() => setShowHistory(false)} />}
    </Overlay>
  );
}

/** Version history (desktop ui/widgets/experiment_request_version_history.py): Current opens the
 *  read-only popup, an archived version opens the comparison with the live row. */
export function VersionHistory({ requestId, onClose }: { requestId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<Version[] | null>(null);
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<Version | null>(null);
  useEffect(() => {
    request<{ versions: Version[] }>("GET", `/api/requests/${requestId}/versions`).then((d) => setList(d.versions))
      .catch((e) => setErr(String(e.message || e)));
  }, [requestId]);
  const cur = list?.[sel];
  const name = (v: Version) => v.current ? t("rqp.vCurrent", { n: v.version }) : t("rqp.vN", { n: v.version });
  return (
    <Overlay onClose={onClose}>
      <h2>{t("rqp.historyTitle")}</h2>
      <p className="muted">{t("rqp.historyHint")}</p>
      {err && <div className="login-error">{err}</div>}
      <div className="rqp-versions" role="listbox">
        {(list ?? []).map((v, i) => (
          <button key={v.id} role="option" aria-selected={i === sel} className={"rqp-version" + (i === sel ? " on" : "") + (v.current ? " current" : "")}
            onClick={() => setSel(i)} onDoubleClick={() => setView(v)}>
            {v.current ? `● ${name(v)}` : `${name(v)}  —  ${v.timestamp}  —  ${v.user}`}
          </button>
        ))}
      </div>
      <div className="modal-buttons">
        <button className="btn-plain" disabled={!cur} onClick={() => cur && setView(cur)}>
          {cur && !cur.current ? t("rqp.compareCurrent") : t("rqp.view")}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button>
      </div>
      {view && view.current && <RequestPopup id={view.id} prefix={`${t("rqp.current")} — `} onClose={() => setView(null)} />}
      {view && !view.current && (
        <VersionCompare requestId={requestId} older={view} olderLabel={name(view)} onClose={() => setView(null)} />
      )}
    </Overlay>
  );
}

function VersionCompare({ requestId, older, olderLabel, onClose }: { requestId: number; older: Version; olderLabel: string; onClose: () => void }) {
  const { t } = useI18n();
  const label = useFieldLabel();
  const [data, setData] = useState<Compare | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    request<Compare>("GET", `/api/requests/${requestId}/versions/${older.id}/compare`).then(setData)
      .catch((e) => setErr(String(e.message || e)));
  }, [requestId, older.id]);
  const rows = (data?.rows ?? []).filter((r) => !onlyChanged || r.changed);
  return (
    <Overlay onClose={onClose} wide="rqp-wide">
      <h2>{t("rqp.compareTitle", { v: olderLabel })}</h2>
      {data && <p className="muted">{data.title}{!data.any_changes && ` — ${t("rqp.noDiff")}`}</p>}
      {err && <div className="login-error">{err}</div>}
      <label className="rqp-check"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> {t("rqp.onlyChanged")}</label>
      <div className="rqp-body">
        <table className="grid">
          <thead><tr><th>{t("rq.field")}</th><th>{olderLabel}</th><th>{t("rqp.currentLive")}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.field} className={r.changed ? "rqp-changed" : ""}>
              <td>{label(r.field, r.field)}</td><td className="note-text">{r.left}</td><td className="note-text">{r.right}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button></div>
    </Overlay>
  );
}

/** Image viewer like the desktop ExperimentRequestImagesDialog: list, zoom, rotate, rename (uploader/superuser). */
export function ImageViewer({ requestId, images, start = 0, onClose, onRenamed }: {
  requestId: number; images: ImgItem[]; start?: number; onClose: () => void; onRenamed?: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<ImgItem[]>(images);
  const [i, setI] = useState(Math.min(start, Math.max(0, images.length - 1)));
  const [zoom, setZoom] = useState<number | null>(null);    // null = fit
  const [rot, setRot] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setList(images), [images]);
  const cur = list[i];
  const go = useCallback((d: number) => { setI((x) => (x + d + list.length) % list.length); setZoom(null); setRot(0); }, [list.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+") setZoom((z) => Math.min(8, (z ?? 1) * 1.25));
      else if (e.key === "-") setZoom((z) => Math.max(0.1, (z ?? 1) / 1.25));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go]);
  const rename = async () => {
    if (!cur) return;
    const typed = window.prompt(t("rqp.renamePrompt"), cur.name.replace(/\.[^.]+$/, ""));
    if (typed == null || !typed.trim()) return;
    try {
      const r = await request<{ name: string | null }>("POST", `/api/requests/${requestId}/images/${cur.id}/rename`, { name: typed.trim() });
      if (r.name) setList((l) => l.map((x) => x.id === cur.id ? { ...x, name: r.name as string } : x));
      onRenamed?.();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : String(e)); }
  };
  const src = cur ? `/api/requests/${requestId}/images/${cur.id}/file` : "";
  return (
    <Overlay onClose={onClose} wide="rqp-img">
      <div className="rqp-imgwrap">
        <div className="rqp-imglist">
          {list.map((m, k) => (
            <button key={m.id} className={"rqp-version" + (k === i ? " on" : "")} title={m.name}
              onClick={() => { setI(k); setZoom(null); setRot(0); }}>{m.name}</button>
          ))}
        </div>
        <div className="rqp-imgmain">
          <div className="rqp-imgbar">
            <button className="btn-plain" onClick={() => go(-1)} disabled={list.length < 2} title="←">‹</button>
            <button className="btn-plain" onClick={() => go(1)} disabled={list.length < 2} title="→">›</button>
            <button className="btn-plain" onClick={() => setZoom((z) => Math.max(0.1, (z ?? 1) / 1.25))} title={t("rqp.zoomOut")}>−</button>
            <button className="btn-plain" onClick={() => setZoom((z) => Math.min(8, (z ?? 1) * 1.25))} title={t("rqp.zoomIn")}>+</button>
            <button className="btn-plain" onClick={() => setZoom(null)}>{t("rqp.fit")}</button>
            <button className="btn-plain" onClick={() => setZoom(1)}>100 %</button>
            <button className="btn-plain" onClick={() => setRot((r) => (r + 270) % 360)} title={t("rqp.rotL")}>⟲</button>
            <button className="btn-plain" onClick={() => setRot((r) => (r + 90) % 360)} title={t("rqp.rotR")}>⟳</button>
            {cur?.can_rename && <button className="btn-plain" onClick={rename}>{t("rqp.rename")}</button>}
            {cur && <a className="btn-plain" href={src} download={cur.name}>{t("rqp.saveAs")}</a>}
            <span className="muted rqp-imgname">{cur?.name} ({i + 1}/{list.length})</span>
          </div>
          {msg && <div className="login-error">{msg}</div>}
          <div className={"rqp-canvas" + (zoom == null ? " fit" : "")}>
            {cur && <img src={src} alt={cur.name}
              style={{ transform: `rotate(${rot}deg)`, ...(zoom == null ? {} : { width: "auto", maxWidth: "none", maxHeight: "none", zoom }) }} />}
          </div>
        </div>
      </div>
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button></div>
    </Overlay>
  );
}

/** Clickable ER icon (All Experiments, Backlog cards, Show Experiment, Report). */
export function RequestIcon({ id, big }: { id: string | number | null | undefined; big?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (id == null || id === "" || id === 0 || id === "0") return null;
  return (
    <>
      <img src={img("experiment_request.png")} alt="ER" className={"rqp-icon" + (big ? " big" : "")} draggable={false}
        title={t("rqp.openTip", { id })} role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }} onDoubleClick={stop} onMouseDown={stop}
        onKeyDown={(e) => { if (e.key === "Enter") setOpen(true); }} />
      {open && <RequestPopup id={Number(id)} onClose={() => setOpen(false)} />}
    </>
  );
}
