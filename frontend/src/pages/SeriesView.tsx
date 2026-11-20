import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, kbItem, notesTip, request, type SeriesData, type SeriesRights } from "../api";
import { useI18n } from "../i18n";
import { confirmLeave, EditCell, EditProvider, useEdit } from "../edit";
import { usePageTitle } from "../pageTitle";
import MachineTable from "../components/MachineTable";
import JetAirView from "../components/JetAirView";
import Attachments from "../components/Attachments";
import { RequestIcon } from "../components/RequestPopup";
import YarnScopeView from "../components/YarnScopeView";
import YarnScopeAty from "../components/YarnScopeAty";
import { useSeriesMenus, type Trial } from "../components/seriesMenus";
import type { MenuItem } from "../components/ContextMenu";
import { CopyTrialsDialog, LabelsDialog, PdfImportDialog, RefCompareDialog, RefNameDialog, YarnsDialog } from "../components/SeriesTools";
import { SensorMeasureDialog } from "../components/SensorMeasure";
import { HelpButton } from "../components/Help";
import { StockDialog } from "./CreateExperiment";
import { copyText, flashTrial, seriesLink } from "../links";
import ConclusionTab, { OutcomeDot } from "../components/ConclusionTab";
import { PHONE, TABLET, useMedia } from "../media";

const TAB_KEY = "tripplet.series.tab";

