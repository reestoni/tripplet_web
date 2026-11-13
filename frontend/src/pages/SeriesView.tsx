import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, notesTip, request, type SeriesData, type SeriesRights } from "../api";
import { useI18n } from "../i18n";
import { confirmLeave, EditCell, EditProvider, useEdit } from "../edit";
import MachineTable from "../components/MachineTable";
import JetAirView from "../components/JetAirView";
import Attachments from "../components/Attachments";
import { RequestIcon } from "../components/RequestPopup";
import YarnScopeView from "../components/YarnScopeView";
import { useSeriesMenus, type Trial } from "../components/seriesMenus";
import type { MenuItem } from "../components/ContextMenu";
import { CopyTrialsDialog, LabelsDialog, PdfImportDialog, RefCompareDialog, RefNameDialog, YarnsDialog } from "../components/SeriesTools";
import { HelpButton } from "../components/Help";

const TAB_KEY = "tripplet.series.tab";

function lastTab(): string | null {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

export default function SeriesView({ accessLevel = 0 }: { accessLevel?: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [data, setData] = useState<SeriesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [reload, setReload] = useState(0);
  const [rights, setRights] = useState<SeriesRights | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);
  const lastId = useRef<string | undefined>(undefined);

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
        const keys = ["machine", "notes", ...(d.has_rd ? ["rd"] : []), ...(d.has_yarnscope ? ["yarnscope"] : []),
          ...d.tabs.map((x) => x.key)];
        const want = lastTab();
        setTab((cur) => (cur && keys.includes(cur) ? cur : want && keys.includes(want) ? want : "machine"));
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
  const canWrite = accessLevel >= 2;
  const reloadAll = (msg?: string) => { setTool(null); setReload((x) => x + 1); if (msg) setToast(msg); };
  // tools that add/change trials reload the page - unsaved values would be lost (desktop asks the same)
  const openTool = (x: Tool) => { if (confirmLeave()) setTool(x); };
  const refAction = async (url: string, body: unknown, msg: string) => {
    await request("POST", url, body);
    reloadAll(msg);
  };

  return (
    <div className="page page-wide">
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
            {s.notes && (
              <button className="link-btn" onClick={() => setShowNotes((v) => !v)}>
                {t("se.notes")} {showNotes ? "▾" : "▸"}
              </button>
            )}
          </div>
        </div>
        <div className="se-actions">
          {s.experiment_request_id != null && <span className="tb-icon big rqp-er"><RequestIcon id={s.experiment_request_id} big /></span>}
          <Attachments seriesId={s.id} />
          {data.trials.length > 0 && (
            <>
              <span className="tb-sep" />
              <button className="tb-btn" disabled={!canWrite} title={canWrite ? undefined : t("tl.writeNeeded")}
                onClick={() => openTool({ kind: "import", which: "statimat" })}>{t("tl.statImport")}</button>
              <button className="tb-btn" disabled={!canWrite} title={canWrite ? undefined : t("tl.writeNeeded")}
                onClick={() => openTool({ kind: "import", which: "itemat" })}>{t("tl.itemImport")}</button>
            </>
          )}
          <span className="tb-sep" />
          <button className="tb-icon big" onClick={() => confirmLeave() && navigate(`/series/${s.id}/report`)} title={t("rep.openTip")}>
            <img src="/api/img/analytics.png" alt={t("rep.open")} />
          </button>
          <HelpButton screen="show_experiment" />
        </div>
      </div>
      {showNotes && s.notes && <div className="card se-notes">{s.notes}</div>}

      <EditProvider key={s.id} seriesId={s.id} canWrite={accessLevel >= 2} onSaved={() => setReload((x) => x + 1)}
        machineMode={() => localStorage.getItem("tripplet.machine.mode") || "single"}
        jetUnit={() => localStorage.getItem("tripplet.jetair.unit") || "Nm3h"}>
        <SeriesBody data={data} tab={tab} choose={choose} tr={tr} accessLevel={accessLevel} rights={rights}
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
      {tool?.kind === "compare" && <RefCompareDialog seriesId={s.id} refId={tool.ref} onClose={() => setTool(null)} />}
      {tool?.kind === "copy" && <CopyTrialsDialog seriesId={s.id} preselected={tool.ids} onClose={() => setTool(null)}
        onDone={(n) => reloadAll(t("tl.copied", { n }))} />}
      {tool?.kind === "yarns" && <YarnsDialog seriesId={s.id} onClose={() => setTool(null)} onDone={() => reloadAll(t("tl.yarnsSaved"))} />}
      {tool?.kind === "import" && <PdfImportDialog seriesId={s.id} kind={tool.which} onClose={() => setTool(null)}
        onDone={() => setReload((x) => x + 1)} />}
      {tool?.kind === "ref-add" && <RefNameDialog title={t("tl.addRefTitle")} initial="" onClose={() => setTool(null)}
        onOk={(name) => refAction(`/api/series/${s.id}/references`, { name }, t("tl.refAdded"))} />}
      {tool?.kind === "ref-mark" && <RefNameDialog title={t("tl.markRefTitle", { trial: tool.trial.label })} initial="" onClose={() => setTool(null)}
        onOk={(name) => refAction(`/api/series/${s.id}/references/${tool.trial.id}/flag`, { make_reference: true, name }, t("sa.saved"))} />}
      {tool?.kind === "ref-rename" && <RefNameDialog title={t("tl.renameRefTitle")} initial={tool.name} onClose={() => setTool(null)}
        onOk={(name) => refAction(`/api/series/${s.id}/references/${tool.trial.id}/rename`, { name }, t("sa.saved"))} />}
      {toast && <div className="toast ok" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  );
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
  | { kind: "import"; which: "statimat" | "itemat" } | { kind: "compare"; ref: number | null };

function SeriesBody({ data, tab, choose, tr, accessLevel, rights, onChanged, onTool, tools }: {
  data: SeriesData; tab: string | null; choose: (k: string) => void; tr: (p: string, k: string, f: string) => string;
  accessLevel: number; rights: SeriesRights | null; onChanged: () => void; onTool: (x: Tool) => void; tools?: ReactNode;
}) {
  const { t } = useI18n();
  const s = data.series;
  const current = data.tabs.find((x) => x.key === tab) ?? null;
  // trial header: Copy trials…, reference samples (desktop _on_trial_header_menu)
  const trialExtras = (trial: Trial, selected: number[]): MenuItem[] => {
    if (accessLevel < 2) {
      const r = data.trials.find((x) => x.id === trial.id)?.reference ?? null;
      return r !== null ? [{ label: t("tl.cmpWithRef"), onClick: () => onTool({ kind: "compare", ref: trial.id }) }] : [];
    }
    const ref = data.trials.find((x) => x.id === trial.id)?.reference ?? null;
    const items: MenuItem[] = [];
    if (ref === null) items.push({ label: t("tl.copyMenu"), onClick: () => onTool({ kind: "copy", ids: selected }) });
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
        <button role="tab" aria-selected={tab === "notes"} className={"se-tab" + (tab === "notes" ? " on" : "")}
          onClick={() => choose("notes")}>
          {t("nt.tab")}{data.notes.length > 0 && <span className="note-count">{data.notes.length}</span>}
        </button>
        {data.pending_tabs.map((x) => (
          <span key={x.key} className="se-tab soon" title={t("se.pending", { tab: tr("tab", x.key, x.title) })}>
            {tr("tab", x.key, x.title)}
          </span>
        ))}
      </div>

      {data.trials.length === 0 && <div className="card muted">{t("se.noTrials")}</div>}
      {tab === "yarnscope" && <YarnScopeView seriesId={s.id} canWrite={accessLevel >= 2} />}
      {data.trials.length > 0 && tab === "rd" && (
        <MachineTable seriesId={s.id} source="rd" rowTitle={(x) => tr("row", x, x)} menus={menus} />
      )}
      {data.trials.length > 0 && tab === "machine" && (
        <MachineTable seriesId={s.id} rowTitle={(x) => tr("row", x, x)} menus={menus} tools={tools} />
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
          <div className="table-wrap pivot-wrap">
            <table className="pivot">
              <thead>
                <tr>
                  <th className="pv-corner" />
                  {data.trials.map((tr0, c) => {
                    const flag = current.flags[String(c)];
                    const tip = [tr0.reference ? t("se.reference", { name: tr0.reference }) : "", flag ?? ""]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <th key={tr0.id} className={(tr0.reference ? "ref" : "") + (menus.selTrials.includes(tr0.id) ? " th-sel" : "")
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
                    <th scope="row">{tr("row", row.title, row.title)}</th>
                    {row.cells.map((cell, c) => (row.r == null ? (
                      <td key={c} className={(cell.alert ?? "") + (data.trials[c]?.reference ? " ref" : "")}>{cell.v}</td>
                    ) : (
                      <EditCell key={c} addr={{ tab: current.key, r: row.r, c }} text={cell.v} editable={!!cell.e}
                        className={(cell.alert ?? "") + (data.trials[c]?.reference ? " ref" : "") + (cell.notes ? " has-note" : "")}
                        title={notesTip(cell.notes) || undefined}
                        onContextMenu={(e, a) => menus.cellMenu(e, a, cell,
                          `${data.trials[c]?.label ?? ""} · ${tr("tab", current.key, current.title)} · ${tr("row", row.title, row.title)}`)} />
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
      {menus.dialogs}
    </>
  );
}
