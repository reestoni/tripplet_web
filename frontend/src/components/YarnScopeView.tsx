import { useEffect, useMemo, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import YarnScopeBatch from "./YarnScopeBatch";

/* DTY YarnScope (read + analyse + save). Everything is computed on the server by the
   desktop's shared module (ui/yarnscope/dty_service.py); this page only draws. */

type YsTrial = { trial_id: number; vno: number; label: string; has_file: boolean; file: string | null;
  analysed: boolean; loaded: boolean };
type Card = { label: string; key: string; decimals: number; unit: string; value: number | null };
type Result = { metrics_card: Card[]; stab: [string, number | null][] | { key: string; label: string; value: number | null }[];
  status_text: string; total_m: number; dx_mm: number; pie: Record<string, number> };
type Trace = { x: number[]; y: number[] };
type Segment = { total_m: number; start_m: number; window_m: number; x_range: [number, number]; line: Trace;
  open_segments: [number, number, number][]; knot_segments: [number, number, number, string][];
  counts: Record<string, number>; thresholds: { T: number; cb: number; ba: number };
  trends: Record<string, { enabled: boolean; x: number[]; y: number[]; colour: string; title: string }>;
  colours: { line: string; open: string; abc: Record<string, string> } };
type Signal = { bars: Trace; step_m: number; thresholds: { T: number; ab: number; bc: number };
  ylim: [number, number]; xlim: [number, number] };
type Mirror = { rows: { base: number; half: number[]; spans: [number, number, string][] }[];
  x_step_mm: number; xlim: [number, number]; ylim: [number, number];
  colours: { open: string; open_alpha: number; abc: Record<string, string>; abc_alpha: number; background: string } };

// clearer than the desktop's repeated "CV": say which value the CV belongs to
const CARD_LABEL: Record<string, string> = {
  CV_FP: "CV FP/m", AvgKL: "Ø KL (knot length)", CV_KL: "CV KL", AvgOL: "Ø OL (open length)", CV_OL: "CV OL",
  AKnots: "A knots", BKnots: "B knots", CKnots: "C knots",
};
const ABC_COLOURS: Record<string, string> = { A: "#e05050", B: "#f0a030", C: "#9060c0" };

type PlotlyLike = { react: (el: HTMLElement, data: unknown[], layout: unknown, cfg?: unknown) => void;
  purge: (el: HTMLElement) => void };
let plotlyPromise: Promise<PlotlyLike> | null = null;
function loadPlotly(): Promise<PlotlyLike> {
  const w = window as unknown as { Plotly?: PlotlyLike };
  if (w.Plotly) return Promise.resolve(w.Plotly);
  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/report-assets/plotly-2.32.0.min.js"; // same local Plotly as the desktop report
      s.onload = () => resolve((window as unknown as { Plotly: PlotlyLike }).Plotly);
      s.onerror = () => reject(new Error("Plotly could not be loaded"));
      document.head.appendChild(s);
    });
  }
  return plotlyPromise;
}

function Plot({ data, layout }: { data: unknown[]; layout: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    loadPlotly().then((P) => {
      if (alive && ref.current) {
        P.react(ref.current, data, { margin: { l: 55, r: 15, t: 10, b: 40 }, showlegend: false, ...layout },
          { displaylogo: false, responsive: true });
      }
    });
    return () => {
      alive = false;
    };
  }, [data, layout]);
  useEffect(() => () => {
    const el = ref.current;
    const w = window as unknown as { Plotly?: PlotlyLike };
    if (el && w.Plotly) w.Plotly.purge(el);
  }, []);
  return <div ref={ref} className="ys-plot" />;
}

const hline = (y: number, colour: string, dash = "dash") =>
  ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y, line: { color: colour, width: 1, dash } });

function segmentsTrace(segs: [number, number, number][], colour: string, width = 3) {
  const x: (number | null)[] = [], y: (number | null)[] = [];
  for (const [x0, x1, m] of segs) x.push(x0, x1, null), y.push(m, m, null);
  return { type: "scattergl", mode: "lines", x, y, line: { color: colour, width }, hoverinfo: "skip" };
}

function MirrorCanvas({ m }: { m: Mirror }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const W = cv.clientWidth || 900, H = cv.clientHeight || 420;
    cv.width = W * devicePixelRatio;
    cv.height = H * devicePixelRatio;
    const g = cv.getContext("2d")!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.fillStyle = m.colours.background;
    g.fillRect(0, 0, W, H);
    const [x0, x1] = m.xlim, [y0, y1] = m.ylim;
    const sx = (x: number) => ((x - x0) / (x1 - x0)) * W;
    const sy = (y: number) => H - ((y - y0) / (y1 - y0)) * H;
    for (const row of m.rows) {
      for (const [i0, i1, cls] of row.spans) {
        g.fillStyle = cls ? m.colours.abc[cls] ?? "#888" : m.colours.open;
        g.globalAlpha = cls ? m.colours.abc_alpha : m.colours.open_alpha;
        g.beginPath();
        for (let i = i0; i <= Math.min(i1, row.half.length - 1); i++) g.lineTo(sx(i * m.x_step_mm), sy(row.base + row.half[i]));
        for (let i = Math.min(i1, row.half.length - 1); i >= i0; i--) g.lineTo(sx(i * m.x_step_mm), sy(row.base - row.half[i]));
        g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }, [m]);
  return <canvas ref={ref} className="ys-mirror" />;
}

