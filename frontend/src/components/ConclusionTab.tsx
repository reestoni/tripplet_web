import { useEffect, useMemo, useState } from "react";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { extraLeaveGuard } from "../edit";

/* Show Experiment tab "Fazit" (desktop ui/widgets/conclusion_tab.py, logic db/series_conclusion.py).
   Written any time - "Done" only means "ready to be analysed". Goal from the experiment request (read only),
   or an own goal when the series has no request. Saved with the button; leaving with changes asks first. */

export const OUTCOMES = ["achieved", "partly", "not_achieved", "open"] as const;
export const RECOMMENDATIONS = ["follow_up", "release", "discard"] as const;
export const OUTCOME_COLOURS: Record<string, string> = { achieved: "#2e9e4f", partly: "#e0a800", not_achieved: "#d64545", open: "#8a94a0" };
const SUMMARY_MAX = 300;

type Fields = { goal: string; outcome: string | null; summary: string; best_trials: number[]; findings: string;
  recommendation: string | null; recommendation_text: string };
type Data = Fields & { ready: boolean; exists: boolean; can_edit: boolean; updated_by: string; updated_at: string | null;
  request: { request_id: number; title: string; reason: string; task: string; criteria: string } | null };

const pick = (d: Fields): Fields => ({ goal: d.goal, outcome: d.outcome, summary: d.summary, best_trials: [...d.best_trials],
  findings: d.findings, recommendation: d.recommendation, recommendation_text: d.recommendation_text });
const same = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b);

/** Coloured dot for an outcome (lists, cards, tab). */
export function OutcomeDot({ outcome, title }: { outcome: string | null | undefined; title?: string }) {
  return <span className="cc-dot" style={{ background: OUTCOME_COLOURS[outcome || "open"] }} title={title} />;
}

