import { useEffect, useMemo, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "./SeriesTools";

/* Dialogs of Smart Chart / Dashboards (desktop Qt dialogs: ui/smart_chart_filter_dialog.py, smart_calc_dialog.py,
   _FairnessDialog / _OpenViewDialog / _SaveViewDialog in screen_smart_chart.py, smart_share_dialog.py) on
   backend/app/smart_chart_api.py. Rules and counting live in ui/smart_dashboard_core.py (shared with the desktop);
   field names, filter texts and fairness sentences are data from there (English, like the dashboard page). */

export type Summary = { trials: number; series: number; machines: number; jets: number; filters: string[];
  ply_scope: string; pages: number; visuals: number; refs: boolean; dirty: boolean };
export type Answer = { cmds: [string, unknown][]; summary: Summary; view?: ViewInfo | null; missing?: string[]; download?: string };
export type ViewInfo = { id: number; name: string; owner: string; folder: string; favourite: boolean; right: "owner" | "edit" | "view"; shared: boolean;
  when: string; kind: { pages: number; visuals: number }; dashboard: boolean; can_change: boolean; can_delete: boolean; can_share: boolean };

const nf = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
const num = (x: number | null | undefined) => (x == null ? "" : String(Number(x.toFixed(4))));

export function errText(t: (k: string, v?: Record<string, string | number>) => string, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code && ["formula", "too_big"].includes(e.code)) return e.message;
    if (e.code) return t(`sc.err.${e.code}`);
    return e.message;
  }
  return String(e);
}

/* ------------------------------------------------------------------ filter editor */
type FieldInfo = { key: string; label: string; group: string };
type Overview = { key: string; label: string; group: string; unit: string; kind: "num" | "cat"; level: string; time: boolean;
  hist?: { counts: number[]; edges: number[]; n: number; min: number | null; max: number | null; lo: number | null; hi: number | null };
  cats?: [string, number][]; periods?: Record<string, string>; time_labels?: string[] };
type Flt = Record<string, unknown> & { key: string };

/** Round a dragged histogram value to a readable number (same rule as ui/smart_dashboard_core.snap). */
function snap(v: number): number {
  if (v === 0) return 0;
  const mag = Math.abs(v) >= 10 ? 10 ** (String(Math.trunc(Math.abs(v))).length - 2) : 0.1;
  return Math.round(Math.round(v / mag) * mag * 10000) / 10000;
}

function Histogram({ hist, lo, hi, onRange }: { hist: NonNullable<Overview["hist"]>; lo: number | null; hi: number | null;
  onRange: (lo: number, hi: number) => void }) {
  const { t } = useI18n();
  const ref = useRef<SVGSVGElement | null>(null);
  const drag = useRef<number | null>(null);
  const { counts, edges } = hist;
  if (!counts.length) return <div className="sc-hist-empty">{t("sc.f.noValues")}</div>;
  const W = 520, H = 150, mx = Math.max(...counts) || 1, bw = W / counts.length;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return edges[0] + f * (edges[edges.length - 1] - edges[0]);
  };
  const move = (x: number) => {
    if (drag.current === null) return;
    const v = at(x);
    const [a, b] = [drag.current, v].sort((p, q) => p - q);
    onRange(snap(a), snap(b));
  };
  return (
    <svg ref={ref} className="sc-hist" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      onMouseDown={(e) => { drag.current = at(e.clientX); }} onMouseMove={(e) => move(e.clientX)}
      onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}>
      <title>{t("sc.f.dragTip")}</title>
      {counts.map((c, i) => {
        const a = edges[i], b = edges[i + 1];
        const inside = (lo !== null || hi !== null) && (lo === null || b > lo) && (hi === null || a < hi);
        const bh = c ? Math.max(1, (c / mx) * (H - 6)) : 0;
        return <rect key={i} x={i * bw + 1} y={H - bh} width={Math.max(1, bw - 2)} height={bh} rx={2} fill={inside ? "#1F7A3A" : "#CBD5CB"} />;
      })}
    </svg>
  );
}

