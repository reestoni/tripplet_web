import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { HelpButton } from "../components/Help";
import { PHONE, useMedia } from "../media";
import { Plot } from "../components/YarnScopeView";

/* Process Playground (desktop ui/screen_process_playground.py) - computing on the server
   (ui/dty_whatif.py + ui/process_playground_core.py). 1 yarn / jet, 2 start conditions, 3 sliders, 4 what happens
   to the lab values (+ goals and "Find settings"); below: chart of the selected lab value and the suggestions.
   Statements, "based on" and the suggestion message come from the shared module (English, like the desktop). */

type ParamMeta = { label: string; unit: string; step: number; dec: number };
type TargetMeta = { label: string; unit: string; dec: number };
type Combo = { key: string; yarn: string; jet: string; trials: number; series: number; settings: number; varied: string };
type Data = { combos: Combo[]; n_trials: number; params: Record<string, ParamMeta>; targets: Record<string, TargetMeta> };
type Range = { lo: number; hi: number; step: number; dec: number; unit: string; varied: boolean };
type Opt = { label: string; tooltip: string; start: Record<string, number | null> };
type ComboInfo = { key: string; yarn: string; jet: string; trials: number; settings: number; series: number; varied: string[];
  options: Opt[]; best: number | null; ranges: Record<string, Range> };
type Row = { target: string; label: string; unit: string; verdict: string; direction: number; start: string; change: string;
  statement: string; based_on: string; strength: string; grey: boolean; bold: boolean };
type Evaluated = { start: Record<string, number>; new: Record<string, number>; changed: string[]; warnings: string[]; rows: Row[];
  notes: Record<string, { ok: boolean; text: string }> };
type Chart = { x: number[]; y: number[]; series: string[]; curve: { x: number[]; y: number[]; lo: number[]; hi: number[] } | null;
  start: number | null; new: number | null };
type Sugg = { targets: string[]; message: string; rows: { new: Record<string, number>; params: { value: string; delta: string }[];
  cells: { target: string; text: string; status: string; verdict: string; tooltip: string }[] }[] };

const PARAMS = ["pressure", "of", "speed"];
const VERDICT_CLASS: Record<string, string> = { clear: "v-clear", probable: "v-prob", tendency: "v-tend", same: "v-same", no_clear: "v-noclear" };
const COLOURS = ["#1F7A3A", "#2386C8", "#E69F00", "#8E44AD", "#C0392B", "#16A085", "#7F8C8D", "#D35400"];
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const fmt = (v: number | null | undefined, dec: number) => (v == null || Number.isNaN(v) ? "" : v.toFixed(dec));

