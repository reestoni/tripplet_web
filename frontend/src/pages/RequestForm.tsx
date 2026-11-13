import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { ImageViewer, VersionHistory } from "../components/RequestPopup";
import RequestHelp from "../components/RequestHelp";

type Field = { name: string; label: string; type: "text" | "multiline" | "date" | "fk"; choices?: [unknown, string][]; required: boolean };
type Loaded = {
  id: number; title: string; status_id: number | null; status_label: string; denial_banner: string | null;
  change_of_id: number | null; pending_change_id: number | null; form: Record<string, unknown>;
  display: { name: string; label: string; text: string; multiline: boolean }[];
  images: { id: number; name: string }[]; is_superuser: boolean; versions: unknown[]; history_target_id: number | null;
};
type Img = { id: number; name: string; can_delete: boolean; can_rename?: boolean };
type Compare = { title: string; rows: { field: string; left: string; right: string; changed: boolean }[]; any_changes: boolean };

function toInput(type: string, v: unknown): string {
  if (v == null) return "";
  if (type === "date") return String(v).slice(0, 10);
  return String(v);
}

/** Create / edit / view one Experiment Request. Rules (required fields, proposal for normal users,
 *  archive for superusers, images) all come from db/experiment_requests on the server. */
export default function RequestForm() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [fields, setFields] = useState<Field[] | null>(null);
  const [required, setRequired] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Compare | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<number | null>(null);
  const [history, setHistory] = useState(false);
  const [help, setHelp] = useState(false);

  const reqId = loaded?.id ?? null;

  const loadImages = (rid: number) =>
    request<{ images: Img[] }>("GET", `/api/requests/${rid}/images`).then((d) => setImages(d.images)).catch(() => setImages([]));

  useEffect(() => {
    let alive = true;
    request<{ fields: Field[]; required: string[] }>("GET", "/api/requests/form").then((f) => {
      if (!alive) return;
      setFields(f.fields);
      setRequired(f.required);
    }).catch((e) => setMsg({ kind: "err", text: e.message }));
    if (!isNew) {
      request<Loaded>("GET", `/api/requests/${id}`).then((d) => {
        if (!alive) return;
        setLoaded(d);
        const v: Record<string, string> = {};
        for (const [k, val] of Object.entries(d.form || {})) {
          const txt = val == null ? "" : String(val);
          v[k] = /^\d{4}-\d{2}-\d{2}[ T]00:00:00/.test(txt) ? txt.slice(0, 10) : txt; // dates as yyyy-mm-dd
        }
        setValues(v);
        setInitial(v);
        loadImages(d.id);
        if (d.is_superuser && d.pending_change_id) {
          request<Compare>("GET", `/api/requests/${d.id}/compare/${d.pending_change_id}`).then((c) => alive && setReview(c));
        }
      }).catch((e) => setMsg({ kind: "err", text: e instanceof ApiError && e.status === 404 ? t("rq.notFound") : e.message }));
    } else {
      setLoaded(null); setValues({}); setInitial({}); setImages([]);
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // unsaved changes (desktop _has_unsaved_changes): ask before leaving the form
  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(values), ...Object.keys(initial)]);
    return [...keys].some((k) => (values[k] ?? "") !== (initial[k] ?? ""));
  }, [values, initial]);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const leaveOk = () => !dirtyRef.current || window.confirm(t("rq.leaveQ"));
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      if (a.origin !== window.location.origin || a.closest(".rq-images, .modal")) return;
      if (!window.confirm(t("rq.leaveQ"))) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); };
  }, [t]);

  const label = (f: Field) => { const k = `rqf.${f.name}`; const v = t(k); return v === k ? f.label : v; };
  const isReq = (f: Field) => f.required || required.includes(f.name);

  const save = async () => {
    setBusy(true); setMsg(null); setMissing([]);
    try {
      const res = await request<{ kind: string; request_id: number | null; message: string; missing: string[] }>(
        isNew ? "POST" : "PUT", isNew ? "/api/requests" : `/api/requests/${reqId}`, { values });
      if (res.kind === "invalid") { setMissing(res.missing); setMsg({ kind: "err", text: res.message }); }
      else if (res.kind === "unchanged") { setInitial(values); setMsg({ kind: "ok", text: t("rq.unchanged") }); }
      else {
        setInitial(values); dirtyRef.current = false;
        setMsg({ kind: "ok", text: res.kind === "proposal" ? t("rq.proposal") : t("rq.saved") });
        window.dispatchEvent(new Event("tripplet:nav-changed"));
        if (isNew && res.request_id) navigate(`/requests/${res.request_id}`, { replace: true });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const upload = async (files: FileList | null) => {
    if (!files || !files.length || reqId == null) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const r = await fetch(`/api/requests/${reqId}/images`, { method: "POST", body: fd, credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({ kind: "err", text: j.detail || "Upload failed" });
    else if (j.errors?.length) setMsg({ kind: "err", text: j.errors.join("\n") });
    loadImages(reqId);
  };

  const delImage = async (im: Img) => {
    if (reqId == null) return;
    await request("POST", `/api/requests/${reqId}/images/delete`, { image_ids: [im.id] }).catch((e) => setMsg({ kind: "err", text: e.message }));
    loadImages(reqId);
  };

  const decide = async (accept: boolean) => {
    if (!loaded?.pending_change_id) return;
    try {
      if (accept) await request("POST", `/api/requests/${loaded.pending_change_id}/accept`);
      else await request("POST", `/api/requests/${loaded.pending_change_id}/reject`, { original_id: loaded.id });
      window.dispatchEvent(new Event("tripplet:nav-changed"));
      dirtyRef.current = false;
      navigate("/requests");
    } catch (e) { setMsg({ kind: "err", text: e instanceof ApiError ? e.message : String(e) }); }
  };

  if (!fields) return <div className="page muted">{msg?.text ?? t("app.loading")}</div>;

  return (
    <div className="page rq-page">
      <div className="se-head">
        <button className="btn-plain" onClick={() => leaveOk() && (dirtyRef.current = false, navigate("/requests"))} title={t("se.back")}>←</button>
        <div className="se-title">
          <h1>{isNew ? t("rq.newTitle") : `#${loaded?.id ?? ""} – ${loaded?.title ?? ""}`}</h1>
          {loaded && <div className="se-facts"><span><b>{t("exp.col.status_id")}:</b> {loaded.status_id ? t(`rqs.${loaded.status_id}`) : loaded.status_label}</span>
            {loaded.change_of_id && <span>{t("rq.isChangeOf", { id: loaded.change_of_id })}</span>}</div>}
        </div>
        <span style={{ flex: 1 }} />
        {loaded && loaded.versions.length > 0 && loaded.history_target_id != null && (
          <button className="btn-plain" onClick={() => setHistory(true)} title={t("rqp.historyTip")}>{t("rq.historyBtn")}</button>
        )}
        <button className="rq-help" onClick={() => setHelp(true)} title={t("rqh.tip")}>?</button>
      </div>
      {loaded?.denial_banner && <div className="card rq-denied">{loaded.denial_banner}</div>}

      {review && review.any_changes && (
        <div className="card rq-review">
          <h3>{t("rq.reviewTitle")}</h3>
          <table className="grid">
            <thead><tr><th>{t("rq.field")}</th><th>{t("rq.current")}</th><th>{t("rq.proposed")}</th></tr></thead>
            <tbody>{review.rows.filter((r) => r.changed).map((r) => (
              <tr key={r.field}><td>{r.field}</td><td className="note-text">{r.left}</td><td className="note-text rq-new">{r.right}</td></tr>
            ))}</tbody>
          </table>
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => decide(false)}>{t("rq.reject")}</button>
            <button className="btn-green" onClick={() => decide(true)}>{t("rq.accept")}</button>
          </div>
        </div>
      )}

      <div className="card rq-form">
        {fields.map((f) => {
          const err = missing.includes(f.label) || missing.includes(f.name);
          const common = { id: `f-${f.name}`, value: values[f.name] ?? "",
            className: "search" + (err ? " rq-missing" : ""),
            onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.name]: e.target.value })) };
          return (
            <label key={f.name} className={"rq-field" + (f.type === "multiline" ? " wide" : "")}>
              <span>{label(f)}{isReq(f) && <b className="rq-req"> *</b>}</span>
              {f.type === "multiline" ? <textarea rows={3} {...common} />
                : f.type === "date" ? <input type="date" {...common} value={toInput("date", values[f.name])} />
                : f.type === "fk" ? (
                  <select {...common}>
                    <option value="">–</option>
                    {(f.choices ?? []).map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
                  </select>
                ) : <input {...common} />}
            </label>
          );
        })}
        <div className="rq-actions">
          <span className="muted">{t("rq.requiredHint")}</span>
          <button className="btn-green" disabled={busy} onClick={save}>{isNew ? t("rq.submit") : t("rq.save")}</button>
        </div>
        {msg && <div className={msg.kind === "err" ? "login-error" : "rq-ok"} style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>}
      </div>

      <div className="card rq-images">
        <div className="at-head">
          <h3>{t("rq.images")}</h3>
          {reqId != null ? (
            <>
              <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: "none" }} onChange={(e) => upload(e.target.files)} />
              <button className="btn-plain" onClick={() => fileRef.current?.click()}>{t("rq.addImages")}</button>
            </>
          ) : <span className="muted">{t("rq.imagesAfterSave")}</span>}
        </div>
        <div className="at-grid">
          {images.map((im, k) => (
            <div key={im.id} className="at-thumb">
              <a href={`/api/requests/${reqId}/images/${im.id}/file`} target="_blank" rel="noreferrer"
                onClick={(e) => { if (!(e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); setViewer(k); } }}>
                <img src={`/api/requests/${reqId}/images/${im.id}/file`} alt={im.name} loading="lazy" />
              </a>
              <span title={im.name}>{im.name}</span>
              {im.can_delete && <button className="link-btn" onClick={() => delImage(im)}>{t("rq.delete")}</button>}
            </div>
          ))}
        </div>
      </div>
      {viewer != null && reqId != null && (
        <ImageViewer requestId={reqId} images={images} start={viewer} onClose={() => setViewer(null)} onRenamed={() => loadImages(reqId)} />
      )}
      {history && loaded?.history_target_id != null && <VersionHistory requestId={loaded.history_target_id} onClose={() => setHistory(false)} />}
      {help && <RequestHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
