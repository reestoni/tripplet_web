import { useEffect, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";
import { isTouch } from "../media";

/* Yarn Count Converter (desktop ui/screen_yarn_count.py), computing on the server (ui/yarn_count.py).
   Left: value + unit -> all count systems (a click makes one the starting value). Right: filaments and plies
   -> per filament, totals, diameter, designation; a notation like 2x150D/48F fills everything in.
   The last input is remembered in this browser (desktop: QSettings). */

type Unit = { key: string; label: string; kind: string; desc: string; formula: string };
type Meta = { units: Unit[]; densities: { name: string; rho: number }[] };
type Result = { ok: boolean; invalid: boolean; values: Record<string, string | null>; filament: Record<string, string | null> };
type Input = { value: string; unit: string; fil: string; ply: string; rho: number };
const KEY = "tripplet.yarnCount";
const BIG = ["dtex", "den"];
const FIL_ROWS: [string, string][] = [["dpf_dtex", "yc.dpfDtex"], ["dpf_den", "yc.dpfDen"], ["diameter", "yc.diameter"],
  ["total_dtex", "yc.totalDtex"], ["total_den", "yc.totalDen"], ["total_Nm", "yc.totalNm"], ["total_Ne", "yc.totalNe"], ["total_fil", "yc.totalFil"]];

function loadInput(): Input {
  try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && d.unit) return d; } catch { /* ignore */ }
  return { value: "167", unit: "dtex", fil: "48", ply: "1", rho: 1.38 };
}