function lastTab(): string | null {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

export default function SeriesView({ accessLevel: userLevel = 0 }: { accessLevel?: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const linkTab = params.get("tab");              // link from "Copy link" (links.ts / desktop db/web_links.py)
  const linkTrial = Number(params.get("trial")) || null;
  const [data, setData] = useState<SeriesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  // phone/tablet (MOBILE.md): the table gets the screen - head, buttons and view bar fold away behind "Details"
  const small = useMedia(TABLET);
  const [headOpen, setHeadOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [fresh, setFresh] = useState(0);          // "↻" / F5: rebuilds every table of the page (desktop btn_refresh)
  const [rights, setRights] = useState<SeriesRights | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const measured = useRef(false);                 // "📏 Messen" saved a file -> rebuild the tables on close
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);
  const lastId = useRef<string | undefined>(undefined);
  const lastRecent = useRef<number | null>(null);
  const linked = useRef(false);                   // link parameters applied (only on the first load of the series)
  // tab title: experiment ID + series number only, e.g. "2026-73-053.01" (series names start with their number)
  const seriesNo = data ? (data.series.name.trim().match(/^\d+/)?.[0] ?? "") : "";
  usePageTitle(data ? (seriesNo ? `${data.series.experiment_id}.${seriesNo}` : data.series.experiment_id) : null);
  if (lastId.current !== id) linked.current = false;

  useEffect(() => {
    let alive = true;
    if (lastId.current !== id) setData(null);   // new series: clear; reload after saving keeps the page
    lastId.current = id;
    setError(null);
    api
      .series(Number(id))
      .then((d) => {
        if (!alive) return;
        setData(d);
        // "Recent" list (desktop ui/recent_series.py) - not for a series opened from the recycle bin
        if (!d.recycle_preview && lastRecent.current !== d.series.id) {
          lastRecent.current = d.series.id;
          request("POST", "/api/recent", { series_id: d.series.id }).catch(() => undefined);
        }
        const keys = ["machine", "notes", ...(d.conclusion ? ["conclusion"] : []), ...(d.has_rd ? ["rd"] : []), ...(d.has_yarnscope ? ["yarnscope"] : []), ...(d.has_yarnscope_aty ? ["yarnscope_aty"] : []),
          ...d.tabs.map((x) => x.key)];
        const first = !linked.current;
        linked.current = true;
        const fromLink = first && linkTab && keys.includes(linkTab) ? linkTab : null;
        const want = lastTab();
        setTab((cur) => fromLink ?? (cur && keys.includes(cur) ? cur : want && keys.includes(want) ? want : "machine"));
        if (first && linkTrial) flashTrial(linkTrial);
      })
      .catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? t("se.notFound") : e.message));
    api.rights(Number(id)).then((r) => alive && setRights(r)).catch(() => alive && setRights(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reload]);

  const choose = (k: string) => {
    setTab(k);
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {
      /* storage blocked */
    }
  };

  // row titles and tab names are translated; unknown ones stay as the desktop shows them
  const tr = (prefix: string, key: string, fallback: string) => {
    const k = `${prefix}.${key}`;
    const v = t(k);
    return v === k ? fallback : v;
  };

  if (error) {
    return (
      <div className="page">
        <button className="btn-plain" onClick={() => navigate(-1)}>← {t("se.back")}</button>
        <div className="card error" style={{ marginTop: 12 }}>{error}</div>
      </div>
    );
  }
  if (!data) return <div className="page muted">{t("se.loading")}</div>;

  const s = data.series;
  // opened from the recycle bin (desktop RecyclePreview): read only until a decision
  const preview = data.recycle_preview ?? null;
  const accessLevel = preview ? 1 : userLevel;
  const canWrite = accessLevel >= 2;
  const copyLink = async (url: string) => setToast(t(await copyText(url) ? "lk.copied" : "lk.failed"));
  // after copying trials, Yarns…, reference samples: series data AND every table again (fresh), so new trials /
  // changed plies show at once - like the desktop's reload after a copy (user 2026-11-20: copies did not appear)
  const reloadAll = (msg?: string) => { setTool(null); setFresh((x) => x + 1); setReload((x) => x + 1); if (msg) setToast(msg); };
  // tools that add/change trials reload the page - unsaved values would be lost (desktop asks the same)
  const openTool = (x: Tool) => { if (confirmLeave()) setTool(x); };
  // desktop "↻ Screen aktualisieren (F5)": everything from the database again, same tab; unsaved values -> ask first
  const refresh = () => {
    if (!confirmLeave()) return;
    setTool(null);
    setFresh((x) => x + 1);
    setReload((x) => x + 1);
    setToast(t("se.refreshed"));
  };
  const refAction = async (url: string, body: unknown, msg: string) => {
    await request("POST", url, body);
    reloadAll(msg);
  };

  return (
    <div className={"page page-wide" + (small ? " se-compact" + (headOpen ? " se-head-open" : "") : "")}>
      {small && (
        <div className="se-mbar">
          <button className="btn-plain" onClick={() => confirmLeave() && navigate(-1)} title={t("se.back")} aria-label={t("se.back")}>←</button>
          <span className="se-mtitle" title={`${s.experiment_id} – ${s.name}`}>{s.name}</span>
          <button className="btn-plain se-mmore" aria-expanded={headOpen} onClick={() => setHeadOpen((v) => !v)}>
            {t("se.details")} {headOpen ? "▴" : "▾"}</button>
        </div>
      )}
      {preview && <RecycleBanner seriesId={s.id} info={preview} onDone={(action) => {
        if (action === "keep") { setToast(t("rb.kept")); setReload((x) => x + 1); } else navigate("/superuser/recycle-bin");
      }} />}
      <div className="se-head">
        <button className="btn-plain" onClick={() => confirmLeave() && navigate(-1)} title={t("se.back")}>←</button>
        <div className="se-title">
          <h1>{s.experiment_id} – {s.name}</h1>
          <div className="se-facts">
            <span className="se-sid" title={t("se.sidTip")} onClick={() => { try { void navigator.clipboard.writeText(String(s.id)); } catch { /* no clipboard */ } }}><b>TrialSeriesID:</b> {s.id}</span>
            <span><b>{t("se.machine")}:</b> {s.machine || "–"}</span>
            <span><b>{t("se.status")}:</b> {s.status_id != null ? t(`status.${s.status_id}`) : "–"}</span>
            <span><b>{t("se.owner")}:</b> {s.owner || "–"}</span>
            <span><b>{t("se.created")}:</b> {s.creation_date ? s.creation_date.replace("T", " ").slice(0, 16) : "–"}</span>
            <span><b>{t("se.trials")}:</b> {data.trials.length}</span>
            <MaterialLine key={fresh} seriesId={s.id} />
            {s.notes && (
              <button className="link-btn" onClick={() => setShowNotes((v) => !v)}>
                {t("se.notes")} {showNotes ? "▾" : "▸"}
              </button>
            )}
          </div>
        </div>
        <div className="se-actions">
          {s.experiment_request_id != null && <span className="tb-icon big rqp-er"><RequestIcon id={s.experiment_request_id} big /></span>}
          {/* keys must differ between siblings (SavedReports below), otherwise React keeps
              the old block on refresh and shows it twice */}
          <Attachments key={`att:${fresh}`} seriesId={s.id} />
          {data.trials.length > 0 && (
            <>
              <span className="tb-sep" />
              <button className="tb-btn" disabled={!canWrite} title={canWrite ? t("tl.pdfTip") : t("tl.writeNeeded")}
                onClick={() => openTool({ kind: "import" })}>{t("tl.pdfImport")}</button>
              <button className="tb-btn" disabled={!canWrite} title={canWrite ? t("ms.btnTip") : t("tl.writeNeeded")}
                onClick={() => setTool({ kind: "measure" })}>{t("ms.btn")}</button>
            </>
          )}
          <span className="tb-sep" />
          {data.boards != null && (
            <button className="tb-btn" title={t("cv.seriesBoardsTip")} onClick={() => confirmLeave() && navigate(`/tools/canvas?series=${s.id}`)}>
              🖼 {t("cv.seriesBoards")}{data.boards ? ` (${data.boards})` : ""}</button>)}
          <button className="tb-btn" title={t("lk.seriesTip")} onClick={() => copyLink(seriesLink(s.id, tab))}>🔗 {t("lk.link")}</button>
          <SavedReports key={`rep:${fresh}`} seriesId={s.id} />
          <button className="tb-icon big" onClick={() => confirmLeave() && navigate(`/series/${s.id}/report`)} title={t("rep.openTip")}>
            <img src="/api/img/analytics.png" alt={t("rep.open")} />
          </button>
          <button className="tb-icon big se-refresh" onClick={refresh} title={t("se.refreshTip")}>↻</button>
          <HelpButton screen="show_experiment" />
        </div>
        <RefreshKey onRefresh={refresh} />
      </div>
      {showNotes && s.notes && <div className="card se-notes">{s.notes}</div>}

      <EditProvider key={`${s.id}:${fresh}`} seriesId={s.id} canWrite={accessLevel >= 2} onSaved={() => setReload((x) => x + 1)}
        machineMode={() => localStorage.getItem("tripplet.machine.mode") || "single"}
        jetUnit={() => localStorage.getItem("tripplet.jetair.unit") || "Nm3h"}>
        <SeriesBody data={data} tab={tab} choose={choose} tr={tr} accessLevel={accessLevel} rights={preview ? null : rights} copyLink={copyLink}
          onChanged={() => setReload((x) => x + 1)} onTool={openTool} tools={data.trials.length > 0 && (
            <>
              <button className="tb-icon" onClick={() => setTool({ kind: "labels" })} title={t("tl.labels")}>
                <img src="/api/img/label.png" alt="" />
              </button>
              {/* desktop "Add empty trial" (+T) -> Create Experiment in add-trials mode */}
              <button className="tb-icon" disabled={!canWrite} onClick={() => confirmLeave() && navigate(`/series/${s.id}/add-trials`)}
                title={canWrite ? t("tl.addTrials") : t("tl.writeNeeded")}>
                <img src="/api/img/add_trial.png" alt="+T" />
              </button>
              <button className="tb-ref" disabled={!canWrite} onClick={() => openTool({ kind: "ref-add" })} title={t("tl.addRefTip")}>+ Ref</button>
              <button className="tb-ref outline" onClick={() => setTool({ kind: "compare", ref: null })} title={t("tl.cmpTip")}>{t("tl.cmpShort")}</button>
              <button className="tb-btn" disabled={!canWrite} onClick={() => openTool({ kind: "copy", ids: [] })}>{t("tl.copyShort")}</button>
              <button className="tb-btn" onClick={() => openTool({ kind: "yarns" })} title={t("tl.yarnsTip")}>{t("tl.yarns")}</button>
            </>
          )} />
      </EditProvider>
      {tool?.kind === "labels" && <LabelsDialog seriesId={s.id} onClose={() => setTool(null)} />}
      {tool?.kind === "compare" && <RefCompareDialog seriesId={s.id} refId={tool.ref} onClose={() => setTool(null)}
        onJump={(trialId) => {
          // desktop _show_trial_in_machine_data: Machine Data, first column of that trial
          setTool(null);
          choose("machine");
          window.setTimeout(() => {
            const th = document.querySelector<HTMLElement>(`th[data-trial="${trialId}"]`);
            if (!th) return;
            th.scrollIntoView({ block: "nearest", inline: "center" });
            th.classList.add("jump-flash");
            window.setTimeout(() => th.classList.remove("jump-flash"), 1600);
          }, 500);
        }} />}
      {tool?.kind === "copy" && <CopyTrialsDialog seriesId={s.id} preselected={tool.ids} onClose={() => setTool(null)}
        onDone={(n) => reloadAll(t("tl.copied", { n }))} />}
      {tool?.kind === "yarns" && <YarnsDialog seriesId={s.id} onClose={() => setTool(null)} onDone={() => reloadAll(t("tl.yarnsSaved"))} />}
      {tool?.kind === "import" && <PdfImportDialog seriesId={s.id} onClose={() => setTool(null)}
        onDone={() => { setFresh((x) => x + 1); setReload((x) => x + 1); }} />}
      {/* new TDMS files: the YarnScope tabs appear / show them after closing (reload of the series data) */}
      {tool?.kind === "measure" && <SensorMeasureDialog seriesId={s.id}
        onClose={() => {
          setTool(null);
          if (measured.current && confirmLeave()) setFresh((x) => x + 1);     // YarnScope tabs list the new files
          measured.current = false;
          setReload((x) => x + 1);
        }}
        onMeasured={() => { measured.current = true; }} />}
      {tool?.kind === "ref-add" &&<RefNameDialog title={t("tl.addRefTitle")} initial="" onClose={() => setTool(null)}
        onOk={(name) => refAction(`/api/series/${s.id}/references`, { name }, t("tl.refAdded"))} />}
      {tool?.kind === "ref-mark" && <RefNameDialog title={t("tl.markRefTitle", { trial: tool.trial.label })} initial="" onClose={() => setTool(null)}
        onOk={(name) => refAction(`/api/series/${s.id}/references/${tool.trial.id}/flag`, { make_reference: true, name }, t("sa.saved"))} />}
      {tool?.kind === "ref-rename" && <RefNameDialog title={t("tl.renameRefTitle")} initial={tool.name} onClose={() => setTool(null)}
        onOk={(name) => refAction(`/api/series/${s.id}/references/${tool.trial.id}/rename`, { name }, t("sa.saved"))} />}
      {toast && <div className="toast ok" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  );
}

/** F5 = "↻" like the desktop (instead of reloading the whole browser page); not while a dialog is open. */
function RefreshKey({ onRefresh }: { onRefresh: () => void }) {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F5" || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      if (document.querySelector(".modal-backdrop, .modal, [role=dialog]")) return;
      e.preventDefault();
      cb.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/** Notes of the series (desktop: Notes tab, auto-save 1.5 s after typing and when leaving the field). */
function SeriesNotes({ seriesId, initial, canWrite, onSaved }: {
  seriesId: number; initial: string; canWrite: boolean; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const saved = useRef(initial);
  const timer = useRef<number | undefined>(undefined);
  const save = async (v: string, reload: boolean) => {
    window.clearTimeout(timer.current);
    if (v === saved.current) return;
    setState("saving");
    try {
      await request("POST", `/api/series/${seriesId}/notes-text`, { text: v });
      saved.current = v;
      setState("saved");
      if (reload) onSaved();
    } catch {
      setState("error");
    }
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="card se-notes-edit">
      <div className="se-notes-head">
        <b>{t("nt.seriesNotes")}</b>
        <span className="muted">{state === "saving" ? t("ed.saving") : state === "saved" ? t("ed.saved") : state === "error" ? t("nt.saveError") : canWrite ? t("nt.autoSave") : t("se.readonlyShort")}</span>
      </div>
      <textarea rows={5} value={text} readOnly={!canWrite} placeholder={canWrite ? t("nt.placeholder") : ""}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => save(v, false), 1500);
        }}
        onBlur={() => save(text, true)} />
    </div>
  );
}

type Tool =
  | { kind: "labels" } | { kind: "yarns" } | { kind: "copy"; ids: number[] } | { kind: "ref-add" }
  | { kind: "ref-mark"; trial: Trial } | { kind: "ref-rename"; trial: Trial; name: string }
  | { kind: "import" } | { kind: "compare"; ref: number | null } | { kind: "measure" };

function SeriesBody({ data, tab, choose, tr, accessLevel, rights, onChanged, onTool, tools, copyLink }: {
  data: SeriesData; tab: string | null; choose: (k: string) => void; tr: (p: string, k: string, f: string) => string;
  copyLink: (url: string) => void;
  accessLevel: number; rights: SeriesRights | null; onChanged: () => void; onTool: (x: Tool) => void; tools?: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const s = data.series;
  const current = data.tabs.find((x) => x.key === tab) ?? null;
  // trial header: Copy trials…, reference samples (desktop _on_trial_header_menu)
  const trialExtras = (trial: Trial, selected: number[]): MenuItem[] => [
    { label: t("lk.trial", { trial: trial.label }), onClick: () => copyLink(seriesLink(s.id,
      tab && !["notes", "conclusion", "yarnscope", "yarnscope_aty"].includes(tab) ? tab : "machine", trial.id)) },
    { sep: true }, ...trialItems(trial, selected)];
  const trialItems = (trial: Trial, selected: number[]): MenuItem[] => {
    // "Open V<n> in Process Playground…" (desktop: DTY series, tool allowed, not for reference samples)
    const playground = (): MenuItem[] => (data.playground ? [{ label: t("tl.openPlayground", { trial: trial.label }),
      title: t("tl.openPlaygroundTip"), onClick: () => { if (confirmLeave()) navigate(`/tools/process-playground?trial=${trial.id}`); } }] : []);
    if (accessLevel < 2) {
      const r = data.trials.find((x) => x.id === trial.id)?.reference ?? null;
      return r !== null ? [{ label: t("tl.cmpWithRef"), onClick: () => onTool({ kind: "compare", ref: trial.id }) }] : playground();
    }
    const ref = data.trials.find((x) => x.id === trial.id)?.reference ?? null;
    const items: MenuItem[] = [];
    if (ref === null) items.push({ label: t("tl.copyMenu"), onClick: () => onTool({ kind: "copy", ids: selected }) }, ...playground());
    items.push({ sep: true }, { label: t("tl.addRef"), onClick: () => onTool({ kind: "ref-add" }) });
    if (ref !== null) {
      items.push({ label: t("tl.cmpWithRef"), onClick: () => onTool({ kind: "compare", ref: trial.id }) });
      items.push({ label: t("tl.renameRef"), onClick: () => onTool({ kind: "ref-rename", trial, name: ref }) });
      items.push({ label: t("tl.unmarkRef"), onClick: async () => {
        if (!confirmLeave() || !window.confirm(t("tl.unmarkQ"))) return;
        try { await request("POST", `/api/series/${s.id}/references/${trial.id}/flag`, { make_reference: false }); onChanged(); }
        catch (e) { window.alert(e instanceof ApiError ? e.message : String(e)); }
      } });
    } else items.push({ label: t("tl.markRef", { trial: trial.label }), onClick: () => onTool({ kind: "ref-mark", trial }) });
    return items;
  };
  const ed = useEdit();
  const menus = useSeriesMenus({ seriesId: s.id, rights, trials: data.trials, onChanged, trialExtras,
    mode: () => localStorage.getItem("tripplet.machine.mode") || "single" });
  // right-click on the ply row of Machine Data (MachineTable) opens the Yarns… dialog
  useEffect(() => {
    const h = () => onTool({ kind: "yarns" });
    window.addEventListener("tripplet:yarns", h);
    return () => window.removeEventListener("tripplet:yarns", h);
  }, [onTool]);
  const trialNotes = (id: number) => data.notes.filter((n) => n.trial_note && n.trial_id === id);
  // phone (MOBILE.md): one trial at a time, ◀ V ▶ or swipe; "All trials" shows the whole table again
  const phone = useMedia(PHONE);
  const [oneTrial, setOneTrial] = useState(true);
  const [trialIdx, setTrialIdx] = useState(0);
  const nTrials = data.trials.length;
  const idx = Math.min(trialIdx, Math.max(0, nTrials - 1));
  const focusId = phone && oneTrial && nTrials > 1 ? data.trials[idx]?.id ?? null : null;
  const step = (d: number) => setTrialIdx((i) => Math.min(Math.max(0, Math.min(i, nTrials - 1) + d), nTrials - 1));
  const pagerTab = tab === "machine" || tab === "rd" || (!!current && !current.lazy);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeProps = focusId == null ? {} : {
    onTouchStart: (e: React.TouchEvent) => { const p = e.touches[0]; swipe.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY } : null; },
    onTouchEnd: (e: React.TouchEvent) => {
      const a = swipe.current; swipe.current = null;
      const p = e.changedTouches[0];
      if (!a || !p || document.querySelector("table.pivot input, table.pivot select")) return;
      const dx = p.clientX - a.x, dy = p.clientY - a.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    },
  };
  const [conclDirty, setConclDirty] = useState(false);
  const [conclSeen, setConclSeen] = useState(false);       // keep the tab mounted once opened (unsaved text survives tab changes)
  useEffect(() => { if (tab === "conclusion") setConclSeen(true); }, [tab]);
  return (
    <>
      <div className="se-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "machine"} className={"se-tab" + (tab === "machine" ? " on" : "")}
          onClick={() => choose("machine")}>
          {tr("tab", "machine", "Machine Data")}{ed?.hasDirty("machine") && <span className="dirty-dot" title={t("ed.unsavedTab")} />}
        </button>
        {data.tabs.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === tab}
            className={"se-tab" + (x.key === tab ? " on" : "")} onClick={() => choose(x.key)}>
            {tr("tab", x.key, x.title)}{ed?.hasDirty(x.key) && <span className="dirty-dot" title={t("ed.unsavedTab")} />}
            {Object.keys(x.flags).length > 0 && <span className="flag-dot" />}
          </button>
        ))}
        {data.has_rd && (
          <button role="tab" aria-selected={tab === "rd"} className={"se-tab" + (tab === "rd" ? " on" : "")}
            onClick={() => choose("rd")}>
            {tr("tab", "rd", "R&D Machine Data")}{ed?.hasDirty("rd") && <span className="dirty-dot" title={t("ed.unsavedTab")} />}
          </button>
        )}
        {data.has_yarnscope && (
          <button role="tab" aria-selected={tab === "yarnscope"} className={"se-tab" + (tab === "yarnscope" ? " on" : "")}
            onClick={() => choose("yarnscope")}>
            YarnScope
          </button>
        )}
        {data.has_yarnscope_aty && (
          <button role="tab" aria-selected={tab === "yarnscope_aty"} className={"se-tab" + (tab === "yarnscope_aty" ? " on" : "")}
            onClick={() => choose("yarnscope_aty")}>
            YarnScope ATY
          </button>
        )}
        <button role="tab" aria-selected={tab === "notes"} className={"se-tab" + (tab === "notes" ? " on" : "")}
          onClick={() => choose("notes")}>
          {t("nt.tab")}{data.notes.length > 0 && <span className="note-count">{data.notes.length}</span>}
        </button>
        {data.conclusion && (
          <button role="tab" aria-selected={tab === "conclusion"} className={"se-tab" + (tab === "conclusion" ? " on" : "")}
            onClick={() => choose("conclusion")} title={data.conclusion.exists ? undefined : t("cc.noneYet")}>
            {t("cc.tab")}{data.conclusion.exists && <OutcomeDot outcome={data.conclusion.outcome} />}
            {conclDirty && <span className="dirty-dot" title={t("ed.unsavedTab")} />}
          </button>
        )}
        {data.pending_tabs.map((x) => (
          <span key={x.key} className="se-tab soon" title={t("se.pending", { tab: tr("tab", x.key, x.title) })}>
            {tr("tab", x.key, x.title)}
          </span>
        ))}
      </div>

      {phone && pagerTab && nTrials > 1 && (
        <div className="se-pager">
          {oneTrial && (
            <>
              <button className="btn-plain" disabled={idx === 0} onClick={() => step(-1)} aria-label={t("se.prevTrial")} title={t("se.prevTrial")}>◀</button>
              <select value={idx} onChange={(e) => setTrialIdx(Number(e.target.value))}>
                {data.trials.map((x, i) => <option key={x.id} value={i}>{x.label}{x.reference ? ` · ${x.reference}` : ""}</option>)}
              </select>
              <span className="muted se-pager-n">{idx + 1}/{nTrials}</span>
              <button className="btn-plain" disabled={idx >= nTrials - 1} onClick={() => step(1)} aria-label={t("se.nextTrial")} title={t("se.nextTrial")}>▶</button>
            </>
          )}
          <button className="btn-plain se-pager-all" onClick={() => setOneTrial((v) => !v)}>{oneTrial ? t("se.allTrials") : t("se.oneTrial")}</button>
        </div>
      )}
      <div className="se-swipe" {...swipeProps}>
      {data.trials.length === 0 && <div className="card muted">{t("se.noTrials")}</div>}
      {tab === "yarnscope" && <YarnScopeView seriesId={s.id} canWrite={accessLevel >= 2} />}
      {tab === "yarnscope_aty" && <YarnScopeAty seriesId={s.id} canWrite={accessLevel >= 2} />}
      {data.trials.length > 0 && tab === "rd" && (
        <MachineTable seriesId={s.id} source="rd" rowTitle={(x) => tr("row", x, x)} menus={menus} onlyTrial={focusId} />
      )}
      {data.trials.length > 0 && tab === "machine" && (
        <MachineTable seriesId={s.id} rowTitle={(x) => tr("row", x, x)} menus={menus} tools={tools} onlyTrial={focusId} />
      )}
      {data.conclusion && (conclSeen || tab === "conclusion") && (
        <div style={tab === "conclusion" ? undefined : { display: "none" }}>
          <ConclusionTab seriesId={s.id} trials={data.trials.map((x) => ({ id: x.id, label: x.label }))}
            onSaved={onChanged} onDirty={setConclDirty} />
        </div>
      )}
      {tab === "notes" && <SeriesNotes seriesId={s.id} initial={s.notes} canWrite={accessLevel >= 2} onSaved={onChanged} />}
      {tab === "notes" && (
        data.notes.length === 0 ? <div className="card muted">{t("nt.none")}</div> : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>{t("nt.trial")}</th><th>{t("nt.where")}</th><th>{t("nt.text")}</th><th>{t("nt.by")}</th><th>{t("nt.when")}</th></tr>
              </thead>
              <tbody>
                {data.notes.map((n) => (
                  <tr key={n.id}>
                    <td className="nowrap">{data.trials.find((x) => x.id === n.trial_id)?.label ?? ""}</td>
                    <td>{n.trial_note ? t("nt.wholeTrial")
                      : n.where_tab ? `${tr("tab", n.where_tab, n.where_tab)} · ${tr("row", n.where_row, n.where_row)}` : n.where_row}</td>
                    <td className="note-text">{n.text}</td>
                    <td className="nowrap">{n.user}</td>
                    <td className="nowrap">{n.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {current?.lazy && current.key === "jet_air" && <JetAirView seriesId={s.id} />}
      {current && !current.lazy && (
        <>
          {(current.retest ?? []).length > 0 && (
            <div className="se-retest">🏳 {t("se.retestBanner")} — {current.retest!.map((x) => x.trial + (x.note ? `: "${x.note}"` : "")).join("; ")}</div>
          )}
          <div className="table-wrap pivot-wrap">
            <table className="pivot">
              <thead>
                <tr>
                  <th className="pv-corner" />
                  {data.trials.map((tr0, c) => {
                    if (focusId != null && tr0.id !== focusId) return null;
                    const flag = current.flags[String(c)];
                    const tip = [tr0.reference ? t("se.reference", { name: tr0.reference }) : "", flag ?? ""]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <th key={tr0.id} data-trial={tr0.id} className={(tr0.reference ? "ref" : "") + (menus.selTrials.includes(tr0.id) ? " th-sel" : "")
                        + (trialNotes(tr0.id).length ? " has-note" : "")}
                        title={[tip, notesTip(trialNotes(tr0.id))].filter(Boolean).join("\n") || undefined}
                        onClick={(e) => menus.clickTrial(e, tr0.id)}
                        onContextMenu={(e) => menus.trialMenu(e, tr0, trialNotes(tr0.id), { tab: current.key, title: tr("tab", current.key, current.title) })}>
                        {tr0.label}
                        {flag && <span className="flag-dot" />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {current.rows.map((row, r) => (
                  <tr key={r} className={row.info ? "info" : ""}>
                    <th scope="row" onContextMenu={(e) => { if (current.kb) menus.open(e, kbItem(t, current.kb).slice(1)); }}>{tr("row", row.title, row.title)}</th>
                    {row.cells.map((cell, c) => (focusId != null && data.trials[c]?.id !== focusId ? null : row.r == null ? (
                      <td key={c} className={(cell.alert ?? "") + (data.trials[c]?.reference ? " ref" : "")}>{cell.v}</td>
                    ) : (
                      <EditCell key={c} addr={{ tab: current.key, r: row.r, c }} text={cell.v} editable={!!cell.e}
                        className={(cell.alert ?? "") + (data.trials[c]?.reference ? " ref" : "") + (cell.notes ? " has-note" : "")}
                        title={notesTip(cell.notes) || undefined}
                        onContextMenu={(e, a) => menus.cellMenu(e, a, cell,
                          `${data.trials[c]?.label ?? ""} · ${tr("tab", current.key, current.title)} · ${tr("row", row.title, row.title)}`,
                          kbItem(t, current.kb).slice(1).concat(current.kb ? [{ sep: true as const }] : []))} />
                    )))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.rows.some((r) => r.cells.some((c) => c.alert)) && (
            <div className="muted se-legend">{t("se.redHint")}</div>
          )}
        </>
      )}
      </div>
      {menus.dialogs}
    </>
  );
}


/* Material line (desktop _load_materials_summary): per ply the most frequent yarn with colour square and
   spool symbol - green = in stock (tooltip: spools / kg / locations), click on yarn or symbol = storage
   locations, spools of this series in bold. */
type Mat = { ply: string; yarn_id: number | null; name: string; colour: string | null; css: string | null;
  stock: { spools: number; kg: number; locations: number } | null };

function MaterialLine({ seriesId }: { seriesId: number }) {
  const { t } = useI18n();
  const [mats, setMats] = useState<Mat[] | null>(null);
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    request<{ materials: Mat[] }>("GET", `/api/series/${seriesId}/materials`).then((r) => setMats(r.materials)).catch(() => setMats([]));
  }, [seriesId]);
  if (!mats || !mats.length) return null;
  return (
    <span className="se-mats"><b>{t("se.material")}:</b>{" "}
      {mats.map((m, i) => {
        const tip = m.stock ? t("se.stockTip", { n: m.stock.spools, kg: m.stock.kg.toFixed(1), locs: m.stock.locations }) : t("ce.notInStock");
        const click = m.yarn_id !== null && m.stock ? () => setOpen({ id: m.yarn_id!, name: m.name }) : undefined;
        return (
          <span key={i} className="se-mat">
            {i > 0 && <span className="muted"> • </span>}
            {m.css && <span className="ce-dot" style={{ background: m.css }} title={m.colour ?? ""} />}
            <span className={click ? "se-mat-link" : ""} onClick={click} title={tip}>{m.ply ? `${m.ply}: ` : ""}{m.name}</span>
            {m.yarn_id !== null && <span className={"ce-stock" + (m.stock ? " on" : "")} title={tip} onClick={click} />}
          </span>
        );
      })}
      {open && <StockDialog yarn={open} chosen={new Set()} seriesId={seriesId} onClose={() => setOpen(null)} />}
    </span>
  );
}


/* Saved reports of the series + "Go!" (desktop _refresh_saved_reports_dropdown / _open_selected_saved_report);
   only shown when the series has saved reports. Ctrl+click on Go = new tab. */
function SavedReports({ seriesId }: { seriesId: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [list, setList] = useState<{ id: number; title: string; author: string }[]>([]);
  const [sel, setSel] = useState<number | "">("");
  useEffect(() => {
    request<{ reports: { id: number; title: string; author: string }[] }>("GET", `/api/series/${seriesId}/reports`)
      .then((r) => { setList(r.reports); setSel(r.reports[0]?.id ?? ""); }).catch(() => setList([]));
  }, [seriesId]);
  if (!list.length) return null;
  const go = (e: React.MouseEvent) => {
    if (sel === "") return;
    const url = `/series/${seriesId}/report?report=${sel}`;
    if (e.ctrlKey || e.metaKey) window.open(url, "_blank");
    else if (confirmLeave()) navigate(url);
  };
  return (
    <span className="se-reports" title={t("se.savedReportsTip")}>
      <select value={sel} onChange={(e) => setSel(Number(e.target.value))}>
        {list.map((r) => <option key={r.id} value={r.id}>{r.title}{r.author ? ` (${r.author})` : ""}</option>)}
      </select>
      <button className="btn-plain" onClick={go}>{t("se.go")}</button>
    </span>
  );
}

const backTimers = new Map<number, number>();

/** Banner of a series opened from the recycle bin (desktop ui/recycle_preview.py): restore for good, back to the
 *  recycle bin (same deletion date / user) or delete permanently. Leaving the page without a decision puts the
 *  series back (desktop: closing the tab). */
function RecycleBanner({ seriesId, info, onDone }: { seriesId: number; info: { deleted_at: string; deleted_by: string };
  onDone: (action: "keep" | "back" | "delete") => void }) {
  const { t } = useI18n();
  const decided = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const url = `/api/superuser/recycle-bin/preview/${seriesId}/back`;
    // a remount right away (React StrictMode in development) must not put the series back: wait a moment
    window.clearTimeout(backTimers.get(seriesId));
    const onUnload = () => { if (!decided.current) navigator.sendBeacon(url); };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      if (!decided.current) backTimers.set(seriesId, window.setTimeout(() => request("POST", url).catch(() => undefined), 400));
    };
  }, [seriesId]);
  const act = async (action: "keep" | "back" | "delete") => {
    if (action === "delete" && !window.confirm(t("rb.deleteQ"))) return;
    decided.current = true;
    try {
      await request("POST", `/api/superuser/recycle-bin/preview/${seriesId}/${action}`);
      onDone(action);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="rb-banner">
      <span><b>{t("rb.bannerTitle")}</b> {t("rb.bannerText", { when: info.deleted_at, who: info.deleted_by || "?" })}</span>
      <span style={{ flex: 1 }} />
      <button className="btn-green" title={t("rb.keepTip")} onClick={() => act("keep")}>{t("rb.keep")}</button>
      <button className="btn-plain" title={t("rb.backTip")} onClick={() => act("back")}>{t("rb.back")}</button>
      <button className="btn-plain danger" title={t("rb.deleteTip")} onClick={() => act("delete")}>{t("rb.delete")}</button>
      {err && <span className="mj-msg err">{err}</span>}
    </div>
  );
}
