import { useEffect, useRef, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";

/* Label Generator (desktop ui/screen_label_generator.py). The browser holds the element list (same JSON as the
   desktop) and moves / resizes it on the canvas; preview and PDF are rendered by the server with the same code
   (ui/label_designer.py, db/label_sheets.py). Designs: tblLabelDesign, sheet: template "CustomLabel". */

type Part = { source: "static" | "field" | "counter"; text?: string; field_key?: string; start?: number; step?: number; digits?: number };
type El = { type: "text" | "logo" | "table"; x_mm: number; y_mm: number; w_mm: number; h_mm: number; font_size?: number; bold?: boolean;
  align?: string; anchor_group?: string; parts?: Part[]; rows?: number; cols?: number; show_borders?: boolean; cells?: { parts: Part[] }[][]; _k?: string };
type Meta = { designs: string[]; designs_available: boolean; template: Record<string, number>; template_fields: { key: string; label: string }[];
  fields: Record<string, string>; px_per_mm: number };
const M = 18;  // margin for the ruler (desktop PREVIEW_MARGIN)
const key = () => Math.random().toString(36).slice(2, 10);
const COUNTER = "__counter__";

function caption(el: El): string {
  if (el.type === "logo") return "Logo";
  if (el.type === "table") return `Table ${el.rows || 1}×${el.cols || 1}`;
  return (el.parts || []).map((p) => (p.source === "field" ? `{${p.field_key}}` : p.source === "counter" ? `{#${p.start ?? 1}}` : p.text || "")).join("").slice(0, 24) || "Text";
}
function newEl(type: El["type"], n: number): El {
  const off = 2 + (n % 5) * 3;
  if (type === "table") return { type, x_mm: off, y_mm: off, w_mm: 40, h_mm: 20, rows: 2, cols: 2, show_borders: true, font_size: 9, align: "left",
    cells: [0, 1].map(() => [0, 1].map(() => ({ parts: [{ source: "static" as const, text: "" }] }))), _k: key() };
  if (type === "logo") return { type, x_mm: off, y_mm: off, w_mm: 15, h_mm: 10, _k: key() };
  return { type, x_mm: off, y_mm: off, w_mm: 30, h_mm: 8, font_size: 9, bold: false, align: "left", parts: [{ source: "static", text: "" }], _k: key() };
}
function resizeCells(el: El): El {
  const rows = Math.max(1, el.rows || 1), cols = Math.max(1, el.cols || 1), old = el.cells || [];
  return { ...el, rows, cols, cells: Array.from({ length: rows }, (_r, r) => Array.from({ length: cols }, (_c, c) => {
    const cell = old[r]?.[c];
    return cell && cell.parts?.length ? cell : { parts: [{ source: "static" as const, text: "" }] };
  })) };
}
const strip = (els: El[]) => els.map(({ _k, ...e }) => e); // eslint-disable-line @typescript-eslint/no-unused-vars

function PartEditor({ part, fields, onChange, onRemove }: { part: Part; fields: Record<string, string>; onChange: (p: Part) => void; onRemove?: () => void }) {
  const { t } = useI18n();
  const val = part.source === "counter" ? COUNTER : part.source === "field" ? part.field_key || "" : "";
  return (
    <div className="lg-part">
      <select value={val} onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? { source: "static", text: part.text || "" } : v === COUNTER ? { source: "counter", start: part.start ?? 1, step: part.step ?? 1, digits: part.digits ?? 0 }
          : { source: "field", field_key: v });
      }}>
        <option value="">{t("lg.static")}</option>
        {Object.entries(fields).map(([k, lab]) => <option key={k} value={k}>{lab}</option>)}
        <option value={COUNTER}>{t("lg.counter")}</option>
      </select>
      {part.source === "static" && <input value={part.text || ""} placeholder={t("lg.textPh")} onChange={(e) => onChange({ ...part, text: e.target.value })} />}
      {part.source === "counter" && <span className="lg-counter">
        <label>{t("lg.start")}<input type="number" value={part.start ?? 1} onChange={(e) => onChange({ ...part, start: Number(e.target.value) })} /></label>
        <label>{t("lg.step")}<input type="number" value={part.step ?? 1} onChange={(e) => onChange({ ...part, step: Number(e.target.value) })} /></label>
        <label>{t("lg.digits")}<input type="number" min={0} max={10} value={part.digits ?? 0} onChange={(e) => onChange({ ...part, digits: Number(e.target.value) })} /></label>
      </span>}
      {onRemove && <button className="mu-x" title={t("lg.removePart")} onClick={onRemove}>✕</button>}
    </div>
  );
}

