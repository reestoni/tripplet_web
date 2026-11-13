import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { Plot } from "./YarnScopeView";
import YarnScopeBatch from "./YarnScopeBatch";

/* ATY YarnScope like the desktop tab "YarnScope ATY" (ui/aty_yarnscope_tab.py): trial list (click =
   analyse, tick = compare), sub tabs Distribution / Garnspiegel / Fabric / Knitted / Compare, control
   panel (Start, rows, gap, bands, knitted rows, class colours + visibility), metrics line, Save, Batch.
   All numbers and geometry come from ui/yarnscope/aty_service.py via backend/app/yarnscope_aty.py;
   this file only draws (black canvases like the desktop's QPainter / matplotlib views). */

type Trial = { trial_id: number; vno: number; label: string; has_file: boolean; file: string | null; analysed: boolean; loaded: boolean };
type Metric = { label: string; key: string; text: string; unit: string };
type Setup = { trials: Trial[]; folder_ok: boolean; controls: Record<string, [number, number, number]>;
  features: [string, string][]; class_colours: { di: Record<string, string>; due: Record<string, string> } };
type Result = { metrics: Metric[][]; total_m: number; mm_pp: number; spots: number };
type Hist = { feature: string; centers: number[]; width: number; counts_1: number[]; counts_2: number[]; rows: string[][];
  colours: { bin1: string; bin2: string } };
type Mirror = { rows: { base: number; half: number[]; spans: [number, number, string][] }[]; x_mm: number[]; mm_step: number;
  xlim: [number, number]; ylim: [number, number]; alpha: number };
type Spans = [number, number, string][][];
type Fabric = { bands: Spans; seg_mm: number };
type Knitted = { rows: Spans; x_range_mm: [number, number]; row_len_mm: number };
type CmpTrial = { label: string; vno: number; colour: string;
  radar: { label: string; values: number[]; sentence: string; score_line: string };
  zoom: { pos_mm: number[]; raw_mm: number[]; base_mm: number[]; global_mean_mm: number; start_m: number } };
type Cmp = { trials: CmpTrial[]; tables: { headers: string[]; rows: string[][] }[]; radar_axes: { key: string; label: string }[];
  hists: Record<"spacing" | "relheight", { label: string; colour: string; edges: number[]; pct: number[] }[]>;
  zoom_window_mm: number; errors: string };
type View = "dist" | "mirror" | "fabric" | "knitted" | "compare";

const COLOUR_KEY = "tripplet.aty.colours";
const VIS_KEY = "tripplet.aty.visible";
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