export default function ProcessPlayground() {
  const { t } = useI18n();
  const phone = useMedia(PHONE);
  const rightRef = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: keyof Combo; desc: boolean } | null>(null);
  const [info, setInfo] = useState<ComboInfo | null>(null);
  const [startTxt, setStartTxt] = useState<Record<string, string>>({});
  const [moved, setMoved] = useState<Record<string, number>>({});
  const [optIdx, setOptIdx] = useState("");
  const [ev, setEv] = useState<Evaluated | null>(null);
  const [selTarget, setSelTarget] = useState("fpm");
  const [chartParam, setChartParam] = useState("pressure");
  const [chart, setChart] = useState<Chart | null | undefined>(undefined);
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [main, setMain] = useState("stab10");
  const [dir, setDir] = useState("up");
  const [sugg, setSugg] = useState<Sugg | null>(null);
  const [finding, setFinding] = useState(false);
  const [tab, setTab] = useState<"chart" | "sugg">("chart");
  const pendingTrial = useRef<string | null>(params.get("trial"));
  const selRow = useRef<HTMLTableRowElement | null>(null);

  const plabel = (p: string) => t(`pp.param.${p}`);
  const tlabel = (tk: string) => t(`pp.target.${tk}`);

  const load = (reload = false) => {
    setLoading(true);
    setErr(null);
    request<Data>("GET", `/api/process-playground/data${reload ? "?reload=1" : ""}`)
      .then((d) => {
        setData(d);
        const tid = pendingTrial.current;
        pendingTrial.current = null;
        if (tid) {
          request<{ key: string; start: Record<string, number | null> }>("GET", `/api/process-playground/trial/${encodeURIComponent(tid)}`)
            .then((r) => openCombo(r.key, r.start))
            .catch((e) => setErr(e instanceof ApiError && e.code === "trial_unusable" ? t("pp.err.trial_unusable") : String(e.message || e)));
        } else if (info && reload) openCombo(info.key, ev?.start ?? null);
      })
      .catch((e) => setErr(t("pp.err.load_failed") + (e?.message ? ` (${e.message})` : "")))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F5" && !e.ctrlKey) { e.preventDefault(); load(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const applyStart = (ci: ComboInfo, start: Record<string, number | null>) => {
    const txt: Record<string, string> = {}, mv: Record<string, number> = {};
    for (const p of PARAMS) {
      const r = ci.ranges[p], v = start[p];
      txt[p] = v == null ? fmt(r.lo, r.dec) : String(v);
      mv[p] = clamp(v == null ? r.lo : v, r.lo, r.hi);
    }
    setStartTxt(txt);
    setMoved(mv);
  };

  const openCombo = (key: string, start: Record<string, number | null> | null) => {
    request<ComboInfo>("GET", `/api/process-playground/combo?key=${encodeURIComponent(key)}`)
      .then((ci) => {
        setInfo(ci);
        setSugg(null);
        setOptIdx(start ? "" : ci.best != null ? String(ci.best) : "");
        const s = start ?? (ci.best != null ? ci.options[ci.best].start : {});
        applyStart(ci, s);
        // phone: the list sits above everything else - jump down to the chosen combination
        setTimeout(() => (phone ? rightRef.current?.scrollIntoView({ block: "start" }) : selRow.current?.scrollIntoView({ block: "center" })), 50);
      })
      .catch((e) => setErr(String(e.message || e)));
  };

  const startNums = useMemo(() => {
    const o: Record<string, number | null> = {};
    for (const p of PARAMS) { const v = parseFloat((startTxt[p] || "").replace(",", ".")); o[p] = Number.isFinite(v) ? v : null; }
    return o;
  }, [startTxt]);

  // evaluate whenever start or sliders change
  useEffect(() => {
    if (!info) return;
    const h = setTimeout(() => {
      request<Evaluated>("POST", "/api/process-playground/evaluate", { key: info.key, start: startNums, moved })
        .then((r) => {
          setEv(r);
          if (r.changed.length && !r.changed.includes(chartParam)) setChartParam(r.changed[0]);
        })
        .catch((e) => setErr(String(e.message || e)));
    }, 120);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, startNums, moved]);

  // chart of the selected lab value
  useEffect(() => {
    if (!info || !ev) return;
    request<{ chart: Chart | null }>("POST", "/api/process-playground/chart",
      { key: info.key, start: ev.start, new: ev.new, target: selTarget, param: chartParam })
      .then((r) => setChart(r.chart)).catch(() => setChart(null));
  }, [info, ev, selTarget, chartParam]);

  const combos = useMemo(() => {
    if (!data) return [];
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    let list = data.combos.filter((c) => words.every((w) => `${c.yarn} ${c.jet}`.toLowerCase().includes(w)));
    if (sort) {
      const { col, desc } = sort;
      list = [...list].sort((a, b) => {
        const x = a[col], y = b[col];
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return desc ? -r : r;
      });
    }
    return list;
  }, [data, search, sort]);

  const sortBy = (col: keyof Combo) => setSort((s) => (s && s.col === col ? { col, desc: !s.desc } : { col, desc: typeof data?.combos[0]?.[col] === "number" }));

  const pickOption = (v: string) => {
    setOptIdx(v);
    if (!info || v === "") return;
    applyStart(info, info.options[Number(v)].start);
  };

  const reset = () => {
    if (!info) return;
    const mv: Record<string, number> = {};
    for (const p of PARAMS) { const r = info.ranges[p]; mv[p] = clamp(startNums[p] ?? r.lo, r.lo, r.hi); }
    setMoved(mv);
  };

  const find = () => {
    if (!info) return;
    setFinding(true);
    request<Sugg>("POST", "/api/process-playground/find", { key: info.key, start: startNums, goals, main, direction: dir })
      .then((r) => { setSugg(r); setTab("sugg"); })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setFinding(false));
  };

  const takeSuggestion = (n: Record<string, number>) => {
    if (!info) return;
    const mv: Record<string, number> = {};
    for (const p of PARAMS) { const r = info.ranges[p]; mv[p] = clamp(n[p], r.lo, r.hi); }
    setMoved(mv);
  };

  const plot = useMemo(() => {
    if (!chart || !data) return null;
    const pm = data.params[chartParam], tm = data.targets[selTarget];
    const series = [...new Set(chart.series)].sort();
    const traces: unknown[] = [];
    if (chart.curve) {
      traces.push({ x: chart.curve.x, y: chart.curve.lo, mode: "lines", line: { width: 0 }, hoverinfo: "skip", type: "scatter" });
      traces.push({ x: chart.curve.x, y: chart.curve.hi, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(35,134,200,0.12)", hoverinfo: "skip", type: "scatter" });
      traces.push({ x: chart.curve.x, y: chart.curve.y, mode: "lines", line: { color: "#2386C8", width: 2 }, hoverinfo: "skip", type: "scatter" });
    }
    traces.push({ x: chart.x, y: chart.y, mode: "markers", type: "scatter", text: chart.series,
      marker: { size: 7, opacity: 0.8, color: chart.series.map((s) => COLOURS[series.indexOf(s) % COLOURS.length]) },
      hovertemplate: `%{text}<br>%{x} ${pm.unit} → %{y:.${tm.dec}f} ${tm.unit}<extra></extra>` });
    const shapes = [];
    if (chart.start != null) shapes.push({ type: "line", yref: "paper", y0: 0, y1: 1, x0: chart.start, x1: chart.start, line: { color: "#5A6460", width: 1, dash: "dash" } });
    if (chart.new != null) shapes.push({ type: "line", yref: "paper", y0: 0, y1: 1, x0: chart.new, x1: chart.new, line: { color: "#1F7A3A", width: 2 } });
    return { traces, layout: { shapes, height: 300, margin: { l: 60, r: 15, t: 10, b: 45 },
      xaxis: { title: { text: `${plabel(chartParam)} [${pm.unit}]   (${t("pp.chartLines")})`, font: { size: 11 } }, gridcolor: "#E6EBE5" },
      yaxis: { title: { text: `${tlabel(selTarget)} [${tm.unit}]`, font: { size: 11 } }, gridcolor: "#E6EBE5" } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, data, chartParam, selTarget, t]);

  if (!data) {
    return <div className="page"><div className="page-head"><h1>{t("pp.title")}</h1></div>
      {err ? <div className="mj-msg err">{err}</div> : <p className="muted">{t("pp.loading")}</p>}</div>;
  }

  const head = (col: keyof Combo, label: string, num = false) => (
    <th className={num ? "num" : ""} onClick={() => sortBy(col)}>{label}{sort?.col === col ? (sort.desc ? " ▼" : " ▲") : ""}</th>);

  return (
    <div className="page pp-page">
      <div className="page-head">
        <h1>{t("pp.title")}</h1>
        <span className="muted pp-sub">{t("pp.subtitle")}</span>
        <span style={{ flex: 1 }} />
        <button className="btn-plain" onClick={() => load(true)} disabled={loading} title={t("pp.reloadTip")}>{t("pp.reload")}</button>
        <HelpButton screen="process_playground" />
      </div>
      {err && <div className="mj-msg err" onClick={() => setErr(null)}>{err}</div>}
      <div className="pp-grid">
        <section className="jr-card pp-combos">
          <h2>1 {t("pp.c1")}</h2>
          <div className="muted pp-hint">{t("pp.c1hint")}</div>
          <input className="pp-search" placeholder={t("pp.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="pp-tablewrap">
            <table className="pp-table">
              <thead><tr>{head("yarn", t("pp.yarn"))}{head("jet", t("pp.jet"))}{head("trials", t("pp.trials"), true)}
                {head("series", t("pp.series"), true)}<th title={t("pp.variedTip")}>{t("pp.varied")}</th></tr></thead>
              <tbody>
                {combos.map((c) => (
                  <tr key={c.key} ref={info?.key === c.key ? selRow : undefined} className={info?.key === c.key ? "sel" : ""}
                    title={t("pp.comboTip", { n: c.settings, s: c.series })} onClick={() => openCombo(c.key, null)}>
                    <td>{c.yarn}</td><td>{c.jet}</td><td className="num">{c.trials}</td><td className="num">{c.series}</td><td>{c.varied}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
          <div className="muted pp-hint">{t("pp.status", { n: data.combos.length, trials: data.n_trials.toLocaleString("de-CH") })}</div>
        </section>
        <div className="pp-right" ref={rightRef}>
          {!info ? <section className="jr-card"><p className="muted">{t("pp.pickCombo")}</p></section> : (<>
            <div className="pp-top">
              <section className="jr-card">
                <h2>2 {t("pp.c2")}</h2>
                <div className="muted pp-hint">{info.yarn} · {info.jet} · {t("pp.comboSum", { n: info.trials, s: info.settings, ser: info.series })}</div>
                <select className="pp-opt" value={optIdx} onChange={(e) => pickOption(e.target.value)}>
                  <option value="">{t("pp.takeTrial")}</option>
                  {info.options.map((o, i) => <option key={i} value={i} title={o.tooltip}>{o.label}</option>)}
                </select>
                {PARAMS.map((p) => {
                  const r = info.ranges[p], note = ev?.notes[p];
                  return (
                    <div key={p} className="pp-start">
                      <label>{plabel(p)}<span className="jr-unit"><input value={startTxt[p] ?? ""} onChange={(e) => { setOptIdx(""); setStartTxt({ ...startTxt, [p]: e.target.value }); }} onBlur={() => {
                        const v = startNums[p]; if (v != null) setMoved((m) => ({ ...m, [p]: clamp(v, r.lo, r.hi) }));
                      }} /> {r.unit}</span></label>
                      {note && <div className={"pp-note" + (note.ok ? "" : " bad")}>{note.ok ? note.text : t("pp.notMeasured", { text: note.text })}</div>}
                    </div>);
                })}
              </section>
              <section className="jr-card">
                <h2>3 {t("pp.c3")} <button className="btn-plain pp-reset" onClick={reset}>{t("pp.reset")}</button></h2>
                {PARAMS.map((p) => {
                  const r = info.ranges[p], v = moved[p] ?? r.lo, st = ev?.start[p];
                  const pct = r.hi > r.lo && st != null ? ((clamp(st, r.lo, r.hi) - r.lo) / (r.hi - r.lo)) * 100 : null;
                  return (
                    <div key={p} className={"pp-slider" + (r.varied ? "" : " off")}>
                      <div className="pp-sl-head"><b>{plabel(p)}</b>
                        <span className="jr-unit"><input type="number" disabled={!r.varied} min={r.lo} max={r.hi} step={r.step} value={fmt(v, r.dec)}
                          onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) setMoved({ ...moved, [p]: clamp(n, r.lo, r.hi) }); }} /> {r.unit}</span>
                        {ev && ev.changed.includes(p) && <span className="pp-delta">{(ev.new[p] - ev.start[p] >= 0 ? "+" : "") + fmt(ev.new[p] - ev.start[p], r.dec)}</span>}
                      </div>
                      <div className="pp-range">
                        <input type="range" disabled={!r.varied} min={r.lo} max={r.hi} step={r.step} value={v}
                          onChange={(e) => setMoved({ ...moved, [p]: parseFloat(e.target.value) })} />
                        {pct != null && r.varied && <span className="pp-startmark" style={{ left: `${pct}%` }} title={t("pp.startMark", { v: fmt(st, r.dec) })} />}
                      </div>
                      <div className="muted pp-hint">{r.varied ? t("pp.measured", { lo: fmt(r.lo, r.dec), hi: fmt(r.hi, r.dec), unit: r.unit }) : t("pp.notVaried")}</div>
                    </div>);
                })}
              </section>
            </div>
            <section className="jr-card">
              <div className="pp-c4head">
                <h2>4 {t("pp.c4")}</h2>
                <span style={{ flex: 1 }} />
                <span>{t("pp.findMain")}</span>
                <select value={main} onChange={(e) => setMain(e.target.value)}>
                  {Object.keys(data.targets).map((tk) => <option key={tk} value={tk}>{tlabel(tk)}</option>)}</select>
                <select value={dir} onChange={(e) => setDir(e.target.value)}>
                  <option value="up">{t("pp.goal.up")}</option><option value="down">{t("pp.goal.down")}</option></select>
                <span className="muted">{t("pp.otherGoals")}</span>
                <button className="btn-green" onClick={find} disabled={finding} title={t("pp.findTip")}>{finding ? t("pp.finding") : t("pp.find")}</button>
              </div>
              {ev && ev.warnings.length > 0 && <div className="pp-warn">{ev.warnings.map((w) => t(`pp.warn.${w}`)).join("  ")}</div>}
              <div className="pp-scroll"><table className="pp-table pp-res">
                <thead><tr><th>{t("pp.col.label")}</th><th className="num" title={t("pp.col.startTip")}>{t("pp.col.start")}</th>
                  <th className="num">{t("pp.col.change")}</th><th>{t("pp.col.statement")}</th><th>{t("pp.col.based")}</th><th>{t("pp.col.goal")}</th></tr></thead>
                <tbody>
                  {(ev?.rows ?? []).map((r) => (
                    <tr key={r.target} className={(VERDICT_CLASS[r.verdict] ?? "") + (selTarget === r.target ? " sel" : "") + (r.grey ? " grey" : "")}
                      onClick={() => { setSelTarget(r.target); setTab("chart"); }}>
                      <td>{tlabel(r.target)}</td><td className="num" data-label={t("pp.col.start")}>{r.start}</td>
                      <td className="num" data-label={t("pp.col.change")}>{r.change}</td>
                      <td className={r.bold ? "b" : ""} title={r.strength}>{r.statement}</td>
                      <td title={r.based_on.split(";  ").join("\n")}>{r.based_on}</td>
                      <td onClick={(e) => e.stopPropagation()} data-label={t("pp.col.goal")}>
                        <select value={goals[r.target] ?? ""} title={t("pp.goalTip")} onChange={(e) => setGoals({ ...goals, [r.target]: e.target.value })}>
                          <option value="" />{["up", "down", "keep"].map((g) => <option key={g} value={g}>{t(`pp.goal.${g}`)}</option>)}</select>
                      </td>
                    </tr>))}
                </tbody>
              </table></div>
            </section>
            <section className="jr-card">
              <div className="se-tabs">
                <button className={"se-tab" + (tab === "chart" ? " on" : "")} onClick={() => setTab("chart")}>{t("pp.tabChart")}</button>
                <button className={"se-tab" + (tab === "sugg" ? " on" : "")} onClick={() => setTab("sugg")}>{t("pp.tabSugg")}</button>
              </div>
              {tab === "chart" ? (<>
                <div className="pp-c4head">
                  <b>{tlabel(selTarget)}</b><span className="muted">{t("pp.against")}</span>
                  <select value={chartParam} onChange={(e) => setChartParam(e.target.value)}>
                    {PARAMS.map((p) => <option key={p} value={p}>{plabel(p)}</option>)}</select>
                </div>
                {chart === null ? <p className="muted pp-empty">{t("pp.noChart")}</p> : plot && <div className="pp-plot"><Plot data={plot.traces} layout={plot.layout} /></div>}
                {chart && <div className="muted pp-hint">{chart.curve ? t("pp.chartHint") : t("pp.chartRaw", { p: plabel(chartParam) })}</div>}
              </>) : (<>
                {!sugg ? <p className="muted pp-empty">{t("pp.suggNone")}</p> : (<>
                  <div className="muted pp-hint">{sugg.message}{sugg.rows.length ? (sugg.message ? "  " : "") + t("pp.suggHint") : ""}</div>
                  {sugg.rows.length > 0 && (
                    <div className="pp-scroll"><table className="pp-table pp-sugg">
                      <thead><tr><th>#</th>{PARAMS.map((p) => <th key={p}>{plabel(p)} [{data.params[p].unit}]</th>)}
                        {sugg.targets.map((tk, i) => <th key={tk}>{tlabel(tk)}{i === 0 ? ` (${t("pp.main")})` : ""}</th>)}</tr></thead>
                      <tbody>
                        {sugg.rows.map((r, i) => (
                          <tr key={i} onClick={() => takeSuggestion(r.new)} title={t("pp.suggTip")}>
                            <td>{i + 1}</td>
                            {r.params.map((pv, j) => <td key={j} className={pv.delta ? "b" : ""}>{pv.value}{pv.delta ? `  (${pv.delta})` : ""}</td>)}
                            {r.cells.map((c, j) => (
                              <td key={c.target} title={c.tooltip} className={j === 0 ? VERDICT_CLASS[c.verdict] ?? "" : c.status ? `st-${c.status}` : ""}>
                                {c.text}{j > 0 && c.status ? `  [${t(`pp.status.${c.status}`)}]` : ""}</td>))}
                          </tr>))}
                      </tbody>
                    </table></div>)}
                </>)}
              </>)}
            </section>
          </>)}
        </div>
      </div>
    </div>
  );
}
