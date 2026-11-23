import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import YarnScopeView from "../components/YarnScopeView";
import YarnScopeAty from "../components/YarnScopeAty";
import { FreeMeasureDialog } from "../components/SensorMeasure";

/* TDMS Inspector (desktop ui/screen_tdms_inspector.py): any .tdms file from this computer through the DTY and/or
   ATY YarnScope - no experiment, nothing read from or written to the database. The file is uploaded
   (app/tdms_inspector.py, kept one day) and gets a negative "series" number the YarnScope views use as usual;
   Save / Batch / Compare are not offered (like the desktop). */

export default function TdmsInspector() {
  const { t } = useI18n();
  const [file, setFile] = useState<{ id: number; name: string; size: number } | null>(null);
  const [tab, setTab] = useState<"dty" | "aty">("dty");
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [measure, setMeasure] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const upload = (f: File | undefined) => {
    if (!f) return;
    setErr(null); setBusy(0);
    const fd = new FormData();
    fd.append("file", f);
    const xhr = new XMLHttpRequest();          // XHR for the upload progress of big files
    xhr.open("POST", "/api/tdms-inspector/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setBusy(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      setBusy(null);
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) { setErr(j.code ? t(`ti.err.${j.code}`) : j.detail); return; }
        setFile({ id: j.series_id, name: j.name, size: j.size });
      } catch { setErr(t("ti.err.failed")); }
    };
    xhr.onerror = () => { setBusy(null); setErr(t("ti.err.failed")); };
    xhr.send(fd);
  };

  return (
    <div className="page ti-page">
      <div className="page-head"><h1>{t("ti.title")}</h1></div>
      <p className="muted">{t("ti.info")}</p>
      <div className="ti-top">
        <button className="btn-green" disabled={busy !== null} onClick={() => input.current?.click()}>📂 {t("ti.open")}</button>
        <input ref={input} type="file" accept=".tdms" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn-plain" disabled={busy !== null} title={t("ti.measureTip")} onClick={() => setMeasure(true)}>{t("ti.measure")}</button>
        <span className="muted">{busy !== null ? t("ti.uploading", { p: busy }) : file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : t("ti.none")}</span>
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      {/* "📏 Messen…": a measurement with own name + speed is opened here as soon as it is saved */}
      {measure && <FreeMeasureDialog onClose={() => setMeasure(false)}
        onMeasured={(r) => { setErr(null); setFile({ id: r.series_id, name: r.file, size: r.size }); }} />}
      {file && (<>
        <div className="se-tabs" role="tablist">
          <button role="tab" className={"se-tab" + (tab === "dty" ? " on" : "")} onClick={() => setTab("dty")}>YarnScope DTY</button>
          <button role="tab" className={"se-tab" + (tab === "aty" ? " on" : "")} onClick={() => setTab("aty")}>YarnScope ATY</button>
        </div>
        {tab === "dty" ? <YarnScopeView key={"d" + file.id} seriesId={file.id} canWrite={false} inspector />
          : <YarnScopeAty key={"a" + file.id} seriesId={file.id} canWrite={false} inspector />}
      </>)}
    </div>
  );
}
