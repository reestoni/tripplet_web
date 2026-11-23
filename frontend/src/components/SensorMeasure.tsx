import { useEffect, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "./SeriesTools";

/* "📏 Messen" in Show Experiment (Nutzerwunsch 2026-11-20, F&E feasibility): YarnScope measuring straight from the
   NI box instead of Sensoft - box + sensor, empty value (no yarn), trial, measure. After a measurement the next
   trial is chosen (like Sensoft counting up). Server: backend/app/sensor_api.py on ui/yarnscope/sensor_measure.py
   (desktop repo, same as the desktop dialog). The server talks to the box - works while it runs on the laptop. */

type Box = { name: string; product: string; serial: string; simulated: boolean };
type Sensor = { key: string; head: string; connector: string; axes: number; label: string; title: string; date: string };
type MTrial = { trial_id: number; vno: number; speed: number | null; dty: string | null; aty: string | null };
type ErrJson = { code: string; detail: string; vars?: Record<string, string | number> };
type Setup = { can_write: boolean; boxes: Box[]; box_error: ErrJson | null; sensors: Sensor[]; trials: MTrial[];
  length: number; speed_range: [number, number]; length_range: [number, number]; replaced_dir: string; default_distance_mm?: number };
type Axis = { axis: string; mean_um: number; std_um: number; connector?: string };
type Zero = { axes: Axis[]; head: string; connector: string; box: string; at: string };
type Pair = { reliable: boolean; corr: number | null; delay_ms?: number; speed?: number; speed_dev_pct?: number;
  distance_from_speed_mm?: number; distance_mm?: number | null; synced?: boolean; error?: string;
  profile?: { from_m: number; to_m: number; speed: number | null; corr: number | null }[];
  knots?: { knots_a: number; knots_b: number; matched: number; pct_a?: number; pct_b?: number; only_a?: number;
    only_b?: number; len_diff_mm?: number | null; len_diff_sd_mm?: number | null } };
type Second = { file: string; connector: string; head: string; axes: Axis[]; series_id?: number };
type Result = { file: string; points: number; rate: number; axes: Axis[]; replaced: string | null; second?: Second; pair?: Pair | null };
type Job = { id: string; vno: number; done: number; total: number; queued: boolean; finished: boolean;
  result: Result | null; error: ErrJson | null };

const PREF = "tripplet.sensorMeasure";
type Prefs = { box?: string; sensor?: string; kind?: "dty" | "aty"; length?: number; second?: string; distance?: string };
const loadPrefs = (): Prefs => { try { return JSON.parse(localStorage.getItem(PREF) || "{}"); } catch { return {}; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* storage blocked */ } };
const vlabel = (vno: number) => `V${String(vno).padStart(3, "0")}`;
/** Zero result: per sensor (connector) its axes, e.g. "C1 X: -88.9 µm (± 2.0)" */
const zeroText = (z: Zero) => z.axes.map((a) => `${a.connector && z.axes.some((b) => b.connector !== a.connector) ? a.connector + " " : ""}`
  + `${a.axis.toUpperCase()}: ${a.mean_um.toFixed(1)} µm (± ${a.std_um.toFixed(1)})`).join("   ");

/** "2nd sensor at the same time" + distance (Nutzerwunsch 2026-11-23): only sensors on the other connector. */
function SecondFields({ sensors, main, second, setSecond, distance, setDistance, busy }: {
  sensors: Sensor[]; main: Sensor | undefined; second: string; setSecond: (v: string) => void;
  distance: string; setDistance: (v: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const others = sensors.filter((x) => main && x.connector !== main.connector && x.head !== main.head);
  return (<>
    <label>{t("ms.second")}</label>
    <select value={others.some((x) => x.key === second) ? second : ""} onChange={(e) => setSecond(e.target.value)} disabled={busy || !others.length}>
      <option value="">{t("ms.secondNone")}</option>
      {others.map((x) => <option key={x.key} value={x.key}>{headLabel(x.head)} · {t(x.axes === 2 ? "ms.axes2" : "ms.axes1")} · {x.connector}</option>)}
    </select>
    {others.some((x) => x.key === second) && (<>
      <label>{t("ms.distance")}</label>
      <div className="ms-row"><input type="text" inputMode="decimal" value={distance} disabled={busy} placeholder="–"
        onChange={(e) => setDistance(e.target.value)} /> <span>mm</span> <span className="muted small">{t("ms.distanceHint")}</span></div>
    </>)}
  </>);
}

/** Result of a simultaneous measurement: delay, speed (with a distance), same knots (sensor_pair.py). */
function PairResult({ pair, second }: { pair: Pair | null | undefined; second?: Second }) {
  const { t } = useI18n();
  if (!second) return null;
  const k = pair?.knots;
  return (
    <div className="ms-pair">
      <div className="small">{t("ms.secondFile", { file: second.file })}</div>
      {!pair || !pair.reliable ? <div className="ms-warn small">{t("ms.pairUnreliable", { c: pair?.corr ?? "–" })}</div> : (<>
        <div><b>{t("ms.pairTitle")}</b> · {t("ms.pairDelay", { ms: pair.delay_ms?.toFixed(3) ?? "–" })} · {t("ms.pairCorr", { c: pair.corr ?? "–" })}</div>
        {pair.speed != null
          ? <div><b>{t("ms.pairSpeed", { v: pair.speed.toFixed(1) })}</b>{pair.speed_dev_pct != null ? ` (${pair.speed_dev_pct > 0 ? "+" : ""}${pair.speed_dev_pct.toFixed(2)} %)` : ""}</div>
          : pair.distance_from_speed_mm != null && <div className="small">{t("ms.pairDistance", { mm: pair.distance_from_speed_mm.toFixed(1) })}</div>}
        {pair.profile && pair.profile.some((x) => x.speed != null) && (
          <div className="small muted">{t("ms.pairProfile")}: {pair.profile.map((x) => x.speed != null ? x.speed.toFixed(0) : "–").join(" · ")}</div>)}
        {k && k.pct_a != null && (<>
          <div>{t("ms.pairKnots", { a: k.pct_a, b: k.pct_b ?? "–", oa: k.only_a ?? 0, ob: k.only_b ?? 0 })}</div>
          {k.len_diff_mm != null && <div className="small muted">{t("ms.pairLen", { d: k.len_diff_mm.toFixed(2), sd: (k.len_diff_sd_mm ?? 0).toFixed(2) })}</div>}
        </>)}
      </>)}
    </div>
  );
}

/** "PXL_3_121_W" -> "PXL 3-121" (type, serial number of the head) */
const headLabel = (h: string) => { const p = h.split("_"); return p.length >= 3 ? `${p[0]} ${p[1]}-${p[2]}` : h; };

export function SensorMeasureDialog({ seriesId, onClose, onMeasured }: {
  seriesId: number; onClose: () => void; onMeasured: () => void }) {
  const { t } = useI18n();
  const prefs = useRef(loadPrefs());
  const [setup, setSetup] = useState<Setup | null>(null);
  const [box, setBox] = useState("");
  const [sensor, setSensor] = useState("");
  const [kind, setKind] = useState<"dty" | "aty">(prefs.current.kind ?? "dty");
  const [trialId, setTrialId] = useState<number | null>(null);
  const [speed, setSpeed] = useState("");
  const [length, setLength] = useState(String(prefs.current.length ?? 100));
  const [zero, setZero] = useState<Zero | null>(null);
  const [second, setSecond] = useState(prefs.current.second ?? "");
  const [distance, setDistance] = useState(prefs.current.distance ?? "");
  const [busy, setBusy] = useState<"" | "zero" | "measure">("");
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);   // "exists": file name, waiting for "measure again"
  const alive = useRef(true);
  const jobId = useRef<string | null>(null);
  useEffect(() => () => { alive.current = false; }, []);

  const errMsg = (e: ErrJson | unknown): string => {
    const j: ErrJson | null = e instanceof ApiError ? { code: e.code ?? "", detail: e.message, vars: (e.data?.vars as ErrJson["vars"]) }
      : e && typeof e === "object" && "code" in e ? (e as ErrJson) : null;
    if (!j) return String(e);
    const k = `ms.err.${j.code}`;
    const v = t(k, { detail: j.detail, ...(j.vars ?? {}) });
    return v === k ? j.detail : v;
  };

  const firstFree = (s: Setup, k: "dty" | "aty", after?: number) => {
    const list = s.trials;
    const later = after != null ? list.filter((x) => x.vno > after) : list;
    return (later.find((x) => !x[k]) ?? later[0] ?? list.find((x) => !x[k]) ?? list[0])?.trial_id ?? null;
  };

  const load = async (selectAfterVno?: number) => {
    try {
      const s = await request<Setup>("GET", `/api/series/${seriesId}/sensor/setup`);
      if (!alive.current) return;
      setSetup(s);
      if (prefs.current.distance == null && s.default_distance_mm) setDistance(String(s.default_distance_mm));
      setBox((cur) => cur && s.boxes.some((b) => b.name === cur) ? cur
        : (s.boxes.find((b) => b.name === prefs.current.box) ?? s.boxes[0])?.name ?? "");
      setSensor((cur) => cur && s.sensors.some((x) => x.key === cur) ? cur
        : (s.sensors.find((x) => x.key === prefs.current.sensor) ?? s.sensors[0])?.key ?? "");
      const tid = selectAfterVno != null ? firstFree(s, kind, selectAfterVno) : firstFree(s, kind);
      pick(s, tid);
    } catch (e) { if (alive.current) setErr(errMsg(e)); }
  };
  useEffect(() => { void load(); }, [seriesId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (s: Setup | null, tid: number | null) => {
    setTrialId(tid);
    const tr = s?.trials.find((x) => x.trial_id === tid);
    if (tr?.speed) setSpeed(String(tr.speed));
  };

  const sens = setup?.sensors.find((x) => x.key === sensor);
  const sec = setup?.sensors.some((x) => x.key === second && sens && x.connector !== sens.connector && x.head !== sens.head) ? second : "";
  const trial = setup?.trials.find((x) => x.trial_id === trialId);
  const num = (s: string) => Number(s.replace(",", "."));

  const doZero = async () => {
    setBusy("zero"); setErr(null);
    try {
      const z = await request<Zero>("POST", `/api/series/${seriesId}/sensor/zero`, { box, sensor, second: sec || undefined });
      if (alive.current) setZero(z);
    } catch (e) { if (alive.current) setErr(errMsg(e)); } finally { if (alive.current) setBusy(""); }
  };

  const doMeasure = async (replace: boolean) => {
    if (!trial || !setup) return;
    const [lo, hi] = setup.speed_range;
    if (!(num(speed) >= lo && num(speed) <= hi)) { setErr(t("ms.err.bad_speed", { lo, hi })); return; }
    if (!zero && !replace && !window.confirm(t("ms.noZeroAsk"))) return;
    prefs.current = { box, sensor, kind, length: num(length), second, distance };
    savePrefs(prefs.current);
    setBusy("measure"); setErr(null); setAsk(null); setResult(null); setJob(null);
    try {
      const { job_id } = await request<{ job_id: string }>("POST", `/api/series/${seriesId}/sensor/measure`, {
        box, sensor, trial_id: trial.trial_id, speed: num(speed), length: num(length), kind, replace, zero,
        second: sec || undefined, distance: num(distance) > 0 ? num(distance) : undefined });
      jobId.current = job_id;
      for (;;) {
        await new Promise((res) => setTimeout(res, 400));
        if (!alive.current) return;
        const j = await request<Job>("GET", `/api/series/${seriesId}/sensor/job/${job_id}`);
        if (!alive.current) return;
        setJob(j);
        if (j.finished) {
          if (j.error) setErr(errMsg(j.error));
          else if (j.result) { setResult(j.result); onMeasured(); await load(trial.vno); }
          break;
        }
      }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.code === "exists") setAsk(String((e.data?.vars as Record<string, string>)?.file ?? ""));
      else setErr(errMsg(e));
    } finally { jobId.current = null; if (alive.current) setBusy(""); }
  };

  const cancel = () => {
    if (jobId.current) void request("POST", `/api/series/${seriesId}/sensor/job/${jobId.current}/cancel`).catch(() => undefined);
  };
  const close = () => { if (busy === "measure") { if (!window.confirm(t("ms.cancelAsk"))) return; cancel(); } onClose(); };

  const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const noBox = setup && !setup.boxes.length;
  const ready = !!setup?.can_write && !!box && !!sens && !!trial && !busy;

  return (
    <Modal title={t("ms.title")} onClose={close}>
      <p className="muted small">{t("ms.intro")}</p>
      {!setup && !err && <p className="muted">{t("se.loading")}</p>}
      {setup && (
        <div className="ms-form">
          <label>{t("ms.box")}</label>
          <div className="ms-row">
            {noBox ? <span className="ms-warn">{setup.box_error ? errMsg(setup.box_error) : t("ms.noBox")}</span> : (
              <select value={box} onChange={(e) => { setBox(e.target.value); setZero(null); }} disabled={!!busy}>
                {setup.boxes.map((b) => <option key={b.name} value={b.name}>{b.name} – {b.product} ({t("ms.serial")} {b.serial})</option>)}
              </select>)}
            <button className="btn-plain" title={t("ms.rescan")} onClick={() => void load()} disabled={!!busy}>↻</button>
          </div>
          <label>{t("ms.sensor")}</label>
          {setup.sensors.length ? (
            <select value={sensor} onChange={(e) => { setSensor(e.target.value); setZero(null); }} disabled={!!busy}
              title={sens ? `${sens.title} – ${t("ms.calibrated")} ${sens.date}` : undefined}>
              {setup.sensors.map((x) => <option key={x.key} value={x.key}>
                {headLabel(x.head)} · {t(x.axes === 2 ? "ms.axes2" : "ms.axes1")} · {x.connector}</option>)}
            </select>) : <span className="ms-warn">{t("ms.noSensor")}</span>}
          <label>{t("ms.folder")}</label>
          <div className="ms-row jr-seg">
            {(["dty", "aty"] as const).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} disabled={!!busy}
                onClick={() => { setKind(k); if (setup) pick(setup, firstFree(setup, k)); }}>{k.toUpperCase()}</button>))}
          </div>

          <SecondFields sensors={setup.sensors} main={sens} second={second} setSecond={(v) => { setSecond(v); setZero(null); }}
            distance={distance} setDistance={setDistance} busy={!!busy} />

          <div className="ms-step">
            <button className="btn-plain" disabled={!box || !sens || !!busy || !setup.can_write} onClick={doZero}>
              {busy === "zero" ? t("ms.zeroBusy") : t("ms.zero")}</button>
            <span className="small">{zero ? zeroText(zero)
              : <span className="muted">{t("ms.zeroHint")}</span>}</span>
          </div>

          <label>{t("ms.trial")}</label>
          <select value={trialId ?? ""} onChange={(e) => pick(setup, Number(e.target.value))} disabled={!!busy}>
            {setup.trials.map((x) => <option key={x.trial_id} value={x.trial_id}>
              {vlabel(x.vno)}{x[kind] ? `   ✓ ${t("ms.measured")}` : ""}</option>)}
          </select>
          <label>{t("ms.speed")}</label>
          <div className="ms-row"><input type="text" inputMode="decimal" value={speed} disabled={!!busy}
            onChange={(e) => setSpeed(e.target.value)} /> <span>m/min</span>
            {trial && !trial.speed && <span className="muted small">{t("ms.noSpeed")}</span>}</div>
          <label>{t("ms.length")}</label>
          <div className="ms-row"><input type="text" inputMode="decimal" value={length} disabled={!!busy}
            onChange={(e) => setLength(e.target.value)} /> <span>m</span></div>
        </div>
      )}
      {!setup?.can_write && setup && <p className="ms-warn">{t("tl.writeNeeded")}</p>}
      {busy === "measure" && (
        <div className="imp-progress" role="status" aria-live="polite">
          <div className={"imp-bar" + (job && job.total > 0 ? "" : " indet")} role="progressbar" aria-valuemin={0}
            aria-valuemax={100} aria-valuenow={job && job.total > 0 ? pct : undefined}>
            <div className="imp-fill" style={job && job.total > 0 ? { width: `${Math.max(pct, 3)}%` } : undefined} />
          </div>
          <div className="imp-lines small"><span><b>{job && job.total > 0 ? `${pct} %` : ""}</b> {t("ms.measuring", { trial: trial ? vlabel(trial.vno) : "" })}</span></div>
        </div>
      )}
      {ask !== null && (
        <div className="ms-ask">
          <p>{t("ms.err.exists", { file: ask })}</p>
          <p className="muted small">{t("ms.replaceHint", { dir: setup?.replaced_dir ?? "_replaced" })}</p>
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => setAsk(null)}>{t("cm.cancel")}</button>
            <button className="btn-green" onClick={() => void doMeasure(true)}>{t("ms.again")}</button>
          </div>
        </div>
      )}
      {result && (
        <div className="rq-ok">
          <b>{t("ms.saved")}</b> {result.file} – {result.points.toLocaleString("de-CH")} {t("ms.points")} · {result.rate.toFixed(1)} Hz
          <div className="small">{result.axes.map((a) => `${a.axis.toUpperCase()} Ø ${a.mean_um.toFixed(0)} µm`).join("   ")}
            {result.replaced ? ` · ${t("ms.replaced", { file: result.replaced })}` : ""}</div>
          <PairResult pair={result.pair} second={result.second} />
        </div>
      )}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        {busy === "measure" && <button className="btn-plain" onClick={cancel}>{t("ms.cancel")}</button>}
        <button className="btn-plain" onClick={close}>{t("cm.close")}</button>
        <button className="btn-green" disabled={!ready} onClick={() => void doMeasure(false)}>
          {t("ms.measure", { trial: trial ? vlabel(trial.vno) : "" })}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ TDMS Inspector: free measurement */
type FreeSetup = { can_write: boolean; boxes: Box[]; box_error: ErrJson | null; sensors: Sensor[]; length: number;
  speed_range: [number, number]; length_range: [number, number]; manual_dir: string; default_distance_mm?: number };
export type FreeResult = Result & { name: string; next_name: string; series_id: number; size: number };
const FREE_PREF = "tripplet.sensorMeasure.free";
type FreePrefs = { name?: string; speed?: string };
const loadFree = (): FreePrefs => { try { return JSON.parse(localStorage.getItem(FREE_PREF) || "{}"); } catch { return {}; } };

/** "📏 Messen…" in the TDMS Inspector (Nutzerwunsch 2026-11-23): own name (e.g. 99999_34) and speed, no series and no
 *  database. The file goes to the _manual sub-folder of the DTY / ATY folder (never picked up by the automatic
 *  analysis); when it is saved the inspector opens it and the name counts up (99999_35). Server: /api/tdms-inspector/sensor */
export function FreeMeasureDialog({ onClose, onMeasured }: { onClose: () => void; onMeasured: (r: FreeResult) => void }) {
  const { t } = useI18n();
  const prefs = useRef(loadPrefs());
  const free = useRef(loadFree());
  const [setup, setSetup] = useState<FreeSetup | null>(null);
  const [box, setBox] = useState("");
  const [sensor, setSensor] = useState("");
  const [kind, setKind] = useState<"dty" | "aty">(prefs.current.kind ?? "dty");
  const [name, setName] = useState(free.current.name ?? "99999_1");
  const [speed, setSpeed] = useState(free.current.speed ?? "");
  const [length, setLength] = useState(String(prefs.current.length ?? 100));
  const [zero, setZero] = useState<Zero | null>(null);
  const [second, setSecond] = useState(prefs.current.second ?? "");
  const [distance, setDistance] = useState(prefs.current.distance ?? "");
  const [busy, setBusy] = useState<"" | "zero" | "measure">("");
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<FreeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);
  const jobId = useRef<string | null>(null);
  useEffect(() => () => { alive.current = false; }, []);

  const errMsg = (e: ErrJson | unknown): string => {
    const j: ErrJson | null = e instanceof ApiError ? { code: e.code ?? "", detail: e.message, vars: (e.data?.vars as ErrJson["vars"]) }
      : e && typeof e === "object" && "code" in e ? (e as ErrJson) : null;
    if (!j) return String(e);
    const k = `ms.err.${j.code}`;
    const v = t(k, { detail: j.detail, ...(j.vars ?? {}) });
    return v === k ? j.detail : v;
  };

  const load = async () => {
    try {
      const s = await request<FreeSetup>("GET", "/api/tdms-inspector/sensor/setup");
      if (!alive.current) return;
      setSetup(s);
      if (prefs.current.distance == null && s.default_distance_mm) setDistance(String(s.default_distance_mm));
      setBox((cur) => cur && s.boxes.some((b) => b.name === cur) ? cur
        : (s.boxes.find((b) => b.name === prefs.current.box) ?? s.boxes[0])?.name ?? "");
      setSensor((cur) => cur && s.sensors.some((x) => x.key === cur) ? cur
        : (s.sensors.find((x) => x.key === prefs.current.sensor) ?? s.sensors[0])?.key ?? "");
    } catch (e) { if (alive.current) setErr(errMsg(e)); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sens = setup?.sensors.find((x) => x.key === sensor);
  const sec = setup?.sensors.some((x) => x.key === second && sens && x.connector !== sens.connector && x.head !== sens.head) ? second : "";
  const num = (s: string) => Number(s.replace(",", "."));

  const doZero = async () => {
    setBusy("zero"); setErr(null);
    try {
      const z = await request<Zero>("POST", "/api/tdms-inspector/sensor/zero", { box, sensor, second: sec || undefined });
      if (alive.current) setZero(z);
    } catch (e) { if (alive.current) setErr(errMsg(e)); } finally { if (alive.current) setBusy(""); }
  };

  const doMeasure = async () => {
    if (!setup) return;
    const [lo, hi] = setup.speed_range;
    if (!name.trim()) { setErr(t("ms.err.bad_name", { name })); return; }
    if (!(num(speed) >= lo && num(speed) <= hi)) { setErr(t("ms.err.bad_speed", { lo, hi })); return; }
    if (!zero && !window.confirm(t("ms.noZeroAsk"))) return;
    prefs.current = { box, sensor, kind, length: num(length), second, distance };
    savePrefs(prefs.current);
    setBusy("measure"); setErr(null); setResult(null); setJob(null);
    try {
      const { job_id } = await request<{ job_id: string }>("POST", "/api/tdms-inspector/sensor/measure", {
        box, sensor, name: name.trim(), speed: num(speed), length: num(length), kind, zero,
        second: sec || undefined, distance: num(distance) > 0 ? num(distance) : undefined });
      jobId.current = job_id;
      for (;;) {
        await new Promise((res) => setTimeout(res, 400));
        if (!alive.current) return;
        const j = await request<Job>("GET", `/api/tdms-inspector/sensor/job/${job_id}`);
        if (!alive.current) return;
        setJob(j);
        if (j.finished) {
          if (j.error) setErr(errMsg(j.error));
          else if (j.result) {
            const r = j.result as FreeResult;
            setResult(r);
            setName(r.next_name);
            try { localStorage.setItem(FREE_PREF, JSON.stringify({ name: r.next_name, speed })); } catch { /* storage blocked */ }
            onMeasured(r);
          }
          break;
        }
      }
    } catch (e) { if (alive.current) setErr(errMsg(e)); } finally { jobId.current = null; if (alive.current) setBusy(""); }
  };

  const cancel = () => {
    if (jobId.current) void request("POST", `/api/tdms-inspector/sensor/job/${jobId.current}/cancel`).catch(() => undefined);
  };
  const close = () => { if (busy === "measure") { if (!window.confirm(t("ms.cancelAsk"))) return; cancel(); } onClose(); };
  const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const noBox = setup && !setup.boxes.length;
  const ready = !!setup?.can_write && !!box && !!sens && !busy;

  return (
    <Modal title={t("ms.freeTitle")} onClose={close}>
      <p className="muted small">{t("ms.freeIntro", { dir: setup?.manual_dir ?? "_manual" })}</p>
      {!setup && !err && <p className="muted">{t("app.loading")}</p>}
      {setup && (
        <div className="ms-form">
          <label>{t("ms.box")}</label>
          <div className="ms-row">
            {noBox ? <span className="ms-warn">{setup.box_error ? errMsg(setup.box_error) : t("ms.noBox")}</span> : (
              <select value={box} onChange={(e) => { setBox(e.target.value); setZero(null); }} disabled={!!busy}>
                {setup.boxes.map((b) => <option key={b.name} value={b.name}>{b.name} – {b.product} ({t("ms.serial")} {b.serial})</option>)}
              </select>)}
            <button className="btn-plain" title={t("ms.rescan")} onClick={() => void load()} disabled={!!busy}>↻</button>
          </div>
          <label>{t("ms.sensor")}</label>
          {setup.sensors.length ? (
            <select value={sensor} onChange={(e) => { setSensor(e.target.value); setZero(null); }} disabled={!!busy}
              title={sens ? `${sens.title} – ${t("ms.calibrated")} ${sens.date}` : undefined}>
              {setup.sensors.map((x) => <option key={x.key} value={x.key}>
                {headLabel(x.head)} · {t(x.axes === 2 ? "ms.axes2" : "ms.axes1")} · {x.connector}</option>)}
            </select>) : <span className="ms-warn">{t("ms.noSensor")}</span>}
          <label>{t("ms.folder")}</label>
          <div className="ms-row jr-seg">
            {(["dty", "aty"] as const).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} disabled={!!busy} onClick={() => setKind(k)}>{k.toUpperCase()}</button>))}
          </div>

          <SecondFields sensors={setup.sensors} main={sens} second={second} setSecond={(v) => { setSecond(v); setZero(null); }}
            distance={distance} setDistance={setDistance} busy={!!busy} />

          <div className="ms-step">
            <button className="btn-plain" disabled={!box || !sens || !!busy || !setup.can_write} onClick={doZero}>
              {busy === "zero" ? t("ms.zeroBusy") : t("ms.zero")}</button>
            <span className="small">{zero ? zeroText(zero)
              : <span className="muted">{t("ms.zeroHint")}</span>}</span>
          </div>

          <label>{t("ms.name")}</label>
          <div className="ms-row"><input type="text" className="ms-name" value={name} disabled={!!busy} maxLength={60}
            onChange={(e) => setName(e.target.value)} /> <span className="muted small">{t("ms.nameHint")}</span></div>
          <label>{t("ms.speed")}</label>
          <div className="ms-row"><input type="text" inputMode="decimal" value={speed} disabled={!!busy}
            onChange={(e) => setSpeed(e.target.value)} /> <span>m/min</span></div>
          <label>{t("ms.length")}</label>
          <div className="ms-row"><input type="text" inputMode="decimal" value={length} disabled={!!busy}
            onChange={(e) => setLength(e.target.value)} /> <span>m</span></div>
        </div>
      )}
      {!setup?.can_write && setup && <p className="ms-warn">{t("tl.writeNeeded")}</p>}
      {busy === "measure" && (
        <div className="imp-progress" role="status" aria-live="polite">
          <div className={"imp-bar" + (job && job.total > 0 ? "" : " indet")} role="progressbar" aria-valuemin={0}
            aria-valuemax={100} aria-valuenow={job && job.total > 0 ? pct : undefined}>
            <div className="imp-fill" style={job && job.total > 0 ? { width: `${Math.max(pct, 3)}%` } : undefined} />
          </div>
          <div className="imp-lines small"><span><b>{job && job.total > 0 ? `${pct} %` : ""}</b> {t("ms.measuring", { trial: name.trim() })}</span></div>
        </div>
      )}
      {result && (
        <div className="rq-ok">
          <b>{t("ms.saved")}</b> {result.file} – {result.points.toLocaleString("de-CH")} {t("ms.points")} · {result.rate.toFixed(1)} Hz
          <div className="small">{result.axes.map((a) => `${a.axis.toUpperCase()} Ø ${a.mean_um.toFixed(0)} µm`).join("   ")} · {t("ms.opened")}</div>
          <PairResult pair={result.pair} second={result.second} />
        </div>
      )}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        {busy === "measure" && <button className="btn-plain" onClick={cancel}>{t("ms.cancel")}</button>}
        <button className="btn-plain" onClick={close}>{t("cm.close")}</button>
        <button className="btn-green" disabled={!ready} onClick={() => void doMeasure()}>
          {t("ms.measure", { trial: name.trim() || "…" })}</button>
      </div>
    </Modal>
  );
}
