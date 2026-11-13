import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "../api";
import { useI18n } from "../i18n";
import { HelpButton } from "../components/Help";
import { useContextMenu, type MenuItem } from "../components/ContextMenu";
import { download, newSid, SummaryBar, useSmartFrame } from "../components/SmartFrame";
import { errText, OpenViewDialog, PdfDialog, SaveViewDialog, ShareDialog, type Answer, type Summary, type ViewInfo } from "../components/SmartDialogs";

/* Smart Chart (desktop ui/screen_smart_chart.py): find trials by their properties across all series and show
   them in a dashboard like Power BI. The dashboard is the desktop page (components/SmartFrame); here the header:
   New, Open view, Save view, Share…, Excel, Reload, PDF. ?view=<id> opens a saved view ("Edit in Smart Chart"). */

export default function SmartChart() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const sid = useMemo(newSid, []);
  const [opened, setOpened] = useState(false);
  const [view, setView] = useState<ViewInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dlg, setDlg] = useState<"open" | "save" | "share" | "pdf" | null>(null);
  const [templates, setTemplates] = useState<{ key: string; label: string; tip: string }[]>([]);
  const [viewsOk, setViewsOk] = useState(true);
  const fr = useSmartFrame(sid, false, opened);
  const menu = useContextMenu();
  const newBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const vid = params.get("view");
    request<{ summary: Summary; view: ViewInfo | null; missing: string[] }>("POST", "/api/smart/open",
      { sid, read_only: false, view_id: vid ? Number(vid) : null })
      .then((d) => { fr.setSummary(d.summary); setView(d.view); if (d.missing?.length) setMsg(t("sc.missing", { names: d.missing.join(", ") })); })
      .catch((e) => {
        setMsg(errText(t, e));
        if (vid) { setParams({}, { replace: true }); request("POST", "/api/smart/open", { sid }).catch(() => undefined); }
      })
      .finally(() => setOpened(true));
    request<{ templates: typeof templates }>("GET", "/api/smart/templates").then((d) => setTemplates(d.templates)).catch(() => undefined);
    request<{ available: boolean }>("GET", "/api/smart/views").then((d) => setViewsOk(d.available)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (p: Promise<Answer>) => p.then((a) => { fr.apply(a); if (a.view !== undefined) setView(a.view ?? null); if (a.missing?.length) setMsg(t("sc.missing", { names: a.missing.join(", ") })); })
    .catch((e) => setMsg(errText(t, e)));
  const startNew = (template: string | null) => {
    setMsg(null);
    setParams({}, { replace: true });
    run(request<Answer>("POST", `/api/smart/${sid}/new`, { template }));
  };
  const openNew = (e: React.MouseEvent) => {
    const items: MenuItem[] = [{ label: t("sc.newEmpty"), onClick: () => startNew("") }, { label: t("sc.newExample"), onClick: () => startNew(null) },
      { sep: true }, { label: t("sc.fromTemplate"), disabled: true },
      ...templates.map((x) => ({ label: "   " + x.label, title: x.tip, onClick: () => startNew(x.key) }))];
    menu.open(e, items);
  };
  const openView = (v: ViewInfo) => {
    setDlg(null); setMsg(null);
    setParams({ view: String(v.id) }, { replace: true });
    run(request<Answer>("POST", `/api/smart/${sid}/view/open`, { id: v.id }));
  };
  const pdf = (all: boolean) => {
    setDlg(null);
    run(request<Answer>("POST", `/api/smart/${sid}/pdf`, { all_pages: all, title: view?.name || "" }));
  };
  const reload = () => run(request<Answer>("POST", `/api/smart/${sid}/reload`));
  const excel = () => {
    if (!fr.summary?.visuals) { setMsg(t("sc.err.no_visuals")); return; }
    download(`/api/smart/${sid}/excel`);
  };

  return (
    <div className="page smart-page">
      <div className="page-head sc-head">
        <div className="sc-titles">
          <div className="sc-kicker">SMART CHART</div>
          <h1>{view?.name || t("sc.newTitle")}</h1>
        </div>
        <button ref={newBtn} className="btn-plain" title={t("sc.newTip")} onClick={(e) => openNew(e)}>{t("sc.new")}</button>
        <button className="btn-plain" disabled={!viewsOk} title={viewsOk ? "" : t("sc.err.unavailable")} onClick={() => setDlg("open")}>{t("sc.openView")}</button>
        <button className="btn-plain" disabled={!viewsOk} title={viewsOk ? "" : t("sc.err.unavailable")} onClick={() => setDlg("save")}>{t("sc.saveView")}</button>
        <button className="btn-plain" disabled={!view?.can_share} title={view?.can_share ? t("sc.shareTip") : t("sc.shareFirst")} onClick={() => setDlg("share")}>{t("sc.share")}</button>
        <button className="btn-plain" title={t("sc.excelTip")} onClick={excel}>Excel</button>
        <button className="btn-plain" title={t("sc.reloadTip")} onClick={reload}>{t("sc.reload")}</button>
        <button className="btn-green" onClick={() => ((fr.summary?.pages || 1) > 1 ? setDlg("pdf") : pdf(false))}>PDF</button>
        <HelpButton screen="smart_chart" />
      </div>
      <SummaryBar s={fr.summary} />
      {(msg || fr.error) && <div className="mj-msg err sc-msg">{msg || fr.error} <button className="mu-x" onClick={() => { setMsg(null); fr.setError(null); }}>✕</button></div>}
      <div className="smart-body">{fr.element}</div>
      {fr.dialogs}
      {menu.menu}
      {dlg === "open" && <OpenViewDialog onClose={() => setDlg(null)} onOpen={openView} />}
      {dlg === "save" && <SaveViewDialog sid={sid} current={view} onClose={() => setDlg(null)}
        onSaved={(v) => { setView(v); setParams({ view: String(v.id) }, { replace: true }); setMsg(null); }} />}
      {dlg === "share" && view && <ShareDialog view={view} onClose={() => setDlg(null)}
        onSaved={() => request<{ view: ViewInfo }>("GET", `/api/smart/${sid}/state`).then((d) => setView(d.view))} />}
      {dlg === "pdf" && <PdfDialog pages={fr.summary?.pages || 1} onClose={() => setDlg(null)} onChoose={pdf} />}
    </div>
  );
}
