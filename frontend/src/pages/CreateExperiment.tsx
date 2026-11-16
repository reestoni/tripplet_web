import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";
import { RequestIcon } from "../components/RequestPopup";
import { HelpButton } from "../components/Help";

/* Create Experiment / Add Trial Series / Add Lab Machines like the desktop's
   ui/screen_create_experiment.py (tabs General, Material, Jet, Machine, Lab Machines with a
   tick when filled). Lists, rules (ply numbers, lab entries, Itemat 0.0 baseline) and the
   writing all run on the server (backend/app/create_api.py -> db/experiment_create.py).
   Modes: create, legacy (typed experiment ID, Ctrl+Shift+J on the New Experiment page like the
   desktop's hidden sidebar button), addseries, addtrials (Show Experiment "+T", /series/:id/add-trials),
   addlab. */

export type CreateMode = "create" | "legacy" | "addseries" | "addtrials" | "addlab";
type Opt = { id: number; label: string };
type Yarn = { id: number; name: string; colour: string; css: string; in_stock: boolean };
type JetDef = { id: number; name: string; geo: Record<string, string>; titer_range: string; ideal_titer: string };
type LabDef = { id: number; name: string; caption: string; unit: string; input: "none" | "itemat" | "csv" | "value"; freeform: boolean };
type Field = { fno: number; caption: string; kind: string; row: number; col: number; gap_before: boolean; options?: [number, string][] };
type Setup = {
  mode: CreateMode; lab_machines: LabDef[]; tensions: number[];
  experiments?: (Opt & { machine_id: number | null })[];
  product_groups?: Opt[]; order_types?: Opt[]; projects?: Opt[]; requests?: Opt[];
  backlog_statuses?: { id: number; name: string }[]; backlog_default?: number | null;
  machines?: { id: number; name: string; joker: boolean }[]; housings?: { id: number; name: string }[];
  yarn_uses?: { id: number; name: string }[]; yarns?: { groups: { label: string; yarns: Yarn[] }[]; open: string | null };
  jets?: { label: string; jets: JetDef[] }[]; max_plies?: number; max_plates?: number;
  series_info?: SeriesInfo; series_lab?: LabEntry[];
};
type SeriesInfo = { experiment_id: number | null; experiment_label: string; series_id: number; series_name: string;
  machine_id: number | null; ply_offset: number };
type Mat = { yarn_id: number; name: string; colour: string; css: string; ply: string; use_id: number | null; spool_id: number | null; spool: string };
type JetRow = { jet_id: number; jet: string; housing_id: number | null; housing: string; plates: string; pressure: string };
type LabEntry = { lm_id: number; name: string; disp: string; value: number | null; freeform: boolean };
type Tab = "general" | "material" | "jet" | "machine" | "lab";

const GEO = ["Luftbohrung", "WinkelLuftbohrung", "GarnkanalBreite", "Luftverbrauch", "Entwicklungsname"];
const PRESSURE_RE = /^\s*\d+(?:[.,]\d{1,2})?\s*$/;
const NUM_RE = /^\s*[+-]?\d+(?:[.,]\d{1,2})?\s*$/;
const CSV_RE = /^\s*[+-]?\d+(?:[.,]\d{1,2})?\s*(,\s*[+-]?\d+(?:[.,]\d{1,2})?\s*)*,?\s*$/;
const FIELD_RE: Record<string, RegExp> = {
  int: /^\s*-?\d+\s*$/, double: /^\s*[+-]?\d+(?:[.,]\d{1,3})?\s*$/, sz: /^\s*(S|Z|SZ)\s*$/i,
};
const pressureText = (p: string) => {
  const v = Number(p.trim().replace(",", "."));
  return Number.isFinite(v) ? String(Number(v.toFixed(2))) : p.trim();
};

