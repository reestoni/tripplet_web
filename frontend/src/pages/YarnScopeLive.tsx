import { useEffect, useMemo, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Plot } from "../components/YarnScopeView";

/* YarnScope Live (Nutzerwunsch 2026-11-23; desktop ui/widgets/sensor_live_window.py): continuous measurement with a
   small dashboard - start / stop by hand, every 30 m knots/m + CV per sensor and, with a second sensor + the distance,
   the measured speed. Optionally saved to the _manual folder while it runs. Server: backend/app/sensor_live_api.py on
   ui/yarnscope/sensor_live.py (desktop repo); the server talks to the box, so it must run on the laptop with the box. */

type Box = { name: string; product: string; serial: string };
type Sensor = { key: string; head: string; connector: string; axes: number; title: string; date: string };
type ErrJson = { code: string; detail: string; vars?: Record<string, string | number> };
type Setup = { can_write: boolean; boxes: Box[]; box_error: ErrJson | null; sensors: Sensor[]; window_m: number;
  window_range: [number, number]; speed_range: [number, number]; manual_dir: string; save_limit_m: number; running: boolean; default_distance_mm?: number };
type SensorRow = { fpm: number | null; cv: number | null; mean_um: number | null };
type Row = { i: number; from_m: number; to_m: number; t: number; sensors: SensorRow[]; corr?: number | null;
  delay_ms?: number | null; speed?: number | null; distance_from_speed_mm?: number | null };
type View = { state: string; error: ErrJson | null; rows: Row[]; n_rows: number; meters?: number; seconds?: number;
  speed?: number; window_m?: number; rate?: number; sensors?: { head: string; connector: string; axes: number }[];
  distance_mm?: number | null; save?: boolean; save_stopped?: boolean; files?: string[]; name?: string; user?: string };

const PREF = "tripplet.yarnscopeLive";
type Prefs = { box?: string; sensor?: string; second?: string; distance?: string; speed?: string; window?: string;
  save?: boolean; name?: string; kind?: "dty" | "aty" };