export function FilterDialog({ sid, scope, vid, index, onClose, onDone }: { sid: string; scope: string; vid: string; index: number;
  onClose: () => void; onDone: (a: Answer) => void }) {
  const { t } = useI18n();
  const ref = { scope, vid, index };
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [tree, setTree] = useState<[string, string[]][]>([]);
  const [edit, setEdit] = useState<Flt | null>(null);
  const [plyScope, setPlyScope] = useState("any");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ov, setOv] = useState<Overview | null>(null);
  const [lo, setLo] = useState(""); const [hi, setHi] = useState("");
  const [mode, setMode] = useState<"all" | "step" | "pick">("all");
  const [step, setStep] = useState("1");
  const [pickVals, setPickVals] = useState<[number, number][] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [period, setPeriod] = useState(""); const [pFrom, setPFrom] = useState(""); const [pTo, setPTo] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [catQ, setCatQ] = useState("");
  const [hits, setHits] = useState<{ base: number; n: number | null; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const freshPick = useRef(true);

  useEffect(() => {
    request<{ tree: [string, string[]][]; fields: FieldInfo[]; edit: Flt | null; ply_scope: string }>("POST", `/api/smart/${sid}/filter/fields`, ref)
      .then((d) => { setFields(d.fields); setTree(d.tree); setEdit(d.edit); setPlyScope(d.ply_scope); if (d.edit) choose(d.edit.key, d.edit); })
      .catch((e) => setErr(errText(t, e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (key: string, flt?: Flt | null) => {
    setErr(null);
    request<Overview>("POST", `/api/smart/${sid}/filter/field`, { ...ref, key }).then((o) => {
      setOv(o);
      setLo(flt && flt.min != null ? num(flt.min as number) : ""); setHi(flt && flt.max != null ? num(flt.max as number) : "");
      const only = (flt?.only as number[] | undefined) || [];
      setMode(only.length ? "pick" : flt?.step ? "step" : "all");
      setStep(flt?.step ? num(flt.step as number) : "1");
      setPicked(new Set(only.map((x) => Math.round(Number(x) * 1e6) / 1e6))); freshPick.current = !only.length; setPickVals(null);
      setPeriod((flt?.period as string) || ""); setPFrom((flt?.from as string) || ""); setPTo((flt?.to as string) || "");
      setCats(new Set((flt?.values as string[]) || [])); setCatQ("");
    }).catch((e) => setErr(errText(t, e)));
  };

  // "Pick values": the numbers between From and To
  useEffect(() => {
    if (!ov || ov.kind !== "num" || mode !== "pick") return;
    const h = setTimeout(() => {
      request<{ values: [number, number][] | null }>("POST", `/api/smart/${sid}/filter/values`,
        { ...ref, key: ov.key, lo: lo === "" ? null : Number(lo.replace(",", ".")), hi: hi === "" ? null : Number(hi.replace(",", ".")) })
        .then((d) => {
          setPickVals(d.values);
          if (d.values && freshPick.current) { setPicked(new Set(d.values.map((v) => v[0]))); freshPick.current = false; }
        }).catch(() => undefined);
    }, 200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, mode, lo, hi]);

  const raw = (): Record<string, unknown> => ov?.kind === "num"
    ? { min: lo, max: hi, mode, step, only: [...picked].filter((x) => !pickVals || pickVals.some((v) => v[0] === x)) }
    : { period, from: pFrom, to: pTo, values: [...cats] };

  useEffect(() => {
    if (!ov) { setHits(null); return; }
    const h = setTimeout(() => {
      request<{ base: number; n: number | null; text: string }>("POST", `/api/smart/${sid}/filter/hits`, { ...ref, key: ov.key, raw: raw() })
        .then(setHits).catch(() => undefined);
    }, 180);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, lo, hi, mode, step, picked, pickVals, period, pFrom, pTo, cats]);

  const apply = () => {
    if (!ov) return;
    request<Answer>("POST", `/api/smart/${sid}/filter/put`, { ...ref, key: ov.key, raw: raw() })
      .then((a) => { onDone(a); onClose(); }).catch((e) => setErr(errText(t, e)));
  };

  const ql = q.trim().toLowerCase();
  const match = (f: FieldInfo, top: string) => !ql || f.label.toLowerCase().includes(ql) || f.group.toLowerCase().includes(ql) || top.toLowerCase().includes(ql);
  const scopeTitle = t(`sc.f.scope.${scope}`);
  const hist = ov?.hist;
  const unit = ov?.unit ? " " + ov.unit : "";
  const shownCats = (ov?.cats || []).filter(([lab]) => !catQ.trim() || lab.toLowerCase().includes(catQ.trim().toLowerCase()));

  return (
    <Modal title={(edit ? t("sc.f.edit") : t("sc.f.add")) + " – " + scopeTitle} onClose={onClose} wide>
      <div className="sc-filter">
        <div className="sc-fields">
          <input className="mj-search" placeholder={t("sc.f.searchField")} value={q} disabled={!!edit} onChange={(e) => setQ(e.target.value)} autoFocus={!edit} />
          <div className="sc-tree">
            {tree.map(([top, subs]) => {
              const groups = [top, ...subs];
              const per = groups.map((g) => [g, fields.filter((f) => f.group === g && match(f, top))] as const);
              const n = per.reduce((s, [, fs]) => s + fs.length, 0);
              if (!n) return null;
              const isOpen = !!ql || open[top] || (ov && per.some(([, fs]) => fs.some((f) => f.key === ov.key)));
              return (
                <div key={top}>
                  <div className="sc-top" onClick={() => setOpen({ ...open, [top]: !isOpen })}>{isOpen ? "▾" : "▸"} {top} ({n})</div>
                  {isOpen && per.map(([g, fs]) => fs.length ? (
                    <div key={g} className={g === top ? "" : "sc-sub"}>
                      {g !== top && <div className="sc-subhead">{g} ({fs.length})</div>}
                      {fs.map((f) => (
                        <div key={f.key} className={"sc-field" + (ov?.key === f.key ? " on" : "") + (edit ? " dis" : "")}
                          onClick={() => { if (!edit) choose(f.key); }}>{f.label}</div>
                      ))}
                    </div>) : null)}
                </div>
              );
            })}
          </div>
        </div>
        <div className="sc-editor">
          {!ov ? <p className="muted">{t("sc.f.choose")}</p> : (<>
            <h3>{ov.label}</h3>
            <p className="muted">{ov.group}{ov.level === "yarn" ? " · " + t(plyScope === "any" ? "sc.f.anyPly" : "sc.f.plies", { s: plyScope }) : ""}</p>
            {ov.kind === "num" && hist && (<>
              <Histogram hist={hist} lo={lo === "" ? null : Number(lo)} hi={hi === "" ? null : Number(hi)}
                onRange={(a, b) => { setLo(num(a)); setHi(num(b)); }} />
              <p className="muted">{hist.n ? t("sc.f.axis", { n: nf(hist.n), min: num(hist.min) + unit, max: num(hist.max) + unit }) : t("sc.f.noValues")}</p>
              <div className="sc-row">
                <label>{t("sc.f.from")} <input value={lo} placeholder={t("sc.f.any")} onChange={(e) => setLo(e.target.value)} /></label>
                <label>{t("sc.f.to")} <input value={hi} placeholder={t("sc.f.any")} onChange={(e) => setHi(e.target.value)} /></label>
              </div>
              <div className="sc-row">
                <label><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> {t("sc.f.allValues")}</label>
                <label title={t("sc.f.stepTip")}><input type="radio" checked={mode === "step"} onChange={() => setMode("step")} /> {t("sc.f.every")}</label>
                <input className="sc-step" list="sc-steps" value={step} onChange={(e) => { setStep(e.target.value); setMode("step"); }} />
                <datalist id="sc-steps">{["1", "0.5", "0.25", "0.2", "0.1"].map((s) => <option key={s} value={s} />)}</datalist>
                <label><input type="radio" checked={mode === "pick"} onChange={() => setMode("pick")} /> {t("sc.f.pick")}</label>
              </div>
              {mode === "pick" && (pickVals === null ? <p className="muted">{t("sc.f.tooMany")}</p> : !pickVals.length ? <p className="muted">{t("sc.f.noneInRange")}</p> : (
                <div className="sc-list">
                  {pickVals.map(([x, n]) => (
                    <label key={x}><input type="checkbox" checked={picked.has(x)} onChange={() => {
                      const s = new Set(picked); if (s.has(x)) s.delete(x); else s.add(x); setPicked(s);
                    }} /> {num(x)}{unit} <span className="muted">({nf(n)})</span></label>
                  ))}
                </div>))}
            </>)}
            {ov.kind === "cat" && (<>
              {ov.time && (
                <div className="sc-row">
                  <label>{t("sc.f.period")} <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                    <option value="">{t("sc.f.pickBelow")}</option>
                    {Object.keys(ov.periods || {}).map((k) => <option key={k} value={k}>{t(`sc.period.${k}`)}</option>)}
                  </select></label>
                  {period === "range" && (<>
                    <label>{t("sc.f.from")} <select value={pFrom} onChange={(e) => setPFrom(e.target.value)}>
                      <option value="">{t("sc.f.open")}</option>{(ov.time_labels || []).map((l) => <option key={l}>{l}</option>)}</select></label>
                    <label>{t("sc.f.to")} <select value={pTo} onChange={(e) => setPTo(e.target.value)}>
                      <option value="">{t("sc.f.open")}</option>{(ov.time_labels || []).map((l) => <option key={l}>{l}</option>)}</select></label>
                  </>)}
                </div>)}
              <input className="mj-search" placeholder={t("sc.f.searchValue")} value={catQ} disabled={!!period} onChange={(e) => setCatQ(e.target.value)} />
              <div className={"sc-list tall" + (period ? " dis" : "")}>
                {shownCats.map(([lab, n]) => (
                  <label key={lab}><input type="checkbox" disabled={!!period} checked={cats.has(lab)} onChange={() => {
                    const s = new Set(cats); if (s.has(lab)) s.delete(lab); else s.add(lab); setCats(s);
                  }} /> {lab} <span className="muted">({nf(n)})</span></label>
                ))}
              </div>
              <button className="btn-plain" disabled={!!period} onClick={() => setCats(new Set())}>{t("sc.f.clearTicks")}</button>
            </>)}
            {hits && <div className="sc-hits">{hits.n === null ? t("sc.f.tickOne", { base: nf(hits.base) })
              : t("sc.f.hits", { n: nf(hits.n), what: hits.text, base: nf(hits.base) })}</div>}
          </>)}
          {err && <div className="login-error">{err}</div>}
          <div className="modal-buttons">
            <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
            <button className="btn-green" disabled={!ov || !hits || hits.n === null} onClick={apply}>{edit ? t("sc.f.apply") : t("sc.f.add")}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ calculated field */
export function CalcDialog({ sid, calcKey, onClose, onDone }: { sid: string; calcKey: string; onClose: () => void; onDone: (a: Answer) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<{ key: string; exists: boolean; name: string; unit: string; formula: string; fields: { name: string; label: string; group: string }[];
    library: { name: string; unit: string; formula: string; view: string }[] } | null>(null);
  const [name, setName] = useState(""); const [unit, setUnit] = useState(""); const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [prev, setPrev] = useState<{ error?: string; n?: number; min?: number; avg?: number; max?: number;
    filtered?: { base: number; n: number; min?: number; avg?: number; max?: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    request<NonNullable<typeof d>>("GET", `/api/smart/${sid}/calc?key=${encodeURIComponent(calcKey)}`)
      .then((x) => { setD(x); setName(x.name); setUnit(x.unit); setText(x.formula); }).catch((e) => setErr(errText(t, e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!d) return;
    const h = setTimeout(() => {
      request<NonNullable<typeof prev>>("POST", `/api/smart/${sid}/calc/preview`, { key: d.key, text }).then(setPrev).catch(() => undefined);
    }, 250);
    return () => clearTimeout(h);
  }, [d, text, sid]);

  const insert = (s: string) => {
    const el = ta.current;
    if (!el) { setText(text + s); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    const nt = text.slice(0, a) + s + text.slice(b);
    setText(nt);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = a + s.length; }, 0);
  };
  const save = () => request<Answer>("POST", `/api/smart/${sid}/calc/save`, { key: d!.key, name, unit, text })
    .then((a) => { onDone(a); onClose(); }).catch((e) => setErr(errText(t, e)));
  const del = () => {
    if (!window.confirm(t("sc.c.deleteAsk"))) return;
    request<Answer>("POST", `/api/smart/${sid}/calc/delete`, { key: d!.key }).then((a) => { onDone(a); onClose(); }).catch((e) => setErr(errText(t, e)));
  };
  const fmt = (x?: number) => (x == null ? "" : Math.abs(x) >= 100 ? x.toFixed(0) : Number(x.toPrecision(3)).toString());
  const ops: [string, string][] = [["+", " + "], ["−", " - "], ["×", " * "], ["÷", " / "], ["(", "("], [")", ")"], ["^", "^"],
    ["abs", "abs("], ["sqrt", "sqrt("], ["log10", "log10("], ["min", "min("], ["max", "max("]];
  const ql = q.trim().toLowerCase();

  return (
    <Modal title={d?.exists ? t("sc.c.change") : t("sc.c.new")} onClose={onClose} wide>
      {!d ? <p className="muted">{err ?? t("app.loading")}</p> : (
        <div className="sc-calc">
          <div>
            <label className="sc-lab">{t("sc.c.name")}<input value={name} placeholder={t("sc.c.namePh")} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            <label className="sc-lab">{t("sc.c.unit")}<input value={unit} placeholder={t("sc.c.unitPh")} onChange={(e) => setUnit(e.target.value)} /></label>
            {!d.exists && d.library.length > 0 && (
              <select className="sc-lib" value="" onChange={(e) => {
                const c = d.library[Number(e.target.value)];
                if (c) { setName(c.name); setUnit(c.unit); setText(c.formula); }
              }}>
                <option value="">{t("sc.c.copyFrom", { n: d.library.length })}</option>
                {d.library.map((c, i) => <option key={i} value={i}>{c.name} · {c.view}</option>)}
              </select>)}
            <label className="sc-lab">{t("sc.c.formula")}
              <textarea ref={ta} rows={4} value={text} placeholder="[Intermingling Points (FP/m)] / [Air Consumption (m3/h)]" onChange={(e) => setText(e.target.value)} /></label>
            <div className="sc-ops">{ops.map(([l, s]) => <button key={l} className="btn-plain" onClick={() => insert(s)}>{l}</button>)}</div>
            <div className="sc-preview">{!prev ? "" : prev.error ? <span className="err">{prev.error}</span>
              : !prev.n ? t("sc.c.noTrial") : t("sc.c.preview", { n: nf(prev.n), min: fmt(prev.min), avg: fmt(prev.avg), max: fmt(prev.max) })}
              {prev?.filtered && !prev.error && <div>{t("sc.c.previewFiltered", { n: nf(prev.filtered.n), base: nf(prev.filtered.base) })}
                {prev.filtered.n ? " · " + t("sc.c.stats", { min: fmt(prev.filtered.min), avg: fmt(prev.filtered.avg), max: fmt(prev.filtered.max) }) : ""}</div>}</div>
            <p className="muted">{t("sc.c.hint")}</p>
            {err && <div className="login-error">{err}</div>}
            <div className="modal-buttons">
              {d.exists && <button className="btn-plain danger" onClick={del}>{t("sc.delete")}</button>}
              <span style={{ flex: 1 }} />
              <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
              <button className="btn-green" disabled={!name.trim() || !!prev?.error} onClick={save}>{t("sc.ok")}</button>
            </div>
          </div>
          <div>
            <b>{t("sc.c.insert")}</b>
            <input className="mj-search" placeholder={t("sc.c.searchField")} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="sc-list tall">
              {d.fields.filter((f) => !ql || f.label.toLowerCase().includes(ql) || f.group.toLowerCase().includes(ql)).map((f) => (
                <div key={f.name} className="sc-field" onDoubleClick={() => insert(`[${f.name}]`)} title={t("sc.c.dbl")}>
                  {f.label} <span className="muted">· {f.group}</span></div>
              ))}
            </div>
          </div>
        </div>)}
    </Modal>
  );
}

/* ------------------------------------------------------------------ colour */
export function ColourDialog({ sid, vid, label, current, onClose, onDone }: { sid: string; vid: string; label: string; current: string;
  onClose: () => void; onDone: (a: Answer) => void }) {
  const { t } = useI18n();
  const [c, setC] = useState(/^#[0-9a-fA-F]{6}$/.test(current) ? current : "#2F6DB5");
  const ok = () => request<Answer>("POST", `/api/smart/${sid}/colour`, { vid, label, colour: c }).then((a) => { onDone(a); onClose(); });
  return (
    <Modal title={label ? t("sc.colourOf", { name: label }) : t("sc.colour")} onClose={onClose}>
      <div className="set-row"><input type="color" value={c} onChange={(e) => setC(e.target.value)} /> <code>{c}</code></div>
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
        <button className="btn-green" onClick={ok}>{t("sc.ok")}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ fairness */
type Fair = { level: string; headline: string; sentence: string; grouping: string; groups: [string, number][];
  conditions: { title: string; influence: number; imbalance: number; level: string; per_group: [string, string][] }[];
  warnings: string[]; can_fix: boolean; fix_text: string };

export function FairDialog({ sid, vid, onClose, onDone }: { sid: string; vid: string; onClose: () => void; onDone: (a: Answer) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<{ fair: Fair | null; read_only: boolean } | null>(null);
  useEffect(() => { request<{ fair: Fair | null; read_only: boolean }>("GET", `/api/smart/${sid}/fair/${encodeURIComponent(vid)}`).then(setD); }, [sid, vid]);
  const bar = (x: number) => `${t(x >= 0.6 ? "sc.fair.high" : x >= 0.3 ? "sc.fair.medium" : "sc.fair.low")} (${Math.round(x * 100)} %)`;
  const fix = () => request<Answer>("POST", `/api/smart/${sid}/fair/${encodeURIComponent(vid)}/fix`).then((a) => { onDone(a); onClose(); });
  const a = d?.fair;
  return (
    <Modal title={t("sc.fair.title")} onClose={onClose} wide>
      {!d ? <p className="muted">{t("app.loading")}</p> : !a ? <p className="muted">{t("sc.fair.none")}</p> : (<>
        <p><b className="sc-fair-head">{a.headline}</b><br />
          {t("sc.fair.compared")}: {a.grouping} – {a.groups.slice(0, 8).map(([g, n]) => `${g} (${n})`).join(", ")}{a.groups.length > 8 ? " …" : ""}<br />{a.sentence}</p>
        <p className="muted">{t("sc.fair.expl")}</p>
        <div className="sc-fair-wrap"><table className="mj-table sc-fair">
          <thead><tr><th>{t("sc.fair.condition")}</th><th>{t("sc.fair.effect")}</th><th>{t("sc.fair.imbalance")}</th><th>{t("sc.fair.rating")}</th><th>{t("sc.fair.inGroups")}</th></tr></thead>
          <tbody>{a.conditions.map((c, i) => (
            <tr key={i}><td>{c.title}</td><td>{bar(c.influence)}</td><td>{bar(c.imbalance)}</td>
              <td className={"lv-" + c.level}>{t(`sc.fair.lv.${c.level}`)}</td><td>{c.per_group.map(([g, v]) => `${g}: ${v}`).join(" · ")}</td></tr>))}
          </tbody></table></div>
        {a.warnings.length > 0 && <div><b>{t("sc.fair.alsoNote")}</b><ul>{a.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        <p className="muted small">{t("sc.fair.note")}</p>
        <div className="modal-buttons">
          {a.can_fix && !d.read_only && <button className="btn-plain" title={a.fix_text} onClick={fix}>{t("sc.fair.fix")}</button>}
          {a.fix_text && <span className="muted" style={{ flex: 1 }}>{a.fix_text}</span>}
          <button className="btn-green" onClick={onClose}>{t("sc.close")}</button>
        </div>
      </>)}
    </Modal>
  );
}

/* ------------------------------------------------------------------ views */
/** Favourites first ("★"), then per folder, then the rest ("") - like ui/smart_dashboard_core.group_views. */
export function viewGroups(vs: ViewInfo[]): [string, ViewInfo[]][] {
  const byName = (a: ViewInfo, b: ViewInfo) => a.name.localeCompare(b.name);
  const out: [string, ViewInfo[]][] = [];
  const favs = vs.filter((v) => v.favourite);
  if (favs.length) out.push(["★", [...favs].sort(byName)]);
  const folders = [...new Set(vs.filter((v) => !v.favourite && v.folder).map((v) => v.folder))].sort((a, b) => a.localeCompare(b));
  folders.forEach((f) => out.push([f, vs.filter((v) => !v.favourite && v.folder === f).sort(byName)]));
  const rest = vs.filter((v) => !v.favourite && !v.folder);
  if (rest.length) out.push([out.length ? "~" : "", rest]);     // "~" = "Other views" heading
  return out;
}

export function viewMeta(t: (k: string, v?: Record<string, string | number>) => string, v: ViewInfo): string {
  const who = v.right === "owner" ? t("sc.v.yours") : t("sc.v.by", { name: v.owner || "?" });
  const can = v.right === "edit" ? " · " + t("sc.v.canEdit") : v.right === "view" ? " · " + t("sc.v.viewOnly") : v.shared ? " · " + t("sc.v.shared") : "";
  return `${who}${can} · ${t("sc.v.kind", { p: v.kind.pages, v: v.kind.visuals })} · ${t("sc.v.changed", { d: v.when })}`;
}

export function OpenViewDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (v: ViewInfo) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<ViewInfo[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<ViewInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => request<{ views: ViewInfo[] }>("GET", "/api/smart/views").then((d) => setList(d.views)).catch((e) => setErr(errText(t, e)));
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const ql = q.trim().toLowerCase();
  const shown = (list || []).filter((v) => !ql || (v.name + " " + v.owner + " " + v.folder).toLowerCase().includes(ql));
  const star = (v: ViewInfo) => request<{ favourite: boolean }>("POST", `/api/smart/views/${v.id}/favourite`).then(load).catch((e) => setErr(errText(t, e)));
  const del = () => {
    if (!sel || !window.confirm(t("sc.v.deleteAsk", { name: sel.name }))) return;
    request("DELETE", `/api/smart/views/${sel.id}`).then(() => { setSel(null); load(); }).catch((e) => setErr(errText(t, e)));
  };
  return (
    <Modal title={t("sc.v.openTitle")} onClose={onClose} wide>
      <input className="mj-search" placeholder={t("sc.v.search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="sc-views">
        {list && !list.length && <p className="muted">{t("sc.v.none")}</p>}
        {viewGroups(shown).map(([title, vs]) => (
          <div key={title || "-"}>
            {title && <div className="sc-vgroup">{title === "★" ? "★ " + t("sc.v.favourites") : title === "~" ? t("sc.v.others") : "📁 " + title}</div>}
            {vs.map((v) => (
              <div key={v.id} className={"sc-view" + (sel?.id === v.id ? " on" : "")} onClick={() => setSel(v)} onDoubleClick={() => onOpen(v)}>
                <button className={"sc-star" + (v.favourite ? " on" : "")} title={t(v.favourite ? "sc.v.unfav" : "sc.v.fav")}
                  onClick={(e) => { e.stopPropagation(); star(v); }}>{v.favourite ? "★" : "☆"}</button>
                <b>{v.name}</b><div className="muted">{viewMeta(t, v)}</div>
              </div>))}
          </div>))}
      </div>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain danger" disabled={!sel?.can_delete} onClick={del}>{t("sc.delete")}</button>
        <span style={{ flex: 1 }} />
        <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
        <button className="btn-green" disabled={!sel} onClick={() => sel && onOpen(sel)}>{t("sc.v.open")}</button>
      </div>
    </Modal>
  );
}

export function SaveViewDialog({ sid, current, onClose, onSaved }: { sid: string; current: ViewInfo | null; onClose: () => void; onSaved: (v: ViewInfo) => void }) {
  const { t } = useI18n();
  const [folder, setFolder] = useState(current?.folder || "");
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => { request<{ folders?: string[] }>("GET", "/api/smart/views").then((d) => setFolders(d.folders || [])).catch(() => undefined); }, []);
  const mine = !current || current.right === "owner";
  const canOverwrite = !!current && current.can_change;
  const [name, setName] = useState(current?.name || "");
  const [shared, setShared] = useState(mine ? !!current?.shared : false);
  const [asNew, setAsNew] = useState(!canOverwrite);
  const [err, setErr] = useState<string | null>(null);
  const save = () => request<{ view: ViewInfo }>("POST", `/api/smart/${sid}/view/save`, { name, shared, as_new: asNew, folder })
    .then((d) => { onSaved(d.view); onClose(); }).catch((e) => setErr(errText(t, e)));
  return (
    <Modal title={t("sc.v.saveTitle")} onClose={onClose}>
      <label className="sc-lab">{t("sc.c.name")}<input value={name} placeholder={t("sc.v.namePh")} onChange={(e) => setName(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }} /></label>
      <label className="sc-lab">{t("sc.v.folder")}<input list="sc-folders" value={folder} placeholder={t("sc.v.folderPh")} maxLength={60}
        onChange={(e) => setFolder(e.target.value)} /></label>
      <datalist id="sc-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      <label className="st-check" title={!mine && !asNew ? t("sc.v.onlyCreator") : ""}>
        <input type="checkbox" checked={shared} disabled={!mine && !asNew} onChange={() => setShared(!shared)} /> {t("sc.v.shareAll")}</label>
      <label className="st-check"><input type="checkbox" checked={asNew} disabled={!canOverwrite} onChange={() => setAsNew(!asNew)} /> {t("sc.v.asNew")}</label>
      <p className="muted small">{t("sc.v.saveHint")}</p>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
        <button className="btn-green" disabled={!name.trim()} onClick={save}>{t("sc.save")}</button>
      </div>
    </Modal>
  );
}

type ShareData = { everybody: boolean; entries: { user_id: number | null; group_id: number | null; can_edit: boolean; name: string }[];
  people: { id: number; name: string }[]; groups: { id: number; name: string }[] };

export function ShareDialog({ view, onClose, onSaved }: { view: ViewInfo; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<ShareData | null>(null);
  const [who, setWho] = useState("");
  const [right, setRight] = useState("view");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { request<ShareData>("GET", `/api/smart/views/${view.id}/share`).then(setD).catch((e) => setErr(errText(t, e))); }, [view.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const taken = useMemo(() => new Set((d?.entries || []).map((e) => (e.user_id != null ? "u" + e.user_id : "g" + e.group_id))), [d]);
  if (!d) return <Modal title={t("sc.s.title", { name: view.name })} onClose={onClose}>{err ? <div className="login-error">{err}</div> : <p className="muted">{t("app.loading")}</p>}</Modal>;
  const options = [...d.groups.filter((g) => !taken.has("g" + g.id)).map((g) => ({ k: "g" + g.id, label: t("sc.s.group", { name: g.name }), name: g.name })),
    ...d.people.filter((p) => !taken.has("u" + p.id)).map((p) => ({ k: "u" + p.id, label: p.name, name: p.name }))];
  const add = () => {
    const o = options.find((x) => x.k === (who || options[0]?.k));
    if (!o) return;
    const id = Number(o.k.slice(1));
    setD({ ...d, entries: [...d.entries, { user_id: o.k[0] === "u" ? id : null, group_id: o.k[0] === "g" ? id : null, can_edit: right === "edit", name: o.name }] });
    setWho("");
  };
  const save = () => request("POST", `/api/smart/views/${view.id}/share`, { everybody: d.everybody,
    entries: d.entries.map((e) => ({ user_id: e.user_id, group_id: e.group_id, can_edit: e.can_edit })) })
    .then(() => { onSaved(); onClose(); }).catch((e) => setErr(errText(t, e)));
  return (
    <Modal title={t("sc.s.title", { name: view.name })} onClose={onClose} wide>
      <label className="st-check"><input type="checkbox" checked={d.everybody} onChange={() => setD({ ...d, everybody: !d.everybody })} /> {t("sc.s.everybody")}</label>
      <h3>{t("sc.s.people")}</h3>
      <table className="mj-table"><thead><tr><th>{t("sc.s.who")}</th><th>{t("sc.s.right")}</th><th /></tr></thead>
        <tbody>{d.entries.map((e, i) => (
          <tr key={i}><td>{e.name} · {t(e.user_id != null ? "sc.s.person" : "sc.s.groupWord")}</td>
            <td><select value={e.can_edit ? "edit" : "view"} onChange={(ev) => setD({ ...d, entries: d.entries.map((x, j) => j === i ? { ...x, can_edit: ev.target.value === "edit" } : x) })}>
              <option value="view">{t("sc.s.canView")}</option><option value="edit">{t("sc.s.canEdit")}</option></select></td>
            <td><button className="btn-plain" onClick={() => setD({ ...d, entries: d.entries.filter((_x, j) => j !== i) })}>{t("sc.s.remove")}</button></td></tr>))}
        </tbody></table>
      <div className="sc-row">
        <select value={who} onChange={(e) => setWho(e.target.value)} disabled={!options.length}>
          {options.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}</select>
        <select value={right} onChange={(e) => setRight(e.target.value)}>
          <option value="view">{t("sc.s.canView")}</option><option value="edit">{t("sc.s.canEdit")}</option></select>
        <button className="btn-plain" disabled={!options.length} onClick={add}>{t("sc.s.add")}</button>
      </div>
      <p className="muted small">{t("sc.s.hint")}</p>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
        <button className="btn-green" onClick={save}>{t("sc.save")}</button>
      </div>
    </Modal>
  );
}

/** "This page" or "All n pages" for the PDF (only asked with more than one page). */
export function PdfDialog({ pages, onClose, onChoose }: { pages: number; onClose: () => void; onChoose: (all: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Modal title="PDF" onClose={onClose}>
      <p>{t("sc.pdfWhich")}</p>
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
        <button className="btn-plain" onClick={() => onChoose(false)}>{t("sc.pdfThis")}</button>
        <button className="btn-green" onClick={() => onChoose(true)}>{t("sc.pdfAll", { n: pages })}</button>
      </div>
    </Modal>
  );
}
