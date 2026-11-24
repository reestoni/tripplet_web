import { useEffect, useMemo, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Plot } from "../components/YarnScopeView";
import { Modal } from "../components/SeriesTools";
import { useKeptZero, ZeroInfo, type Kept, type Zero } from "../components/SensorMeasure";

/* YarnScope Live (Nutzerwunsch 2026-11-23; desktop ui/widgets/sensor_live_window.py): continuous measurement with a
   small dashboard - start / stop by hand, every 30 m knots/m + CV per sensor and, with a second sensor + the distance,
   the measured speed. Optionally saved to the _manual folder while it runs. Server: backend/app/sensor_live_api.py on
   ui/yarnscope/sensor_live.py (desktop repo); the server talks to the box, so it must run on the laptop with the box.
   Bookmarks (Nutzerwunsch 2026-11-24): "Merken" keeps the last N m (default 100) on the server, no input while tuning;
   on a bookmark "Versuch anlegen" copies a template trial with jet / pressure / OF / speed and, only if ticked, saves
   the bookmark as that trial's TDMS (ui/yarnscope/live_trial.py); "Als Datei" writes it to _manual. */

type Box = { name: string; product: string; serial: string };
type Sensor = { key: string; head: string; connector: string; axes: number; title: string; date: string };
type ErrJson = { code: string; detail: string; vars?: Record<string, string | number> };
type Setup = { can_write: boolean; boxes: Box[]; box_error: ErrJson | null; sensors: Sensor[]; window_m: number;
  window_range: [number, number]; speed_range: [number, number]; manual_dir: string; save_limit_m: number; running: boolean; default_distance_mm?: number;
  zeros?: Kept[] };
type SensorRow = { fpm: number | null; cv: number | null; mean_um: number | null;
  /** thickness minus the empty value (2026-11-24): whole window, open (bulky) parts, knots - null without an empty value */
  d_um?: number | null; d_bulk?: number | null; d_knot?: number | null };
type Row = { i: number; from_m: number; to_m: number; t: number; sensors: SensorRow[]; corr?: number | null;
  delay_ms?: number | null; speed?: number | null; distance_from_speed_mm?: number | null };
type Bookmark = { id: number; at: string; at_m: number; length_m: number; speed: number | null; sensors: SensorRow[];
  label: string; trial: { series_id: number; vno: number; trial_id: number } | null; file: string | null };
type View = { state: string; error: ErrJson | null; rows: Row[]; n_rows: number; meters?: number; seconds?: number;
  speed?: number; window_m?: number; rate?: number; sensors?: { head: string; connector: string; axes: number }[];
  distance_mm?: number | null; save?: boolean; save_stopped?: boolean; files?: string[]; name?: string; user?: string;
  bookmarks?: Bookmark[]; bookmark_range?: [number, number]; bookmark_m?: number };
type Recent = { series: number; eid: string; name: string };
type TField = { key: string; label: string; rule: string | null; choices: [number, string][] | null };
type TVal = { na?: boolean; v?: number | string | null; text?: string };
type TSetup = { recent: Recent[]; series?: { id: number; name: string; eid: string }; next_no?: number; default?: number | null;
  trials?: { id: number; vno: number }[]; fields?: TField[]; source?: Record<string, Record<string, TVal>> };
type TResult = { trial_id: number; vno: number; series_id: number; file: string | null; replaced: string | null; tdms_error: string | null };

const PREF = "tripplet.yarnscopeLive";
type Prefs = { box?: string; sensor?: string; second?: string; distance?: string; speed?: string; window?: string;
  save?: boolean; name?: string; kind?: "dty" | "aty"; auto?: boolean; bmLen?: string; bmName?: string; bmSeries?: string };
const loadPrefs = (): Prefs => { try { return JSON.parse(localStorage.getItem(PREF) || "{}"); } catch { return {}; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* storage blocked */ } };
const headLabel = (h: string) => { const p = h.split("_"); return p.length >= 3 ? `${p[0]} ${p[1]}-${p[2]}` : h; };
const fmt = (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toFixed(d));
const num = (s: string) => Number(String(s).replace(",", "."));
const COLORS = ["#1d983a", "#2a78d6"];
const vlabel = (vno: number) => `V${String(vno).padStart(3, "0")}`;

