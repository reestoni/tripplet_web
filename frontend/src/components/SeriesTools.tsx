import { useEffect, useMemo, useState, type ReactNode } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { TrialPicker } from "../pages/CreateExperiment";

/* Show Experiment tools like the desktop: Print labels, Copy trials, Yarns… dialog, reference samples,
   Statimat / Itemat PDF import. Rules + writes on the server (backend/app/series_tools.py,
   series_manage.py), shared with the desktop. */

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={"modal" + (wide ? " modal-wide" : "")} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Print labels */
type LabelInfo = { range: [number, number] | null; header: string; template: Record<string, number>; fields: [string, string][] };

export function LabelsDialog({ seriesId, onClose }: { seriesId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<LabelInfo | null>(null);
  const [tpl, setTpl] = useState<Record<string, number>>({});
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [start, setStart] = useState(0);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    request<LabelInfo>("GET", `/api/series/${seriesId}/labels`).then((i) => {
      setInfo(i); setTpl(i.template);
      if (i.range) { setFrom(i.range[0]); setTo(i.range[1]); }
    }).catch((e) => setMsg({ kind: "err", text: errText(e) }));
  }, [seriesId]);
  const cols = Math.max(1, Math.round(tpl.ColumnCount || 1)), rows = Math.max(1, Math.round(tpl.RowCount || 1));
  const count = Math.max(0, to - from + 1);
  const pdf = async () => {
    setMsg(null);
    try {
      const res = await fetch(`/api/series/${seriesId}/labels/pdf`, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_no: from, to_no: to, start_index: start, template: tpl }) });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
      // Save as a file (like the desktop's save dialog), not a preview tab.
      const name = (info?.header ?? "").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = name ? `trial_labels_${name}.pdf` : "trial_labels.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
  };
  const saveTpl = async () => {
    try { await request("POST", "/api/series/labels/template", { template: tpl }); setMsg({ kind: "ok", text: t("tl.tplSaved") }); }
    catch (e) { setMsg({ kind: "err", text: errText(e) }); }
  };
  return (
    <Modal title={t("tl.labelsTitle")} onClose={onClose} wide>
      {info && !info.range && <p className="muted">{t("tl.noTrials")}</p>}
      {info?.range && (
        <>
          <div className="fill-form">
            <label>{t("cm.fromTrial")} <input type="number" min={info.range[0]} max={info.range[1]} value={from}
              onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to < v) setTo(v); }} /></label>
            <label>{t("cm.toTrial")} <input type="number" min={info.range[0]} max={info.range[1]} value={to}
              onChange={(e) => setTo(Math.max(from, Number(e.target.value)))} /></label>
            <span className="muted">{t("tl.labelCount", { n: count, header: info.header })}</span>
          </div>
          <div className="tl-grid-wrap">
            <div>
              <div className="muted">{t("tl.startCell")}</div>
              <div className="tl-grid" style={{ gridTemplateColumns: `repeat(${cols}, 22px)` }}>
                {Array.from({ length: cols * rows }, (_x, i) => (
                  <button key={i} className={"tl-cell" + (i === start ? " start" : i > start && i < start + count ? " used" : "")}
                    onClick={() => setStart(i)} title={String(i + 1)} />
                ))}
              </div>
            </div>
            <div className="tl-tpl">
              {info.fields.map(([k, label]) => (
                <label key={k}>{label}
                  <input type="number" step={k.endsWith("Count") ? 1 : 0.1} value={tpl[k] ?? 0}
                    onChange={(e) => setTpl((x) => ({ ...x, [k]: Number(e.target.value) }))} />
                </label>
              ))}
            </div>
          </div>
        </>
      )}
      {msg && <div className={msg.kind === "ok" ? "rq-ok" : "login-error"}>{msg.text}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={saveTpl} disabled={!info}>{t("tl.saveTpl")}</button>
        <button className="btn-plain" onClick={onClose}>{t("cm.close")}</button>
        <button className="btn-green" disabled={!info?.range || count < 1} onClick={pdf}>{t("tl.createPdf")}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Copy trials */
type CField = { key: string; label: string; rule: string | null; default: boolean; choices: [number | string, string][] | null };
type CVal = { v?: string | number | null; text?: string; na?: boolean; varies?: boolean };
type CSetup = { trials: { id: number; label: string; summary: string }[]; next_no: number; fields: CField[]; source: Record<string, Record<string, CVal>> };

export function CopyTrialsDialog({ seriesId, preselected, onClose, onDone }: {
  seriesId: number; preselected: number[]; onClose: () => void; onDone: (n: number) => void;
}) {
  const { t } = useI18n();
  const [s, setS] = useState<CSetup | null>(null);
  const [sel, setSel] = useState<number[]>(preselected);
  const [lastClick, setLastClick] = useState<number | null>(null);
  const [n, setN] = useState(1);
  const [block, setBlock] = useState(true);
  const [allFields, setAllFields] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, string | number | null>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<CSetup>("GET", `/api/series/${seriesId}/copy-setup`).then(setS).catch((e) => setErr(errText(e)));
  }, [seriesId]);
  const selected = s ? s.trials.filter((x) => sel.includes(x.id)) : [];
  const sources = block ? Array.from({ length: n }, () => selected).flat() : selected.flatMap((x) => Array.from({ length: n }, () => x));
  const keys = (() => { const occ: Record<number, number> = {}; return sources.map((x) => `${x.id}:${(occ[x.id] = (occ[x.id] ?? -1) + 1)}`); })();
  const fields = s ? s.fields.filter((f) => allFields || f.default) : [];
  const toggle = (id: number, i: number, shift: boolean) => {
    if (!s) return;
    if (shift && lastClick !== null) {
      const [a, b] = [Math.min(lastClick, i), Math.max(lastClick, i)];
      const ids = s.trials.slice(a, b + 1).map((x) => x.id);
      const on = !sel.includes(id);
      setSel((cur) => (on ? [...new Set([...cur, ...ids])] : cur.filter((x) => !ids.includes(x))));
    } else setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setLastClick(i);
  };
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const plan = sources.map((x, i) => ({ source: x.id, values: edits[keys[i]] ?? {} }));
      const r = await request<{ new_ids: number[] }>("POST", `/api/series/${seriesId}/copy`, { plan });
      onDone(r.new_ids.length);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={t("tl.copyTitle")} onClose={onClose} wide>
      {!s && !err && <div className="muted">{t("se.loading")}</div>}
      {s && (
        <>
          <div className="tl-step"><b>1</b> {t("tl.whichTrials")}
            <button className="link-btn" onClick={() => setSel(s.trials.map((x) => x.id))}>{t("tl.all")}</button>
            <button className="link-btn" onClick={() => setSel([])}>{t("tl.none")}</button>
          </div>
          <div className="tl-trials">
            {s.trials.map((x, i) => (
              <label key={x.id} className="tl-trial" onClick={(e) => { e.preventDefault(); toggle(x.id, i, e.shiftKey); }}>
                <input type="checkbox" readOnly checked={sel.includes(x.id)} /> <b>{x.label}</b> <span className="muted">{x.summary}</span>
              </label>
            ))}
          </div>
          <div className="muted">{t("tl.shiftHint")}</div>
          <div className="tl-step"><b>2</b> {t("tl.howOften")}
            <input type="number" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /> ×
            <label className="md-radio"><input type="radio" checked={block} onChange={() => setBlock(true)} /> {t("tl.repeatBlock")}</label>
            <label className="md-radio"><input type="radio" checked={!block} onChange={() => setBlock(false)} /> {t("tl.eachInRow")}</label>
          </div>
          <div className="tl-step"><b>3</b> {t("tl.result")}
            <label className="md-radio"><input type="checkbox" checked={allFields} onChange={(e) => setAllFields(e.target.checked)} /> {t("tl.allFields")}</label>
          </div>
          <div className="table-wrap tl-result">
            <table className="grid">
              <thead><tr><th>{t("tl.new")}</th><th>{t("tl.from")}</th>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {sources.map((x, i) => (
                  <tr key={keys[i]}>
                    <td>V{s.next_no + i}</td><td>{x.label}</td>
                    {fields.map((f) => {
                      const src = s.source[String(x.id)]?.[f.key] ?? {};
                      const ed = edits[keys[i]] ?? {};
                      const changed = f.key in ed;
                      if (src.na) return <td key={f.key} className="muted" title={t("tl.noPly")} />;
                      const set = (v: string) => setEdits((all) => {
                        const cur = { ...(all[keys[i]] ?? {}) };
                        const orig = src.v == null ? "" : String(src.v);
                        if (v === orig && !src.varies) delete cur[f.key]; else cur[f.key] = v === "" ? null : v;
                        return { ...all, [keys[i]]: cur };
                      });
                      const value = changed ? (ed[f.key] == null ? "" : String(ed[f.key])) : (src.v == null ? "" : String(src.v));
                      return (
                        <td key={f.key} className={changed ? "dirty" : ""}>
                          {f.choices ? (
                            <select value={value} onChange={(e) => set(e.target.value)}>
                              <option value="">–</option>
                              {f.choices.map(([id, nm]) => <option key={String(id)} value={String(id)}>{nm}</option>)}
                            </select>
                          ) : (
                            <input className="tl-in" placeholder={src.varies ? "div." : ""} defaultValue={changed ? value : (src.text ?? "")}
                              onBlur={(e) => { if (e.target.value !== (src.text ?? "")) set(e.target.value); }} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">{t("tl.copiedInfo")}</p>
        </>
      )}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={!sources.length || busy} onClick={go}>{t("tl.copyN", { n: sources.length })}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Yarns… */
type YRow = { ply: string; yarn_id: number | null; yarn: string; use_id: number | null; ends: Record<string, number> };
type YState = { editable: boolean; trials: { id: number; label: string; ref: boolean }[]; rows: YRow[]; mixed: string[];
  uses: [number, string][]; max_ends: number };
type Yarn = { id: number; name: string; colour: string; search: string };
const plyNo = (p: string) => Number((p.match(/\d+/) ?? ["0"])[0]);

export function YarnsDialog({ seriesId, onClose, onDone }: { seriesId: number; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [st, setSt] = useState<YState | null>(null);
  const [rows, setRows] = useState<YRow[]>([]);
  const [catalog, setCatalog] = useState<Yarn[] | null>(null);
  const [pick, setPick] = useState<{ row: number | null; q: string } | null>(null);
  const [trialPick, setTrialPick] = useState(false);
  // "+ Trial output" (desktop _add_trial_output): the semi-finished yarn of another trial as a new ply
  const addTrialOutput = async (trialId: number) => {
    setTrialPick(false);
    try {
      const y = await request<{ id: number; name: string }>("POST", `/api/series/${seriesId}/yarns/trial-output`, { trial_id: trialId });
      choose(y, true);
    } catch (e) { setErr(errText(e)); }
  };
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<YState>("GET", `/api/series/${seriesId}/yarns`).then((x) => { setSt(x); setRows(x.rows.map((r) => ({ ...r, ends: { ...r.ends } }))); })
      .catch((e) => setErr(errText(e)));
  }, [seriesId]);
  useEffect(() => {
    if (pick && !catalog) request<{ yarns: Yarn[] }>("GET", "/api/series/yarns/catalog").then((r) => setCatalog(r.yarns)).catch((e) => setErr(errText(e)));
  }, [pick, catalog]);
  const ed = !!st?.editable;
  const nextPly = (rs: YRow[]) => { const used = new Set(rs.map((r) => plyNo(r.ply))); let n = 1; while (used.has(n)) n++; return `Ply ${n}`; };
  const choose = (y: Pick<Yarn, "id" | "name">, newRow = false) => {
    if ((!pick && !newRow) || !st) return;
    setErr(null);
    if (newRow || pick!.row === null) {   // new row: the ply of its yarn, else the next free one (series rule)
      const same = rows.find((r) => r.yarn_id === y.id);
      if (same && !window.confirm(t("tl.yarnAgain", { yarn: y.name, ply: same.ply }))) return;
      setRows((rs) => [...rs, { ply: same ? same.ply : nextPly(rs), yarn_id: y.id, yarn: y.name, use_id: null,
        ends: Object.fromEntries(st.trials.map((x) => [String(x.id), x.ref ? 0 : 1])) }]);
    } else {
      const pr = rows[pick!.row!];
      const other = rows.find((r) => r.ply !== pr.ply && r.yarn_id === y.id);
      if (other) { setErr(t("tl.yarnHasPly", { yarn: y.name, ply: other.ply })); return; }
      setRows((rs) => rs.map((r) => (r.ply === pr.ply && r.yarn_id === pr.yarn_id ? { ...r, yarn_id: y.id, yarn: y.name } : r)));
    }
    setPick(null);
  };
  const shown = useMemo(() => {
    if (!catalog || !pick) return [];
    const words = pick.q.toLowerCase().split(/\s+/).filter(Boolean);
    return catalog.filter((y) => words.every((w) => y.search.includes(w))).slice(0, 200);
  }, [catalog, pick]);
  const send = async (apply: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await request<{ changes: string[]; applied: boolean }>("POST", `/api/series/${seriesId}/yarns`,
        { rows: rows.map(({ ply, yarn_id, use_id, ends }) => ({ ply, yarn_id, use_id, ends })), apply });
      if (r.applied) onDone(); else if (!r.changes.length) setErr(t("tl.noChanges")); else setConfirm(r.changes);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => plyNo(a.r.ply) - plyNo(b.r.ply) || a.i - b.i);
  return (
    <Modal title={t("tl.yarnsTitle")} onClose={onClose} wide>
      <p className="muted">{ed ? t("tl.yarnsHint") : t("tl.yarnsRo")}</p>
      {st && st.mixed.length > 0 && <p className="login-error">{t("tl.mixed", { plies: st.mixed.join(", ") })}</p>}
      {st && (
        <div className="table-wrap tl-result">
          <table className="grid tl-yarns">
            <thead><tr><th>Ply</th><th>{t("sa.yarnCol")}</th><th>{t("tl.use")}</th>
              {st.trials.map((x) => <th key={x.id} className={x.ref ? "ref" : ""}>{x.label}</th>)}</tr></thead>
            <tbody>
              {order.map(({ r, i }) => (
                <tr key={i}>
                  <td className="nowrap">{r.ply}</td>
                  <td>{ed ? <button className="link-btn" onClick={() => setPick({ row: i, q: "" })}>{r.yarn}</button> : r.yarn}</td>
                  <td>
                    <select disabled={!ed} value={r.use_id ?? ""} onChange={(e) => {
                      const u = e.target.value ? Number(e.target.value) : null;
                      if (rows.some((o, j) => j !== i && o.ply === r.ply && o.yarn_id === r.yarn_id && o.use_id === u)) { setErr(t("tl.useTaken")); return; }
                      setRows((rs) => rs.map((o, j) => (j === i ? { ...o, use_id: u } : o)));
                    }}>
                      <option value="">—</option>
                      {st.uses.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}
                    </select>
                  </td>
                  {st.trials.map((x) => {
                    const v = r.ends[String(x.id)] ?? 0;
                    return (
                      <td key={x.id} className={"tl-end" + (v ? " on" : "")}
                        onClick={() => ed && setRows((rs) => rs.map((o, j) => (j === i ? { ...o, ends: { ...o.ends, [String(x.id)]: v ? 0 : 1 } } : o)))}
                        onKeyDown={(e) => {
                          if (!ed || !/^[0-9]$/.test(e.key)) return;
                          const n = Math.min(st.max_ends, Number(e.key));
                          setRows((rs) => rs.map((o, j) => (j === i ? { ...o, ends: { ...o.ends, [String(x.id)]: n } } : o)));
                        }} tabIndex={ed ? 0 : undefined} title={t("tl.endsTip")}>
                        {v ? (v > 1 ? v : "●") : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="tl-pick">
          <input className="search" autoFocus placeholder={t("sa.yarnSearch")} value={pick.q} onChange={(e) => setPick({ ...pick, q: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) choose(shown[0]); }} />
          <div className="tl-pick-list">
            {!catalog && <div className="muted">{t("se.loading")}</div>}
            {shown.map((y) => (
              <button key={y.id} className="tl-pick-item" onClick={() => choose(y)}>
                {y.name}{y.colour && <span className="muted"> · {y.colour}</span>}
              </button>
            ))}
          </div>
          <button className="link-btn" onClick={() => setPick(null)}>{t("cm.cancel")}</button>
        </div>
      )}
      {confirm && (
        <div className="card tl-confirm">
          <b>{t("tl.applyQ")}</b>
          <ul>{confirm.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => setConfirm(null)}>{t("cm.cancel")}</button>
            <button className="btn-green" disabled={busy} onClick={() => send(true)}>{t("tl.apply")}</button>
          </div>
        </div>
      )}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        {ed && <button className="btn-plain" onClick={() => setPick({ row: null, q: "" })}>{t("tl.addPly")}</button>}
        {ed && <button className="btn-plain" title={t("tl.trialOutputTip")} onClick={() => setTrialPick(true)}>{t("tl.trialOutput")}</button>}
        <button className="btn-plain" onClick={onClose}>{ed ? t("cm.cancel") : t("cm.close")}</button>
        {ed && !confirm && <button className="btn-green" disabled={busy} onClick={() => send(false)}>{t("tl.apply")}…</button>}
      </div>
      {trialPick && <TrialPicker searchUrl="/api/series/yarns/trial-search" onCancel={() => setTrialPick(false)} onOk={addTrialOutput} />}
    </Modal>
  );
}

/* ------------------------------------------------------------------ reference samples */
export function RefNameDialog({ title, initial, onClose, onOk }: {
  title: string; initial: string; onClose: () => void; onOk: (name: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { try { await onOk(v); } catch (e) { setErr(errText(e)); } };
  return (
    <Modal title={title} onClose={onClose}>
      <label>{t("tl.refName")}<input className="search" autoFocus value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }} /></label>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" onClick={go}>{t("sa.ok")}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ PDF import (Statimat + Itemat in one) */
/** One import for Statimat and Itemat PDFs (Nutzerwunsch 2026-11-16, both apps): the kind of every attached PDF
 *  is recognised by the server (db/lab_pdf_import.detect_kind), the chosen ones are imported by their kind. */
export function PdfImportDialog({ seriesId, onClose, onDone }: { seriesId: number; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [pdfs, setPdfs] = useState<{ id: number; name: string }[] | null>(null);
  const [kinds, setKinds] = useState<Record<string, string | null> | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    request<{ pdfs: { id: number; name: string }[] }>("GET", `/api/series/${seriesId}/attachments`).then((r) => setPdfs(r.pdfs))
      .catch((e) => setErr(errText(e)));
    request<{ kinds: Record<string, string | null> }>("GET", `/api/series/${seriesId}/pdf-import/kinds`).then((r) => setKinds(r.kinds))
      .catch(() => setKinds({}));
  }, [seriesId]);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await request<{ message: string }>("POST", `/api/series/${seriesId}/pdf-import`, { kind: "auto", ids: sel });
      setResult(r.message); onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const kindOf = (id: number) => (kinds ? kinds[String(id)] ?? null : undefined);
  const badge = (k: string | null | undefined) =>
    k === undefined ? <span className="pi-kind muted">…</span>
      : <span className={"pi-kind " + (k ?? "unknown")}>{k === "statimat" ? "Statimat" : k === "itemat" ? "Itemat" : t("tl.pdfUnknown")}</span>;
  const chosen = sel.map(kindOf);
  return (
    <Modal title={t("tl.pdfTitle")} onClose={onClose}>
      {!result && <p className="muted">{t("tl.pdfText")}</p>}
      {pdfs?.length === 0 && <p>{t("tl.noPdfs")}</p>}
      {!result && pdfs && pdfs.length > 0 && (
        <div className="tl-trials pi-list">
          {pdfs.map((p) => (
            <label key={p.id} className="tl-trial"><input type="checkbox" checked={sel.includes(p.id)}
              onChange={() => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} />
              {badge(kindOf(p.id))} {p.name}</label>
          ))}
        </div>
      )}
      {!result && sel.length > 0 && (
        <p className="muted small">{t("tl.pdfChosen", { s: chosen.filter((k) => k === "statimat").length,
          i: chosen.filter((k) => k === "itemat").length, u: chosen.filter((k) => k === null).length })}</p>
      )}
      {busy && <p className="muted">{t("tl.importing")}</p>}
      {result && <pre className="tl-result-text">{result}</pre>}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.close")}</button>
        {!result && <button className="btn-green" disabled={!sel.length || busy} onClick={go}>{t("tl.import")}</button>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ vs Ref / Target */
type CmpSetup = { trials: { id: number; label: string; ref: boolean }[]; refs: { id: number; name: string }[];
  sets: { id: number; name: string; criteria: Record<string, Crit>; can_delete: boolean }[]; db: boolean;
  directions: string[]; default_tol: Record<string, number> };
type Crit = { dir?: string | null; tol?: number | null; target?: number | null };
type CmpMetric = { key: string; tab: string; title: string; ref: number | null; counted: boolean };
type CmpCell = { status: string; diff: number | null; value: number | null };
type CmpRow = { trial_id: number; label: string; passed: number; total: number; all_pass: boolean; failing: string[]; cells: Record<string, CmpCell> };

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export function RefCompareDialog({ seriesId, refId, onClose, onJump }: { seriesId: number; refId: number | null; onClose: () => void;
  onJump?: (trialId: number) => void }) {
  const { t } = useI18n();
  const [setup, setSetup] = useState<CmpSetup | null>(null);
  const [ref, setRef] = useState<number | null>(refId);
  const [crit, setCrit] = useState<Record<string, Crit>>({});
  const [setId, setSetId] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  const [res, setRes] = useState<{ metrics: CmpMetric[]; rows: CmpRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [first, setFirst] = useState(true);
  useEffect(() => {
    request<CmpSetup>("GET", `/api/series/${seriesId}/ref-compare/setup`).then((s) => {
      setSetup(s);
      if (refId === null && s.refs.length) setRef(s.refs[0].id);
    }).catch((e) => setErr(errText(e)));
  }, [seriesId, refId]);
  useEffect(() => {
    if (!setup) return;
    const id = window.setTimeout(() => {
      request<{ metrics: CmpMetric[]; rows: CmpRow[] }>("POST", `/api/series/${seriesId}/ref-compare`, { ref_id: ref, criteria: crit, fresh: first })
        .then((r) => { setRes(r); setFirst(false); }).catch((e) => setErr(errText(e)));
    }, 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, ref, crit, seriesId]);
  const upd = (k: string, p: Partial<Crit>) => { setCrit((c) => ({ ...c, [k]: { ...(c[k] ?? {}), ...p } })); setChanged(true); };
  const fmt = (v: number | null | undefined) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(2));
  const counted = res?.metrics.filter((m) => m.counted) ?? [];
  const saveSet = async (asNew: boolean) => {
    const cur = setup?.sets.find((s) => s.id === setId);
    const name = asNew || !cur ? window.prompt(t("tl.cmpSetName"), cur?.name ?? "") : cur.name;
    if (!name) return;
    try {
      const r = await request<{ id: number; sets: CmpSetup["sets"] }>("POST", "/api/series/ref-criteria",
        { name, criteria: crit, set_id: asNew ? null : setId });
      setSetup((s) => s && { ...s, sets: r.sets }); setSetId(r.id); setChanged(false);
    } catch (e) { setErr(errText(e)); }
  };
  const delSet = async () => {
    const cur = setup?.sets.find((s) => s.id === setId);
    if (!cur || !window.confirm(t("tl.cmpDelQ", { name: cur.name }))) return;
    try {
      const r = await request<{ sets: CmpSetup["sets"] }>("DELETE", `/api/series/ref-criteria/${cur.id}`);
      setSetup((s) => s && { ...s, sets: r.sets }); setSetId(null);
    } catch (e) { setErr(errText(e)); }
  };
  const dirLabel: Record<string, string> = { higher: t("tl.cmpHigher"), lower: t("tl.cmpLower"), close: t("tl.cmpClose") };
  const [onlyPass, setOnlyPass] = useState(false);   // desktop "Only trials that meet all criteria"
  return (
    <Modal title={t("tl.cmpTitle")} onClose={onClose} wide>
      {setup && (
        <div className="tl-step">
          {t("tl.cmpWith")}
          <select value={ref ?? -1} onChange={(e) => setRef(Number(e.target.value) < 0 ? null : Number(e.target.value))}>
            {setup.refs.map((r) => <option key={r.id} value={r.id}>Ref: {r.name || t("tl.cmpRefSample")}</option>)}
            <option value={-1}>{t("tl.cmpOwn")}</option>
          </select>
          <span className="muted">{t("tl.cmpSet")}</span>
          <select value={setId ?? ""} onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            setSetId(id); setCrit(id ? { ...(setup.sets.find((s) => s.id === id)?.criteria ?? {}) } : {}); setChanged(false);
          }}>
            <option value="">–</option>
            {setup.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn-plain" disabled={!setup.db || !changed || setId === null} onClick={() => saveSet(false)}>{t("tl.cmpSave")}</button>
          <button className="btn-plain" disabled={!setup.db || !Object.keys(crit).length} onClick={() => saveSet(true)}>{t("tl.cmpSaveAs")}</button>
          <button className="btn-plain" disabled={!setup.sets.find((s) => s.id === setId)?.can_delete} onClick={delSet}>{t("cm.delete")}</button>
        </div>
      )}
      <p className="muted">{ref === null ? t("tl.cmpHintOwn") : t("tl.cmpHint")}</p>
      {res && (
        <div className="cmp-wrap">
          <div className="table-wrap cmp-crit">
            <table className="grid">
              <thead><tr><th>{t("tl.cmpMetric")}</th><th>{ref === null ? t("tl.cmpTarget") : "Ref"}</th><th>{t("tl.cmpDir")}</th><th>{t("tl.cmpTol")}</th>{ref !== null && <th>{t("tl.cmpTarget")}</th>}</tr></thead>
              <tbody>
                {res.metrics.map((m) => {
                  const c = crit[m.key] ?? {};
                  return (
                    <tr key={m.key} className={m.counted ? "cmp-on" : ""}>
                      <td><span className="muted">{m.tab} · </span>{m.title}</td>
                      <td>{ref === null
                        ? <input className="tl-in" value={c.target ?? ""} onChange={(e) => upd(m.key, { target: num(e.target.value) })} />
                        : fmt(m.ref)}</td>
                      <td><select value={c.dir ?? ""} onChange={(e) => upd(m.key, { dir: e.target.value || null })}>
                        <option value="">–</option>
                        {setup?.directions.map((d) => <option key={d} value={d}>{dirLabel[d] ?? d}</option>)}
                      </select></td>
                      <td><input className="tl-in narrow" placeholder={c.dir ? String(setup?.default_tol[c.dir] ?? "") : ""} value={c.tol ?? ""}
                        onChange={(e) => upd(m.key, { tol: num(e.target.value) })} /></td>
                      {ref !== null && <td><input className="tl-in" placeholder={fmt(m.ref)} value={c.target ?? ""}
                        onChange={(e) => upd(m.key, { target: num(e.target.value) })} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="st-check"><input type="checkbox" checked={onlyPass} onChange={(e) => setOnlyPass(e.target.checked)} /> {t("tl.cmpOnlyPass")}</label>
          <div className="table-wrap cmp-res">
            {counted.length === 0 ? <p className="muted">{t("tl.cmpNone")}</p> : (
              <table className="grid">
                <thead><tr><th>{t("nt.trial")}</th><th>{t("tl.cmpPassed")}</th>{counted.map((m) => <th key={m.key} title={m.tab}>{m.title}</th>)}</tr></thead>
                <tbody>
                  {res.rows.filter((r) => !onlyPass || r.all_pass).map((r) => (
                    <tr key={r.trial_id} className={r.all_pass ? "cmp-all" : ""} onDoubleClick={() => onJump?.(r.trial_id)}
                      title={[r.failing.length ? t("tl.cmpMisses", { list: r.failing.join(", ") }) : "", onJump ? t("tl.cmpJumpTip") : ""].filter(Boolean).join("\n") || undefined}>
                      <td className="nowrap"><b>{r.label}</b></td>
                      <td className="nowrap">{r.passed}/{r.total}</td>
                      {counted.map((m) => {
                        const c = r.cells[m.key];
                        return <td key={m.key} className={"cmp-" + c.status}>{fmt(c.value)}{c.diff != null && <span className="cmp-diff"> {c.diff > 0 ? "+" : ""}{c.diff.toFixed(1)}%</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {!res && !err && <div className="muted">{t("se.loading")}</div>}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("cm.close")}</button></div>
    </Modal>
  );
}