export default function LabelGenerator() {
  const { t } = useI18n();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [els, setEls] = useState<El[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [w, setW] = useState(60), [h, setH] = useState(30);
  const [sid, setSid] = useState("");
  const [series, setSeries] = useState<{ id: number; header: { experiment_id: string; series_name: string } | null; trials: number[]; fields: Record<string, string> } | null>(null);
  const [trial, setTrial] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [design, setDesign] = useState("");
  const [mode, setMode] = useState<"copies" | "range">("copies");
  const [copies, setCopies] = useState(1), [frm, setFrm] = useState(0), [to, setTo] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [print, setPrint] = useState(false);
  const [alignY, setAlignY] = useState(true);
  const drag = useRef<{ k: string; mode: "move" | "size"; x: number; y: number; el0: El; others: El[] } | null>(null);
  const px = meta?.px_per_mm || 8;
  const fields = series?.fields || meta?.fields || {};

  useEffect(() => {
    request<Meta>("GET", "/api/label-generator/meta").then((m) => { setMeta(m); setW(m.template.LabelWidthMm || 60); setH(m.template.LabelHeightMm || 30); setDesign(m.designs[0] || ""); })
      .catch((e) => setMsg({ text: String(e), err: true }));
  }, []);
  // preview (same rendering as the PDF) whenever something changes
  useEffect(() => {
    if (!meta) return;
    const hd = setTimeout(() => {
      fetch("/api/label-generator/preview", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements: strip(els), w_mm: w, h_mm: h, values, fields, scale: px }) })
        .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); }); });
    }, 150);
    return () => clearTimeout(hd);
  }, [els, w, h, values, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  // label size is stored in the sheet template right away (desktop)
  useEffect(() => {
    if (!meta || (w === meta.template.LabelWidthMm && h === meta.template.LabelHeightMm)) return;
    const hd = setTimeout(() => request<{ template: Record<string, number> }>("POST", "/api/label-generator/label-size", { w_mm: w, h_mm: h })
      .then((d) => setMeta((m) => (m ? { ...m, template: d.template } : m))).catch(() => undefined), 500);
    return () => clearTimeout(hd);
  }, [w, h]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta) return <div className="muted">{msg?.text ?? t("app.loading")}</div>;
  const selEl = els.find((e) => e._k === sel) || null;
  const patch = (k: string, p: Partial<El>) => setEls((es) => es.map((e) => (e._k === k ? { ...e, ...p } : e)));
  const errOf = (e: unknown) => (e instanceof ApiError && e.code ? t(`lg.err.${e.code}`) : String(e));

  const search = () => {
    const id = Number(sid);
    if (!id) return;
    request<{ header: { experiment_id: string; series_name: string } | null; trials: number[]; fields: Record<string, string> }>("GET", `/api/label-generator/series/${id}`)
      .then((d) => {
        setSeries({ id, ...d }); setValues(null); setTrial(null);
        if (!d.header) setMsg({ text: t("lg.notFound", { id }), err: true });
        else if (!d.trials.length) setMsg({ text: t("lg.noTrials", { id, exp: d.header.experiment_id, name: d.header.series_name }), err: true });
        else { setMsg(null); setFrm(d.trials[0]); setTo(d.trials[d.trials.length - 1]); pickTrial(id, d.trials[0]); }
      }).catch((e) => setMsg({ text: errOf(e), err: true }));
  };
  const pickTrial = (id: number, nr: number) => {
    setTrial(nr);
    request<{ values: Record<string, string> }>("GET", `/api/label-generator/series/${id}/trial/${nr}`).then((d) => setValues(d.values)).catch(() => undefined);
  };
  const loadDesign = () => design && request<{ elements: El[] }>("GET", `/api/label-generator/designs/${encodeURIComponent(design)}`)
    .then((d) => { setEls(d.elements.map((e) => ({ ...e, _k: key() }))); setSel(null); }).catch((e) => setMsg({ text: errOf(e), err: true }));
  const saveDesign = () => {
    const name = window.prompt(t("lg.designName"), design);
    if (!name || !name.trim()) return;
    request<{ designs: string[]; name: string }>("POST", "/api/label-generator/designs", { name, elements: strip(els) })
      .then((d) => { setMeta({ ...meta, designs: d.designs }); setDesign(d.name); setMsg({ text: t("lg.saved") }); }).catch((e) => setMsg({ text: errOf(e), err: true }));
  };
  const count = mode === "range" ? (series?.trials || []).filter((n) => n >= Math.min(frm, to) && n <= Math.max(frm, to)).length : copies;
  const canGenerate = () => {
    if (!els.length) return t("lg.err.no_elements");
    if (mode === "range" && (!series?.header || !series.trials.length)) return t("lg.err.no_series");
    if (mode === "range" && !count) return t("lg.err.empty_range");
    if (mode === "copies" && !values && els.some((e) => e.type === "text" && (e.parts || []).some((p) => p.source === "field"))) return t("lg.err.need_trial");
    return null;
  };

  // drag / resize on the canvas (mm), anchor group moves along
  const down = (e: React.MouseEvent, el: El, m: "move" | "size") => {
    e.stopPropagation(); e.preventDefault();
    setSel(el._k!);
    drag.current = { k: el._k!, mode: m, x: e.clientX, y: e.clientY, el0: { ...el }, others: els.filter((o) => o._k !== el._k) };
  };
  const move = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / px, dy = (e.clientY - d.y) / px;
    const r = (v: number) => Math.round(v * 2) / 2;
    if (d.mode === "size") { patch(d.k, { w_mm: Math.max(1, r(d.el0.w_mm + dx)), h_mm: Math.max(1, r(d.el0.h_mm + dy)) }); return; }
    const nx = r(d.el0.x_mm + dx), ny = r(d.el0.y_mm + dy), mx = nx - d.el0.x_mm, my = ny - d.el0.y_mm;
    const g = d.el0.anchor_group;
    setEls((es) => es.map((o) => {
      if (o._k === d.k) return { ...o, x_mm: nx, y_mm: ny };
      const before = d.others.find((x) => x._k === o._k);
      return g && before && before.anchor_group === g ? { ...o, x_mm: before.x_mm + mx, y_mm: before.y_mm + my } : o;
    }));
  };
  const up = () => { drag.current = null; };
  const setAnchor = (el: El, target: string) => {
    if (!target) { patch(el._k!, { anchor_group: undefined }); return; }
    const tg = els.find((o) => o._k === target);
    if (!tg) return;
    const group = tg.anchor_group || key();
    setEls((es) => es.map((o) => (o._k === tg._k ? { ...o, anchor_group: group } : o._k === el._k ? { ...o, anchor_group: group, ...(alignY ? { y_mm: tg.y_mm } : {}) } : o)));
  };

  const W = w * px, H = h * px;
  const ticksX = Array.from({ length: Math.floor(w / 10) + 1 }, (_x, i) => i * 10), ticksY = Array.from({ length: Math.floor(h / 10) + 1 }, (_x, i) => i * 10);

  return (
    <div className="page lg-page">
      <div className="page-head"><h1>{t("lg.title")}</h1></div>
      {msg && <div className={"mj-msg" + (msg.err ? " err" : "")}>{msg.text} <button className="mu-x" onClick={() => setMsg(null)}>✕</button></div>}
      <div className="lg-body">
        <div className="lg-left">
          <section className="jr-card"><h2>{t("lg.loadData")}</h2>
            <div className="lg-row"><label>{t("lg.seriesId")}<input value={sid} onChange={(e) => setSid(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") search(); }} /></label>
              <button className="btn-green" onClick={search}>{t("lg.search")}</button></div>
            <div className="lg-row"><label>{t("lg.trial")}<select disabled={!series?.trials.length} value={trial ?? ""} onChange={(e) => series && pickTrial(series.id, Number(e.target.value))}>
              {(series?.trials || []).map((n) => <option key={n} value={n}>{t("lg.trialN", { n })}</option>)}</select></label></div>
            <p className="muted small">{values ? t("lg.loaded") + " " + Object.entries(values).map(([k, v]) => `${fields[k] || k} = ${v}`).join(", ") : t("lg.loadHint")}</p>
          </section>
          <section className="jr-card"><h2>{t("lg.size")}</h2>
            <div className="lg-row"><label>{t("lg.width")}<input type="number" min={5} max={500} step={0.5} value={w} onChange={(e) => setW(Number(e.target.value) || 5)} /></label>
              <label>{t("lg.height")}<input type="number" min={5} max={500} step={0.5} value={h} onChange={(e) => setH(Number(e.target.value) || 5)} /></label></div>
            <p className="muted small">{t("lg.sizeHint")}</p>
          </section>
          <section className="jr-card"><h2>{t("lg.designs")}</h2>
            <div className="lg-row"><select value={design} onChange={(e) => setDesign(e.target.value)}>{meta.designs.map((d) => <option key={d}>{d}</option>)}</select>
              <button className="btn-plain" disabled={!design} onClick={loadDesign}>{t("lg.load")}</button></div>
            <div className="lg-row"><button className="btn-plain" disabled={!meta.designs_available} title={meta.designs_available ? "" : t("lg.err.unavailable")} onClick={saveDesign}>{t("lg.saveAs")}</button>
              <button className="btn-plain" onClick={() => { setEls([]); setSel(null); }}>{t("lg.clear")}</button></div>
          </section>
          <section className="jr-card"><h2>{t("lg.generate")}</h2>
            <label className="lg-row">{t("lg.mode")}<select value={mode} onChange={(e) => setMode(e.target.value as "copies" | "range")}>
              <option value="copies">{t("lg.modeCopies")}</option><option value="range">{t("lg.modeRange")}</option></select></label>
            {mode === "copies" ? <label className="lg-row">{t("lg.copies")}<input type="number" min={1} max={500} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(500, Number(e.target.value))))} /></label>
              : <div className="lg-row"><label>{t("lg.from")}<input type="number" value={frm} onChange={(e) => setFrm(Number(e.target.value))} /></label>
                <label>{t("lg.to")}<input type="number" value={to} onChange={(e) => setTo(Number(e.target.value))} /></label></div>}
            <button className="btn-green" onClick={() => { const err = canGenerate(); if (err) setMsg({ text: err, err: true }); else setPrint(true); }}>{t("lg.generatePdf")}</button>
          </section>
        </div>
        <section className="jr-card lg-canvas-card">
          <h2>{t("lg.canvas")}</h2>
          <div className="lg-row">
            <button className="btn-plain" onClick={() => { const e = newEl("text", els.length); setEls([...els, e]); setSel(e._k!); }}>+ {t("lg.addText")}</button>
            <button className="btn-plain" onClick={() => { const e = newEl("logo", els.length); setEls([...els, e]); setSel(e._k!); }}>+ {t("lg.addLogo")}</button>
            <button className="btn-plain" onClick={() => { const e = newEl("table", els.length); setEls([...els, e]); setSel(e._k!); }}>+ {t("lg.addTable")}</button>
          </div>
          <p className="muted small">{t("lg.legend")}</p>
          <div className="lg-work">
            <div className="lg-canvas" style={{ width: W + M + 10, height: H + M + 10 }} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onMouseDown={() => setSel(null)}>
              {preview && <img src={preview} alt="" style={{ left: M, top: M, width: W, height: H }} draggable={false} />}
              <svg width={W + M + 10} height={H + M + 10}>
                {ticksX.map((mm) => <g key={"x" + mm}><line x1={M + mm * px} y1={M} x2={M + mm * px} y2={M + H} stroke="rgba(0,0,0,0.16)" />
                  <line x1={M + mm * px} y1={M - 4} x2={M + mm * px} y2={M} stroke="#555" />{mm > 0 && <text x={M + mm * px} y={M - 6} fontSize={9} textAnchor="middle" fill="#555">{mm}</text>}</g>)}
                {ticksY.map((mm) => <g key={"y" + mm}><line x1={M} y1={M + mm * px} x2={M + W} y2={M + mm * px} stroke="rgba(0,0,0,0.16)" />
                  <line x1={M - 4} y1={M + mm * px} x2={M} y2={M + mm * px} stroke="#555" /></g>)}
                <rect x={M} y={M} width={W} height={H} fill="none" stroke="#333" />
              </svg>
              {els.map((el) => (
                <div key={el._k} className={"lg-el" + (el._k === sel ? " on" : "") + (el.anchor_group ? " anchored" : "")}
                  style={{ left: M + el.x_mm * px, top: M + el.y_mm * px, width: el.w_mm * px, height: el.h_mm * px }}
                  onMouseDown={(e) => down(e, el, "move")} title={caption(el)}>
                  <span>{caption(el)}</span>
                  <i onMouseDown={(e) => down(e, el, "size")} />
                </div>))}
            </div>
            <aside className="lg-props">
              {!selEl ? <p className="muted small">{t("lg.selectHint")}</p> : (<>
                <b>{selEl.type === "logo" ? t("lg.logo") : selEl.type === "table" ? t("lg.table") : t("lg.textEl")}</b>
                {selEl.type === "table" && (<>
                  <div className="lg-row"><label>{t("lg.rows")}<input type="number" min={1} max={50} value={selEl.rows} onChange={(e) => setEls(els.map((o) => (o._k === sel ? resizeCells({ ...o, rows: Number(e.target.value) }) : o)))} /></label>
                    <label>{t("lg.cols")}<input type="number" min={1} max={20} value={selEl.cols} onChange={(e) => setEls(els.map((o) => (o._k === sel ? resizeCells({ ...o, cols: Number(e.target.value) }) : o)))} /></label></div>
                  <label className="st-check"><input type="checkbox" checked={selEl.show_borders !== false} onChange={(e) => patch(sel!, { show_borders: e.target.checked })} /> {t("lg.borders")}</label>
                  <div className="muted small">{t("lg.cells")}</div>
                  {(selEl.cells || []).map((row, r) => row.map((cell, c) => (
                    <div key={`${r}-${c}`} className="lg-cell"><span>{r + 1}/{c + 1}</span>
                      <PartEditor part={cell.parts[0]} fields={fields} onChange={(p) => patch(sel!, { cells: (selEl.cells || []).map((rr, i) => rr.map((cc, j) => (i === r && j === c ? { parts: [p] } : cc))) })} /></div>)))}
                </>)}
                {selEl.type === "text" && (<>
                  <div className="muted small">{t("lg.content")}</div>
                  {(selEl.parts || []).map((p, i) => <PartEditor key={i} part={p} fields={fields}
                    onChange={(np) => patch(sel!, { parts: (selEl.parts || []).map((q, j) => (j === i ? np : q)) })}
                    onRemove={(selEl.parts || []).length > 1 ? () => patch(sel!, { parts: (selEl.parts || []).filter((_q, j) => j !== i) }) : undefined} />)}
                  <button className="btn-plain" onClick={() => patch(sel!, { parts: [...(selEl.parts || []), { source: "static", text: "" }] })}>+ {t("lg.addPart")}</button>
                </>)}
                {selEl.type !== "logo" && (<div className="lg-row">
                  <label>{t("lg.font")}<input type="number" min={4} max={60} step={0.5} value={selEl.font_size ?? 9} onChange={(e) => patch(sel!, { font_size: Number(e.target.value) })} /></label>
                  <label className="st-check"><input type="checkbox" checked={!!selEl.bold} onChange={(e) => patch(sel!, { bold: e.target.checked })} /> {t("lg.bold")}</label>
                  <label>{t("lg.align")}<select value={selEl.align || "left"} onChange={(e) => patch(sel!, { align: e.target.value })}>
                    {["left", "center", "right"].map((a) => <option key={a} value={a}>{t(`lg.al.${a}`)}</option>)}</select></label></div>)}
                <div className="muted small">{t("lg.geometry")}</div>
                <div className="lg-row lg-geo">{(["x_mm", "y_mm", "w_mm", "h_mm"] as const).map((k) => <label key={k}>{k[0].toUpperCase()}
                  <input type="number" step={0.5} value={selEl[k]} onChange={(e) => {
                    const v = Number(e.target.value);
                    if ((k === "x_mm" || k === "y_mm") && selEl.anchor_group) {
                      const d = v - selEl[k];
                      setEls(els.map((o) => (o._k === sel ? { ...o, [k]: v } : o.anchor_group === selEl.anchor_group ? { ...o, [k]: o[k] + d } : o)));
                    } else patch(sel!, { [k]: v } as Partial<El>);
                  }} /></label>)}</div>
                <label className="lg-row">{t("lg.anchor")}<select value={els.find((o) => o._k !== sel && o.anchor_group && o.anchor_group === selEl.anchor_group)?._k || ""}
                  onChange={(e) => setAnchor(selEl, e.target.value)}>
                  <option value="">{t("lg.noAnchor")}</option>
                  {els.filter((o) => o._k !== sel).map((o) => <option key={o._k} value={o._k}>{caption(o)}</option>)}</select></label>
                <label className="st-check"><input type="checkbox" checked={alignY} onChange={(e) => setAlignY(e.target.checked)} /> {t("lg.alignY")}</label>
                <button className="btn-plain danger" onClick={() => { setEls(els.filter((o) => o._k !== sel)); setSel(null); }}>{t("lg.deleteEl")}</button>
              </>)}
            </aside>
          </div>
        </section>
      </div>
      {print && <PrintDialog meta={meta} count={count} onClose={() => setPrint(false)} onGo={(template, start, save) => {
        const body = { elements: strip(els), mode, copies, series_id: series?.id ?? null, trial_nr: trial, frm, to, template, start_index: start, save_template: save };
        fetch("/api/label-generator/pdf", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(async (r) => {
            if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg({ text: j.code ? t(`lg.err.${j.code}`) : String(j.detail || r.statusText), err: true }); return; }
            const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "labels.pdf"; a.click();
            if (save) setMeta({ ...meta, template: { ...meta.template, ...template } });
            setPrint(false);
          });
      }} />}
    </div>
  );
}