const loadPrefs = (): Prefs => { try { return JSON.parse(localStorage.getItem(PREF) || "{}"); } catch { return {}; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* storage blocked */ } };
const headLabel = (h: string) => { const p = h.split("_"); return p.length >= 3 ? `${p[0]} ${p[1]}-${p[2]}` : h; };
const fmt = (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toFixed(d));
const num = (s: string) => Number(String(s).replace(",", "."));
const COLORS = ["#1d983a", "#2a78d6"];

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
  const [view, setView] = useState<View | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const others = (setup?.sensors ?? []).filter((x) => sens && x.connector !== sens.connector);
  const sec = others.some((x) => x.key === second) ? second : "";

  const start = async () => {
    if (!setup) return;
    const [lo, hi] = setup.speed_range;
    if (!(num(speed) >= lo && num(speed) <= hi)) { setErr(t("ms.err.bad_speed", { lo, hi })); return; }
    prefs.current = { box, sensor, second, distance, speed, window: win, save, name, kind };
    savePrefs(prefs.current);
    setBusy(true); setErr(null);
    try {
      const v = await request<View>("POST", "/api/yarnscope-live/start", { box, sensor, second: sec || undefined,
        speed: num(speed), distance: num(distance) > 0 ? num(distance) : undefined, window: num(win) || 30, save, name: name.trim(), kind });
      nRows.current = 0;
      setRows([]);
      setView(v);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
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
    const lay = (title: string) => ({ height: 200, margin: { l: 50, r: 10, t: 24, b: 32 }, title: { text: title, font: { size: 12 } },
      showlegend: two, legend: { orientation: "h", y: 1.25 }, xaxis: { title: { text: "m" } } });
    const names = (view?.sensors ?? []).map((s) => `${headLabel(s.head)} ${s.connector}`);
    return [
      { data: names.map((nm, i) => line(rows.map((r) => r.sensors[i]?.fpm), i, nm)), layout: lay(t("yl.fpm")) },
      { data: names.map((nm, i) => line(rows.map((r) => r.sensors[i]?.cv), i, nm)), layout: lay(t("yl.cv")) },
      ...(two ? [{ data: [line(rows.map((r) => r.speed ?? null), 0, "m/min")], layout: lay(t("yl.speed")) }] : []),
    ];
  }, [rows, view?.sensors, two, t]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <label>{t("ms.speed")}</label>
            <div className="ms-row"><input type="text" inputMode="decimal" value={speed} disabled={lock} onChange={(e) => setSpeed(e.target.value)} /> <span>m/min</span></div>
            <label>{t("yl.window")}</label>
            <div className="ms-row"><input type="text" inputMode="decimal" value={win} disabled={lock} onChange={(e) => setWin(e.target.value)} /> <span>m</span></div>
            <label>{t("yl.save")}</label>
            <div className="ms-row"><input type="checkbox" checked={save} disabled={lock} onChange={(e) => setSave(e.target.checked)} />
              {save && <><input type="text" className="ms-name" value={name} disabled={lock} maxLength={60} onChange={(e) => setName(e.target.value)} />
                <span className="jr-seg">{(["dty", "aty"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} disabled={lock} onClick={() => setKind(k)}>{k.toUpperCase()}</button>)}</span></>}
            </div>
          </div>)}
          {save && setup && <p className="muted small">{t("yl.saveHint", { dir: setup.manual_dir, max: setup.save_limit_m })}</p>}
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
            {(view?.sensors ?? []).map((s, i) => (
              <div key={s.connector} className="yl-tile" style={{ borderColor: COLORS[i] }}>
                <div className="yl-tile-h">{headLabel(s.head)} · {s.connector}</div>
                <div className="yl-big">{fmt(last?.sensors[i]?.fpm, 1)}<span> {t("yl.fpmUnit")}</span></div>
                <div>CV {fmt(last?.sensors[i]?.cv, 1)} %</div>
              </div>))}
            {two && (<div className="yl-tile">
              <div className="yl-tile-h">{t("yl.speed")}</div>
              <div className="yl-big">{fmt(last?.speed, 1)}<span> m/min</span></div>
              <div className="small muted">{last?.delay_ms != null ? `${t("ms.pairDelay", { ms: last.delay_ms.toFixed(3) })} · ${t("ms.pairCorr", { c: last.corr ?? "–" })}` : t("yl.noMatch")}
                {last?.speed == null && last?.distance_from_speed_mm != null ? ` · ${t("ms.pairDistance", { mm: last.distance_from_speed_mm.toFixed(1) })}` : ""}</div>
            </div>)}
          </div>
          {rows.length > 0 && <div className="yl-charts">{charts.map((c, i) => <Plot key={i} data={c.data} layout={c.layout} />)}</div>}
          {rows.length > 0 && (
            <div className="yl-table-wrap"><table className="yl-table">
              <thead><tr><th>m</th>{(view?.sensors ?? []).map((s) => <th key={s.connector} colSpan={2}>{headLabel(s.head)} {s.connector}</th>)}
                {two && <th>{t("yl.speed")}</th>}{two && <th>{t("yl.match")}</th>}</tr>
                <tr><th />{(view?.sensors ?? []).map((s) => [<th key={s.connector + "f"}>{t("yl.fpmUnit")}</th>, <th key={s.connector + "c"}>CV %</th>])}
                  {two && <th>m/min</th>}{two && <th />}</tr></thead>
              <tbody>{[...rows].reverse().map((r) => (
                <tr key={r.i}><td>{r.from_m}–{r.to_m}</td>
                  {r.sensors.map((s, i) => [<td key={i + "f"}>{fmt(s.fpm, 1)}</td>, <td key={i + "c"}>{fmt(s.cv, 1)}</td>])}
                  {two && <td>{fmt(r.speed, 1)}</td>}{two && <td>{fmt(r.corr, 2)}</td>}</tr>))}</tbody>
            </table></div>)}
        </div>
      </div>
    </div>
  );
}