/** Black canvas sized to its box, redrawn when the data changes (desktop: QPainter / matplotlib on black). */
function Canvas({ draw, deps, height }: { draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; deps: unknown[]; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = cv.clientWidth || 900, h = cv.clientHeight || height;
    cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
    const g = cv.getContext("2d")!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    draw(g, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={ref} className="aty-canvas" style={{ height }} />;
}

export default function YarnScopeAty({ seriesId, canWrite, inspector }: { seriesId: number; canWrite: boolean; inspector?: boolean }) {
  const { t } = useI18n();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [view, setView] = useState<View>("dist");
  const [batch, setBatch] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  // control panel (desktop spin boxes) - the views update when "Show" is pressed, like the desktop
  const [ctl, setCtl] = useState({ start_m: 0, turns: 10, gap: 2, bands: 250, rows: 50 });
  const [shown, setShown] = useState(ctl);
  const [feature, setFeature] = useState("F01_length_mm");
  const [colours, setColours] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [colourPanel, setColourPanel] = useState(false);
  const [hist, setHist] = useState<Hist | null>(null);
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [fabric, setFabric] = useState<Fabric | null>(null);
  const [knitted, setKnitted] = useState<Knitted | null>(null);
  const base = `/api/series/${seriesId}/aty`;
  const err = (e: unknown) => setMsg({ kind: "err", text: e instanceof ApiError ? e.message : String(e) });

  const loadTrials = () => request<Setup>("GET", base).then((s) => {
    setSetup(s);
    const defs = { ...s.class_colours.di, ...s.class_colours.due };
    setColours(load(COLOUR_KEY, defs));
    setVisible(load(VIS_KEY, Object.fromEntries(Object.keys(defs).map((k) => [k, true]))));
    setCtl((c) => ({ ...Object.fromEntries(Object.entries(s.controls).map(([k, v]) => [k, v[0]])), ...c }));
  });
  useEffect(() => { loadTrials().catch(err); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seriesId]);

  const analyse = (tid: number) => {
    setBatch(false); setSel(tid); setResult(null); setHist(null); setMirror(null); setFabric(null); setKnitted(null);
    setMsg(null); setBusy(true);
    if (view === "compare") setView("dist");
    request<Result>("POST", `${base}/${tid}/analyse`).then((r) => { setResult(r); return loadTrials(); })
      .catch(err).finally(() => setBusy(false));
  };

  // data of the visible sub tab
  useEffect(() => {
    if (sel == null || !result) return;
    let alive = true;
    const go = view === "dist" ? request<Hist>("GET", `${base}/${sel}/hist?feature=${feature}`).then((d) => alive && setHist(d))
      : view === "mirror" ? request<Mirror>("GET", `${base}/${sel}/garnspiegel?start=${shown.start_m}&turns=${shown.turns}&gap=${shown.gap}`).then((d) => alive && setMirror(d))
      : view === "fabric" ? request<Fabric>("GET", `${base}/${sel}/fabric?bands=${shown.bands}`).then((d) => alive && setFabric(d))
      : view === "knitted" ? request<Knitted>("GET", `${base}/${sel}/knitted?rows=${shown.rows}`).then((d) => alive && setKnitted(d))
      : Promise.resolve();
    go.catch(err);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, result, view, feature, shown]);

  const save = () => {
    if (sel == null) return;
    request("POST", `${base}/${sel}/save`).then(() => { setMsg({ kind: "ok", text: t("aty.saved") }); return loadTrials(); }).catch(err);
  };

  const histPlot = useMemo(() => {
    if (!hist) return null;
    const w = hist.width;
    return { data: [
      { type: "bar", x: hist.centers.map((c) => c - w / 2), y: hist.counts_1, width: w, name: t("aty.bin1"), marker: { color: hist.colours.bin1 } },
      { type: "bar", x: hist.centers.map((c) => c + w / 2), y: hist.counts_2, width: w, name: t("aty.bin2"), marker: { color: hist.colours.bin2 } },
    ], layout: { barmode: "overlay", showlegend: true, legend: { orientation: "h", y: 1.12 },
      xaxis: { title: { text: t(`aty.feature.${hist.feature}`) } }, yaxis: { title: { text: t("aty.per100m") } } } };
  }, [hist, t]);

  const colourOf = (k: string) => colours[k] ?? "#888";
  const on = (k: string) => visible[k] !== false;

  if (!setup) return <div className="muted">{msg?.text ?? t("app.loading")}</div>;
  const cur = setup.trials.find((x) => x.trial_id === sel);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const views: View[] = inspector ? ["dist", "mirror", "fabric", "knitted"] : ["dist", "mirror", "fabric", "knitted", "compare"];

  return (
    <div className="ys">
      <div className="ys-list">
        {!inspector && <button className="btn-green ys-batch-btn" onClick={() => setBatch(true)} disabled={busy}>Batch</button>}
        {!inspector && <p className="muted aty-hint">{t("aty.listHint")}</p>}
        {setup.trials.map((tr) => (
          <div key={tr.trial_id} className={"ys-trial aty-trial" + (tr.trial_id === sel ? " on" : "") + (tr.has_file ? "" : " off")}>
            {!inspector && <input type="checkbox" disabled={!tr.has_file} checked={picked.includes(tr.trial_id)} onChange={() => toggle(tr.trial_id)}
              title={t("aty.pickTip")} />}
            <button disabled={!tr.has_file || busy} onClick={() => analyse(tr.trial_id)} title={tr.file ?? t("ys.noFile")}>
              <span>{tr.label}</span>
              <span className={"ys-state " + (tr.analysed ? "ok" : tr.has_file ? "todo" : "none")}>
                {tr.analysed ? t("ys.analysed") : tr.has_file ? t("ys.notAnalysed") : t("ys.noFile")}
              </span>
            </button>
          </div>
        ))}
        {!setup.folder_ok && <p className="muted aty-hint">{t("aty.noFolder")}</p>}
      </div>
      <div className="ys-main">
        {batch && <YarnScopeBatch kind="aty" seriesId={seriesId} canWrite={canWrite} onClose={() => setBatch(false)} onDone={() => { loadTrials(); }} />}
        {!batch && (
          <>
            <div className="ys-head">
              <h3>{cur ? <>{cur.label} <span className="muted">· {cur.file}{result ? ` · ${result.total_m.toFixed(1)} m` : ""}</span></> : t("aty.title")}</h3>
              {busy && <span className="muted">{t("aty.analysing")}</span>}
              {canWrite && !inspector && result && <button className="btn-green" onClick={save} title={t("aty.saveTip")}>{t("ys.save")}</button>}
              {msg && <span className={msg.kind === "err" ? "login-error" : "muted"}>{msg.text}</span>}
            </div>
            <div className="se-tabs">
              {views.map((v) => (
                <button key={v} className={"se-tab" + (view === v ? " on" : "")} onClick={() => setView(v)}>{t(`aty.view.${v}`)}</button>
              ))}
            </div>
            {view === "compare" ? (
              <AtyCompare base={base} picked={picked} startM={shown.start_m} />
            ) : !result ? (
              <div className="card muted">{sel == null ? t("aty.pick") : busy ? t("aty.analysing") : ""}</div>
            ) : (
              <>
                {view === "dist" && (
                  <>
                    <label className="md-radio">{t("aty.feature")}{" "}
                      <select className="search ys-num" value={feature} onChange={(e) => setFeature(e.target.value)}>
                        {setup.features.map(([k]) => <option key={k} value={k}>{t(`aty.feature.${k}`)}</option>)}
                      </select>
                    </label>
                    {histPlot && <Plot data={histPlot.data} layout={histPlot.layout} />}
                    {hist && (
                      <div className="table-wrap"><table className="grid aty-hist">
                        <thead><tr><th>{t("aty.interval")}</th><th>{t("aty.bin1")} /100m</th><th>{t("aty.bin2")} /100m</th></tr></thead>
                        <tbody>{hist.rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className={k ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
                      </table></div>
                    )}
                  </>
                )}
                {view === "mirror" && mirror && (
                  <Canvas height={Math.max(320, mirror.rows.length * 46)} deps={[mirror, colours, visible]} draw={(g, w, h) => {
                    const [x0, x1] = mirror.xlim, [y0, y1] = mirror.ylim;
                    const sx = (x: number) => ((x - x0) / (x1 - x0)) * w, sy = (y: number) => h - ((y - y0) / (y1 - y0)) * h;
                    const band = (row: Mirror["rows"][number], i0: number, i1: number) => {
                      g.beginPath();
                      for (let i = i0; i <= i1; i++) g.lineTo(sx(mirror.x_mm[i]), sy(row.base + row.half[i]));
                      for (let i = i1; i >= i0; i--) g.lineTo(sx(mirror.x_mm[i]), sy(row.base - row.half[i]));
                      g.closePath(); g.fill();
                    };
                    for (const row of mirror.rows) {
                      const n = Math.min(row.half.length, mirror.x_mm.length) - 1;
                      g.globalAlpha = 1; g.fillStyle = "#fff"; band(row, 0, n);
                      g.globalAlpha = mirror.alpha;
                      for (const [s, e, k] of row.spans) if (on(k)) { g.fillStyle = colourOf(k); band(row, s, Math.min(e, n)); }
                    }
                    g.globalAlpha = 1;
                  }} />
                )}
                {view === "fabric" && fabric && (
                  <Canvas height={520} deps={[fabric, colours, visible]} draw={(g, w, h) => {
                    const n = Math.max(1, fabric.bands.length);
                    let gap = 2;
                    while (gap > 0 && gap * (n - 1) > h - n) gap--;
                    const bh = (h - gap * (n - 1)) / n, top0 = (h - (bh * n + gap * (n - 1))) / 2;
                    for (let i = 0; i < n; i++) {
                      const y0 = Math.round(top0 + i * (bh + gap)), hh = Math.max(1, Math.round(top0 + i * (bh + gap) + bh) - y0);
                      g.fillStyle = "#fff"; g.fillRect(0, y0, w, hh);
                      for (const [a, b, k] of fabric.bands[i] ?? []) {
                        if (!on(k)) continue;
                        const p0 = Math.round((a / fabric.seg_mm) * w), p1 = Math.round((b / fabric.seg_mm) * w);
                        if (p1 > p0) { g.fillStyle = colourOf(k); g.fillRect(p0, y0, p1 - p0, hh); }
                      }
                    }
                  }} />
                )}
                {view === "knitted" && knitted && (
                  <Canvas height={560} deps={[knitted, colours, visible]} draw={(g, w, h) => {
                    const rows = Math.max(1, knitted.rows.length), pad = Math.max(8, Math.round(0.02 * Math.min(w, h)));
                    const iw = w - 2 * pad, ih = h - 2 * pad, rs = ih / rows, A = 0.55 * rs;
                    const pts = Math.max(20, Math.floor(knitted.row_len_mm)) + 1, dx = iw / (pts - 1);
                    const [xr0, xr1] = knitted.x_range_mm, span = Math.max(1e-9, xr1 - xr0);
                    g.lineWidth = Math.max(1, 0.2 * rs); g.lineJoin = "miter"; g.lineCap = "round";
                    for (let r = 0; r < rows; r++) {
                      const ym = pad + (r + 0.5) * rs, xs: number[] = [], ys: number[] = [];
                      let flip = r % 2 === 0;
                      for (let i = 0; i < pts; i++) { xs.push(pad + i * dx); ys.push(flip ? ym + A : ym - A); flip = !flip; }
                      g.strokeStyle = "#fff"; g.beginPath(); xs.forEach((x, i) => g.lineTo(x, ys[i])); g.stroke();
                      for (const [a, b, k] of knitted.rows[r] ?? []) {
                        if (!on(k)) continue;
                        const s0 = Math.max(xr0, Math.min(b, a)), s1 = Math.min(xr1, Math.max(a, b));
                        if (s1 <= s0) continue;
                        const px0 = pad + ((s0 - xr0) / span) * iw, px1 = pad + ((s1 - xr0) / span) * iw;
                        g.strokeStyle = colourOf(k); g.beginPath();
                        for (let i = 1; i < pts; i++) {
                          const xm = (xs[i - 1] + xs[i]) / 2;
                          if (xm >= px0 && xm <= px1) { g.moveTo(xs[i - 1], ys[i - 1]); g.lineTo(xs[i], ys[i]); }
                        }
                        g.stroke();
                      }
                    }
                  }} />
                )}
                <div className="aty-metrics">{result.metrics.map((line, i) => (
                  <div key={i}>{line.map((m) => <span key={m.key}>{t(`aty.m.${m.key}`)}: <b>{m.text}{m.unit ? ` ${m.unit}` : ""}</b></span>)}</div>
                ))}</div>
              </>
            )}
            <p className="muted aty-bins">{t("aty.binInfo")}</p>
            <div className="aty-ctrl">
              {(["start_m", "turns", "gap", "bands", "rows"] as const).map((k) => {
                const [, lo, hi] = setup.controls[k];
                return (
                  <label key={k} className="md-radio" title={t(`aty.ctl.${k}Tip`)}>{t(`aty.ctl.${k}`)}
                    <input type="number" className="search ys-num" min={lo} max={hi} step={k === "gap" ? 0.5 : k === "start_m" ? 1 : 1}
                      value={ctl[k]} onChange={(e) => { const v = Number(e.target.value); if (v >= lo && v <= hi) setCtl({ ...ctl, [k]: v }); }} />
                  </label>
                );
              })}
              <button className="btn-green" onClick={() => setShown({ ...ctl })}>{t("aty.show")}</button>
              <button className={"btn-plain" + (colourPanel ? " on" : "")} onClick={() => setColourPanel(!colourPanel)}>{t("aty.colours")} {colourPanel ? "▲" : "▼"}</button>
            </div>
            {colourPanel && (
              <div className="aty-colours">
                {(["di", "due"] as const).map((fam) => (
                  <div key={fam}>
                    <b>{t(`aty.fam.${fam}`)}</b>
                    <div className="aty-cgrid">
                      {Object.keys(setup.class_colours[fam]).map((k) => (
                        <label key={k} className="aty-cls" title={t("aty.clsTip")}>
                          <input type="checkbox" checked={on(k)} onChange={(e) => { const v = { ...visible, [k]: e.target.checked }; setVisible(v); store(VIS_KEY, v); }} />
                          <input type="color" value={colourOf(k)} onChange={(e) => { const c = { ...colours, [k]: e.target.value }; setColours(c); store(COLOUR_KEY, c); }} />
                          {k}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <button className="btn-plain" onClick={() => {
                  const d = { ...setup.class_colours.di, ...setup.class_colours.due };
                  setColours(d); setVisible(Object.fromEntries(Object.keys(d).map((k) => [k, true]))); store(COLOUR_KEY, d); store(VIS_KEY, {});
                }}>{t("aty.resetColours")}</button>
                <p className="muted">{t("aty.clsRule")}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Compare */
function AtyCompare({ base, picked, startM }: { base: string; picked: number[]; startM: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<Cmp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const run = () => {
    setBusy(true); setErr(null);
    request<Cmp>("POST", `${base}/compare`, { trial_ids: picked, start_m: startM }).then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e))).finally(() => setBusy(false));
  };
  const radar = useMemo(() => {
    if (!data) return null;
    const theta = [...data.radar_axes.map((a) => t(`aty.axis.${a.key}`)), t(`aty.axis.${data.radar_axes[0].key}`)];
    return { data: data.trials.map((tr) => ({ type: "scatterpolar", r: [...tr.radar.values, tr.radar.values[0]], theta, fill: "toself",
      name: tr.label, line: { color: tr.colour }, opacity: 0.6 })),
      layout: { showlegend: true, polar: { radialaxis: { range: [0, 10] } }, margin: { l: 40, r: 40, t: 20, b: 20 } } };
  }, [data, t]);
  const histPlot = (key: "spacing" | "relheight") => {
    if (!data) return null;
    const hs = data.hists[key];
    return { data: hs.map((h) => ({ type: "bar", name: h.label, marker: { color: h.colour }, opacity: 0.75,
      x: h.edges.slice(0, -1).map((e, i) => (e + h.edges[i + 1]) / 2), y: h.pct })),
      layout: { barmode: "group", showlegend: true, legend: { orientation: "h", y: 1.15 }, margin: { l: 50, r: 10, t: 30, b: 45 },
        xaxis: { title: { text: t(key === "spacing" ? "aty.cmp.spacingX" : "aty.cmp.relX") } }, yaxis: { title: { text: t("aty.cmp.pctLoops") } } } };
  };
  return (
    <div className="aty-cmp">
      <div className="aty-cmp-top">
        <button className="btn-green" disabled={busy || picked.length === 0} onClick={run}>{busy ? t("aty.cmp.running") : t("aty.cmp.run")}</button>
        <button className={"btn-plain" + (info ? " on" : "")} onClick={() => setInfo(!info)}>ⓘ {t("aty.cmp.how")}</button>
        <span className="muted">{picked.length === 0 ? t("aty.cmp.none") : data ? t("aty.cmp.done", { n: data.trials.length })
          + (data.errors ? ` ${t("ys.cmp.skipped")} ${data.errors}` : "") : t("aty.cmp.selected", { n: picked.length })}</span>
      </div>
      {info && <div className="aty-info">{t("aty.cmp.method")}</div>}
      {err && <p className="login-error">{err}</p>}
      {data && radar && (
        <>
          <h4>{t("aty.cmp.fingerprint")}</h4>
          <div className="aty-radar">
            <div className="aty-radar-plot"><Plot data={radar.data} layout={radar.layout} /></div>
            <div className="aty-radar-desc">{data.radar_axes.map((a) => <p key={a.key}><b>{t(`aty.axis.${a.key}`)}</b> – {t(`aty.axisDesc.${a.key}`)}</p>)}</div>
          </div>
          {data.trials.map((tr) => (
            <p key={tr.label} className="aty-sentence"><b style={{ color: tr.colour }}>{tr.label}</b>: {tr.radar.sentence} <span className="muted">({tr.radar.score_line})</span></p>
          ))}
          {data.tables.map((tb, i) => (
            <div key={i} className="table-wrap"><table className="grid aty-cmp-table">
              <thead><tr>{tb.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{tb.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}
                style={j === 0 ? { color: data.trials[k]?.colour, fontWeight: 700 } : undefined}>{c}</td>)}</tr>)}</tbody>
            </table></div>
          ))}
          <h4>{t("aty.cmp.signal", { mm: data.zoom_window_mm })}</h4>
          <div className="aty-zooms">
            {data.trials.map((tr) => (
              <div key={tr.label} className="aty-zoom">
                <Plot data={[
                  { type: "scatter", mode: "lines", x: tr.zoom.pos_mm, y: tr.zoom.raw_mm, name: t("aty.cmp.raw"), line: { color: tr.colour, width: 1 } },
                  { type: "scatter", mode: "lines", x: tr.zoom.pos_mm, y: tr.zoom.base_mm, name: t("aty.cmp.core"), line: { color: "#222", width: 2 } },
                  { type: "scatter", mode: "lines", x: [tr.zoom.pos_mm[0], tr.zoom.pos_mm[tr.zoom.pos_mm.length - 1]],
                    y: [tr.zoom.global_mean_mm, tr.zoom.global_mean_mm], name: t("aty.cmp.globalMean"), line: { color: "#999", dash: "dash", width: 1 } },
                ]} layout={{ showlegend: false, title: { text: `${tr.label} · ${t("aty.cmp.from", { m: tr.zoom.start_m.toFixed(1) })}`, font: { size: 12 } },
                  margin: { l: 50, r: 10, t: 30, b: 35 }, xaxis: { title: { text: "mm" } }, yaxis: { title: { text: "mm" } } }} />
              </div>
            ))}
          </div>
          <div className="aty-hists">
            {(["spacing", "relheight"] as const).map((k) => { const p = histPlot(k); return p && <div key={k}><Plot data={p.data} layout={p.layout} /></div>; })}
          </div>
        </>
      )}
    </div>
  );
}