function Copy({ text }: { text: string | null | undefined }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  if (!text) return <span />;
  return <button className="yc-copy" onClick={() => {
    navigator.clipboard?.writeText(text.replace(/'/g, "")).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => undefined);
  }}>{done ? t("yc.copied") : t("yc.copy")}</button>;
}

export default function YarnCount() {
  const { t } = useI18n();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [inp, setInp] = useState<Input>(loadInput);
  const [res, setRes] = useState<Result | null>(null);
  const [nota, setNota] = useState("");
  const [notaDefault, setNotaDefault] = useState("dtex");
  const [notaMsg, setNotaMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [showF, setShowF] = useState(false);

  useEffect(() => { request<Meta>("GET", "/api/yarn-count/meta").then(setMeta).catch(() => undefined); }, []);
  useEffect(() => {
    const h = setTimeout(() => {
      request<Result>("POST", "/api/yarn-count/convert", { value: inp.value, unit: inp.unit, filaments: inp.fil, plies: inp.ply, density: inp.rho })
        .then((r) => { setRes(r); if (r.ok) { try { localStorage.setItem(KEY, JSON.stringify(inp)); } catch { /* ignore */ } } })
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(h);
  }, [inp]);

  // notation preview while typing, Enter takes it over
  useEffect(() => {
    if (!nota.trim()) { setNotaMsg(null); return; }
    const h = setTimeout(() => {
      request<{ ok: boolean; count: string; unit_label: string; filaments: number | null; plies: number }>("POST", "/api/yarn-count/notation", { text: nota, default_unit: notaDefault })
        .then((p) => {
          if (!p.ok) { setNotaMsg({ text: t("yc.notaBad"), err: true }); return; }
          const parts = [`${p.count} ${p.unit_label}`];
          if (p.filaments) parts.push(t("yc.nFil", { n: p.filaments }));
          if (p.plies > 1) parts.push(t("yc.nPly", { n: p.plies }));
          setNotaMsg({ text: t("yc.readAs", { what: parts.join(", ") }) });
        }).catch(() => undefined);
    }, 150);
    return () => clearTimeout(h);
  }, [nota, notaDefault, t]);

  const takeNotation = () => {
    request<{ ok: boolean; count: string; unit: string; filaments: number | null; plies: number }>("POST", "/api/yarn-count/notation", { text: nota, default_unit: notaDefault })
      .then((p) => {
        if (!p.ok) { setNotaMsg({ text: t("yc.notaBad"), err: true }); return; }
        setInp({ ...inp, value: p.count, unit: p.unit, fil: p.filaments ? String(p.filaments) : "", ply: String(p.plies) });
        setNotaMsg({ text: t("yc.taken") });
      });
  };
  const pick = (unit: string) => {
    const v = res?.values[unit];
    if (!res?.ok || !v || unit === inp.unit) return;
    setInp({ ...inp, unit, value: v.replace(/'/g, "") });
  };

  if (!meta) return <div className="muted">{t("app.loading")}</div>;
  const units = meta.units;
  const unitLabel = (k: string) => units.find((u) => u.key === k)?.label || k;
  return (
    <div className="page yc-page">
      <div className="page-head"><h1>{t("yc.title")}</h1></div>
      <div className="yc-grid">
        <section className="yc-card">
          <h2>{t("yc.convert")}</h2>
          <div className="yc-row">
            <input className="yc-in" inputMode="decimal" value={inp.value} placeholder={t("yc.valuePh")} autoFocus={!isTouch()} onChange={(e) => setInp({ ...inp, value: e.target.value })} />
            <select className="yc-in" value={inp.unit} onChange={(e) => setInp({ ...inp, unit: e.target.value })}>
              {units.map((u) => <option key={u.key} value={u.key}>{u.label} – {u.desc}</option>)}
            </select>
          </div>
          {res?.invalid && <div className="yc-err">{t("yc.positive")}</div>}
          <div className="yc-tiles">
            {BIG.map((k) => (
              <div key={k} className={"yc-tile" + (inp.unit === k ? " on" : "")} onClick={() => pick(k)} title={t("yc.pickTip")}>
                <div className="yc-tile-unit">{unitLabel(k)}</div>
                <div className="yc-tile-val">{res?.values[k] ?? "–"}</div>
                <Copy text={res?.values[k]} />
              </div>))}
          </div>
          <div className="yc-units">
            {units.filter((u) => !BIG.includes(u.key)).map((u) => (
              <div key={u.key} className={"yc-unit" + (inp.unit === u.key ? " on" : "")} onClick={() => pick(u.key)} title={t("yc.pickTip")}>
                <span className="yc-u-label">{u.label}<span className="muted small"> {u.desc}</span></span>
                <b>{res?.values[u.key] ?? "–"}</b>
                <span onClick={(e) => e.stopPropagation()}><Copy text={res?.values[u.key]} /></span>
              </div>))}
          </div>
        </section>
        <section className="yc-card">
          <h2>{t("yc.filTitle")}</h2>
          <p className="muted small">{t("yc.filHint")}</p>
          <div className="yc-form">
            <label>{t("yc.fil")}<input inputMode="numeric" value={inp.fil} placeholder="48" onChange={(e) => setInp({ ...inp, fil: e.target.value })} /></label>
            <label>{t("yc.ply")}<input inputMode="numeric" value={inp.ply} placeholder="1" onChange={(e) => setInp({ ...inp, ply: e.target.value })} /></label>
            <label>{t("yc.material")}<select value={inp.rho} onChange={(e) => setInp({ ...inp, rho: Number(e.target.value) })}>
              {meta.densities.map((d) => <option key={d.name} value={d.rho}>{d.name} – {d.rho} g/cm³</option>)}</select></label>
          </div>
          <table className="yc-res"><tbody>
            {FIL_ROWS.map(([k, label]) => (
              <tr key={k} className={k.startsWith("total_d") ? "big" : ""}><td>{t(label)}</td><td>{res?.filament[k] ?? "–"}</td><td><Copy text={res?.filament[k]} /></td></tr>))}
          </tbody></table>
          <div className="yc-head">{t("yc.designation")}</div>
          <div className="yc-desig"><span>{res?.filament.designation ?? "–"}</span><Copy text={res?.filament.designation} /></div>
          <div className="yc-head">{t("yc.readNotation")}</div>
          <div className="yc-row">
            <input className="yc-in" value={nota} placeholder={t("yc.notaPh")} onChange={(e) => setNota(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") takeNotation(); }} />
            <select className="yc-in" value={notaDefault} onChange={(e) => setNotaDefault(e.target.value)}>
              {["dtex", "den", "tex"].map((k) => <option key={k} value={k}>{t("yc.bare", { unit: k })}</option>)}
            </select>
          </div>
          <div className={notaMsg?.err ? "yc-err" : "muted small"}>{notaMsg?.text ?? t("yc.notaHint")}</div>
        </section>
      </div>
      <section className="yc-card">
        <button className="yc-fold" onClick={() => setShowF(!showF)}>{showF ? "▾" : "▸"} {t("yc.formulas")}</button>
        {showF && (<>
          <table className="yc-formulas"><tbody>
            {units.map((u) => <tr key={u.key}><td><b>{u.label}</b></td><td className="muted">{u.desc}</td><td><code>{u.formula}</code></td></tr>)}
          </tbody></table>
          <p className="muted small">{t("yc.formulaNote")}</p>
        </>)}
      </section>
    </div>
  );
}