export default function ConclusionTab({ seriesId, trials, onSaved, onDirty }: {
  seriesId: number; trials: { id: number; label: string }[]; onSaved: () => void; onDirty: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [vals, setVals] = useState<Fields | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    request<Data>("GET", `/api/series/${seriesId}/conclusion`).then((d) => { setData(d); setVals(pick(d)); })
      .catch((e) => setMsg({ kind: "err", text: e instanceof ApiError ? e.message : String(e) }));
  }, [seriesId]);
  const dirty = useMemo(() => !!data && !!vals && !same(pick(data), vals), [data, vals]);
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving with unsaved changes: browser (reload/close), app links and buttons using confirmLeave()
  useEffect(() => {
    extraLeaveGuard.text = dirty ? t("cc.leaveQ") : "";
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      if (a.origin !== window.location.origin) return;
      if (!window.confirm(t("cc.leaveQ"))) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", h);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", h); document.removeEventListener("click", onClick, true); };
  }, [dirty, t]);
  useEffect(() => () => { extraLeaveGuard.text = ""; }, []);

  if (!data || !vals) return <div className="card muted">{msg?.text ?? t("app.loading")}</div>;
  if (!data.ready) return <div className="card muted">{t("cc.noTable")}</div>;
  const ro = !data.can_edit;
  const set = (patch: Partial<Fields>) => { setVals({ ...vals, ...patch }); setMsg(null); };
  const toggle = <K extends "outcome" | "recommendation">(k: K, v: string) => set({ [k]: vals[k] === v ? null : v } as Partial<Fields>);

  const save = async () => {
    setBusy(true);
    try {
      const r = await request<{ created: boolean; notified: number; conclusion: Data }>("PUT", `/api/series/${seriesId}/conclusion`, vals);
      setData(r.conclusion);
      setVals(pick(r.conclusion));
      setMsg({ kind: "ok", text: r.notified ? t("cc.savedNotified") : t("cc.saved") });
      onSaved();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError && e.code ? t(`cc.err.${e.code}`) : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const when = data.updated_at ? data.updated_at.replace("T", " ").slice(0, 16) : "";
  const req = data.request;

  return (
    <div className="card cc">
      <p className="muted cc-hint">{ro ? t("cc.readOnly") : t("cc.hint")}</p>
      {req ? (
        <div className="cc-request">
          <b>{t("cc.fromRequest")}</b> – {req.title}
          {req.reason && <div><b>{t("cc.reason")}:</b> {req.reason}</div>}
          {req.task && <div><b>{t("cc.task")}:</b> {req.task}</div>}
          {req.criteria && <div><b>{t("cc.criteria")}:</b> {req.criteria}</div>}
        </div>
      ) : (
        <label className="cc-field">
          <span>{t("cc.goal")} <i className="muted">{t("cc.goalHint")}</i></span>
          <textarea rows={2} value={vals.goal} readOnly={ro} maxLength={2000} onChange={(e) => set({ goal: e.target.value })} />
        </label>
      )}

      <div className="cc-grid">
        <span className="cc-lab">{t("cc.outcome")}</span>
        <div className="cc-choices">
          {OUTCOMES.map((o) => (
            <button key={o} type="button" disabled={ro} className={"cc-choice" + (vals.outcome === o ? " on" : "")}
              style={vals.outcome === o ? { background: OUTCOME_COLOURS[o], borderColor: OUTCOME_COLOURS[o] } : { color: OUTCOME_COLOURS[o] }}
              onClick={() => toggle("outcome", o)}>{t(`cc.o.${o}`)}</button>
          ))}
        </div>

        <span className="cc-lab">{t("cc.summary")}</span>
        <div>
          <input className="cc-input" value={vals.summary} readOnly={ro} maxLength={SUMMARY_MAX} placeholder={t("cc.summaryPh")}
            onChange={(e) => set({ summary: e.target.value })} />
          <div className="cc-count">{vals.summary.length} / {SUMMARY_MAX}</div>
        </div>

        <span className="cc-lab">{t("cc.best")}</span>
        <div className="cc-trials">
          {trials.length === 0 && <span className="muted">–</span>}
          {trials.map((tr) => {
            const on = vals.best_trials.includes(tr.id);
            return (
              <button key={tr.id} type="button" disabled={ro} className={"cc-trial" + (on ? " on" : "")}
                onClick={() => set({ best_trials: on ? vals.best_trials.filter((x) => x !== tr.id) : [...vals.best_trials, tr.id] })}>
                {tr.label}
              </button>
            );
          })}
        </div>

        <span className="cc-lab">{t("cc.findings")}</span>
        <textarea rows={8} value={vals.findings} readOnly={ro} maxLength={20000} placeholder={t("cc.findingsPh")}
          onChange={(e) => set({ findings: e.target.value })} />

        <span className="cc-lab">{t("cc.recommendation")}</span>
        <div>
          <div className="cc-choices">
            {RECOMMENDATIONS.map((r) => (
              <button key={r} type="button" disabled={ro} className={"cc-choice neutral" + (vals.recommendation === r ? " on" : "")}
                onClick={() => toggle("recommendation", r)}>{t(`cc.r.${r}`)}</button>
            ))}
          </div>
          <textarea rows={2} value={vals.recommendation_text} readOnly={ro} maxLength={2000} placeholder={t("cc.recPh")}
            onChange={(e) => set({ recommendation_text: e.target.value })} />
        </div>
      </div>

      <div className="cc-bar">
        <span className={"cc-state" + (dirty ? " dirty" : "")}>
          {dirty ? t("cc.unsaved") : data.exists ? t("cc.lastChange", { by: data.updated_by || "?", when }) : t("cc.none")}
        </span>
        {msg && <span className={"mj-msg " + msg.kind}>{msg.text}</span>}
        {!ro && <button className="btn-green" disabled={!dirty || busy} onClick={save}>{busy ? t("ed.saving") : t("cc.save")}</button>}
      </div>
    </div>
  );
}
