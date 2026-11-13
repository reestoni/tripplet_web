import { useEffect, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Plot } from "../components/YarnScopeView";

/* Jet ROI Calculator (desktop ui/screen_nozzle_calculator.py), computing + PDF on the server (ui/jet_roi.py).
   Single jet: competitor vs Heberlein (jet from the DB or by hand), multi: comparisons Jet A vs Jet B. */

type JetOpt = { id: number; name: string; diam: number | null; holes: number; lv: number | null };
type Meta = { currencies: { code: string; sym: string }[]; default_cost: Record<string, string>; default_price: Record<string, string>;
  psi_per_bar: number; processes: string[]; jets: Record<string, JetOpt[]> };
type P = { value: string; unit: "bar" | "PSI" };
type Single = { process: string; positions: string; hours: string; currency: string; cost_m3: string; nozzle_px: string;
  comp_type: string; comp_diam: string; comp_holes: string; comp_pressure: P; heb_mode: "product" | "manual";
  heb_jet_id: number | null; heb_holes: string; heb_type: string; heb_diam: string; heb_pressure: P };
type Row = { label: string; pos: string; hours: string; a_jet_id: number | null; b_jet_id: number | null; a_price: string; b_price: string; a_pressure: P; b_pressure: P };
type SingleRes = { result: Record<string, number | string | null>; chart: { years: number[]; comp: number[]; heb: number[]; breakeven: number | null } };
type MultiRes = { results: Record<string, number | string | null>[]; totals: Record<string, number | string | null>;
  chart: { years: number[]; a: number[]; b: number[]; breakeven: number | null } };

const n0 = (v: unknown) => (typeof v === "number" ? v.toLocaleString("de-CH", { maximumFractionDigits: 0 }).replace(/’/g, "'") : "–");
const n2 = (v: unknown, d = 2) => (typeof v === "number" ? v.toFixed(d) : "–");
const newSingle = (): Single => ({ process: "DTY", positions: "1", hours: "8000", currency: "CHF", cost_m3: "0.04", nozzle_px: "100",
  comp_type: "", comp_diam: "1.0", comp_holes: "1", comp_pressure: { value: "4", unit: "bar" }, heb_mode: "product",
  heb_jet_id: null, heb_holes: "1", heb_type: "", heb_diam: "", heb_pressure: { value: "4", unit: "bar" } });
const newRow = (i: number): Row => ({ label: "", pos: "100", hours: "", a_jet_id: null, b_jet_id: null, a_price: "", b_price: "",
  a_pressure: { value: "4", unit: "bar" }, b_pressure: { value: "4", unit: "bar" }, ...(i < 0 ? {} : {}) });

async function postPdf(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "report.pdf";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function Pressure({ p, onChange, psiPerBar }: { p: P; onChange: (p: P) => void; psiPerBar: number }) {
  const toggle = () => {
    const v = Number(p.value.replace(",", "."));
    const unit = p.unit === "bar" ? "PSI" : "bar";
    const conv = Number.isFinite(v) ? (unit === "PSI" ? (v * psiPerBar).toFixed(1) : (v / psiPerBar).toFixed(2)) : p.value;
    onChange({ value: conv, unit });
  };
  return <span className="jr-press"><input value={p.value} onChange={(e) => onChange({ ...p, value: e.target.value })} />
    <button type="button" className="btn-plain" onClick={toggle}>{p.unit}</button></span>;
}

function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return <span className="jr-seg">{options.map(([k, l]) => <button key={k} type="button" className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>)}</span>;
}

