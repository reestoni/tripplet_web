import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { seriesLink } from "../links";
import { HelpButton } from "../components/Help";
import { PHONE, useMedia } from "../media";

/* Jet Advisor (desktop ui/screen_jet_advisor.py) - computing on the server (ui/jet_advisor.py, on the fits of the
   Process Playground). Targets + yarn + filters -> jets with recommended pressure / overfeed / speed.
   The last form is kept in localStorage (tripplet.jetAdvisor). */

type Item = { id: number; name: string };
type Yarn = { id: number; name: string; material_id: number | null; material: string; endtiter: number | null;
  filaments: number | null; yarn_type: string };
type Options = { jet_types: Item[]; makers: Item[]; groups: Item[]; materials: Item[]; yarns: Yarn[];
  targets: string[]; params: string[]; n_trials: number; n_combos: number };
type Pred = { value: number; sd: number; prob: number; met: boolean };
type Result = { jet_id: number; jet: string; type: string; type_id: number | null; maker: string; group: string;
  air: number | null; titer_from: number | null; titer_to: number | null; titer_ok: boolean | null; yarn_key: string;
  yarn: string; distance: number; score: number; prob: number; source: "measured" | "model";
  settings: Record<string, number>; window: Record<string, [number, number]>; miss: number; safety: number;
  air_nm3h: number | null; all_met: boolean; preds: Record<string, Pred>; n_trials: number; n_series: number;
  n_at_setting: number; series: { id: number; name: string }[]; varied: string[]; trial_id: number | null };
type Answer = { results: Result[]; n_jets: number; n_combos: number; yarns: { key: string; name: string; distance: number }[];
  targets: string[] };

type Form = {
  yarnMode: "db" | "own"; yarnId: string; material: string; endtiter: string; filaments: string;
  sameMaterial: boolean; reach: string;
  targets: Record<string, { lo: string; hi: string }>;
  jetTypes: number[]; makers: number[]; groups: number[]; titerFit: boolean;
  limits: Record<string, { lo: string; hi: string }>; prefer: "robust" | "air";
};

const TARGETS = ["fpm", "fpm_cv", "stab03", "stab06", "stab10", "stab13"];
const PARAMS = ["pressure", "of", "speed"];
const UNITS: Record<string, string> = { fpm: "1/m", fpm_cv: "%", stab03: "%", stab06: "%", stab10: "%", stab13: "%",
  pressure: "bar", of: "%", speed: "m/min" };
const DEC: Record<string, number> = { pressure: 1, of: 1, speed: 0 };
const REACH = ["0.3", "0.6", "1", "1.5"];
const KEY = "tripplet.jetAdvisor";

const empty = (): Form => ({
  yarnMode: "db", yarnId: "", material: "", endtiter: "", filaments: "", sameMaterial: true, reach: "1",
  targets: Object.fromEntries(TARGETS.map((k) => [k, { lo: "", hi: "" }])),
  jetTypes: [], makers: [], groups: [], titerFit: false,
  limits: Object.fromEntries(PARAMS.map((k) => [k, { lo: "", hi: "" }])), prefer: "robust",
});

function loadForm(): Form {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const f = { ...empty(), ...JSON.parse(raw) } as Form;
      f.targets = { ...empty().targets, ...f.targets };
      f.limits = { ...empty().limits, ...f.limits };
      return f;
    }
  } catch { /* private window */ }
  return empty();
}

const num = (s: string): number | null => {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : null;
};
const fmt = (v: number | null | undefined, dec = 1) => (v == null ? "–" : v.toFixed(dec));
const pct = (p: number) => `${Math.round(p * 100)} %`;

function probClass(p: number) {
  return p >= 0.8 ? "good" : p >= 0.5 ? "ok" : p >= 0.2 ? "weak" : "bad";
}

