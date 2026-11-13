import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";

type Item = { id: number; name: string; can_delete?: boolean };
type Data = { images: Item[]; pdfs: Item[] };
type Kind = "image" | "pdf";
type UploadResult = { images: number; pdfs: number; errors: string[] };
type Msg = { kind: "ok" | "err"; text: string; errors?: string[] };

/** Images and PDFs attached to the series: buttons in the header, upload (button or drag & drop
 *  onto the header buttons / the gallery), gallery overlay with rename and delete.
 *  Rules as on the desktop (db/series_uploads.py): everybody uploads and renames,
 *  delete only the uploader or a superuser. */
export default function Attachments({ seriesId }: { seriesId: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const [big, setBig] = useState<Item | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);   // null = fit (desktop images dialog: zoom / rotate)
  const [rot, setRot] = useState(0);
  const showBig = (it: Item | null) => { setBig(it); setZoom(null); setRot(0); };
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    request<Data>("GET", `/api/series/${seriesId}/attachments`).then(setData).catch(() => setData(null));
  }, [seriesId]);
  useEffect(load, [load]);

  useEffect(() => {
    if (msg?.kind !== "ok") return;
    const h = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(h);
  }, [msg]);

  /** backend code -> up.err.<code>, else the English detail */
  const errText = (code: string | undefined, detail: string | undefined) => {
    const key = `up.err.${code ?? ""}`;
    const s = t(key);
    return s === key ? detail || t("up.failed") : s;
  };
  const caught = (e: unknown) =>
    setMsg({ kind: "err", text: e instanceof ApiError ? errText(e.code, e.message) : String(e) });

  const upload = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length || progress !== null) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    setMsg(null);
    setProgress(0);
    // XHR instead of fetch: upload progress for big PDFs / many photos
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/series/${seriesId}/attachments`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setProgress(Math.round((100 * ev.loaded) / ev.total)); };
    xhr.onload = () => {
      setProgress(null);
      let j: Partial<UploadResult> & { code?: string; detail?: string } = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 400) {
        setMsg({ kind: "err", text: errText(j.code, typeof j.detail === "string" ? j.detail : undefined) });
      } else {
        const text = t("up.done", { i: j.images ?? 0, p: j.pdfs ?? 0 });
        const errors = j.errors ?? [];
        setMsg(errors.length ? { kind: "err", text, errors } : { kind: "ok", text });
      }
      load();
    };
    xhr.onerror = () => { setProgress(null); setMsg({ kind: "err", text: t("up.failed") }); };
    xhr.send(fd);
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dropProps = {
    onDragEnter: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDrag(true); } },
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDrag(true); } },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDrag(false);
      upload(e.dataTransfer.files);
    },
  };

  const rename = async (kind: Kind, it: Item) => {
    const dot = it.name.lastIndexOf(".");
    const ext = dot > 0 ? it.name.slice(dot) : kind === "pdf" ? ".pdf" : "";
    const base = dot > 0 ? it.name.slice(0, dot) : it.name;
    const typed = window.prompt(t("up.renamePrompt", { ext: ext || "-" }), base);
    if (typed === null || !typed.trim() || typed.trim() === base) return;
    try {
      const r = await request<{ name: string }>("POST", `/api/series/${seriesId}/attachments/${kind}/${it.id}/rename`, { name: typed });
      if (big && big.id === it.id) setBig({ ...big, name: r.name });
      load();
    } catch (e) { caught(e); }
  };

  const remove = async (kind: Kind, it: Item) => {
    if (!window.confirm(t("up.confirmDelete", { name: it.name }))) return;
    try {
      const r = await request<{ deleted: number[]; errors: string[] }>("POST", `/api/series/${seriesId}/attachments/${kind}/delete`, { ids: [it.id] });
      if (r.errors.length) setMsg({ kind: "err", text: t("up.deleteProblems"), errors: r.errors });
      if (big && big.id === it.id) showBig(null);
      load();
    } catch (e) { caught(e); }
  };

  const url = (kind: string, id: number) => `/api/series/${seriesId}/attachments/${kind}/${id}`;
  const close = () => { setOpen(null); showBig(null); };
  const actions = (kind: Kind, it: Item) => (
    <span className="up-actions">
      <button className="link-btn" onClick={() => rename(kind, it)}>{t("up.rename")}</button>
      {it.can_delete && <button className="link-btn up-del" onClick={() => remove(kind, it)}>{t("up.delete")}</button>}
    </span>
  );
  const uploadLabel = progress !== null ? t("up.progress", { n: progress }) : t("up.upload");
  const images = data?.images ?? [];
  const pdfs = data?.pdfs ?? [];
  const list = open === "image" ? images : pdfs;

  return (
    <span className={"up-zone" + (drag && !open ? " drag" : "")} {...dropProps}>
      <button className="tb-btn" onClick={() => fileRef.current?.click()} disabled={progress !== null}
        title={t("up.tip")}>
        {uploadLabel}
      </button>
      <button className="tb-icon" disabled={!images.length} onClick={() => setOpen("image")} title={t("at.images", { n: images.length })}>
        <img src="/api/img/picture.png" alt="" />{images.length > 0 && <span className="tb-count">{images.length}</span>}
      </button>
      <button className="tb-icon" disabled={!pdfs.length} onClick={() => setOpen("pdf")} title={t("at.pdfs", { n: pdfs.length })}>
        <img src="/api/img/pdf.png" alt="" />{pdfs.length > 0 && <span className="tb-count">{pdfs.length}</span>}
      </button>
      <input ref={fileRef} type="file" multiple accept="image/*,.heic,.heif,.pdf,application/pdf" style={{ display: "none" }}
        onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      {msg && (
        <span className={"up-msg " + msg.kind} role="status">
          <span>{msg.text}</span>
          {msg.errors && msg.errors.length > 0 && (
            <ul>{msg.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
          <button className="btn-plain up-x" onClick={() => setMsg(null)} aria-label={t("at.close")}>×</button>
        </span>
      )}
      {open && (
        <div className="modal-back" onClick={close}>
          <div className={"modal at-modal" + (drag ? " up-drag" : "")} onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true">
            <div className="at-head">
              <h2>{open === "image" ? t("at.imagesTitle") : t("at.pdfsTitle")}</h2>
              <span className="up-head-btns">
                <button className="btn-plain" onClick={() => fileRef.current?.click()} disabled={progress !== null}>
                  {uploadLabel}
                </button>
                <button className="btn-plain" onClick={close}>{t("at.close")}</button>
              </span>
            </div>
            <div className="muted up-hint">{t("up.dropHint")}</div>
            {list.length === 0 && <div className="muted">{t("up.empty")}</div>}
            {open === "pdf" && (
              <ul className="at-list">
                {pdfs.map((p) => (
                  <li key={p.id}>
                    <a href={url("pdf", p.id)} target="_blank" rel="noreferrer">{p.name}</a>
                    {actions("pdf", p)}
                  </li>
                ))}
              </ul>
            )}
            {open === "image" && !big && (
              <div className="at-grid">
                {images.map((im) => (
                  <div key={im.id} className="up-tile">
                    <button className="at-thumb" onClick={() => showBig(im)} title={im.name}>
                      <img src={url("image", im.id)} alt={im.name} loading="lazy" />
                      <span>{im.name}</span>
                    </button>
                    {actions("image", im)}
                  </div>
                ))}
              </div>
            )}
            {open === "image" && big && (
              <div className="at-big">
                <div className="rqp-imgbar">
                  <button className="btn-plain" onClick={() => showBig(null)}>← {t("at.all")}</button>
                  {(() => {
                    const list = data?.images ?? [];
                    const i = list.findIndex((x) => x.id === big.id);
                    const go = (d: number) => list.length > 1 && showBig(list[(i + d + list.length) % list.length]);
                    return (
                      <>
                        <button className="btn-plain" onClick={() => go(-1)} disabled={list.length < 2}>‹</button>
                        <button className="btn-plain" onClick={() => go(1)} disabled={list.length < 2}>›</button>
                        <span className="muted">{i + 1}/{list.length}</span>
                      </>
                    );
                  })()}
                  <button className="btn-plain" onClick={() => setZoom((z) => Math.max(0.1, (z ?? 1) / 1.25))} title={t("rqp.zoomOut")}>−</button>
                  <button className="btn-plain" onClick={() => setZoom((z) => Math.min(8, (z ?? 1) * 1.25))} title={t("rqp.zoomIn")}>+</button>
                  <button className="btn-plain" onClick={() => setZoom(null)}>{t("rqp.fit")}</button>
                  <button className="btn-plain" onClick={() => setZoom(1)}>100 %</button>
                  <button className="btn-plain" onClick={() => setRot((r) => (r + 270) % 360)} title={t("rqp.rotL")}>⟲</button>
                  <button className="btn-plain" onClick={() => setRot((r) => (r + 90) % 360)} title={t("rqp.rotR")}>⟳</button>
                  <a className="btn-plain" href={url("image", big.id)} download={big.name}>{t("rqp.saveAs")}</a>
                  <a className="btn-plain" href={url("image", big.id)} target="_blank" rel="noreferrer">{t("at.newTab")}</a>
                </div>
                <div className={"rqp-canvas" + (zoom == null ? " fit" : "")}>
                  <img src={url("image", big.id)} alt={big.name}
                    style={{ transform: `rotate(${rot}deg)`, ...(zoom == null ? {} : { width: "auto", maxWidth: "none", maxHeight: "none", zoom }) }} />
                </div>
                <div className="muted">{big.name} {actions("image", big)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