export default function CreateExperiment({ mode }: { mode: CreateMode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routeSeries = Number(useParams().id) || null;          // addtrials: /series/:id/add-trials
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // General
  const [pg, setPg] = useState<number | null>(null);
  const [ot, setOt] = useState<number | null>(null);
  const [number, setNumber] = useState("");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectLocked, setProjectLocked] = useState(false);
  const [seriesName, setSeriesName] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [prio, setPrio] = useState(2);
  const [expId, setExpId] = useState<number | null>(null);
  const [seriesList, setSeriesList] = useState<{ id: number; name: string }[]>([]);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [trials, setTrials] = useState<{ id: number; label: string }[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // Material / Jet / Machine / Lab
  const [mats, setMats] = useState<Mat[]>([]);
  const [jets, setJets] = useState<JetRow[]>([]);
  const [machineId, setMachineId] = useState<number | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [lab, setLab] = useState<LabEntry[]>([]);
  // legacy: typed experiment ID -> product group / order type (server parses)
  const [legacyId, setLegacyId] = useState("");
  const [legacy, setLegacy] = useState<{ ok: boolean; taken: boolean } | null>(null);
  const info = setup?.series_info;

  const errText = (e: unknown) => {
    if (e instanceof ApiError && e.code) {
      const key = `ce.err.${e.code}`;
      const vars = (e.data?.vars ?? {}) as Record<string, string | number>;
      const s = t(key, vars);
      // these carry a server detail worth showing (which field / what failed)
      if (s !== key) return ["bad_input", "save_failed"].includes(e.code) ? `${s} ${e.message}` : s;
    }
    return e instanceof Error ? e.message : String(e);
  };

  useEffect(() => {
    request<Setup>("GET", `/api/create/setup?mode=${mode}${mode === "addtrials" ? `&series=${routeSeries}` : ""}`).then((s) => {
      setSetup(s);
      setStatus(s.backlog_default ?? null);
      if (s.series_info) { setMachineId(s.series_info.machine_id); setLab(s.series_lab ?? []); }
      const rq = Number(params.get("request"));
      if (mode === "create" && rq && s.requests?.some((r) => r.id === rq)) setRequestId(rq);
      const ex = Number(params.get("experiment"));
      if (ex && s.experiments?.some((e) => e.id === ex)) setExpId(ex);
      const copy = Number(params.get("copy"));
      if (mode === "addseries" && copy) {
        // "Copy TrialSeries" (desktop open_addseries_prefill): its experiment + its jet rows
        request<{ experiment_id: number | null; jets: JetRow[] }>("GET", `/api/create/series/${copy}/jets`)
          .then((r) => {
            if (!ex && r.experiment_id != null && s.experiments?.some((e) => e.id === r.experiment_id)) setExpId(r.experiment_id);
            setJets(r.jets.map((j) => ({ ...j, pressure: String(j.pressure ?? "") }))); setTab("jet");
          })
          .catch((e) => setMsg({ kind: "err", text: errText(e) }));
      }
    }).catch((e) => setLoadErr(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // legacy: parse the typed ID on the server, take product group / order type from it
  useEffect(() => {
    if (mode !== "legacy") return;
    if (!/^\s*\d{4}-\d{2,}-\d{3}\s*$/.test(legacyId)) { setLegacy(legacyId ? { ok: false, taken: false } : null); setPg(null); setOt(null); return; }
    request<{ product_group: number; order_type: number; taken: boolean }>("GET", `/api/create/legacy-id?id=${encodeURIComponent(legacyId.trim())}`)
      .then((r) => { setPg(r.product_group); setOt(r.order_type); setLegacy({ ok: true, taken: r.taken }); })
      .catch(() => { setLegacy({ ok: false, taken: false }); setPg(null); setOt(null); });
  }, [mode, legacyId]);

  // Ctrl+Shift+J switches New Experiment <-> Legacy import (desktop: hidden sidebar button)
  useEffect(() => {
    if (mode !== "create" && mode !== "legacy") return;
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        navigate(mode === "create" ? "/experiments/legacy" : "/experiments/new");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mode, navigate]);

  // next free experiment number (create)
  useEffect(() => {
    if (mode !== "create" || pg == null || ot == null) { setNumber(""); return; }
    request<{ number: string }>("GET", `/api/create/next-number?pg=${pg}&ot=${ot}`)
      .then((r) => setNumber(r.number)).catch(() => setNumber(""));
  }, [mode, pg, ot]);

  // a linked request's project always wins (and locks the choice)
  useEffect(() => {
    if (requestId == null) { setProjectLocked(false); return; }
    request<{ project_id: number | null }>("GET", `/api/create/request-project/${requestId}`).then((r) => {
      if (r.project_id != null) { setProjectId(r.project_id); setProjectLocked(true); } else setProjectLocked(false);
    }).catch(() => setProjectLocked(false));
  }, [requestId]);

  // existing experiment -> its machine (add series), its series (add lab machines)
  useEffect(() => {
    if (expId == null || !setup) { setSeriesList([]); setSeriesId(null); return; }
    if (mode === "addseries") setMachineId(setup.experiments?.find((e) => e.id === expId)?.machine_id ?? null);
    if (mode === "addlab") {
      request<{ series: { id: number; name: string }[] }>("GET", `/api/create/experiments/${expId}/series`).then((r) => {
        setSeriesList(r.series);
        const want = Number(params.get("series"));
        setSeriesId(r.series.find((x) => x.id === want)?.id ?? r.series[0]?.id ?? null);
      }).catch((e) => setMsg({ kind: "err", text: errText(e) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expId, setup, mode]);

  useEffect(() => {
    if (mode !== "addlab" || seriesId == null) { setTrials([]); setChecked(new Set()); return; }
    request<{ trials: { id: number; label: string }[] }>("GET", `/api/create/series/${seriesId}/trials`).then((r) => {
      setTrials(r.trials); setChecked(new Set(r.trials.map((x) => x.id)));
    }).catch((e) => setMsg({ kind: "err", text: errText(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, seriesId]);

  // machine -> its fields; a joker machine starts in "Backlog"
  const joker = !!setup?.machines?.find((m) => m.id === machineId)?.joker;
  useEffect(() => {
    setValues({});
    if (machineId == null || mode === "addlab") { setFields([]); return; }
    request<{ fields: Field[] }>("GET", `/api/create/machine-fields/${machineId}`).then((r) => setFields(r.fields))
      .catch((e) => setMsg({ kind: "err", text: errText(e) }));
  }, [machineId, mode]);
  useEffect(() => {
    if (joker) setStatus(setup?.backlog_statuses?.find((s) => s.name === "Backlog")?.id ?? null);
  }, [joker, setup]);

  // tab checks (desktop _check_general/_material/_jet/_machine/_lab)
  const fieldsOk = fields.every((f) => {
    const v = (values[String(f.fno)] ?? "").trim();
    return !v || !FIELD_RE[f.kind] || FIELD_RE[f.kind].test(v);
  });
  const ok: Record<Tab, boolean> = {
    general: mode === "create" ? pg != null && ot != null && !!number && !!seriesName.trim()
      : mode === "legacy" ? pg != null && ot != null && !!legacy?.ok && !legacy.taken && !!seriesName.trim()
      : mode === "addseries" ? expId != null && !!seriesName.trim()
      : mode === "addtrials" ? !!info
      : expId != null && seriesId != null && checked.size > 0,
    material: mats.length > 0,
    jet: jets.length > 0 && jets.every((j) => j.housing_id != null),
    machine: (mode === "addtrials" || machineId != null) && fieldsOk,
    lab: mode === "addlab" ? lab.length > 0 : true,
  };
  const tabs: Tab[] = mode === "addlab" ? ["general", "lab"] : ["general", "material", "jet", "machine", "lab"];
  const canSave = tabs.every((x) => ok[x]) && !busy;
  const dirty = !!(mats.length || jets.length || lab.length || seriesName);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty && !busy) e.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty, busy]);

  const save = async () => {
    if (!canSave) { setMsg({ kind: "err", text: t("ce.fillAll") }); return; }
    setBusy(true); setMsg(null);
    try {
      if (mode === "addlab") {
        const r = await request<{ created: number; skipped: number; jet_air: Record<string, number> | null }>(
          "POST", "/api/create/lab-save", { series_id: seriesId, trial_ids: [...checked], lab });
        const lines = [t("ce.labSaved", { created: r.created, skipped: r.skipped })];
        if (r.jet_air) lines.push(r.jet_air.physical_jets === 0 ? t("ce.jetAirNone")
          : t("ce.jetAirStats", { created: r.jet_air.created, there: r.jet_air.skipped_exists, jets: r.jet_air.physical_jets }));
        setMsg({ kind: "ok", text: lines.join("\n") });
        setLab([]);
        return;
      }
      const r = await request<{ series_id: number; label: string }>("POST", "/api/create/save", {
        mode, product_group: pg, order_type: ot, request_id: mode === "create" ? requestId : null, project_id: projectId,
        legacy_id: legacyId, series_id: info?.series_id ?? null,
        experiment_id: expId, series_name: seriesName, backlog_status: status, backlog_prio: prio,
        machine_id: machineId, machine_values: values,
        materials: mats.map((m) => ({ yarn_id: m.yarn_id, name: m.name, ply: m.ply, use_id: m.use_id, spool_id: m.spool_id })),
        jets: jets.map((j) => ({ jet_id: j.jet_id, housing_id: j.housing_id, plates: j.plates, pressure: j.pressure })),
        lab,
      });
      setMats([]); setJets([]); setLab([]); setSeriesName("");
      window.dispatchEvent(new Event("tripplet:nav-changed"));   // badges: request is now linked, backlog grew
      navigate(`/series/${r.series_id}`);
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loadErr) return <div className="page"><div className="login-error">{loadErr}</div></div>;
  if (!setup) return <div className="page muted">{t("app.loading")}</div>;

  return (
    <div className="page ce-page">
      <div className="se-head">
        <div className="se-title">
          <h1>{t(`ce.title.${mode}`)}</h1>
          <div className="se-facts"><span>{t(`ce.sub.${mode}`)}</span></div>
        </div>
        <span style={{ flex: 1 }} />
        {mode === "create" && requestId != null && <span className="tb-icon big rqp-er"><RequestIcon id={requestId} big floating /></span>}
        <HelpButton screen="create_experiment" />
        <button className="btn-green" disabled={!canSave} onClick={save} title={canSave ? undefined : t("ce.fillAll")}>
          {busy ? t("ce.saving") : t("ce.save")}
        </button>
      </div>
      {msg && <div className={(msg.kind === "err" ? "login-error" : "rq-ok") + " ce-msg"}>{msg.text}</div>}

      <div className="se-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={"se-tab" + (tab === x ? " on" : "")} onClick={() => setTab(x)}>
            <span className={"ce-tick" + (ok[x] ? " on" : "")}>{ok[x] ? "✓" : "○"}</span> {t(`ce.tab.${x}`)}
          </button>
        ))}
      </div>

      <div className="card ce-card">
        {tab === "general" && (
          <General mode={mode} setup={setup} pg={pg} setPg={setPg} ot={ot} setOt={setOt} number={number}
            legacyId={legacyId} setLegacyId={setLegacyId} legacy={legacy} info={info}
            requestId={requestId} setRequestId={setRequestId} projectId={projectId} setProjectId={setProjectId}
            projectLocked={projectLocked} seriesName={seriesName} setSeriesName={setSeriesName}
            status={status} setStatus={setStatus} joker={joker} prio={prio} setPrio={setPrio}
            expId={expId} setExpId={setExpId} seriesList={seriesList} seriesId={seriesId} setSeriesId={setSeriesId}
            trials={trials} checked={checked} setChecked={setChecked} />
        )}
        {tab === "material" && <MaterialTab setup={setup} mats={mats} setMats={setMats} errText={errText} seriesCtx={info?.series_id ?? null} />}
        {tab === "jet" && <JetTab setup={setup} jets={jets} setJets={setJets} />}
        {tab === "machine" && (
          <div className="ce-machine">
            <label className="rq-field ce-narrow">
              <span>{t("ce.machine")}</span>
              <select className="search" value={machineId ?? ""} disabled={mode === "addtrials"} title={mode === "addtrials" ? t("ce.machineOfSeries") : undefined}
                onChange={(e) => setMachineId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">–</option>
                {setup.machines?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            {joker && <p className="muted">{t("ce.jokerHint")}</p>}
            <MachineGrid fields={fields} values={values} setValues={setValues} />
          </div>
        )}
        {tab === "lab" && (
          <LabTab setup={setup} mode={mode} lab={lab} setLab={setLab} trialIds={[...checked]} errText={errText} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ General */
function General(p: {
  mode: CreateMode; setup: Setup; pg: number | null; setPg: (v: number | null) => void; ot: number | null; setOt: (v: number | null) => void;
  number: string; legacyId: string; setLegacyId: (v: string) => void; legacy: { ok: boolean; taken: boolean } | null;
  info: SeriesInfo | undefined;
  requestId: number | null; setRequestId: (v: number | null) => void; projectId: number | null;
  setProjectId: (v: number | null) => void; projectLocked: boolean; seriesName: string; setSeriesName: (v: string) => void;
  status: number | null; setStatus: (v: number | null) => void; joker: boolean; prio: number; setPrio: (v: number) => void;
  expId: number | null; setExpId: (v: number | null) => void; seriesList: { id: number; name: string }[];
  seriesId: number | null; setSeriesId: (v: number | null) => void; trials: { id: number; label: string }[];
  checked: Set<number>; setChecked: (s: Set<number>) => void;
}) {
  const { t } = useI18n();
  const { mode, setup } = p;
  const num = (v: string) => (v ? Number(v) : null);
  const allOn = p.trials.length > 0 && p.trials.every((x) => p.checked.has(x.id));
  return (
    <div className="rq-form ce-general">
      {mode === "legacy" && (
        <>
          <p className="ce-legacy wide">{t("ce.legacyHint")}</p>
          <label className="rq-field">
            <span>{t("ce.legacyId")}</span>
            <input className={"search" + (p.legacy && (!p.legacy.ok || p.legacy.taken) ? " ce-bad" : "")} value={p.legacyId}
              placeholder={t("ce.legacyPlaceholder")} onChange={(e) => p.setLegacyId(e.target.value)} />
            {p.legacy && !p.legacy.ok && <small className="login-error">{t("ce.err.legacy_format")}</small>}
            {p.legacy?.taken && <small className="login-error">{t("ce.err.legacy_taken", { id: p.legacyId.trim() })}</small>}
          </label>
          <span />
        </>
      )}
      {mode === "addtrials" && p.info && (
        <>
          <label className="rq-field"><span>{t("ce.existingExp")}</span><input className="search" readOnly value={p.info.experiment_label} /></label>
          <label className="rq-field"><span>{t("ce.existingSeries")}</span><input className="search" readOnly value={p.info.series_name} /></label>
          <p className="muted wide">{t("ce.addTrialsHint")}</p>
        </>
      )}
      {(mode === "create" || mode === "legacy") && (
        <>
          <label className="rq-field">
            <span>{t("ce.pg")}</span>
            <select className="search" value={p.pg ?? ""} disabled={mode === "legacy"} onChange={(e) => p.setPg(num(e.target.value))}>
              <option value="">–</option>
              {(setup.product_groups ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="rq-field">
            <span>{t("ce.ot")}</span>
            <select className="search" value={p.ot ?? ""} disabled={mode === "legacy"} onChange={(e) => p.setOt(num(e.target.value))}>
              <option value="">–</option>
              {(setup.order_types ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        </>
      )}
      {mode === "create" && (
        <>
          <label className="rq-field">
            <span>{t("ce.request")}</span>
            <select className={"search" + ((setup.requests?.length ?? 0) > 0 && p.requestId == null ? " ce-attention" : "")}
              value={p.requestId ?? ""} onChange={(e) => p.setRequestId(num(e.target.value))}>
              <option value="">{t("ce.requestNone")}</option>
              {setup.requests?.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="rq-field">
            <span>{t("ce.number")}</span>
            <input className="search" readOnly value={p.number} placeholder={t("ce.numberAuto")} />
          </label>
        </>
      )}
      {(mode === "create" || mode === "legacy") && (
        <label className="rq-field">
          <span>{t("ce.project")}</span>
          <select className="search" disabled={p.projectLocked && mode === "create"} title={p.projectLocked ? t("ce.projectLocked") : undefined}
            value={p.projectId ?? ""} onChange={(e) => p.setProjectId(num(e.target.value))}>
            <option value="">{t("ce.none")}</option>
            {setup.projects?.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
      )}
      {(mode === "addseries" || mode === "addlab") && (
        <label className="rq-field">
          <span>{t("ce.existingExp")}</span>
          <select className="search" value={p.expId ?? ""} onChange={(e) => p.setExpId(num(e.target.value))}>
            <option value="">–</option>
            {setup.experiments?.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      )}
      {mode === "addlab" && (
        <label className="rq-field">
          <span>{t("ce.existingSeries")}</span>
          <select className="search" value={p.seriesId ?? ""} onChange={(e) => p.setSeriesId(num(e.target.value))}>
            {p.seriesList.length === 0 && <option value="">–</option>}
            {p.seriesList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      {mode !== "addlab" && mode !== "addtrials" && (
        <>
          <label className="rq-field">
            <span>{t("ce.seriesName")}</span>
            <input className="search" value={p.seriesName} onChange={(e) => p.setSeriesName(e.target.value)} />
          </label>
          <label className="rq-field">
            <span>{t("ce.backlogStatus")}</span>
            <select className="search" disabled={p.joker} title={p.joker ? t("ce.jokerHint") : undefined}
              value={p.status ?? ""} onChange={(e) => p.setStatus(num(e.target.value))}>
              {setup.backlog_statuses?.map((s) => <option key={s.id} value={s.id}>{t(`status.${s.id}`) === `status.${s.id}` ? s.name : t(`status.${s.id}`)}</option>)}
            </select>
          </label>
          <label className="rq-field">
            <span>{t("ce.prio")}</span>
            <select className="search" value={p.prio} onChange={(e) => p.setPrio(Number(e.target.value))}>
              {[1, 2, 3].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </>
      )}
      {mode === "addlab" && p.seriesId != null && (
        <div className="rq-field wide">
          <span>{t("ce.trials")}</span>
          <div className="ce-trials">
            <button className="btn-plain" onClick={() => p.setChecked(allOn ? new Set() : new Set(p.trials.map((x) => x.id)))}>
              {allOn ? t("ce.deselectAll") : t("ce.selectAll")}
            </button>
            {p.trials.map((x) => (
              <label key={x.id} className="ce-trial">
                <input type="checkbox" checked={p.checked.has(x.id)} onChange={() => {
                  const s = new Set(p.checked);
                  if (s.has(x.id)) s.delete(x.id); else s.add(x.id);
                  p.setChecked(s);
                }} /> {x.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Material */
function MaterialTab({ setup, mats, setMats, errText, seriesCtx }: {
  setup: Setup; mats: Mat[]; setMats: (m: Mat[]) => void; errText: (e: unknown) => string; seriesCtx: number | null;
}) {
  const { t } = useI18n();
  const groups = setup.yarns?.groups ?? [];
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(setup.yarns?.open ? [setup.yarns.open] : []));
  const [sel, setSel] = useState<Yarn | null>(null);
  const [ends, setEnds] = useState(1);
  const [useId, setUseId] = useState<number | null>(null);
  const [spoolFor, setSpoolFor] = useState<{ yarn: Yarn; ply: string } | null>(null);
  const [trialPick, setTrialPick] = useState(false);
  const [stockOf, setStockOf] = useState<Yarn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const max = setup.max_plies ?? 5;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = groups.map((g) => ({ ...g, yarns: words.length ? g.yarns.filter((y) => words.every((w) => y.name.toLowerCase().includes(w))) : g.yarns }))
    .filter((g) => !words.length || g.yarns.length);

  // ply rule on the server (same yarn = same ply; add trials: the series' plies count)
  const plyFor = async (yarnId: number) => {
    const r = await request<{ ply: string; conflict: { code: string; vars: Record<string, string> } | null }>(
      "POST", "/api/create/ply", { materials: mats.map((m) => ({ yarn_id: m.yarn_id, name: m.name, ply: m.ply })),
        yarn_id: yarnId, series_id: seriesCtx });
    if (r.conflict) { setErr(t(`ce.err.${r.conflict.code}`, r.conflict.vars)); return null; }
    return r.ply;
  };
  const add = async () => {
    if (!sel) return;
    setErr(null);
    if (mats.length >= max) { setErr(t("ce.maxPlies", { n: max })); return; }
    try {
      const ply = await plyFor(sel.id);
      if (ply) setSpoolFor({ yarn: sel, ply });
    } catch (e) { setErr(errText(e)); }
  };
  // "+ Trial": the output of an existing trial (semi-finished, any machine) as ply - no spool
  const addTrialPly = async (trialId: number) => {
    setTrialPick(false); setErr(null);
    if (mats.length >= max) { setErr(t("ce.maxPlies", { n: max })); return; }
    try {
      const y = await request<{ yarn_id: number; name: string }>("POST", "/api/create/trial-yarn", { trial_id: trialId });
      const ply = await plyFor(y.yarn_id);
      if (!ply) return;
      const use = setup.yarn_uses?.find((u) => u.id === useId);
      const row: Mat = { yarn_id: y.yarn_id, name: y.name, colour: "", css: "", ply, use_id: use ? use.id : null, spool_id: null, spool: "" };
      setMats([...mats, ...Array.from({ length: Math.max(1, ends) }, () => ({ ...row }))]);
    } catch (e) { setErr(errText(e)); }
  };
  const addRows = (spoolId: number | null, spool: string) => {
    if (!spoolFor) return;
    const use = setup.yarn_uses?.find((u) => u.id === useId);
    const row: Mat = { yarn_id: spoolFor.yarn.id, name: spoolFor.yarn.name, colour: spoolFor.yarn.colour, css: spoolFor.yarn.css, ply: spoolFor.ply,
      use_id: use ? use.id : null, spool_id: spoolId, spool };
    setMats([...mats, ...Array.from({ length: Math.max(1, ends) }, () => ({ ...row }))]);
    setSpoolFor(null); setSel(null);
  };
  const remove = async (i: number) => {
    const rest = mats.filter((_, k) => k !== i);
    try {
      const r = await request<{ plies: string[] }>("POST", "/api/create/plies", { yarn_ids: rest.map((m) => m.yarn_id), series_id: seriesCtx });
      setMats(rest.map((m, k) => ({ ...m, ply: r.plies[k] ?? m.ply })));
    } catch (e) { setErr(errText(e)); }
  };

  return (
    <div className="ce-material">
      <div className="ce-pickrow">
        <div className="ce-tree-wrap">
          <input className="search" placeholder={t("ce.searchMaterial")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ce-tree">
            {shown.map((g) => {
              const isOpen = words.length > 0 || open.has(g.label);
              return (
                <div key={g.label}>
                  <button className="ce-group" onClick={() => {
                    const s = new Set(open); if (s.has(g.label)) s.delete(g.label); else s.add(g.label); setOpen(s);
                  }}>{isOpen ? "▾" : "▸"} {g.label}</button>
                  {isOpen && g.yarns.map((y) => (
                    <div key={y.id} className={"ce-item" + (sel?.id === y.id ? " on" : "")} onClick={() => setSel(y)} onDoubleClick={() => { setSel(y); }}
                      title={y.colour ? t("ce.colour", { colour: y.colour }) : undefined}>
                      <span className="ce-dot" style={{ background: y.css || "transparent" }} />
                      <span className="ce-name">{y.name}</span>
                      <span className={"ce-stock" + (y.in_stock ? " on" : "")} title={y.in_stock ? t("ce.inStockClick") : t("ce.notInStock")}
                        onClick={(e) => { if (y.in_stock) { e.stopPropagation(); setStockOf(y); } }} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="ce-addcol">
          <label className="ce-inline">{t("ce.ends")}
            <input type="number" min={1} max={20} value={ends} onChange={(e) => setEnds(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <label className="ce-inline">{t("ce.yarnUse")}
            <select value={useId ?? ""} onChange={(e) => setUseId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {setup.yarn_uses?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <button className="btn-green" disabled={!sel || mats.length >= max} onClick={add}>+ {t("ce.addYarn")}</button>
          <button className="btn-plain" disabled={mats.length >= max} onClick={() => setTrialPick(true)} title={t("ce.trialPlyTip")}>+ {t("ce.trialPly")}</button>
          {sel && <span className="muted">{sel.name}</span>}
        </div>
      </div>
      {err && <div className="login-error ce-msg">{err}</div>}
      <table className="grid ce-table">
        <thead><tr><th>{t("ce.material")}</th><th>Ply</th><th>{t("ce.yarnUse")}</th><th>{t("ce.spool")}</th><th /></tr></thead>
        <tbody>
          {mats.map((m, i) => (
            <tr key={i}>
              <td><span className="ce-dot" style={{ background: m.css || "transparent" }} />{m.name}</td>
              <td className="nowrap">{m.ply}</td>
              <td>{setup.yarn_uses?.find((u) => u.id === m.use_id)?.name ?? "—"}</td>
              <td>{m.spool || "—"}</td>
              <td><button className="link-btn" onClick={() => remove(i)} title={t("ce.remove")}>✕</button></td>
            </tr>
          ))}
          {mats.length === 0 && <tr><td colSpan={5} className="muted">{t("ce.noMaterial")}</td></tr>}
        </tbody>
      </table>
      {spoolFor && <SpoolPicker yarn={spoolFor.yarn} onCancel={() => setSpoolFor(null)} onOk={addRows} />}
      {trialPick && <TrialPicker onCancel={() => setTrialPick(false)} onOk={addTrialPly} />}
      {stockOf && <StockDialog yarn={stockOf} chosen={new Set(mats.filter((m) => m.spool_id != null).map((m) => m.spool_id as number))}
        onClose={() => setStockOf(null)} />}
    </div>
  );
}

/** "+ Trial" (desktop TrialPickerDialog): live search over experiment ID / series / machine, one trial. */
export function TrialPicker({ onCancel, onOk, searchUrl = "/api/create/trials-search" }: { onCancel: () => void; onOk: (trialId: number) => void; searchUrl?: string }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: number; label: string }[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    if (!q.trim()) { setRows(null); return; }
    const h = window.setTimeout(() => {
      request<{ trials: { id: number; label: string }[] }>("GET", `${searchUrl}?q=${encodeURIComponent(q)}`)
        .then((r) => { setRows(r.trials); setSel(null); }).catch(() => setRows([]));
    }, 250);
    return () => window.clearTimeout(h);
  }, [q, searchUrl]);
  return (
    <Modal title={t("ce.trialPickTitle")} onClose={onCancel} wide>
      <p className="muted">{t("ce.trialPickHint")}</p>
      <input className="search" autoFocus placeholder={t("ce.trialPickPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ce-tree ce-picklist">
        {rows?.length === 0 && <div className="muted ce-item">{t("ce.noTrials")}</div>}
        {rows?.map((r) => (
          <div key={r.id} className={"ce-item" + (sel === r.id ? " on" : "")} onClick={() => setSel(r.id)} onDoubleClick={() => onOk(r.id)}>{r.label}</div>
        ))}
      </div>
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onCancel}>{t("bl.machine.cancel")}</button>
        <button className="btn-green" disabled={sel == null} onClick={() => sel != null && onOk(sel)}>{t("rq.ok")}</button>
      </div>
    </Modal>
  );
}

type StockSpool = { id: number; location: string; batch: string; kg: number | null; tube: string; tube_colours: string[][]; received: string; assigned: boolean };

/** Where are the spools of this yarn (desktop YarnLocationsDialog): spools in stock by location,
 *  alternating background per location, the spools chosen in the form in bold. */
export function StockDialog({ yarn, chosen, onClose, seriesId }: { yarn: Pick<Yarn, "id" | "name">; chosen: Set<number>; onClose: () => void; seriesId?: number }) {
  const { t } = useI18n();
  const [spools, setSpools] = useState<StockSpool[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    request<{ spools: StockSpool[] }>("GET", seriesId ? `/api/series/${seriesId}/stock/${yarn.id}` : `/api/create/stock/${yarn.id}`).then((r) => setSpools(r.spools)).catch(() => setSpools([]));
  }, [yarn.id, seriesId]);
  const locs = spools ? [...new Set(spools.map((s) => s.location))] : [];
  const kg = (spools ?? []).reduce((a, s) => a + (s.kg ?? 0), 0);
  const tubeCss = (parts: string[][]) => parts.map((w) => w.find((x) => CSS.supports("color", x))).filter(Boolean) as string[];
  let group = -1, prev: string | null = null;
  return (
    <Modal title={t("ce.stockTitle", { yarn: yarn.name })} onClose={onClose} wide>
      {!spools ? <p className="muted">{t("app.loading")}</p> : spools.length === 0 ? <p>{t("ce.stockNone")}</p> : (
        <>
          <p>{t("ce.stockInfo", { n: spools.length, kg: kg.toFixed(1), locs: locs.length, names: locs.map((l) => l || t("ce.noLocation")).join(", ") })}</p>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>{t("ce.location")}</th><th>{t("ce.spool")}</th><th>{t("ce.batch")}</th><th className="num">{t("ce.weight")}</th>
                <th>{t("ce.tube")}</th><th>{t("ce.received")}</th></tr></thead>
              <tbody>
                {spools.map((s) => {
                  if (s.location !== prev) { group++; prev = s.location; }
                  const bold = chosen.has(s.id) || s.assigned;
                  const cols = tubeCss(s.tube_colours);
                  return (
                    <tr key={s.id} className={(group % 2 ? "ce-tint" : "") + (bold ? " ce-chosen" : "") + (picked === s.id ? " ce-picked" : "")}
                      onClick={() => setPicked(s.id)}>
                      <td>{s.location || "–"}</td><td>#{s.id}</td><td>{s.batch || "–"}</td>
                      <td className="num">{s.kg != null ? s.kg.toFixed(2) : "?"}</td>
                      <td>{cols.length > 0 && <span className="ce-tube">{cols.map((c, i) => <span key={i} style={{ background: c }} />)}</span>}{s.tube || "–"}</td>
                      <td>{s.received}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {spools.some((s) => chosen.has(s.id)) && <p className="muted">{t("ce.stockBold")}</p>}
        </>
      )}
      <div className="modal-buttons">
        {!!spools?.length && (
          <button className="btn-plain" title={t("ce.openStockTip")} onClick={() => {
            // desktop: switches to Yarn Stock at this yarn (batch of the selected spool); the web opens a new tab
            // so the half-filled experiment form stays
            const batch = spools.find((s) => s.id === picked)?.batch ?? "";
            window.open(`/tools/yarn-stock?yarn=${yarn.id}&charge=${encodeURIComponent(batch)}`, "_blank");
          }}>{t("ce.openStock")}</button>
        )}
        <button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button>
      </div>
    </Modal>
  );
}

function SpoolPicker({ yarn, onCancel, onOk }: { yarn: Yarn; onCancel: () => void; onOk: (id: number | null, label: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<{ spools: { id: number; label: string }[]; in_stock: boolean } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    request<{ spools: { id: number; label: string }[]; in_stock: boolean }>("GET", `/api/create/spools/${yarn.id}`)
      .then(setData).catch(() => setData({ spools: [], in_stock: false }));
  }, [yarn.id]);
  return (
    <Modal title={t("ce.spoolTitle")} onClose={onCancel}>
      <label className="rq-field">
        <span>{t("ce.spoolFor", { yarn: yarn.name })}</span>
        <select className="search" value={sel ?? ""} onChange={(e) => setSel(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t("ce.noSpool")}</option>
          {data?.spools.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {data && !data.in_stock && <p className="ce-warn">{t("ce.noSpoolInStock")}</p>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onCancel}>{t("bl.machine.cancel")}</button>
        <button className="btn-green" disabled={!data} onClick={() => onOk(sel, data?.spools.find((s) => s.id === sel)?.label ?? "")}>{t("rq.ok")}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Jet */
function JetTab({ setup, jets, setJets }: { setup: Setup; jets: JetRow[]; setJets: (j: JetRow[]) => void }) {
  const { t } = useI18n();
  const groups = setup.jets ?? [];
  const maxPlates = setup.max_plates ?? 20;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(groups[0] ? [groups[0].label] : []));
  const [sort, setSort] = useState<{ col: number; asc: boolean } | null>(null);
  const [sel, setSel] = useState<JetDef | null>(null);
  const [housing, setHousing] = useState<number | null>(null);
  const [nPlates, setNPlates] = useState("");
  const [plates, setPlates] = useState<string[]>([]);
  const [pressure, setPressure] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [cur, setCur] = useState<number | null>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const cell = (j: JetDef, col: number) => (col === 0 ? j.name : col <= 5 ? j.geo[GEO[col - 1]] ?? "" : col === 6 ? j.titer_range : j.ideal_titer);
  const shown = useMemo(() => groups.map((g) => {
    let list = words.length ? g.jets.filter((j) => words.every((w) => (j.name + " " + (j.geo.Entwicklungsname ?? "")).toLowerCase().includes(w))) : g.jets;
    if (sort) {
      const key = (j: JetDef) => { const v = cell(j, sort.col); const n = Number(v.replace(",", ".")); return v !== "" && Number.isFinite(n) ? [0, n] as const : [1, v.toLowerCase()] as const; };
      list = [...list].sort((a, b) => {
        const ka = key(a), kb = key(b);
        const c = ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0);
        return sort.asc ? c : -c;
      });
    }
    return { ...g, jets: list };
  }).filter((g) => !words.length || g.jets.length),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [groups, q, sort]);

  const n = Number(nPlates);
  const inputsOk = housing != null && sel != null && /^\d+$/.test(nPlates) && n >= 1 && n <= maxPlates
    && plates.slice(0, n).every((p) => /^\d+$/.test(p.trim()) && Number(p) <= 100) && PRESSURE_RE.test(pressure);
  const setCount = (v: string) => {
    setNPlates(v);
    const k = Number(v);
    if (/^\d+$/.test(v) && k >= 1 && k <= maxPlates) setPlates(Array.from({ length: k }, (_, i) => plates[i]?.trim() ? plates[i] : String(i + 1)));
  };
  const add = () => {
    if (!inputsOk || !sel) return;
    setJets([...jets, { jet_id: sel.id, jet: sel.name, housing_id: housing, housing: setup.housings?.find((h) => h.id === housing)?.name ?? "",
      plates: plates.slice(0, n).map((p) => p.trim()).join(","), pressure: pressureText(pressure) }]);
    setPressure("");
  };
  const edit = (i: number, patch: Partial<JetRow>) => setJets(jets.map((j, k) => (k === i ? { ...j, ...patch } : j)));
  const move = (i: number, d: number) => {
    const k = i + d;
    if (k < 0 || k >= jets.length) return;
    const a = [...jets]; [a[i], a[k]] = [a[k], a[i]]; setJets(a); setCur(k);
  };
  // drag & drop reordering (desktop: ReadOnlyTable on_row_moved -> _move_jet_row)
  const [drag, setDrag] = useState<number | null>(null);
  const dropAt = (to: number) => {
    if (drag == null || drag === to) { setDrag(null); return; }
    const a = [...jets];
    const [row] = a.splice(drag, 1);
    a.splice(to, 0, row);
    setJets(a); setCur(to); setDrag(null); setPicked(new Set());
  };
  const heads = [t("ce.jet"), t("ce.geo.Luftbohrung"), t("ce.geo.WinkelLuftbohrung"), t("ce.geo.GarnkanalBreite"),
    t("ce.geo.Luftverbrauch"), t("ce.geo.Entwicklungsname"), t("ce.titerRange"), t("ce.idealTiter")];

  return (
    <div className="ce-jet">
      <div className="ce-jetform">
        <label className="rq-field ce-narrow">
          <span>{t("ce.housing")}</span>
          <select className="search" value={housing ?? ""} onChange={(e) => setHousing(e.target.value ? Number(e.target.value) : null)}>
            <option value="" />
            {setup.housings?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
        <input className="search" placeholder={t("ce.searchJet")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ce-tree ce-jettree">
          <table className="grid">
            <thead><tr>{heads.map((h, i) => (
              <th key={i} className="ce-sort" onClick={() => setSort(sort?.col === i ? { col: i, asc: !sort.asc } : { col: i, asc: true })}>
                {h}{sort?.col === i ? (sort.asc ? " ▲" : " ▼") : ""}
              </th>))}</tr></thead>
            <tbody>
              {shown.map((g) => {
                const isOpen = words.length > 0 || open.has(g.label);
                return (
                  <Fragment key={g.label}>
                    <tr className="ce-grouprow" onClick={() => { const s = new Set(open); if (s.has(g.label)) s.delete(g.label); else s.add(g.label); setOpen(s); }}>
                      <td colSpan={8}>{isOpen ? "▾" : "▸"} {g.label}</td>
                    </tr>
                    {isOpen && g.jets.map((j) => (
                      <tr key={j.id} className={"ce-jetrow" + (sel?.id === j.id ? " on" : "")} onClick={() => setSel(j)}>
                        {heads.map((_, c) => <td key={c} className={c >= 1 && c <= 4 ? "num" : ""}>{cell(j, c)}</td>)}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ce-platerow">
          <label className="ce-inline">{t("ce.nPlates")}
            <input type="number" min={1} max={maxPlates} value={nPlates} onChange={(e) => setCount(e.target.value)} />
          </label>
          {/^\d+$/.test(nPlates) && n >= 1 && n <= maxPlates && plates.slice(0, n).map((p, i) => (
            <label key={i} className="ce-plate">{t("ce.plate", { n: i + 1 })}
              <input value={p} onChange={(e) => setPlates(plates.map((x, k) => (k === i ? e.target.value : x)))}
                className={/^\d+$/.test(p.trim()) && Number(p) <= 100 ? "" : "ce-bad"} />
            </label>
          ))}
          <label className="ce-inline">{t("ce.pressure")}
            <input value={pressure} onChange={(e) => setPressure(e.target.value)} className={!pressure || PRESSURE_RE.test(pressure) ? "" : "ce-bad"} />
          </label>
          <button className="btn-green" disabled={!inputsOk} onClick={add}>+ {t("ce.addJet")}</button>
          {sel && <span className="muted">{sel.name}</span>}
        </div>
      </div>
      <table className="grid ce-table">
        <thead><tr><th /><th>{t("ce.housing")}</th><th>{t("ce.jet")}</th><th>{t("ce.nPlates")}</th><th>{t("ce.pressure")}</th><th>{t("ce.plates")}</th><th /></tr></thead>
        <tbody>
          {jets.map((j, i) => (
            <tr key={i} className={(cur === i ? "ce-cur" : "") + (drag === i ? " ce-dragging" : "")} onClick={() => setCur(i)}
              draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (drag != null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); dropAt(i); }}
              onDragEnd={() => setDrag(null)} title={t("ce.dragTip")}>
              <td><input type="checkbox" checked={picked.has(i)} onChange={() => { const s = new Set(picked); if (s.has(i)) s.delete(i); else s.add(i); setPicked(s); }} /></td>
              <td className={j.housing_id == null ? "ce-bad" : ""}>{j.housing || "—"}</td>
              <td>{j.jet}</td>
              <td><input className="ce-cellin" defaultValue={j.plates.split(",").length} key={`n${i}-${j.plates}`} onBlur={(e) => {
                const k = Number(e.target.value);
                if (Number.isInteger(k) && k >= 1) edit(i, { plates: Array.from({ length: k }, (_, x) => String(x + 1)).join(",") });
                else e.target.value = String(j.plates.split(",").length);
              }} /></td>
              <td><input className="ce-cellin" defaultValue={j.pressure} key={`p${i}-${j.pressure}`} onBlur={(e) => {
                const v = e.target.value.trim().replace(",", ".");
                if (v !== "" && Number.isFinite(Number(v))) edit(i, { pressure: pressureText(v) }); else e.target.value = j.pressure;
              }} /></td>
              <td>{j.plates}</td>
              <td><button className="link-btn" title={t("ce.remove")} onClick={(e) => { e.stopPropagation(); setJets(jets.filter((_, k) => k !== i)); setPicked(new Set()); setCur(null); }}>✕</button></td>
            </tr>
          ))}
          {jets.length === 0 && <tr><td colSpan={7} className="muted">{t("ce.noJet")}</td></tr>}
        </tbody>
      </table>
      <div className="ce-btnrow">
        <button className="btn-plain" disabled={!picked.size} onClick={() => { setJets([...jets, ...[...picked].sort((a, b) => a - b).map((i) => ({ ...jets[i] }))]); setPicked(new Set()); }}>{t("ce.copySel")}</button>
        <button className="btn-plain" disabled={cur == null || cur === 0} onClick={() => cur != null && move(cur, -1)}>{t("ce.up")}</button>
        <button className="btn-plain" disabled={cur == null || cur >= jets.length - 1} onClick={() => cur != null && move(cur, 1)}>{t("ce.down")}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Machine */
function MachineGrid({ fields, values, setValues }: { fields: Field[]; values: Record<string, string>; setValues: (v: Record<string, string>) => void }) {
  const set = (fno: number, v: string) => setValues({ ...values, [String(fno)]: v });
  if (!fields.length) return null;
  return (
    <div className="ce-mgrid">
      {fields.filter((f) => f.gap_before).map((f) => <div key={`g${f.fno}`} className="ce-gap" style={{ gridRow: f.row, gridColumn: "1 / -1" }} />)}
      {fields.map((f) => {
        const v = values[String(f.fno)] ?? "";
        const bad = !!v.trim() && !!FIELD_RE[f.kind] && !FIELD_RE[f.kind].test(v);
        return (
          <Fragment key={f.fno}>
            <span className="ce-mlabel" style={{ gridRow: f.row + 1, gridColumn: f.col * 2 + 1 }}>{f.caption}</span>
            <span style={{ gridRow: f.row + 1, gridColumn: f.col * 2 + 2 }}>
              {f.kind === "dropdown" ? (
                <select value={v} onChange={(e) => set(f.fno, e.target.value)}>
                  <option value="" />
                  {(f.options ?? []).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              ) : (
                <input value={v} className={bad ? "ce-bad" : ""}
                  onChange={(e) => set(f.fno, f.kind === "sz" ? e.target.value.toUpperCase() : e.target.value)} />
              )}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Lab Machines */
function LabTab({ setup, mode, lab, setLab, trialIds, errText }: {
  setup: Setup; mode: CreateMode; lab: LabEntry[]; setLab: (l: LabEntry[]) => void; trialIds: number[]; errText: (e: unknown) => string;
}) {
  const { t } = useI18n();
  const [lmId, setLmId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [tens, setTens] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const lm = setup.lab_machines.find((m) => m.id === lmId) ?? null;
  const textOk = lm?.input === "csv" ? CSV_RE.test(text) : NUM_RE.test(text);
  const canAdd = !!lm && (lm.input === "none" || (lm.input === "itemat" ? tens.size > 0 || textOk : textOk));
  const add = async () => {
    if (!lm) return;
    setErr(null);
    try {
      const r = await request<{ entries: LabEntry[] }>("POST", "/api/create/lab-entries", {
        mode, entries: lab, lm_id: lm.id, text: lm.input === "none" ? "" : text, tensions: [...tens], trial_ids: trialIds });
      setLab([...lab, ...r.entries]);
      if (r.entries.length) setText("");
      setTens(new Set());
    } catch (e) { setErr(errText(e)); }
  };
  const remove = async (i: number) => {
    setErr(null);
    try {
      const r = await request<{ ok: boolean }>("POST", "/api/create/lab-can-delete", { entries: lab, index: i });
      if (!r.ok) { setErr(t("ce.baselineStays")); return; }
      setLab(lab.filter((_, k) => k !== i));
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <div className="ce-lab">
      <div className="ce-labrow">
        <label className="ce-inline">{t("ce.labMachine")}
          <select value={lmId ?? ""} onChange={(e) => { setLmId(e.target.value ? Number(e.target.value) : null); setText(""); setTens(new Set()); setErr(null); }}>
            <option value="">–</option>
            {setup.lab_machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        {lm?.input === "itemat" && (
          <>
            <span className="ce-inline">{t("ce.tension")}</span>
            {setup.tensions.map((v) => (
              <label key={v} className="ce-inline">
                <input type="checkbox" checked={tens.has(v)} onChange={() => { const s = new Set(tens); if (s.has(v)) s.delete(v); else s.add(v); setTens(s); }} />
                {v.toFixed(1)} {lm.unit || "cN/dtex"}
              </label>
            ))}
          </>
        )}
        {lm && lm.input !== "none" && (
          <label className="ce-inline">{lm.caption}
            <input value={text} onChange={(e) => setText(e.target.value)} className={!text || textOk ? "" : "ce-bad"}
              placeholder={lm.input === "itemat" ? t("ce.otherTension") : lm.input === "csv" ? t("ce.csvHint") : ""} />
            {lm.unit}
          </label>
        )}
        <button className="btn-green" disabled={!canAdd} onClick={add}>+ {t("ce.addLab")}</button>
      </div>
      {lm?.freeform && <p className="muted">{t("ce.freeformHint")}</p>}
      {err && <div className="login-error ce-msg">{err}</div>}
      <table className="grid ce-table">
        <thead><tr><th>{t("ce.labMachine")}</th><th>{t("ce.additional")}</th><th /></tr></thead>
        <tbody>
          {lab.map((e, i) => (
            <tr key={i}><td>{e.name}</td><td>{e.disp}</td>
              <td><button className="link-btn" onClick={() => remove(i)} title={t("ce.remove")}>✕</button></td></tr>
          ))}
          {lab.length === 0 && <tr><td colSpan={3} className="muted">{mode === "addlab" ? t("ce.noLabNeeded") : t("ce.noLab")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