export default function JetAdvisor() {
  const { t } = useI18n();
  const [opts, setOpts] = useState<Options | null>(null);
  const [form, setForm] = useState<Form>(loadForm);
  const [ans, setAns] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [yarnSearch, setYarnSearch] = useState("");

  const load = (reload = false) => {
    setErr(null);
    request<Options>("GET", `/api/jet-advisor/options${reload ? "?reload=1" : ""}`)
      .then(setOpts)
      .catch((e) => setErr(t("ja.err.load_failed") + (e?.message ? ` (${e.message})` : "")));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(form)); } catch { /* ignore */ } }, [form]);

  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const setTarget = (k: string, side: "lo" | "hi", v: string) =>
    setForm((f) => ({ ...f, targets: { ...f.targets, [k]: { ...f.targets[k], [side]: v } } }));
  const setLimit = (k: string, side: "lo" | "hi", v: string) =>
    setForm((f) => ({ ...f, limits: { ...f.limits, [k]: { ...f.limits[k], [side]: v } } }));
  const toggle = (key: "jetTypes" | "makers" | "groups", id: number) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const yarn = opts?.yarns.find((y) => String(y.id) === form.yarnId) ?? null;
  const yarnList = useMemo(() => {
    const q = yarnSearch.trim().toLowerCase();
    return (opts?.yarns ?? []).filter((y) => !q || y.name.toLowerCase().includes(q) || y.material.toLowerCase().includes(q));
  }, [opts, yarnSearch]);

  const phone = useMedia(PHONE);
  const resultsRef = useRef<HTMLDivElement>(null);
  const run = () => {
    setErr(null);
    const targets: Record<string, { lo: number | null; hi: number | null }> = {};
    for (const k of TARGETS) {
      const lo = num(form.targets[k].lo), hi = num(form.targets[k].hi);
      if (lo != null || hi != null) targets[k] = { lo, hi };
    }
    const limits: Record<string, (number | null)[]> = {};
    for (const p of PARAMS) {
      const lo = num(form.limits[p].lo), hi = num(form.limits[p].hi);
      if (lo != null || hi != null) limits[p] = [lo, hi];
    }
    const body = {
      targets, limits, prefer: form.prefer, same_material: form.sameMaterial, max_distance: num(form.reach) ?? 1,
      titer_fit: form.titerFit,
      jet_types: form.jetTypes.length ? form.jetTypes : null, makers: form.makers.length ? form.makers : null,
      groups: form.groups.length ? form.groups : null,
      ...(form.yarnMode === "db"
        ? { yarn_id: form.yarnId ? Number(form.yarnId) : null }
        : { endtiter: num(form.endtiter), filaments: num(form.filaments), material_id: form.material ? Number(form.material) : null }),
    };
    setBusy(true);
    request<Answer>("POST", "/api/jet-advisor/advise", body)
      .then((a) => {
        setAns(a); setOpen(null);
        // phone: the inputs fill the screen - jump down to the list
        if (phone) window.setTimeout(() => resultsRef.current?.scrollIntoView({ block: "start" }), 50);
      })
      .catch((e) => setErr(e instanceof ApiError && e.code ? t(`ja.err.${e.code}`) : String(e?.message || e)))
      .finally(() => setBusy(false));
  };

  const reset = () => { setForm(empty()); setAns(null); };
  const activeTargets = ans?.targets ?? [];

  if (!opts) {
    return <div className="page"><div className="page-head"><h1>{t("ja.title")}</h1></div>
      {err ? <div className="mj-msg err">{err}</div> : <p className="muted">{t("ja.loading")}</p>}</div>;
  }

  const chips = (key: "jetTypes" | "makers" | "groups", items: Item[]) => (
    <div className="ja-chips">
      {items.map((it) => (
        <button key={it.id} type="button" className={"ja-chip" + (form[key].includes(it.id) ? " on" : "")}
          onClick={() => toggle(key, it.id)}>{it.name || t("ja.none")}</button>
      ))}
    </div>
  );

  const detail = (r: Result) => (
      <div className="ja-det">
        <div>
          <div className="ja-lab">{t("ja.detail.jet")}</div>
          <div className="small">{[r.maker, r.group].filter(Boolean).join(" · ") || "–"}</div>
          <div className="small muted">{t("ja.detail.titer", { from: fmt(r.titer_from, 0), to: fmt(r.titer_to, 0) })}</div>
        </div>
        <div>
          <div className="ja-lab">{t("ja.detail.why")}</div>
          <div className="small">
            {r.source === "measured" ? t("ja.detail.measured", { n: r.n_at_setting }) : t("ja.detail.model")}
            {" "}{t("ja.detail.varied", { list: r.varied.map((p) => t(`pp.param.${p}`)).join(", ") || "–" })}
          </div>
          <div className="small muted">{r.all_met ? t("ja.detail.safety", { s: fmt(r.safety) }) : t("ja.detail.miss", { s: fmt(r.miss) })}</div>
        </div>
        <div>
          <div className="ja-lab">{t("ja.detail.series")}</div>
          <div className="ja-links">
            {r.series.map((s) => <Link key={s.id} to={seriesLink(s.id)} target="_blank">{s.name || `#${s.id}`}</Link>)}
          </div>
        </div>
        {r.trial_id != null && (
          <div>
            <Link className="btn-plain" to={`/tools/process-playground?trial=${r.trial_id}`} target="_blank">{t("ja.detail.playground")}</Link>
          </div>
        )}
      </div>
  );

  /* phone: one card per jet instead of the wide table; tap = details */
  const cards = (rows: Result[]) => (
    <div className="ja-cards">
      {rows.map((r, i) => (
        <div key={r.jet_id} className={"ja-card" + (open === r.jet_id ? " open" : "")}>
          <button className="ja-card-head" onClick={() => setOpen(open === r.jet_id ? null : r.jet_id)} aria-expanded={open === r.jet_id}>
            <span className="ja-card-no muted">{i + 1}</span>
            <span className="ja-card-name">
              <b>{r.jet}</b>
              <span className="small">
                {r.type && <span className={"ja-type t" + (r.type_id ?? 0)}>{r.type}</span>}
                {r.titer_ok === false && <span className="ja-warn">⚠ {t("ja.titerOut")}</span>}
              </span>
            </span>
            <span className="ja-card-prob">
              <span className={"ja-prob " + probClass(r.prob)}><span style={{ width: pct(r.prob) }} /></span>
              <span className="small">{pct(r.prob)}</span>
            </span>
            <span className="ja-card-fold muted">{open === r.jet_id ? "▾" : "▸"}</span>
          </button>
          <div className="ja-card-vals">
            {PARAMS.map((p) => {
              const [a, b] = r.window[p] ?? [r.settings[p], r.settings[p]];
              return (
                <div key={p}><span className="muted small">{t(`pp.param.${p}`)}</span>
                  <b>{fmt(r.settings[p], DEC[p])} <span className="muted small">{UNITS[p]}</span></b>
                  {Math.abs(b - a) > 1e-6 && <span className="muted small">{fmt(a, DEC[p])}–{fmt(b, DEC[p])}</span>}
                </div>
              );
            })}
            {activeTargets.map((k) => {
              const pr = r.preds[k];
              return (
                <div key={k} className={pr ? (pr.met ? "met" : "miss") : ""}><span className="muted small">{t(`pp.target.${k}`)}</span>
                  <b>{pr ? <>{pr.met ? "✓ " : "✗ "}{fmt(pr.value)}</> : "–"} <span className="muted small">{UNITS[k]}</span></b>
                  {pr && <span className="muted small">± {fmt(pr.sd)}</span>}
                </div>
              );
            })}
            <div><span className="muted small">{t("ja.col.air")}</span><b>{fmt(r.air_nm3h, 2)} <span className="muted small">Nm³/h</span></b></div>
          </div>
          <div className="ja-card-basis small">
            <span className={"ja-src " + r.source}>{t(`ja.src.${r.source}`)}</span>{" "}
            <span className="muted">{r.yarn}{r.distance > 0 ? ` (${r.distance.toFixed(2)})` : ""} · {t("ja.trialsSeries", { n: r.n_trials, s: r.n_series })}</span>
          </div>
          {open === r.jet_id && detail(r)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="page ja-page">
      <div className="page-head">
        <h1>{t("ja.title")}</h1>
        <span className="muted small">{t("ja.basis", { trials: opts.n_trials, combos: opts.n_combos })}</span>
        <button className="btn-plain ja-head-btn" onClick={() => load(true)} title={t("ja.reloadTip")}>{t("ja.reload")}</button>
        <HelpButton screen="jet_advisor" />
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="ja-grid">
        <div className="ja-inputs">
          <section className="jr-card">
            <h2>{t("ja.yarn")}</h2>
            <div className="ja-seg">
              <button className={form.yarnMode === "db" ? "on" : ""} onClick={() => set({ yarnMode: "db" })}>{t("ja.yarnDb")}</button>
              <button className={form.yarnMode === "own" ? "on" : ""} onClick={() => set({ yarnMode: "own" })}>{t("ja.yarnOwn")}</button>
            </div>
            {form.yarnMode === "db" ? (
              <div className="jr-form">
                <input className="ja-search" placeholder={t("ja.yarnSearch")} value={yarnSearch} onChange={(e) => setYarnSearch(e.target.value)} />
                <select size={6} value={form.yarnId} onChange={(e) => set({ yarnId: e.target.value })}>
                  {yarnList.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
                {yarn && <div className="muted small">{yarn.material} · {fmt(yarn.endtiter, 0)} dtex · f{fmt(yarn.filaments, 0)}{yarn.yarn_type ? ` · ${yarn.yarn_type}` : ""}</div>}
              </div>
            ) : (
              <div className="jr-form">
                <label>{t("ja.material")}<select value={form.material} onChange={(e) => set({ material: e.target.value })}>
                  <option value="">{t("ja.anyMaterial")}</option>
                  {opts.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <label>{t("ja.endtiter")}<span className="jr-unit"><input inputMode="decimal" value={form.endtiter} onChange={(e) => set({ endtiter: e.target.value })} /> dtex</span></label>
                <label>{t("ja.filaments")}<input inputMode="numeric" value={form.filaments} onChange={(e) => set({ filaments: e.target.value })} /></label>
              </div>
            )}
            <div className="jr-form">
              <label>{t("ja.reach")}<select value={form.reach} onChange={(e) => set({ reach: e.target.value })}>
                {REACH.map((r) => <option key={r} value={r}>{t(`ja.reach.${r}`)}</option>)}</select></label>
              <label className="ja-check"><input type="checkbox" checked={form.sameMaterial} onChange={(e) => set({ sameMaterial: e.target.checked })} />{t("ja.sameMaterial")}</label>
            </div>
          </section>

          <section className="jr-card">
            <h2>{t("ja.targets")}</h2>
            <table className="ja-tt">
              <thead><tr><th></th><th>{t("ja.min")}</th><th>{t("ja.max")}</th><th></th></tr></thead>
              <tbody>
                {TARGETS.map((k) => (
                  <tr key={k}>
                    <td>{t(`pp.target.${k}`)}</td>
                    <td><input inputMode="decimal" value={form.targets[k].lo} onChange={(e) => setTarget(k, "lo", e.target.value)} /></td>
                    <td><input inputMode="decimal" value={form.targets[k].hi} onChange={(e) => setTarget(k, "hi", e.target.value)} /></td>
                    <td className="muted small">{UNITS[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="jr-card">
            <h2>{t("ja.jets")}</h2>
            <div className="ja-lab">{t("ja.jetType")} <span className="muted small">{t("ja.allIfNone")}</span></div>
            {chips("jetTypes", opts.jet_types)}
            <details className="ja-more">
              <summary>{t("ja.moreFilters")}{(form.makers.length || form.groups.length) ? " •" : ""}</summary>
              <div className="ja-lab">{t("ja.maker")}</div>
              {chips("makers", opts.makers)}
              <div className="ja-lab">{t("ja.group")}</div>
              {chips("groups", opts.groups)}
            </details>
            <label className="ja-check"><input type="checkbox" checked={form.titerFit} onChange={(e) => set({ titerFit: e.target.checked })} />{t("ja.titerFit")}</label>
          </section>

          <section className="jr-card">
            <h2>{t("ja.settings")}</h2>
            <table className="ja-tt">
              <thead><tr><th></th><th>{t("ja.from")}</th><th>{t("ja.to")}</th><th></th></tr></thead>
              <tbody>
                {PARAMS.map((p) => (
                  <tr key={p}>
                    <td>{t(`pp.param.${p}`)}</td>
                    <td><input inputMode="decimal" value={form.limits[p].lo} onChange={(e) => setLimit(p, "lo", e.target.value)} /></td>
                    <td><input inputMode="decimal" value={form.limits[p].hi} onChange={(e) => setLimit(p, "hi", e.target.value)} /></td>
                    <td className="muted small">{UNITS[p]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ja-lab">{t("ja.prefer")}</div>
            <div className="ja-seg">
              <button className={form.prefer === "robust" ? "on" : ""} onClick={() => set({ prefer: "robust" })}>{t("ja.preferRobust")}</button>
              <button className={form.prefer === "air" ? "on" : ""} onClick={() => set({ prefer: "air" })}>{t("ja.preferAir")}</button>
            </div>
          </section>

          <div className="ja-actions">
            <button className="btn-green" disabled={busy} onClick={run}>{busy ? t("ja.searching") : t("ja.search")}</button>
            <button className="btn-plain" onClick={reset}>{t("ja.reset")}</button>
          </div>
        </div>

        <div className="ja-results" ref={resultsRef}>
          {!ans ? (
            <div className="ja-empty muted">{t("ja.start")}</div>
          ) : (
            <>
              <div className="ja-summary">
                {t("ja.found", { jets: ans.n_jets, combos: ans.n_combos })}
                {ans.yarns.length > 0 && (
                  <div className="ja-yarns">
                    <span className="muted small">{t("ja.basedOnYarns")}</span>
                    {ans.yarns.slice(0, 12).map((y) => (
                      <span key={y.key} className="ja-ychip" title={t("ja.distanceTip")}>{y.name} <b>{y.distance.toFixed(2)}</b></span>
                    ))}
                    {ans.yarns.length > 12 && <span className="muted small">+{ans.yarns.length - 12}</span>}
                  </div>
                )}
              </div>
              {ans.results.length === 0 ? (
                <div className="ja-empty muted">{ans.yarns.length === 0 ? t("ja.noYarns") : t("ja.noJets")}</div>
              ) : phone ? cards(ans.results) : (
                <div className="ja-tablewrap">
                  <table className="ja-res">
                    <thead>
                      <tr>
                        <th>#</th><th>{t("ja.col.jet")}</th><th>{t("ja.col.hit")}</th>
                        {PARAMS.map((p) => <th key={p} className="ja-num" title={t(`pp.param.${p}`)}>{t(`ja.short.${p}`)}<div className="muted small">{UNITS[p]}</div></th>)}
                        {activeTargets.map((k) => <th key={k} className="ja-num" title={t(`pp.target.${k}`)}>{t(`ja.short.${k}`)}<div className="muted small">{UNITS[k]}</div></th>)}
                        <th className="ja-num">{t("ja.col.air")}<div className="muted small">Nm³/h</div></th>
                        <th>{t("ja.col.basis")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ans.results.map((r, i) => (
                        <Fragment key={r.jet_id}>
                          <tr className={"ja-row" + (open === r.jet_id ? " open" : "")} onClick={() => setOpen(open === r.jet_id ? null : r.jet_id)}>
                            <td className="muted">{i + 1}</td>
                            <td>
                              <b>{r.jet}</b>
                              <div className="small">
                                {r.type && <span className={"ja-type t" + (r.type_id ?? 0)}>{r.type}</span>}
                                {r.titer_ok === false && <span className="ja-warn" title={t("ja.titerOutTip", { from: fmt(r.titer_from, 0), to: fmt(r.titer_to, 0) })}>⚠ {t("ja.titerOut")}</span>}
                              </div>
                            </td>
                            <td>
                              <div className={"ja-prob " + probClass(r.prob)}><span style={{ width: pct(r.prob) }} /></div>
                              <div className="small">{pct(r.prob)}</div>
                            </td>
                            {PARAMS.map((p) => {
                              const [a, b] = r.window[p] ?? [r.settings[p], r.settings[p]];
                              return (
                                <td key={p} className="ja-num">
                                  <b>{fmt(r.settings[p], DEC[p])}</b>
                                  {Math.abs(b - a) > 1e-6 && <div className="muted small">{fmt(a, DEC[p])}–{fmt(b, DEC[p])}</div>}
                                </td>
                              );
                            })}
                            {activeTargets.map((k) => {
                              const pr = r.preds[k];
                              return (
                                <td key={k} className={"ja-num " + (pr?.met ? "met" : "miss")} title={pr ? t("ja.predTip", { p: pct(pr.prob) }) : ""}>
                                  {pr ? <>{pr.met ? "✓ " : "✗ "}{fmt(pr.value)}<div className="muted small">± {fmt(pr.sd)}</div></> : "–"}
                                </td>
                              );
                            })}
                            <td className="ja-num">{fmt(r.air_nm3h, 2)}</td>
                            <td className="small ja-basis" title={r.yarn}>
                              <span className={"ja-src " + r.source}>{t(`ja.src.${r.source}`)}</span>
                              <div className="muted">{r.yarn}{r.distance > 0 ? ` (${r.distance.toFixed(2)})` : ""}</div>
                              <div className="muted">{t("ja.trialsSeries", { n: r.n_trials, s: r.n_series })}</div>
                            </td>
                          </tr>
                          {open === r.jet_id && (
                            <tr className="ja-detail">
                              <td></td>
                              <td colSpan={5 + activeTargets.length + 1}>
                                {detail(r)}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