function PrintDialog({ meta, count, onClose, onGo }: { meta: Meta; count: number; onClose: () => void; onGo: (tpl: Record<string, number>, start: number, save: boolean) => void }) {
  const { t } = useI18n();
  const [tpl, setTpl] = useState<Record<string, number>>({ ...meta.template });
  const [start, setStart] = useState(0);
  const [save, setSave] = useState(false);
  const cols = Math.max(1, Math.round(tpl.ColumnCount || 1)), rows = Math.max(1, Math.round(tpl.RowCount || 1));
  return (
    <Modal title={t("lg.printTitle", { n: count })} onClose={onClose} wide>
      <div className="lg-print">
        <div className="lg-tpl">{meta.template_fields.map((f) => (
          <label key={f.key}>{t(`lg.tpl.${f.key}`)}<input type="number" step={f.key.endsWith("Count") ? 1 : 0.1} value={tpl[f.key]} onChange={(e) => setTpl({ ...tpl, [f.key]: Number(e.target.value) })} /></label>))}
          <label className="st-check"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> {t("lg.saveTpl")}</label>
        </div>
        <div>
          <div className="muted small">{t("lg.startPos")}</div>
          <div className="lg-sheet" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {Array.from({ length: cols * rows }, (_x, i) => <button key={i} className={(i === start ? "on " : "") + (i >= start && i < start + count ? "used" : "")} onClick={() => setStart(i)}>{i + 1}</button>)}
          </div>
          {start + count > cols * rows && <p className="muted small">{t("lg.morePages")}</p>}
        </div>
      </div>
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
        <button className="btn-green" onClick={() => onGo(tpl, start, save)}>{t("lg.generatePdf")}</button></div>
    </Modal>
  );
}
