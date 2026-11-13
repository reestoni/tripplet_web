import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../api";
import { useI18n } from "../i18n";
import { HelpButton } from "../components/Help";
import { newSid, useSmartFrame } from "../components/SmartFrame";
import { errText, PdfDialog, viewMeta, type Answer, type Summary, type ViewInfo } from "../components/SmartDialogs";

/* Dashboards (desktop ui/screen_dashboards.py): LOOK at your own dashboards and the ones shared with you -
   Smart Chart is where they are built. Left the list, right the dashboard read-only (slicers, clicks,
   drill-down, page tabs work, nothing is saved); PDF yes, Excel no (desktop decision). "Edit in Smart Chart"
   for the creator and people with an edit share. The last dashboard is remembered in this browser. */

const LAST = "tripplet.dashboards.last";

export default function Dashboards() {
  const { t } = useI18n();
  const nav = useNavigate();
  const sid = useMemo(newSid, []);
  const [list, setList] = useState<ViewInfo[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [mayEdit, setMayEdit] = useState(false);
  const [cur, setCur] = useState<ViewInfo | null>(null);
  const [opened, setOpened] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pdfAsk, setPdfAsk] = useState(false);
  const fr = useSmartFrame(sid, true, opened);

  const loadList = (keep?: number | null) =>
    request<{ available: boolean; views: ViewInfo[]; smart_chart: boolean }>("GET", "/api/smart/views?kind=dashboard").then((d) => {
      setList(d.views); setAvailable(d.available); setMayEdit(d.smart_chart);
      let want = keep ?? null;
      if (want == null) { try { want = Number(localStorage.getItem(LAST)) || null; } catch { want = null; } }
      const v = d.views.find((x) => x.id === want) || d.views.find((x) => x.right === "owner") || d.views[0];
      if (v) pick(v);
    }).catch((e) => setMsg(errText(t, e)));

  useEffect(() => { loadList(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: ViewInfo) => {
    setCur(v); setMsg(null);
    try { localStorage.setItem(LAST, String(v.id)); } catch { /* private window */ }
    if (!opened) {
      request<{ summary: Summary; view: ViewInfo }>("POST", "/api/smart/open", { sid, read_only: true, view_id: v.id })
        .then((d) => { fr.setSummary(d.summary); setOpened(true); }).catch((e) => setMsg(errText(t, e)));
    } else {
      request<Answer>("POST", `/api/smart/${sid}/view/open`, { id: v.id }).then((a) => fr.apply(a)).catch((e) => setMsg(errText(t, e)));
    }
  };
  const reload = () => {
    if (opened) request<Answer>("POST", `/api/smart/${sid}/reload`).then((a) => fr.apply(a)).catch(() => undefined);
    loadList(cur?.id);
  };
  const pdf = (all: boolean) => {
    setPdfAsk(false);
    request<Answer>("POST", `/api/smart/${sid}/pdf`, { all_pages: all, title: cur?.name || "" }).then((a) => fr.apply(a)).catch((e) => setMsg(errText(t, e)));
  };

  const ql = q.trim().toLowerCase();
  const shown = (list || []).filter((v) => !ql || (v.name + " " + v.owner + " " + viewMeta(t, v)).toLowerCase().includes(ql));
  const groups: [string, ViewInfo[], string][] = [["dsb.mine", shown.filter((v) => v.right === "owner"), "dsb.noneMine"],
    ["dsb.shared", shown.filter((v) => v.right !== "owner"), "dsb.noneShared"]];
  const empty = !available ? t("dsb.unavailable") : list && !list.length ? t("dsb.none") : null;

  return (
    <div className="page smart-page">
      <div className="page-head sc-head">
        <div className="sc-titles">
          <div className="sc-kicker">DASHBOARDS</div>
          <h1>{cur && !empty ? cur.name : "Dashboards"}</h1>
          {cur && !empty && <div className="muted small">{viewMeta(t, cur)}</div>}
        </div>
        {cur && !empty && cur.can_change && mayEdit && (
          <button className="btn-plain" title={t("dsb.editTip")} onClick={() => nav(`/tools/smart-chart?view=${cur.id}`)}>{t("dsb.edit")}</button>)}
        <button className="btn-plain" title={t("dsb.reloadTip")} onClick={reload}>{t("sc.reload")}</button>
        <button className="btn-green" disabled={!opened || !!empty} onClick={() => ((fr.summary?.pages || 1) > 1 ? setPdfAsk(true) : pdf(false))}>PDF</button>
        <HelpButton screen="dashboards" />
      </div>
      {(msg || fr.error) && <div className="mj-msg err sc-msg">{msg || fr.error}</div>}
      <div className="dsb-body">
        <aside className="dsb-list">
          <input className="mj-search" placeholder={t("dsb.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          {groups.map(([title, vs, none]) => (
            <div key={title}>
              <div className="dsb-group">{t(title)}</div>
              {!vs.length && <div className="muted small dsb-none">{t(none)}</div>}
              {vs.map((v) => (
                <div key={v.id} className={"dsb-item" + (cur?.id === v.id ? " on" : "")} title={viewMeta(t, v)} onClick={() => pick(v)}>
                  {v.name}{v.right !== "owner" && <span className="muted"> · {v.owner}</span>}
                </div>))}
            </div>))}
        </aside>
        <div className="smart-body">
          {empty ? <div className="dsb-empty">{empty}</div> : list === null ? <div className="dsb-empty">{t("app.loading")}</div> : fr.element}
        </div>
      </div>
      {fr.dialogs}
      {pdfAsk && <PdfDialog pages={fr.summary?.pages || 1} onClose={() => setPdfAsk(false)} onChoose={pdf} />}
    </div>
  );
}
