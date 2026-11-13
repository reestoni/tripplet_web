import { useEffect, useMemo, useState } from "react";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { Plot } from "./YarnScopeView";

/* DTY YarnScope "Prozessvergleich" like the desktop sub tab (ui/dty_yarnscope_tab.py): 2-6 trials, process
   wave over the whole measured length, sine fits (+ process mean, drift lines, open spot trend), normalised
   on the median, table with the 10 m robustness check. Computed by dty_service.run_process_comparison /
   comparison_json on the server; the server keeps the result, so display options only redraw. */

type Trial = { trial_id: number; label: string; has_file: boolean };
type Trace = { row: number; trial_id: number; kind: "process_mean" | "drift" | "sine_fit" | "open_trend"; colour: string;
  label: string; x: number[]; y: number[] };
type Row = { trial_id: number; label: string; colour: string; table: string[] };
type Compare = { rows: Row[]; traces: Trace[]; errors: string; verdict_colours: Record<string, string>; bin: number;
  axis: { title: string; xlabel: string; ylabel: string } };
type RollMode = "Meter" | "Paare";

// desktop _YS_COMPARE_LINE_STYLE
const STYLE: Record<Trace["kind"], { width: number; dash?: string; opacity?: number }> = {
  process_mean: { width: 1, opacity: 0.45 }, drift: { width: 1.25, opacity: 0.9 },
  sine_fit: { width: 2.1, dash: "dash" }, open_trend: { width: 1.6, dash: "dot" },
};
const ROLL: Record<RollMode, { min: number; max: number; step: number; def: number }> = {
  Meter: { min: 0.1, max: 50, step: 0.1, def: 1 }, Paare: { min: 1, max: 500, step: 1, def: 10 } };
const HEADERS = ["trial", "median", "lambda", "amp", "r2", "spectrum", "drift", "rms", "sign10", "lcv10", "amp10", "r210", "verdict"];