export default function YarnScopeView({ seriesId, canWrite }: { seriesId: number; canWrite: boolean }) {
  const { t } = useI18n();
  const [trials, setTrials] = useState<YsTrial[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"segment" | "signal" | "mirror">("segment");
  const [start, setStart] = useState(0);
  const [win, setWin] = useState(3);
  const [pos, setPos] = useState({ start: 0, win: 3 });   // what the charts show (debounced)
  const [loadingView, setLoadingView] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setPos({ start, win }), 250);
    return () => window.clearTimeout(id);
  }, [start, win]);
  const [seg, setSeg] = useState<Segment | null>(null);
  const [sig, setSig] = useState<Signal | null>(null);
  const [mir, setMir] = useState<Mirror | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const base = `/api/series/${seriesId}/yarnscope`;

  const loadTrials = () => request<{ trials: YsTrial[] }>("GET", base).then((d) => setTrials(d.trials));
  useEffect(() => {
    loadTrials().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const analyse = (tid: number) => {
    setSel(tid);
    setResult(null);
    setSeg(null); setSig(null); setMir(null);
    setError(null); setSaved(null);
    setStart(0);
    setPos({ start: 0, win });
    setBusy(true);
    request<Result>("POST", `${base}/${tid}/analyse`)
      .then((r) => { setResult(r); return loadTrials(); })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (sel == null || !result) return;
    let alive = true;
    setLoadingView(true);
    const q = `?start=${pos.start}&window=${pos.win}`;
    const go = view === "segment" ? request<Segment>("GET", `${base}/${sel}/segment${q}`).then((d) => alive && setSeg(d))
      : view === "signal" ? request<Signal>("GET", `${base}/${sel}/signal${q}`).then((d) => alive && setSig(d))
      : request<Mirror>("GET", `${base}/${sel}/garnspiegel?start=${pos.start}`).then((d) => alive && setMir(d));
    go.catch((e) => alive && setError(e.message)).finally(() => alive && setLoadingView(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, result, view, pos]);

  const segPlot = useMemo(() => {
    if (!seg) return null;
    const data: unknown[] = [
      { type: "scattergl", mode: "lines", x: seg.line.x, y: seg.line.y, line: { color: seg.colours.line, width: 1 }, hoverinfo: "skip" },
      segmentsTrace(seg.open_segments, seg.colours.open),
      ...["A", "B", "C"].map((c) => segmentsTrace(seg.knot_segments.filter((k) => k[3] === c).map((k) => [k[0], k[1], k[2]] as [number, number, number]), seg.colours.abc[c])),
      ...Object.values(seg.trends).filter((tr) => tr.enabled && tr.x?.length).map((tr) => ({
        type: "scatter", mode: "lines", x: tr.x, y: tr.y, line: { color: tr.colour, width: 2 }, name: tr.title })),
    ];
    const th = seg.thresholds;
    return { data, layout: { xaxis: { range: seg.x_range, title: { text: `m  (${seg.x_range[0].toFixed(1)} – ${seg.x_range[1].toFixed(1)})` } },
      shapes: [hline(th.T, "#333"), hline(th.cb, seg.colours.abc.C, "dot"), hline(th.ba, seg.colours.abc.A, "dot")] } };
  }, [seg]);

  const pie = useMemo(() => {
    if (!result?.pie) return null;
    const keys = ["A", "B", "C"].filter((k) => result.pie[k] != null);
    if (!keys.length) return null;
    return { data: [{ type: "pie", labels: keys.map((k) => `${k}`), values: keys.map((k) => result.pie[k]), sort: false,
      marker: { colors: keys.map((k) => ABC_COLOURS[k]) }, textinfo: "label+percent", textposition: "inside", insidetextorientation: "horizontal", hole: 0.3,
      hovertemplate: "%{label}: %{percent}<extra></extra>" }],
      layout: { margin: { l: 5, r: 5, t: 5, b: 5 }, showlegend: false } };
  }, [result]);

  const sigPlot = useMemo(() => {
    if (!sig) return null;
    const half = sig.step_m / 2;
    return { data: [{ type: "bar", x: sig.bars.x.map((x) => x + half), y: sig.bars.y, width: sig.step_m,
      marker: { color: "#7a8a7d" }, hoverinfo: "x+y" }],
      layout: { bargap: 0, xaxis: { range: sig.xlim, title: { text: `m  (${sig.xlim[0].toFixed(2)} – ${sig.xlim[1].toFixed(2)})` } }, yaxis: { range: sig.ylim, title: { text: "µm" } },
        shapes: [hline(sig.thresholds.T, "#333"), hline(sig.thresholds.ab, "#e05050", "dot"), hline(sig.thresholds.bc, "#9060c0", "dot")] } };
  }, [sig]);

  const save = () => {
    if (sel == null) return;
    request<{ ok: boolean }>("POST", `${base}/${sel}/save`)
      .then(() => { setSaved(t("ys.saved")); return loadTrials(); })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  };

  if (!trials) return <div className="muted">{error ?? t("app.loading")}</div>;
  const cur = trials.find((x) => x.trial_id === sel);
  const total = result?.total_m ?? 0;

  return (
    <div className="ys">
      <div className="ys-list">
        <button className="btn-green ys-batch-btn" onClick={() => setBatch(true)} disabled={busy}>Batch</button>
        {trials.map((tr) => (
          <button key={tr.trial_id} disabled={!tr.has_file || busy}
            className={"ys-trial" + (tr.trial_id === sel ? " on" : "")} onClick={() => analyse(tr.trial_id)}
            title={tr.file ?? t("ys.noFile")}>
            <span>{tr.label}</span>
            <span className={"ys-state " + (tr.analysed ? "ok" : tr.has_file ? "todo" : "none")}>
              {tr.analysed ? t("ys.analysed") : tr.has_file ? t("ys.notAnalysed") : t("ys.noFile")}
            </span>
          </button>
        ))}
      </div>
      <div className="ys-main">
        {batch && <YarnScopeBatch seriesId={seriesId} canWrite={canWrite} onClose={() => setBatch(false)}
          onDone={() => { loadTrials(); }} />}
        {!batch && <>
        {sel == null && <div className="card muted">{t("ys.pick")}</div>}
        {busy && <div className="card muted">{t("ys.analysing", { label: cur?.label ?? "" })}</div>}
        {error && <div className="card error">{error}</div>}
        {result && cur && (
          <>
            <div className="ys-head">
              <h3>{cur.label} <span className="muted">· {cur.file} · {total.toFixed(1)} m</span></h3>
              {canWrite && <button className="btn-green" onClick={save}>{t("ys.save")}</button>}
              {saved && <span className="muted">{saved}</span>}
            </div>
            <div className="ys-top">
            <div className="ys-cards">
              {result.metrics_card.map((c, i) => (
                <div key={i} className={"ys-card" + (c.key === "FPm" || c.key === "CV_FP" ? " hl" : "")}>
                  <div className="ys-card-l">{CARD_LABEL[c.key] ?? c.label}</div>
                  <div className="ys-card-v">{c.value == null ? "–" : `${c.value.toFixed(c.decimals)}${c.unit}`}</div>
                </div>
              ))}
            </div>
            {pie && <div className="ys-pie"><Plot data={pie.data} layout={pie.layout} /></div>}
            </div>
            <div className="md-bar">
              {(["segment", "signal", "mirror"] as const).map((v) => (
                <label key={v} className="md-radio">
                  <input type="radio" checked={view === v} onChange={() => setView(v)} /> {t(`ys.view.${v}`)}
                </label>
              ))}
              <span className="ys-pos">
                {t("ys.start")}
                <input type="range" min={0} max={Math.max(0, total - 0.5)} step={0.1} value={start}
                  onChange={(e) => setStart(Number(e.target.value))} />
                <input type="number" className="search ys-num" min={0} step={0.5} value={start}
                  onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} /> <span>m</span>
                {view !== "mirror" && (
                  <>
                    <span className="ys-gap">{t("ys.window")}</span>
                    <select className="search ys-num" value={win} onChange={(e) => setWin(Number(e.target.value))}>
                      {[1, 3, 5, 10, 30].map((w) => <option key={w} value={w}>{w} m</option>)}
                    </select>
                  </>
                )}
              </span>
              {loadingView && <span className="ys-updating">{t("ys.updating")}</span>}
            </div>
            {view === "segment" && segPlot && <Plot data={segPlot.data} layout={segPlot.layout} />}
            {view === "segment" && seg && (
              <div className="muted ys-legend">
                A {seg.counts.A ?? 0} · B {seg.counts.B ?? 0} · C {seg.counts.C ?? 0}
              </div>
            )}
            {view === "signal" && sigPlot && <Plot data={sigPlot.data} layout={sigPlot.layout} />}
            {view === "mirror" && mir && <MirrorCanvas m={mir} />}
            <div className="muted ys-status">{result.status_text}</div>
          </>
        )}
        </>}
      </div>
    </div>
  );
}
