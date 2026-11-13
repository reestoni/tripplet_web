import { useState, type MouseEvent as RME } from "react";
import { useNavigate } from "react-router-dom";
import { img, request } from "../api";
import { useI18n } from "../i18n";
import { Overlay } from "./RequestPopup";

/* RE icon (saved Smart-Chart report of a series) and the small pickers used by the request pages.
   Like the desktop _open_report_icon_for_series + ui/widgets/report_picker.py: one report = open it,
   several = pick one; Ctrl/middle click = new browser tab. Data: db/series_overview.reports_for_series. */

type Report = { id: number; title: string; author: string };
export type Choice = { key: number; label: string };

const newTab = (e: RME) => e.ctrlKey || e.metaKey || e.button === 1;

/** List picker (one entry = choose, double-click = OK), used for reports and series. */
export function Picker({ title, hint, items, onPick, onClose }: {
  title: string; hint?: string; items: Choice[]; onPick: (key: number, e: RME) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [sel, setSel] = useState(0);
  return (
    <Overlay onClose={onClose}>
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      <div className="rqp-versions" role="listbox">
        {items.map((it, i) => (
          <button key={it.key} role="option" aria-selected={i === sel} className={"rqp-version" + (i === sel ? " on" : "")}
            onClick={(e) => { setSel(i); if (newTab(e)) onPick(it.key, e); }}
            onAuxClick={(e) => { if (e.button === 1) onPick(it.key, e); }}
            onDoubleClick={(e) => onPick(it.key, e)}>{it.label}</button>
        ))}
      </div>
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("bl.machine.cancel")}</button>
        <button className="btn-green" disabled={!items[sel]} onClick={(e) => items[sel] && onPick(items[sel].key, e)}>{t("rq.ok")}</button>
      </div>
    </Overlay>
  );
}

/** Clickable RE icon: opens the saved report of the series (Ctrl/middle click = new tab). */
export function ReportIcon({ seriesId, count }: { seriesId: number; count: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pick, setPick] = useState<{ list: Report[]; tab: boolean } | null>(null);
  if (!count) return null;
  const go = (rid: number, tab: boolean) => {
    const url = `/series/${seriesId}/report?report=${rid}`;
    if (tab) window.open(url, "_blank", "noopener");
    else navigate(url);
  };
  const click = (e: RME) => {
    e.stopPropagation();
    e.preventDefault();
    const tab = newTab(e);
    request<{ reports: Report[] }>("GET", `/api/series/${seriesId}/reports`).then((d) => {
      if (d.reports.length === 1) go(d.reports[0].id, tab);
      else if (d.reports.length > 1) setPick({ list: d.reports, tab });
    }).catch(() => undefined);
  };
  return (
    <>
      <img src={img("analytics.png")} alt="RE" className="rqp-icon" draggable={false} role="button"
        title={t("rqp.reportTip", { n: count })}
        onClick={click} onAuxClick={(e) => { if (e.button === 1) click(e); }}
        onMouseDown={(e) => { e.stopPropagation(); if (e.button === 1) e.preventDefault(); }}
        onDoubleClick={(e) => e.stopPropagation()} />
      {pick && (
        <Picker title={t("rqp.pickReport")} hint={t("rqp.pickReportHint")}
          items={pick.list.map((r) => ({ key: r.id, label: (r.title || t("rqp.untitled")) + (r.author ? `  —  ${r.author}` : "") }))}
          onPick={(id, e) => { const tab = pick.tab || newTab(e); setPick(null); go(id, tab); }}
          onClose={() => setPick(null)} />
      )}
    </>
  );
}