export default function YarnScopeCompare({ seriesId, trials, bin, onClose }: {
  seriesId: number; trials: Trial[]; bin: number; onClose: () => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<number[]>([]);
  const [opts, setOpts] = useState({ normalized: true, process_mean: false, drift: false, open_trend: false });
  const [roll, setRoll] = useState<{ mode: RollMode; amount: number }>({ mode: "Meter", amount: 1 });
  const [ran, setRan] = useState<number[] | null>(null);      // trial ids of the last run
  const [data, setData] = useState<Compare | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const withFile = trials.filter((x) => x.has_file);

  const fetchCompare = (ids: number[]) => request<Compare>("POST", `/api/series/${seriesId}/yarnscope/compare`, {
    trial_ids: ids, bin, ...opts, open_roll: `${roll.mode}:${roll.amount}` });

  const run = () => {
    if (picked.length < 2) { setErr(t("ys.cmp.min")); return; }
    if (picked.length > 6) { setErr(t("ys.cmp.max")); return; }
    setBusy(true); setErr(null);
    fetchCompare(picked).then((d) => { setData(d); setRan(picked); setHidden(new Set()); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e))).finally(() => setBusy(false));
  };
  // display options: same trials again - the server answers from its kept result
  useEffect(() => {
    if (!ran) return;
    const id = window.setTimeout(() => {
      fetchCompare(ran).then(setData).catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, roll]);

  const plot = useMemo(() => {
    if (!data) return null;
    const kindLabel = (k: Trace["kind"]) => t(`ys.cmp.kind.${k}`);
    const label = (tr: Trace) => `${data.rows[tr.row]?.label ?? ""} ${kindLabel(tr.kind)}`;
    return {
      data: data.traces.filter((tr) => !hidden.has(tr.trial_id)).map((tr) => ({
        type: "scattergl", mode: "lines", x: tr.x, y: tr.y, name: label(tr), opacity: STYLE[tr.kind].opacity ?? 1,
        line: { color: tr.colour, width: STYLE[tr.kind].width, dash: STYLE[tr.kind].dash ?? "solid" } })),
      layout: { showlegend: true, legend: { orientation: "h", y: -0.22, yanchor: "top" }, margin: { l: 60, r: 15, t: 30, b: 50 },
        title: { text: t(opts.process_mean ? "ys.cmp.titleMean" : "ys.cmp.titleFits"), font: { size: 13 } },
        xaxis: { title: { text: t("ys.cmp.x") } }, yaxis: { title: { text: t(opts.normalized ? "ys.cmp.yNorm" : "ys.cmp.yAbs") } } },
    };
  }, [data, hidden, opts, t]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const verdictKey = (v: string) => `ys.cmp.verdict.${v.replace(/\s+/g, "_")}`;

  return (
    <div className="ys-cmp">
      <div className="ys-cmp-left">
        <div className="ys-cmp-head"><b>{t("ys.cmp.title")}</b><button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button></div>
        <div className="ys-cmp-list">
          {withFile.map((x) => (
            <label key={x.trial_id} className="ys-cmp-trial">
              <input type="checkbox" checked={picked.includes(x.trial_id)} onChange={() => toggle(x.trial_id)}
                disabled={!picked.includes(x.trial_id) && picked.length >= 6} /> {x.label}
            </label>
          ))}
          {withFile.length === 0 && <div className="muted">{t("ys.noFile")}</div>}
        </div>
        <label title={t("ys.cmp.normTip")}><input type="checkbox" checked={opts.normalized} onChange={(e) => setOpts({ ...opts, normalized: e.target.checked })} /> {t("ys.cmp.norm")}</label>
        <label title={t("ys.cmp.meanTip")}><input type="checkbox" checked={opts.process_mean} onChange={(e) => setOpts({ ...opts, process_mean: e.target.checked })} /> {t("ys.cmp.mean")}</label>
        <label title={t("ys.cmp.driftTip")}><input type="checkbox" checked={opts.drift} onChange={(e) => setOpts({ ...opts, drift: e.target.checked })} /> {t("ys.cmp.drift")}</label>
        <label title={t("ys.trendTip.opening")}><input type="checkbox" checked={opts.open_trend} onChange={(e) => setOpts({ ...opts, open_trend: e.target.checked })} /> {t("ys.trend.opening")}</label>
        <span className="ys-cmp-roll">
          <select className="search ys-num" disabled={!opts.open_trend} value={roll.mode} title={t("ys.rollTip")}
            onChange={(e) => { const m = e.target.value as RollMode; setRoll({ mode: m, amount: ROLL[m].def }); }}>
            <option value="Meter">{t("ys.roll.Meter")}</option><option value="Paare">{t("ys.roll.Paare")}</option>
          </select>
          <input type="number" className="search ys-num" disabled={!opts.open_trend} min={ROLL[roll.mode].min} max={ROLL[roll.mode].max}
            step={ROLL[roll.mode].step} value={roll.amount}
            onChange={(e) => { const v = Number(e.target.value); if (v >= ROLL[roll.mode].min && v <= ROLL[roll.mode].max) setRoll({ ...roll, amount: v }); }} />
          {roll.mode === "Meter" && <span>m</span>}
        </span>
        <span className="muted ys-cmp-bin">{t("ys.cmp.bin", { bin: bin.toFixed(2) })}</span>
        <button className="btn-green" disabled={busy || picked.length < 2} onClick={run}>{busy ? t("ys.cmp.running") : `▶ ${t("ys.cmp.run")}`}</button>
        <p className="muted ys-cmp-status">
          {busy ? t("ys.cmp.loading") : data ? (data.rows.length ? t("ys.cmp.done", { n: data.rows.length }) : t("ys.cmp.none"))
            + (data.errors ? ` ${t("ys.cmp.skipped")} ${data.errors}` : "") : t("ys.cmp.hint")}
        </p>
        {err && <p className="login-error">{err}</p>}
      </div>
      <div className="ys-cmp-right">
        {plot && <Plot data={plot.data} layout={plot.layout} />}
        {data && data.rows.length > 0 && (
          <div className="table-wrap">
            <table className="grid ys-cmp-table">
              <thead><tr><th title={t("ys.cmp.showTip")}>👁</th><th />{HEADERS.map((h) => <th key={h}>{t(`ys.cmp.h.${h}`)}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const verdict = r.table[r.table.length - 1];
                  return (
                    <tr key={r.trial_id} className={hidden.has(r.trial_id) ? "ys-cmp-off" : ""}>
                      <td><input type="checkbox" checked={!hidden.has(r.trial_id)} onChange={() => {
                        const s = new Set(hidden); if (s.has(r.trial_id)) s.delete(r.trial_id); else s.add(r.trial_id); setHidden(s);
                      }} /></td>
                      <td><span className="ys-cmp-swatch" style={{ background: r.colour }} /></td>
                      {r.table.slice(0, -1).map((v, i) => <td key={i} className={i ? "num" : ""}>{v}</td>)}
                      <td style={{ color: data.verdict_colours[verdict] ?? undefined }}>
                        {t(verdictKey(verdict)) === verdictKey(verdict) ? verdict : t(verdictKey(verdict))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