export default function YarnScopeLive() {
  const { t } = useI18n();
  const prefs = useRef(loadPrefs());
  const [setup, setSetup] = useState<Setup | null>(null);
  const [box, setBox] = useState("");
  const [sensor, setSensor] = useState("");
  const [second, setSecond] = useState(prefs.current.second ?? "");
  const [distance, setDistance] = useState(prefs.current.distance ?? "");
  const [speed, setSpeed] = useState(prefs.current.speed ?? "");
  const [win, setWin] = useState(prefs.current.window ?? "30");
  const [save, setSave] = useState(prefs.current.save ?? true);
  const [name, setName] = useState(prefs.current.name ?? "99999_live");
  const [kind, setKind] = useState<"dty" | "aty">(prefs.current.kind ?? "dty");
  const [auto, setAuto] = useState(prefs.current.auto ?? true);
  const [view, setView] = useState<View | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bmLen, setBmLen] = useState(prefs.current.bmLen ?? "100");
  const [bmSel, setBmSel] = useState<number | null>(null);
  const [bmMsg, setBmMsg] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ kind: "trial"; bm: Bookmark | null } | { kind: "file"; bm: Bookmark } | null>(null);
  const [big, setBig] = useState<number | null>(null);      // chart shown at full size (2026-11-24)
  useEffect(() => {
    if (big == null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [big]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const errMsg = (e: ErrJson | unknown): string => {
    const j: ErrJson | null = e instanceof ApiError ? { code: e.code ?? "", detail: e.message, vars: (e.data?.vars as ErrJson["vars"]) }
      : e && typeof e === "object" && "code" in e ? (e as ErrJson) : null;
    if (!j) return String(e);
    for (const k of [`yl.err.${j.code}`, `ms.err.${j.code}`]) {
      const v = t(k, { detail: j.detail, ...(j.vars ?? {}) });
      if (v !== k) return v;
    }
    return j.detail;
  };

  const loadSetup = async () => {
    try {
      const s = await request<Setup>("GET", "/api/yarnscope-live/setup");
      if (!alive.current) return;
      setSetup(s);
      if (prefs.current.distance == null && s.default_distance_mm) setDistance(String(s.default_distance_mm));
      setBox((cur) => cur && s.boxes.some((b) => b.name === cur) ? cur : (s.boxes.find((b) => b.name === prefs.current.box) ?? s.boxes[0])?.name ?? "");
      setSensor((cur) => cur && s.sensors.some((x) => x.key === cur) ? cur : (s.sensors.find((x) => x.key === prefs.current.sensor) ?? s.sensors[0])?.key ?? "");
    } catch (e) { if (alive.current) setErr(errMsg(e)); }
  };
  useEffect(() => { void loadSetup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // poll the running session (also one started from another tab / by the desktop of the same server)
  const running = view?.state === "running" || view?.state === "stopping";
  const nRows = useRef(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const v = await request<View>("GET", `/api/yarnscope-live/state?since=${nRows.current}`);
        if (stop || !alive.current) return;
        if (v.state === "none") { setView(null); return; }
        setView(v);
        if (v.rows.length) {
          setRows((cur) => {
            const known = new Set(cur.map((r) => r.i));
            const next = [...cur, ...v.rows.filter((r) => !known.has(r.i))];
            nRows.current = next.length ? next[next.length - 1].i + 1 : 0;
            return next;
          });
        }
      } catch { /* next tick */ }
    };
    void tick();
    const id = window.setInterval(() => void tick(), running || busy ? 1000 : 5000);
    return () => { stop = true; window.clearInterval(id); };
  }, [running, busy]);

  const sens = setup?.sensors.find((x) => x.key === sensor);
  const others = (setup?.sensors ?? []).filter((x) => sens && x.connector !== sens.connector && x.head !== sens.head);
  const sec = others.some((x) => x.key === second) ? second : "";
  const autoOn = auto && !!sec && num(distance) > 0;       // TrippleT measures the speed itself
  // empty value before the start (2026-11-24) - the same remembered value as the measure window
  const [zero, storeZero] = useKeptZero(setup?.zeros, box, sens as never, setup?.sensors.find((x) => x.key === sec) as never);
  const [zeroBusy, setZeroBusy] = useState(false);
  const doZero = async () => {
    setZeroBusy(true); setErr(null);
    try { storeZero(await request<Zero>("POST", "/api/yarnscope-live/zero", { box, sensor, second: sec || undefined })); }
    catch (e) { setErr(errMsg(e)); } finally { setZeroBusy(false); }
  };

  const start = async () => {
    if (!setup) return;
    const [lo, hi] = setup.speed_range;
    if (!autoOn && !(num(speed) >= lo && num(speed) <= hi)) { setErr(t("ms.err.bad_speed", { lo, hi })); return; }
    if (!zero && !window.confirm(t("yl.noZeroAsk"))) return;
    prefs.current = { box, sensor, second, distance, speed, window: win, save, name, kind, auto };
    savePrefs(prefs.current);
    setBusy(true); setErr(null);
    try {
      const v = await request<View>("POST", "/api/yarnscope-live/start", { box, sensor, second: sec || undefined,
        speed: autoOn ? undefined : num(speed), auto_speed: autoOn, distance: num(distance) > 0 ? num(distance) : undefined,
        window: num(win) || 30, save, name: name.trim(), kind });
      nRows.current = 0;
      setRows([]);
      setView(v);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const bookmarks = view?.bookmarks ?? [];
  const refresh = async () => {
    try { const v = await request<View>("GET", `/api/yarnscope-live/state?since=${nRows.current}`); if (alive.current && v.state !== "none") setView(v); } catch { /* next tick */ }
  };
  const mark = async () => {
    prefs.current = { ...prefs.current, bmLen };
    savePrefs(prefs.current);
    setErr(null);
    try {
      const b = await request<Bookmark>("POST", "/api/yarnscope-live/bookmark", { length: num(bmLen) || undefined });
      setBmMsg(t("yl.marked", { id: b.id, len: b.length_m.toFixed(0) }));
      setBmSel(b.id);
      await refresh();
    } catch (e) { setErr(errMsg(e)); }
  };
  const unmark = async (b: Bookmark) => {
    try { await request("DELETE", `/api/yarnscope-live/bookmark/${b.id}`); if (bmSel === b.id) setBmSel(null); await refresh(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const stopIt = async () => {
    setBusy(true);
    try { setView(await request<View>("POST", "/api/yarnscope-live/stop")); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const two = (view?.sensors?.length ?? 0) > 1;
  const last = rows[rows.length - 1];
  const x = rows.map((r) => r.to_m);
  const charts = useMemo(() => {
    const line = (y: (number | null | undefined)[], i: number, nm: string) =>
      ({ type: "scatter", mode: "lines+markers", x, y, name: nm, line: { color: COLORS[i], width: 2 }, marker: { size: 5 } });
    // y axis with a MINIMUM span around the values, so 0.5 knots more does not look like a jump (user 2026-11-23):
    // knots/m at least +-10 % of the mean, CV at least 0..40 %, speed at least +-3 %
    const range = (vals: (number | null | undefined)[], rel: number, floor?: [number, number]): [number, number] | undefined => {
      const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
      if (!v.length) return floor;
      let lo = Math.min(...v), hi = Math.max(...v);
      if (floor) { lo = Math.min(lo, floor[0]); hi = Math.max(hi, floor[1]); }
      const mid = (lo + hi) / 2, half = Math.max((hi - lo) / 2 * 1.15, Math.abs(v.reduce((a, b) => a + b, 0) / v.length) * rel);
      return [floor ? Math.max(floor[0], mid - half) : mid - half, mid + half];
    };
    const shapes = (view?.bookmarks ?? []).map((b) => ({ type: "line", x0: b.at_m, x1: b.at_m, yref: "paper", y0: 0, y1: 1,
      line: { color: "#e0a100", width: 2, dash: "dot" } }));
    const notes = (view?.bookmarks ?? []).map((b) => ({ x: b.at_m, y: 1, yref: "paper", text: `📌${b.id}`, showarrow: false,
      font: { size: 10 }, yanchor: "bottom" }));
    const lay = (title: string, yr?: [number, number]) => ({ margin: { l: 46, r: 8, t: 30, b: 34 },
      title: { text: title, font: { size: 12 }, y: 0.97 }, showlegend: two, legend: { orientation: "h", y: -0.28, font: { size: 10 } },
      xaxis: { title: { text: "m", standoff: 2 } }, yaxis: yr ? { range: yr } : {}, shapes, annotations: notes });
    const names = (view?.sensors ?? []).map((s) => `${headLabel(s.head)} ${s.connector}`);
    const fpm = rows.flatMap((r) => r.sensors.map((s) => s.fpm));
    const cv = rows.flatMap((r) => r.sensors.map((s) => s.cv));
    const sp = rows.map((r) => r.speed ?? null);
    const dv = rows.flatMap((r) => r.sensors.flatMap((s) => [s.d_bulk, s.d_knot]));
    const hasD = dv.some((v) => v != null);
    const dline = (y: (number | null | undefined)[], i: number, nm: string, dash: boolean) =>
      ({ ...line(y, i, nm), line: { color: COLORS[i], width: 2, dash: dash ? "dot" : "solid" } });
    return [
      { data: names.map((nm, i) => line(rows.map((r) => r.sensors[i]?.fpm), i, nm)), layout: lay(t("yl.fpm"), range(fpm, 0.10)) },
      { data: names.map((nm, i) => line(rows.map((r) => r.sensors[i]?.cv), i, nm)), layout: lay(t("yl.cv"), range(cv, 0, [0, 40])) },
      ...(two ? [{ data: [line(sp, 0, "m/min")], layout: { ...lay(t("yl.speed"), range(sp, 0.03)), showlegend: false } }] : []),
      // thickness: open (bulky) parts solid, knots dotted, per sensor (2026-11-24)
      ...(hasD ? [{ data: names.flatMap((nm, i) => [dline(rows.map((r) => r.sensors[i]?.d_bulk), i, `${nm} ${t("yl.bulk")}`, false),
        dline(rows.map((r) => r.sensors[i]?.d_knot), i, `${nm} ${t("yl.knot")}`, true)]),
        layout: { ...lay(`${t("yl.thick")} µm`, range(dv, 0.05)), showlegend: true } }] : []),
    ];
  }, [rows, view?.sensors, view?.bookmarks, two, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = running || busy;
  return (
    <div className="page yl-page">
      <div className="page-head"><h1>{t("nav./tools/yarnscope-live")}</h1></div>
      <p className="muted">{t("yl.info")}</p>
      <div className="yl-grid">
        <div className="card yl-form">
          {!setup && !err && <p className="muted">{t("app.loading")}</p>}
          {setup && (<div className="ms-form">
            <label>{t("ms.box")}</label>
            <div className="ms-row">
              {!setup.boxes.length ? <span className="ms-warn">{setup.box_error ? errMsg(setup.box_error) : t("ms.noBox")}</span> : (
                <select value={box} onChange={(e) => setBox(e.target.value)} disabled={lock}>
                  {setup.boxes.map((b) => <option key={b.name} value={b.name}>{b.name} – {b.product} ({t("ms.serial")} {b.serial})</option>)}
                </select>)}
              <button className="btn-plain" title={t("ms.rescan")} onClick={() => void loadSetup()} disabled={lock}>↻</button>
            </div>
            <label>{t("ms.sensor")}</label>
            <select value={sensor} onChange={(e) => setSensor(e.target.value)} disabled={lock}>
              {setup.sensors.map((s) => <option key={s.key} value={s.key}>{headLabel(s.head)} · {t(s.axes === 2 ? "ms.axes2" : "ms.axes1")} · {s.connector}</option>)}
            </select>
            <label>{t("ms.second")}</label>
            <select value={sec} onChange={(e) => setSecond(e.target.value)} disabled={lock || !others.length}>
              <option value="">{t("ms.secondNone")}</option>
              {others.map((s) => <option key={s.key} value={s.key}>{headLabel(s.head)} · {t(s.axes === 2 ? "ms.axes2" : "ms.axes1")} · {s.connector}</option>)}
            </select>
            {sec && (<><label>{t("ms.distance")}</label>
              <div className="ms-row"><input type="text" inputMode="decimal" value={distance} disabled={lock} placeholder="–"
                onChange={(e) => setDistance(e.target.value)} /> <span>mm</span></div></>)}
            {sec && num(distance) > 0 && (<><label>{t("yl.auto")}</label>
              <div className="ms-row"><input type="checkbox" checked={auto} disabled={lock} onChange={(e) => setAuto(e.target.checked)} />
                <span className="muted small">{t("yl.autoHint")}</span></div></>)}
            <label>{t("ms.speed")}</label>
            <div className="ms-row"><input type="text" inputMode="decimal" value={autoOn ? "" : speed} placeholder={autoOn ? t("yl.autoPh") : ""}
              disabled={lock || autoOn} onChange={(e) => setSpeed(e.target.value)} /> <span>m/min</span></div>
            <label>{t("yl.window")}</label>
            <div className="ms-row"><input type="text" inputMode="decimal" value={win} disabled={lock} onChange={(e) => setWin(e.target.value)} /> <span>m</span></div>
            <label>{t("yl.save")}</label>
            <div className="ms-row"><input type="checkbox" checked={save} disabled={lock} onChange={(e) => setSave(e.target.checked)} />
              {save && <><input type="text" className="ms-name" value={name} disabled={lock} maxLength={60} onChange={(e) => setName(e.target.value)} />
                <span className="jr-seg">{(["dty", "aty"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} disabled={lock} onClick={() => setKind(k)}>{k.toUpperCase()}</button>)}</span></>}
            </div>
          </div>)}
          {save && setup && <p className="muted small">{t("yl.saveHint", { dir: setup.manual_dir, max: setup.save_limit_m })}</p>}
          {setup && (<div className="ms-step">
            <button className="btn-plain" disabled={!box || !sens || lock || zeroBusy || !setup.can_write} onClick={() => void doZero()}>
              {zeroBusy ? t("ms.zeroBusy") : t(zero ? "ms.zeroAgain" : "ms.zero")}</button>
            <ZeroInfo zero={zero} />
          </div>)}
          <div className="modal-buttons">
            {!running ? <button className="btn-green" disabled={!setup?.can_write || !box || !sens || busy} onClick={() => void start()}>▶ {t("yl.start")}</button>
              : <button className="btn-red" disabled={busy || view?.state === "stopping"} onClick={() => void stopIt()}>■ {t("yl.stop")}</button>}
          </div>
          {setup && !setup.can_write && <p className="ms-warn">{t("tl.writeNeeded")}</p>}
          {err && <div className="login-error">{err}</div>}
          {view?.error && <div className="login-error">{errMsg(view.error)}</div>}
        </div>

        <div className="yl-dash">
          <div className="yl-status small">
            {view ? <>
              <b>{t(`yl.state.${view.state}`)}</b> · {fmt(view.meters, 0)} m · {fmt(view.seconds, 0)} s · {fmt(view.rate, 1)} Hz
              {view.user ? ` · ${view.user}` : ""}
              {view.save_stopped && <span className="ms-warn"> · {t("yl.saveStopped")}</span>}
              {!!view.files?.length && <div>{t("yl.saved", { files: view.files.join(", ") })}</div>}
            </> : <span className="muted">{t("yl.idle")}</span>}
          </div>
          <div className="yl-tiles">
            {(view?.sensors ?? []).map((s, i) => [
              <div key={s.connector + "f"} className="yl-tile" style={{ borderColor: COLORS[i] }}>
                <div className="yl-tile-h">{headLabel(s.head)} · {s.connector} · {t("yl.fpm")}</div>
                <div className="yl-big">{fmt(last?.sensors[i]?.fpm, 1)}<span> {t("yl.fpmUnit")}</span></div>
              </div>,
              // CV is important for the user (2026-11-24): its own card, as large as knots/m
              <div key={s.connector + "c"} className="yl-tile" style={{ borderColor: COLORS[i] }}>
                <div className="yl-tile-h">{headLabel(s.head)} · {s.connector} · {t("yl.cv")}</div>
                <div className="yl-big">{fmt(last?.sensors[i]?.cv, 1)}<span> %</span></div>
              </div>,
              <div key={s.connector + "d"} className="yl-tile" style={{ borderColor: COLORS[i] }} title={t("yl.thickNote")}>
                <div className="yl-tile-h">{headLabel(s.head)} · {s.connector} · {t("yl.thick")}</div>
                {last?.sensors[i]?.d_um != null ? (<>
                  <div className="yl-big">{fmt(last.sensors[i].d_um, 0)}<span> µm</span></div>
                  <div className="small">{t("yl.bulk")} {fmt(last.sensors[i].d_bulk, 0)} · {t("yl.knot")} {fmt(last.sensors[i].d_knot, 0)} µm</div>
                </>) : <div className="small muted">{rows.length ? t("yl.thickNoZero") : "–"}</div>}
              </div>])}
            {two && (<div className="yl-tile">
              <div className="yl-tile-h">{t("yl.speed")}</div>
              <div className="yl-big">{fmt(last?.speed, 1)}<span> m/min</span></div>
              <div className="small muted">{last?.delay_ms != null ? `${t("ms.pairDelay", { ms: last.delay_ms.toFixed(3) })} · ${t("ms.pairCorr", { c: last.corr ?? "–" })}` : t("yl.noMatch")}
                {last?.speed == null && last?.distance_from_speed_mm != null ? ` · ${t("ms.pairDistance", { mm: last.distance_from_speed_mm.toFixed(1) })}` : ""}</div>
            </div>)}
          </div>
          {setup && (
            <div className="yl-marks card">
              <div className="yl-markbar">
                <button className="btn-green" disabled={!setup?.can_write || !(running || view?.state === "done")} onClick={() => void mark()}
                  title={t("yl.markTip")}>📌 {t("yl.mark")}</button>
                <span className="small">{t("yl.markLast")}</span>
                <input type="text" inputMode="decimal" className="yl-marklen" value={bmLen} onChange={(e) => setBmLen(e.target.value)}
                  aria-label={t("yl.markLen")} /> <span className="small">m</span>
                {bmMsg && <span className="small muted">{bmMsg}</span>}
                {/* a trial without a bookmark - never a TDMS (Nutzerwunsch 2026-11-24) */}
                <button className="btn-plain yl-newtrial" disabled={!setup?.can_write} title={t("yl.newTrialTip")}
                  onClick={() => setDlg({ kind: "trial", bm: null })}>{t("yl.newTrial")}</button>
              </div>
              {!bookmarks.length ? <p className="muted small">{t("yl.bmNone")}</p> : (
                <div className="yl-table-wrap"><table className="yl-table yl-bmtable">
                  <thead><tr><th>#</th><th>{t("yl.bmTime")}</th><th>{t("yl.bmAt")}</th><th>{t("yl.bmLen")}</th><th>{t("yl.fpmUnit")}</th>
                    <th>CV %</th><th>m/min</th><th>{t("yl.bmResult")}</th><th /></tr></thead>
                  <tbody>{bookmarks.map((b) => (
                    <tr key={b.id} className={bmSel === b.id ? "on" : ""} onClick={() => setBmSel(b.id)}>
                      <td>📌{b.id}{b.label ? ` ${b.label}` : ""}</td><td>{b.at.slice(11, 16)}</td><td>{fmt(b.at_m, 0)}</td><td>{fmt(b.length_m, 0)} m</td>
                      <td>{fmt(b.sensors[0]?.fpm, 1)}</td><td>{fmt(b.sensors[0]?.cv, 1)}</td><td>{fmt(b.speed, 1)}</td>
                      <td className="small">{b.trial ? `${b.trial.series_id} ${vlabel(b.trial.vno)}` : ""}{b.file ? ` · ${b.file}` : ""}</td>
                      <td className="yl-bmact">
                        <button className="btn-plain" disabled={!setup?.can_write} onClick={(e) => { e.stopPropagation(); setDlg({ kind: "trial", bm: b }); }}>{t("yl.bmTrial")}</button>
                        <button className="btn-plain" disabled={!setup?.can_write} onClick={(e) => { e.stopPropagation(); setDlg({ kind: "file", bm: b }); }}>{t("yl.bmFile")}</button>
                        <button className="btn-plain" title={t("yl.bmDelete")} aria-label={t("yl.bmDelete")} onClick={(e) => { e.stopPropagation(); void unmark(b); }}>✕</button>
                      </td></tr>))}</tbody>
                </table></div>)}
            </div>)}
          {rows.length > 0 && <div className="yl-charts">{charts.map((c, i) => (
            <div key={i} className="yl-chart">
              <button className="yl-chart-max" title={t("yl.enlarge")} aria-label={t("yl.enlarge")} onClick={() => setBig(i)}>⤢</button>
              <Plot data={c.data} layout={c.layout} />
            </div>))}</div>}
          {big != null && charts[big] && (
            <div className="yl-bigchart" role="dialog" aria-modal="true">
              <div className="yl-bigchart-bar">
                <b>{String((charts[big].layout as { title?: { text?: string } }).title?.text ?? "")}</b>
                <button className="btn-plain" onClick={() => setBig(null)}>✕ {t("yl.shrink")}</button>
              </div>
              <div className="yl-bigchart-plot"><Plot data={charts[big].data}
                layout={{ ...charts[big].layout, title: undefined, margin: { l: 60, r: 20, t: 20, b: 50 } }} /></div>
            </div>)}
          {rows.length > 0 && (
            <div className="yl-table-wrap"><table className="yl-table">
              <thead><tr><th>m</th>{(view?.sensors ?? []).map((s) => <th key={s.connector} colSpan={5}>{headLabel(s.head)} {s.connector}</th>)}
                {two && <th>{t("yl.speed")}</th>}{two && <th>{t("yl.match")}</th>}</tr>
                <tr><th />{(view?.sensors ?? []).map((s) => [<th key={s.connector + "f"}>{t("yl.fpmUnit")}</th>, <th key={s.connector + "c"}>CV %</th>,
                  <th key={s.connector + "d"}>{t("yl.thick")} µm</th>, <th key={s.connector + "b"}>{t("yl.bulk")}</th>, <th key={s.connector + "k"}>{t("yl.knot")}</th>])}
                  {two && <th>m/min</th>}{two && <th />}</tr></thead>
              <tbody>{[...rows].reverse().map((r) => (
                <tr key={r.i}><td>{r.from_m}–{r.to_m}</td>
                  {r.sensors.map((s, i) => [<td key={i + "f"}>{fmt(s.fpm, 1)}</td>, <td key={i + "c"}>{fmt(s.cv, 1)}</td>,
                    <td key={i + "d"}>{fmt(s.d_um, 0)}</td>, <td key={i + "b"}>{fmt(s.d_bulk, 0)}</td>, <td key={i + "k"}>{fmt(s.d_knot, 0)}</td>])}
                  {two && <td>{fmt(r.speed, 1)}</td>}{two && <td>{fmt(r.corr, 2)}</td>}</tr>))}</tbody>
            </table></div>)}
        </div>
      </div>
      {dlg?.kind === "trial" && <LiveTrialDialog bm={dlg.bm} bookmarks={bookmarks} prefs={prefs} errMsg={errMsg} onClose={() => setDlg(null)}
        onDone={(msg) => { setDlg(null); setBmMsg(msg); void refresh(); }} />}
      {dlg?.kind === "file" && <BookmarkFileDialog bm={dlg.bm} prefs={prefs} errMsg={errMsg} onClose={() => setDlg(null)}
        onDone={(msg) => { setDlg(null); setBmMsg(msg); void refresh(); }} />}
    </div>
  );
}

/** "Versuche anlegen": series (recent or typed), template trial (default: highest number) and one COLUMN per new trial
 *  (Nutzerwunsch 2026-11-24: e.g. jet plate 1 and plate 2 at once) with the copy fields shown by default, filled from the
 *  template; "+ Versuch" copies the last column. Per column optionally a bookmark as that trial's TDMS (each bookmark once).
 *  Only changed values are sent; the server checks everything before the first copy (live_trial.create_many). */
type TCol = { vals: Record<string, string>; bm: number | null };
function LiveTrialDialog({ bm, bookmarks, prefs, errMsg, onClose, onDone }: {
  bm: Bookmark | null; bookmarks: Bookmark[]; prefs: { current: Prefs }; errMsg: (e: unknown) => string;
  onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [series, setSeries] = useState(prefs.current.bmSeries ?? "");
  const [st, setSt] = useState<TSetup | null>(null);
  const [tpl, setTpl] = useState<number | null>(null);
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<TCol[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = (s: TSetup, id: number | null) => {
    const src = id != null ? s.source?.[String(id)] ?? {} : {};
    const o: Record<string, string> = {};
    for (const f of s.fields ?? []) {
      const v = src[f.key];
      if (!v || v.na) continue;
      o[f.key] = f.choices ? (v.v == null ? "" : String(v.v)) : (v.text ?? "");
    }
    setOrig(o);
    setCols((cur) => (cur.length ? cur : [{ vals: {}, bm: null }]).map((c) => ({ ...c, vals: { ...o } })));
  };
  const load = async (sid?: string) => {
    const want = (sid ?? series).trim();
    setErr(null);
    try {
      const s = await request<TSetup>("GET", `/api/yarnscope-live/trial-setup${/^\d+$/.test(want) ? `?series=${want}` : ""}`);
      setSt(s);
      if (s.series) {
        const id = s.default ?? null;
        setTpl(id); fill(s, id);
        prefs.current = { ...prefs.current, bmSeries: String(s.series.id) };
        savePrefs(prefs.current);
      }
    } catch (e) { setErr(errMsg(e)); setSt((cur) => cur ? { recent: cur.recent } : null); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changedOf = (c: TCol) => Object.fromEntries(Object.entries(c.vals).filter(([k, v]) => v.trim() !== (orig[k] ?? ""))
    .map(([k, v]) => [k, v.trim()]));
  const setVal = (ci: number, key: string, v: string) => setCols((cur) => cur.map((c, i) => i === ci ? { ...c, vals: { ...c.vals, [key]: v } } : c));
  const setBm = (ci: number, v: number | null) => setCols((cur) => cur.map((c, i) => i === ci ? { ...c, bm: v } : c));
  const addCol = () => setCols((cur) => [...cur, { vals: { ...(cur[cur.length - 1]?.vals ?? orig) }, bm: null }]);
  const removeCol = (ci: number) => setCols((cur) => cur.length > 1 ? cur.filter((_c, i) => i !== ci) : cur);
  const next = st?.next_no ?? 1;
  const names = cols.map((_c, i) => vlabel(next + i));

  const create = async () => {
    if (!st?.series || tpl == null || !cols.length) return;
    setBusy(true); setErr(null);
    try {
      const r = await request<{ trials: TResult[] }>("POST", "/api/yarnscope-live/trials",
        { series_id: st.series.id, template_id: tpl, items: cols.map((c) => ({ values: changedOf(c), bookmark: c.bm })) });
      const parts = r.trials.map((x) => `${x.series_id} ${vlabel(x.vno)}` + (x.file ? ` (${x.file}${x.replaced ? ", " + t("yl.replaced", { dir: "_replaced" }) : ""})` : "")
        + (x.tdms_error ? ` – ${t("yl.tdmsFailed", { detail: x.tdms_error })}` : ""));
      onDone(t("yl.createdMany", { list: parts.join(", ") }));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const s0 = bm?.sensors[0];
  const fields = (st?.fields ?? []).filter((f) => f.key in orig);
  const bmLabel = (b: Bookmark) => `📌${b.id}${b.label ? " " + b.label : ""} · ${fmt(b.length_m, 0)} m · ${fmt(b.sensors[0]?.fpm, 1)} ${t("yl.fpmUnit")}`;
  return (
    <Modal title={bm ? t("yl.trialTitle", { id: bm.id }) : t("yl.trialTitleFree")} onClose={onClose} wide>
      <p className="muted small">{bm ? t("yl.trialInfo", { len: fmt(bm.length_m, 0), m: fmt(bm.at_m, 0), fpm: fmt(s0?.fpm, 1), cv: fmt(s0?.cv, 1), speed: fmt(bm.speed, 1) })
        : t("yl.trialInfoFree")}</p>
      <div className="ms-form">
        <label htmlFor="yl-series">{t("yl.series")}</label>
        <div className="ms-row">
          <input id="yl-series" type="text" inputMode="numeric" list="yl-recent" value={series} placeholder={t("yl.seriesPh")}
            onChange={(e) => setSeries(e.target.value.split(" ")[0])} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} />
          <datalist id="yl-recent">{(st?.recent ?? []).map((r) => <option key={r.series} value={String(r.series)}>{`${r.eid} ${r.name}`}</option>)}</datalist>
          <button className="btn-plain" onClick={() => void load()}>{t("yl.load")}</button>
        </div>
        {st?.series && (<>
          <label />
          <span className="small muted">{st.series.eid} · {st.series.name}</span>
          <label htmlFor="yl-tpl">{t("yl.template")}</label>
          {st.trials?.length ? (
            <select id="yl-tpl" value={tpl ?? ""} onChange={(e) => { const id = Number(e.target.value); setTpl(id); fill(st, id); }}>
              {st.trials.map((x) => <option key={x.id} value={x.id}>{vlabel(x.vno)}</option>)}
            </select>) : <span className="ms-warn">{t("yl.noTemplate")}</span>}
        </>)}
      </div>
      {st?.series && !!st.trials?.length && (
        <div className="yl-cols-wrap">
          <table className="yl-cols">
            <thead><tr><th />{names.map((nm, ci) => (
              <th key={ci}>{nm}{cols.length > 1 && <button className="yl-colx" title={t("yl.removeTrial")} aria-label={t("yl.removeTrial")}
                onClick={() => removeCol(ci)}>✕</button>}</th>))}
              <th><button className="btn-plain" onClick={addCol} disabled={cols.length >= 20}>{t("yl.addTrial")}</button></th></tr></thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key}><th>{f.label}</th>{cols.map((c, ci) => {
                  const v = c.vals[f.key] ?? "";
                  const cls = v.trim() !== (orig[f.key] ?? "") ? "yl-changed" : "";
                  const id = `yl-f-${ci}-${f.key.replace(/[^A-Za-z0-9]/g, "_")}`;
                  return <td key={ci}>{f.choices ? (
                    <select id={id} aria-label={`${names[ci]} ${f.label}`} value={v} className={cls} onChange={(e) => setVal(ci, f.key, e.target.value)}>
                      <option value="" />{f.choices.map(([k, n]) => <option key={k} value={String(k)}>{n}</option>)}
                    </select>) : <input id={id} aria-label={`${names[ci]} ${f.label}`} type="text" value={v} className={cls}
                      onChange={(e) => setVal(ci, f.key, e.target.value)} />}</td>;
                })}<td /></tr>))}
              <tr><th>{t("yl.tdmsFrom")}</th>{cols.map((c, ci) => (
                <td key={ci}><select aria-label={`${names[ci]} ${t("yl.tdmsFrom")}`} value={c.bm ?? ""}
                  onChange={(e) => setBm(ci, e.target.value === "" ? null : Number(e.target.value))} disabled={!bookmarks.length}>
                  <option value="">–</option>
                  {bookmarks.map((b) => <option key={b.id} value={b.id} disabled={cols.some((o, oi) => oi !== ci && o.bm === b.id)}>{bmLabel(b)}</option>)}
                </select></td>))}<td /></tr>
            </tbody>
          </table>
        </div>)}
      {st?.series && <p className="muted small">{t("yl.willCreate", { list: names.join(", ") })}</p>}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={busy || !st?.series || tpl == null || !cols.length} onClick={() => void create()}>
          {cols.length > 1 ? t("yl.createMany", { n: cols.length }) : t("yl.create")}</button>
      </div>
    </Modal>
  );
}

/** "Als Datei": the bookmark to _manual under a free name (counts up), no trial. */
function BookmarkFileDialog({ bm, prefs, errMsg, onClose, onDone }: {
  bm: Bookmark; prefs: { current: Prefs }; errMsg: (e: unknown) => string; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(prefs.current.bmName ?? "99999_1");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      const r = await request<{ file: string; files: string[]; next_name: string }>("POST", `/api/yarnscope-live/bookmark/${bm.id}/file`, { name: name.trim() });
      prefs.current = { ...prefs.current, bmName: r.next_name };
      savePrefs(prefs.current);
      onDone(t("yl.fileSaved", { files: r.files.join(", ") }));
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={t("yl.fileTitle", { id: bm.id })} onClose={onClose}>
      <p className="muted small">{t("yl.fileHint", { dir: "_manual" })}</p>
      <div className="ms-form">
        <label htmlFor="yl-fname">{t("ms.name")}</label>
        <input id="yl-fname" type="text" className="ms-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      </div>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={!name.trim()} onClick={() => void save()}>{t("yl.fileSave")}</button>
      </div>
    </Modal>
  );
}