function Kpi({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="jr-kpi"><div className="jr-kpi-l">{label}</div><div className="jr-kpi-v">{value}</div><div className="jr-kpi-u">{unit}</div></div>;
}

export default function JetRoi() {
  const { t } = useI18n();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [f, setF] = useState<Single>(newSingle);
  const [res, setRes] = useState<SingleRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mProcess, setMProcess] = useState("DTY");
  const [mCurrency, setMCurrency] = useState("CHF");
  const [mCost, setMCost] = useState("0.04");
  const [rows, setRows] = useState<Row[]>([newRow(0), newRow(1)]);
  const [mRes, setMRes] = useState<MultiRes | null>(null);

  useEffect(() => { request<Meta>("GET", "/api/jet-roi/meta").then(setMeta).catch((e) => setErr(String(e))); }, []);
  if (!meta) return <div className="muted">{err ?? t("app.loading")}</div>;
  const sym = (c: string) => meta.currencies.find((x) => x.code === c)?.sym || c;
  const jetsFor = (p: string) => meta.jets[p] || [];
  const errOf = (e: unknown) => (e instanceof ApiError && e.code ? t(`jr.err.${e.code}`) : String(e instanceof Error ? e.message : e));
  const set = (patch: Partial<Single>) => { setF({ ...f, ...patch }); };
  const setCurrency = (c: string) => set({ currency: c, cost_m3: meta.default_cost[c] || "0.04", nozzle_px: meta.default_price[c] || "100" });
  const calc = () => { setErr(null); request<SingleRes>("POST", "/api/jet-roi/single", f).then(setRes).catch((e) => { setRes(null); setErr(errOf(e)); }); };
  const pdf = () => postPdf("/api/jet-roi/single/pdf", f).catch((e) => setErr(String(e.message || e)));
  const multiBody = () => ({ process: mProcess, currency: mCurrency, cost_m3: mCost, rows });
  const calcMulti = () => { setErr(null); request<MultiRes>("POST", "/api/jet-roi/multi", multiBody()).then(setMRes).catch((e) => { setMRes(null); setErr(errOf(e)); }); };
  const pdfMulti = () => postPdf("/api/jet-roi/multi/pdf", multiBody()).catch((e) => setErr(String(e.message || e)));
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const procOpts: [string, string][] = meta.processes.map((p) => [p, p]);
  const jet = jetsFor(f.process).find((j) => j.id === f.heb_jet_id);
  const r = res?.result;
  const press = (v: unknown, unit: unknown) => (typeof v === "number" ? (unit === "PSI" ? `${(v * meta.psi_per_bar).toFixed(1)} PSI` : `${v.toFixed(2)} bar`) : "–");

  return (
    <div className="page jr-page">
      <div className="page-head">
        <h1>{t("jr.title")}</h1>
        <Seg value={mode} options={[["single", t("jr.single")], ["multi", t("jr.multi")]]} onChange={(v) => { setMode(v as "single" | "multi"); setErr(null); }} />
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      {mode === "single" ? (
        <div className="jr-grid">
          <div className="jr-inputs">
            <section className="jr-card"><h2>{t("jr.general")}</h2>
              <div className="jr-form">
                <label>{t("jr.process")}<Seg value={f.process} options={procOpts} onChange={(v) => set({ process: v, heb_jet_id: null })} /></label>
                <label>{t("jr.positions")}<input value={f.positions} onChange={(e) => set({ positions: e.target.value })} /></label>
                <label>{t("jr.hours")}<input value={f.hours} onChange={(e) => set({ hours: e.target.value })} /></label>
                <label>{t("jr.currency")}<select value={f.currency} onChange={(e) => setCurrency(e.target.value)}>
                  {meta.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
                <label>{t("jr.cost")}<span className="jr-unit"><input value={f.cost_m3} onChange={(e) => set({ cost_m3: e.target.value })} /> {sym(f.currency)}/Nm³</span></label>
                <label>{t("jr.price")}<span className="jr-unit"><input value={f.nozzle_px} onChange={(e) => set({ nozzle_px: e.target.value })} /> {sym(f.currency)}</span></label>
              </div></section>
            <section className="jr-card"><h2>{t("jr.competitor")}</h2>
              <div className="jr-form">
                <label>{t("jr.jetType")}<input value={f.comp_type} placeholder="CompXX-3" onChange={(e) => set({ comp_type: e.target.value })} /></label>
                <label>{t("jr.bore")}<span className="jr-unit"><input value={f.comp_diam} onChange={(e) => set({ comp_diam: e.target.value })} /> mm</span></label>
                <label>{t("jr.holes")}<input value={f.comp_holes} onChange={(e) => set({ comp_holes: e.target.value })} /></label>
                <label>{t("jr.pressure")}<Pressure p={f.comp_pressure} psiPerBar={meta.psi_per_bar} onChange={(p) => set({ comp_pressure: p })} /></label>
              </div></section>
            <section className="jr-card"><h2>{t("jr.heberlein")}</h2>
              <Seg value={f.heb_mode} options={[["product", t("jr.fromDb")], ["manual", t("jr.manual")]]} onChange={(v) => set({ heb_mode: v as "product" | "manual" })} />
              <div className="jr-form">
                {f.heb_mode === "product" ? (<>
                  <label>{t("jr.jet")}<select value={f.heb_jet_id ?? ""} onChange={(e) => set({ heb_jet_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">{t("jr.selectDb")}</option>
                    {jetsFor(f.process).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
                  <label>{t("jr.bore")}<span className="jr-unit"><input readOnly value={jet?.diam != null ? jet.diam.toFixed(4) : ""} placeholder={t("jr.auto")} /> mm</span></label>
                </>) : (<>
                  <label>{t("jr.jetType")}<input value={f.heb_type} placeholder="P142-2" onChange={(e) => set({ heb_type: e.target.value })} /></label>
                  <label>{t("jr.bore")}<span className="jr-unit"><input value={f.heb_diam} onChange={(e) => set({ heb_diam: e.target.value })} /> mm</span></label>
                </>)}
                <label>{t("jr.holes")}<input value={f.heb_holes} onChange={(e) => set({ heb_holes: e.target.value })} /></label>
                <label>{t("jr.pressure")}<Pressure p={f.heb_pressure} psiPerBar={meta.psi_per_bar} onChange={(p) => set({ heb_pressure: p })} /></label>
              </div></section>
            <div className="toolbar">
              <button className="btn-green" onClick={calc}>{t("jr.calculate")} →</button>
              <button className="btn-plain" onClick={() => { setF(newSingle()); setRes(null); setErr(null); }}>{t("jr.reset")}</button>
              {res && <button className="btn-plain" onClick={pdf}>{t("jr.pdf")}</button>}
            </div>
          </div>
          <section className="jr-card jr-result"><h2>{t("jr.result")}</h2>
            {!r ? <p className="muted jr-placeholder">{t("jr.placeholder")}</p> : (<>
              <div className="jr-kpis">
                <Kpi label={t("jr.kSaveDay")} value={n2(r.saving_day)} unit={String(r.sym)} />
                <Kpi label={t("jr.kSaveYr")} value={n0(r.saving_yr)} unit={String(r.sym)} />
                <Kpi label={t("jr.kJetCost")} value={n0(r.total_nozzle)} unit={String(r.sym)} />
                <Kpi label={t("jr.kAmort")} value={r.amort == null ? "N/A" : n2(r.amort)} unit={t("jr.years")} />
                <Kpi label={t("jr.kAir")} value={n2(r.saving_pct, 1)} unit="%" />
              </div>
              <div className="jr-chart-title">{t("jr.chartTitle", { sym: String(r.sym) })}</div>
              <Plot data={[
                { x: res!.chart.years, y: res!.chart.comp, name: t("jr.competitor"), mode: "lines+markers", line: { color: "#999999" } },
                { x: res!.chart.years, y: res!.chart.heb, name: "Heberlein", mode: "lines+markers", line: { color: "#39A650" } },
              ]} layout={{ height: 260, margin: { l: 60, r: 10, t: 10, b: 40 }, xaxis: { title: t("jr.year"), dtick: 1 },
                legend: { orientation: "h", y: 1.12 },
                shapes: res!.chart.breakeven != null ? [{ type: "line", x0: res!.chart.breakeven, x1: res!.chart.breakeven, yref: "paper", y0: 0, y1: 1, line: { color: "#e53935", dash: "dash", width: 1 } }] : [],
                annotations: res!.chart.breakeven != null ? [{ x: res!.chart.breakeven, yref: "paper", y: 0.95, text: t("jr.breakeven", { y: res!.chart.breakeven.toFixed(2) }), showarrow: false, font: { color: "#e53935", size: 11 }, xanchor: "left" }] : [] }} />
              <table className="jr-detail"><tbody>
                <tr><td>{t("jr.dCompQh")}</td><td>{n2(r.comp_qh, 4)} Nm³/h @ {press(r.comp_pressure, r.comp_p_unit)}</td></tr>
                <tr><td>{t("jr.dHebQh")}</td><td>{n2(r.heb_qh, 4)} Nm³/h @ {press(r.heb_pressure, r.heb_p_unit)}</td></tr>
                <tr><td>{t("jr.dCompDay")}</td><td>{n2(r.comp_qday)} Nm³</td></tr>
                <tr><td>{t("jr.dHebDay")}</td><td>{n2(r.heb_qday)} Nm³</td></tr>
                <tr><td>{t("jr.dCompYr")}</td><td>{n0(r.comp_qyr)} Nm³</td></tr>
                <tr><td>{t("jr.dHebYr")}</td><td>{n0(r.heb_qyr)} Nm³</td></tr>
                <tr><td>{t("jr.dSaveYr")}</td><td>{n0(r.saving_qyr)} Nm³</td></tr>
                <tr><td>{t("jr.dSavePct")}</td><td>{n2(r.saving_pct, 1)} %</td></tr>
                <tr><td>{t("jr.dBreak")}</td><td>{String(r.be_str)}</td></tr>
              </tbody></table>
              <div className="jr-summary">
                <div>{t("jr.sOne")} <b>{n2(r.saving_qh_one)} Nm³</b></div>
                <div>{t("jr.sAll")} <b>{n2(r.saving_qh_all)} Nm³</b></div>
                <div>{t("jr.sDay")} <b>{n2(r.saving_qday_all)} Nm³</b></div>
                <div>{t("jr.sYr")} <b>{n0(r.saving_qyr_all)} Nm³</b></div>
                {typeof r.be_bar === "number" && r.be_bar > 0 && <p>{t("jr.sBreak", { p: press(r.be_bar, r.heb_p_unit) })}</p>}
              </div>
            </>)}
          </section>
        </div>
      ) : (
        <div className="jr-multi">
          <section className="jr-card"><h2>{t("jr.general")}</h2>
            <div className="jr-form jr-form-row">
              <label>{t("jr.process")}<Seg value={mProcess} options={procOpts} onChange={(v) => { setMProcess(v); setRows(rows.map((x) => ({ ...x, a_jet_id: null, b_jet_id: null }))); }} /></label>
              <label>{t("jr.currency")}<select value={mCurrency} onChange={(e) => setMCurrency(e.target.value)}>
                {meta.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
              <label>{t("jr.cost")}<span className="jr-unit"><input value={mCost} onChange={(e) => setMCost(e.target.value)} /> {sym(mCurrency)}/Nm³</span></label>
            </div></section>
          {rows.map((row, i) => (
            <section key={i} className="jr-card jr-mrow">
              <div className="jr-form jr-form-row">
                <label>{t("jr.label")}<input value={row.label} placeholder={t("jr.labelPh", { x: String.fromCharCode(65 + i) })} onChange={(e) => setRow(i, { label: e.target.value })} /></label>
                <label>{t("jr.positions")}<input value={row.pos} onChange={(e) => setRow(i, { pos: e.target.value })} /></label>
                <label>{t("jr.hours")}<input value={row.hours} placeholder={t("jr.hours")} onChange={(e) => setRow(i, { hours: e.target.value })} /></label>
              </div>
              <div className="jr-ab">
                {(["a", "b"] as const).map((k) => (
                  <div key={k} className="jr-abcol"><b>{k === "a" ? t("jr.jetA") : t("jr.jetB")}</b>
                    <select value={row[`${k}_jet_id`] ?? ""} onChange={(e) => setRow(i, { [`${k}_jet_id`]: e.target.value ? Number(e.target.value) : null } as Partial<Row>)}>
                      <option value="">{t("jr.selectJet")}</option>
                      {jetsFor(mProcess).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
                    <Pressure p={row[`${k}_pressure`]} psiPerBar={meta.psi_per_bar} onChange={(p) => setRow(i, { [`${k}_pressure`]: p } as Partial<Row>)} />
                    <input value={row[`${k}_price`]} placeholder={t("jr.pricePh")} onChange={(e) => setRow(i, { [`${k}_price`]: e.target.value } as Partial<Row>)} />
                  </div>))}
              </div>
            </section>))}
          <div className="toolbar">
            <button className="btn-plain" onClick={() => setRows([...rows, newRow(rows.length)])}>+ {t("jr.addRow")}</button>
            <button className="btn-plain" disabled={rows.length <= 1} onClick={() => setRows(rows.slice(0, -1))}>− {t("jr.removeRow")}</button>
            <button className="btn-green" onClick={calcMulti}>{t("jr.calculate")} →</button>
            <button className="btn-plain" onClick={() => { setRows([newRow(0), newRow(1)]); setMRes(null); }}>{t("jr.reset")}</button>
            {mRes && <button className="btn-plain" onClick={pdfMulti}>{t("jr.pdf")}</button>}
          </div>
          {mRes && (
            <section className="jr-card"><h2>{t("jr.compResult")}</h2>
              <div className="jr-kpis">
                <Kpi label={t("jr.kSaveYr")} value={n0(mRes.totals.saving)} unit={String(mRes.totals.sym)} />
                <Kpi label={t("jr.kInvest")} value={n0(mRes.totals.invest)} unit={String(mRes.totals.sym)} />
                <Kpi label={t("jr.kAmort")} value={mRes.totals.amort == null ? "N/A" : n2(mRes.totals.amort)} unit={t("jr.years")} />
                <Kpi label={t("jr.kAir")} value={n2(mRes.totals.air_pct, 1)} unit="%" />
              </div>
              <table className="mj-table jr-mtable"><thead><tr>
                <th>{t("jr.label")}</th><th>{t("jr.jetA")}</th><th>{t("jr.jetB")}</th><th>{t("jr.hours")}</th><th>{t("jr.kSaveYr")}</th><th>{t("jr.kInvest")}</th><th>{t("jr.kAmort")}</th></tr></thead>
                <tbody>{mRes.results.map((x, i) => (
                  <tr key={i}><td>{String(x.label)}</td><td>{String(x.a_name)}</td><td>{String(x.b_name)}</td><td>{n0(x.h_yr)} h</td>
                    <td>{n0(x.saving_yr)} {String(x.sym)}</td><td>{typeof x.net_invest === "number" && x.net_invest > 0 ? `${n0(x.net_invest)} ${x.sym}` : "0"}</td>
                    <td>{x.amort === undefined || (typeof x.net_invest === "number" && x.net_invest <= 0) ? "—" : x.amort == null ? "∞" : `${n2(x.amort)} ${t("jr.yr")}`}</td></tr>))}
                  <tr className="jr-total"><td>{t("jr.total")}</td><td>—</td><td>—</td><td>{n0(mRes.totals.hours)} h</td><td>{n0(mRes.totals.saving)} {String(mRes.totals.sym)}</td>
                    <td>{n0(mRes.totals.invest)} {String(mRes.totals.sym)}</td><td>{mRes.totals.amort == null ? "N/A" : `${n2(mRes.totals.amort)} ${t("jr.yr")}`}</td></tr>
                </tbody></table>
              <div className="jr-chart-title">{t("jr.mChartTitle", { n: mRes.results.length, sym: String(mRes.totals.sym) })}</div>
              <Plot data={[
                { x: mRes.chart.years, y: mRes.chart.a, name: t("jr.aLegend"), mode: "lines+markers", line: { color: "#999999" } },
                { x: mRes.chart.years, y: mRes.chart.b, name: t("jr.bLegend"), mode: "lines+markers", line: { color: "#39A650" } },
              ]} layout={{ height: 260, margin: { l: 60, r: 10, t: 10, b: 40 }, xaxis: { title: t("jr.year"), dtick: 1 }, legend: { orientation: "h", y: 1.12 },
                shapes: mRes.chart.breakeven != null ? [{ type: "line", x0: mRes.chart.breakeven, x1: mRes.chart.breakeven, yref: "paper", y0: 0, y1: 1, line: { color: "#e53935", dash: "dash", width: 1 } }] : [] }} />
            </section>)}
        </div>
      )}
    </div>
  );
}
