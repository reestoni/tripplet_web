import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";

/* Yarn Stock (desktop ui/screen_yarn_stock.py) on backend/app/yarn_stock_api.py / db/yarn_stock.py.
   Overview yarn x batch (status per yarn), spools of the chosen batch (edit, new, discard, used in,
   history), label queue + label sheet PDF, rack lookup, Excel exports, "Go to spool #" (also scanner).
   Writing from access level 2, MinStock only superusers - checked again on the server. */

type Group = { yarn_id: number; charge: string; yarn: string; producers: string; producer_ids: number[]; count: number;
  total_kg: number; yarn_total_kg?: number; min_stock?: number | null; status?: string; locations: string; css?: string | null };
type Spool = { id: number; weight: number | null; location: string; colour: string; producer_id: number | null;
  received: string | null; status: string };
type QueueItem = { QueueID: number; SpoolID: number; Yarn: string; Batch: string; Weight: number; Location: string };
type Data = { overview: Group[]; yarns: { id: number; name: string; css: string | null }[]; producers: [number, string][];
  queue: QueueItem[]; can_write: boolean; can_edit_minstock: boolean; status_colors: Record<string, string> };
type Edit = { weight?: string; location?: string; colour?: string; producer?: number | null };
type T = (k: string, v?: Record<string, string | number>) => string;

const key = (g: { yarn_id: number; charge: string }) => `${g.yarn_id}|${g.charge}`;
const kg = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "" : Number(v).toFixed(d));

function errText(t: T, e: unknown): string {
  if (e instanceof ApiError && e.code) {
    const k = `st.err.${e.code}`;
    const s = t(k, (e.data?.vars ?? {}) as Record<string, string | number>);
    if (s !== k) return s;
  }
  return e instanceof Error ? e.message : String(e);
}

async function download(url: string, filename: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    let j: { detail?: string; code?: string } = {};
    try { j = await res.json(); } catch { /* none */ }
    throw new ApiError(res.status, j.detail ?? res.statusText, j.code, j as Record<string, unknown>);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function Sq({ css }: { css?: string | null }) {
  return css ? <span className="ce-dot my-sq" style={{ background: css }} /> : null;
}

/* inline group cell (Batch / Producer / Min. stock): click -> edit, Enter / change saves at once (desktop) */
function GroupCell({ value, display, kind, producers, onSave, editable }: { value: string | number | null; display: string;
  kind: "text" | "producer" | "number"; producers?: [number, string][]; onSave: (v: string) => void; editable: boolean }) {
  const [edit, setEdit] = useState(false);
  if (!edit || !editable) {
    return <span className={editable ? "st-editable" : ""} onDoubleClick={(e) => { if (editable) { e.stopPropagation(); setEdit(true); } }}>{display}</span>;
  }
  if (kind === "producer") {
    return (
      <select autoFocus className="at-edit" defaultValue={value === null ? "" : String(value)} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { setEdit(false); onSave(e.target.value); }} onBlur={() => setEdit(false)}
        onKeyDown={(e) => e.key === "Escape" && setEdit(false)}>
        <option value="">— none —</option>
        {producers?.map(([i, n]) => <option key={i} value={i}>{n}</option>)}
      </select>
    );
  }
  return (
    <input autoFocus className="at-edit" defaultValue={value === null ? "" : String(value)} onClick={(e) => e.stopPropagation()}
      inputMode={kind === "number" ? "decimal" : undefined}
      onBlur={(e) => { setEdit(false); if (e.target.value !== String(value ?? "")) onSave(e.target.value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { (e.target as HTMLInputElement).value = String(value ?? ""); setEdit(false); }
      }} />
  );
}

export default function YarnStock() {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; history?: number } | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<{ yarn_id: number; charge: string } | null>(null);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [hilite, setHilite] = useState<number | null>(null);
  const [open, setOpen] = useState({ detail: true, queue: true, rack: true });
  const [goto, setGoto] = useState("");
  const [rack, setRack] = useState("");
  const [rackRows, setRackRows] = useState<Group[]>([]);
  const [queueSel, setQueueSel] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<null | { kind: "new" | "producer" | "usedin" | "history" | "print" | "discard" | "pending";
    ids?: number[]; title?: string; then?: () => void }>(null);
  const gotoRef = useRef<HTMLInputElement>(null);
  const dirty = Object.keys(edits).length > 0;

  const load = useCallback(async () => {
    try {
      const d = await request<Data>("GET", "/api/yarn-stock");
      setData(d);
      setLoadErr(null);
      return d;
    } catch (e) { setLoadErr(errText(t, e)); return null; }
  }, [t]);

  const loadGroup = useCallback(async (g: { yarn_id: number; charge: string } | null) => {
    setEdits({});
    setTicked(new Set());
    if (!g) { setSpools([]); return; }
    const r = await request<{ spools: Spool[] }>("GET", `/api/yarn-stock/group?yarn_id=${g.yarn_id}&charge=${encodeURIComponent(g.charge)}`);
    setSpools(r.spools);
  }, []);

  const [params] = useSearchParams();
  useEffect(() => {
    // ?yarn=<id>&charge=<batch> ("Open in Yarn Stock" from Create Experiment, desktop goto_yarn_batch):
    // that batch, else the first batch of the yarn
    load().then((d) => {
      const y = Number(params.get("yarn"));
      if (!d || !y) return;
      const c = params.get("charge") ?? "";
      const g = d.overview.find((x) => x.yarn_id === y && x.charge === c) ?? d.overview.find((x) => x.yarn_id === y);
      if (!g) return;
      setSel({ yarn_id: g.yarn_id, charge: g.charge });
      loadGroup(g).catch(() => undefined);
      window.setTimeout(() => document.getElementById(`grp-${key(g)}`)?.scrollIntoView({ block: "center" }), 80);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(() => {
    if (!rack.trim()) { setRackRows([]); return; }
    const h = window.setTimeout(() => {
      request<{ rows: Group[] }>("GET", `/api/yarn-stock/rack?prefix=${encodeURIComponent(rack.trim())}`)
        .then((r) => setRackRows(r.rows)).catch((e) => setMsg({ kind: "err", text: errText(t, e) }));
    }, 200);
    return () => window.clearTimeout(h);
  }, [rack, data, t]);

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const refresh = async (g = sel) => { await load(); await loadGroup(g); };

  /* unsaved spool edits: Save / Discard / Cancel before anything that reloads the spools (desktop) */
  const guard = (then: () => void) => { if (dirty) setDialog({ kind: "pending", then }); else then(); };

  const choose = (g: Group) => {
    if (sel && key(sel) === key(g)) return;
    guard(() => { setSel({ yarn_id: g.yarn_id, charge: g.charge }); setHilite(null); loadGroup(g).catch((e) => setMsg({ kind: "err", text: errText(t, e) })); });
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.overview ?? []).filter((g) => (!q || g.yarn.toLowerCase().includes(q) || g.charge.toLowerCase().includes(q))
      && (!status || g.status === status));
  }, [data, search, status]);

  const groupSave = async (g: Group, what: "batch" | "producer" | "minstock", v: string) => {
    try {
      if (what === "batch") await request("POST", "/api/yarn-stock/group/batch", { yarn_id: g.yarn_id, charge: g.charge, new_charge: v });
      else if (what === "producer") await request("POST", "/api/yarn-stock/group/producer", { yarn_id: g.yarn_id, charge: g.charge, producer_id: v === "" ? null : Number(v) });
      else {
        const s = v.trim().replace(",", ".");
        const val = s === "" || s === "–" || s === "-" ? null : Number(s);
        if (val !== null && (!Number.isFinite(val) || val < 0)) { setMsg({ kind: "err", text: t("st.err.bad_minstock") }); return; }
        await request("POST", "/api/yarn-stock/minstock", { yarn_id: g.yarn_id, value: val });
      }
      const next = what === "batch" && sel && key(sel) === key(g) ? { yarn_id: g.yarn_id, charge: v.trim() === "–" ? "" : v.trim() } : sel;
      if (next !== sel) setSel(next);
      await refresh(next);
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
  };

  const doGoto = async () => {
    const text = goto;
    guard(async () => {
      try {
        const r = await request<{ spool_id: number; yarn_id: number; charge: string; discarded: boolean }>("POST", "/api/yarn-stock/goto", { text });
        if (r.discarded) { setMsg({ kind: "err", text: t("st.goto_discarded", { id: r.spool_id }), history: r.spool_id }); return; }
        setSearch(""); setStatus("");
        let g = data?.overview.find((x) => x.yarn_id === r.yarn_id && x.charge === r.charge)
          ?? data?.overview.find((x) => x.yarn_id === r.yarn_id);
        if (!g) { setMsg({ kind: "err", text: t("st.goto_nogroup", { id: r.spool_id }) }); return; }
        g = g!;
        setSel({ yarn_id: g.yarn_id, charge: g.charge });
        setOpen((o) => ({ ...o, detail: true }));
        await loadGroup(g);
        setHilite(r.spool_id);
        window.setTimeout(() => document.getElementById(`spool-${r.spool_id}`)?.scrollIntoView({ block: "center" }), 50);
        document.getElementById(`grp-${key(g)}`)?.scrollIntoView({ block: "nearest" });
      } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
      gotoRef.current?.select();      // the next scan replaces the input
    });
  };

  const saveSpools = async (): Promise<boolean> => {
    if (!dirty) { setMsg({ kind: "ok", text: t("st.no_changes") }); return true; }
    try {
      const changes = Object.entries(edits).map(([id, e]) => ({ id: Number(id), weight: e.weight, location: e.location, colour: e.colour,
        producer_id: e.producer === undefined ? null : e.producer, set_producer: e.producer !== undefined }));
      const r = await request<{ updated: number }>("POST", "/api/yarn-stock/spools/save", { changes });
      setMsg({ kind: "ok", text: t("st.saved", { n: r.updated }) });
      await refresh();
      return true;
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); return false; }
  };

  const setEdit = (s: Spool, field: keyof Edit, v: string | number | null) => {
    const orig: Record<keyof Edit, unknown> = { weight: kg(s.weight), location: s.location, colour: s.colour, producer: s.producer_id };
    setEdits((all) => {
      const e = { ...(all[s.id] ?? {}) } as Record<string, unknown>;
      if (String(orig[field] ?? "") === String(v ?? "")) delete e[field]; else e[field] = v;
      const next = { ...all };
      if (Object.keys(e).length) next[s.id] = e as Edit; else delete next[s.id];
      return next;
    });
  };

  const tickedOrHilite = () => [...ticked, ...(hilite !== null && !ticked.has(hilite) ? [hilite] : [])];

  const addToQueue = async () => {
    if (!ticked.size) { setMsg({ kind: "err", text: t("st.tick_one") }); return; }
    try {
      const r = await request<{ added: number }>("POST", "/api/yarn-stock/queue/add", { ids: [...ticked] });
      setMsg({ kind: "ok", text: t("st.queued", { n: r.added }) });
      await load();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
  };

  const removeFromQueue = async () => {
    if (!queueSel.size) { setMsg({ kind: "err", text: t("st.select_one") }); return; }
    try {
      await request("POST", "/api/yarn-stock/queue/remove", { ids: [...queueSel] });
      setQueueSel(new Set());
      await load();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
  };

  if (loadErr) return <div className="card error">{loadErr}</div>;
  if (!data) return <div className="muted">{t("app.loading")}</div>;
  const ro = !data.can_write;
  const selGroup = sel ? data.overview.find((g) => key(g) === key(sel)) : undefined;
  const pname = (id: number | null | undefined) => (id === null || id === undefined ? "" : data.producers.find(([i]) => i === id)?.[1] ?? `#${id}`);
  const activeIds = spools.filter((s) => s.status === "in stock").map((s) => s.id);
  const allTicked = activeIds.length > 0 && activeIds.every((i) => ticked.has(i));

  const groupRow = (g: Group, rackRow: boolean) => {
    const single = g.producer_ids.length === 1 ? g.producer_ids[0] : null;
    const isSel = !rackRow && sel && key(sel) === key(g);
    return (
      <tr key={key(g)} id={rackRow ? undefined : `grp-${key(g)}`} className={isSel ? "sel" : ""}
        style={rackRow ? undefined : { background: data.status_colors[g.status ?? "OK"] }}
        onClick={() => !rackRow && choose(g)}>
        <td><Sq css={g.css ?? data.yarns.find((y) => y.id === g.yarn_id)?.css} />{g.yarn}</td>
        <td><GroupCell value={g.charge} display={g.charge || "–"} kind="text" editable={!ro} onSave={(v) => groupSave(g, "batch", v)} /></td>
        <td><GroupCell value={single} display={g.producers} kind="producer" producers={data.producers} editable={!ro} onSave={(v) => groupSave(g, "producer", v)} /></td>
        <td className="num">{g.count}</td>
        <td className="num">{kg(g.total_kg)}</td>
        {!rackRow && <td className="num">{kg(g.yarn_total_kg)}</td>}
        {!rackRow && <td className="num"><GroupCell value={g.min_stock ?? null} display={g.min_stock == null ? "–" : String(g.min_stock)} kind="number"
          editable={data.can_edit_minstock} onSave={(v) => groupSave(g, "minstock", v)} /></td>}
        {!rackRow && <td>{t(`st.status.${g.status}`)}</td>}
        <td>{g.locations}</td>
      </tr>
    );
  };

  const section = (k: "detail" | "queue" | "rack", title: React.ReactNode) => (
    <div className="st-sec-head">
      <button className="st-toggle" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>{open[k] ? "▾" : "▸"}</button>
      {title}
    </div>
  );

  return (
    <div className="st-page">
      <div className="page-head">
        <h1>{t("st.title")}</h1>
        <label className="st-goto">{t("st.goto")}
          <input ref={gotoRef} value={goto} placeholder={t("st.goto_ph")} title={t("st.goto_tip")} onChange={(e) => setGoto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doGoto(); }} />
        </label>
        <button className="btn-plain" onClick={doGoto}>{t("st.go")}</button>
      </div>
      {msg && (
        <div className={"st-msg" + (msg.kind === "err" ? " err" : "")}>
          {msg.text}
          {msg.history !== undefined && <button className="btn-plain" onClick={() => setDialog({ kind: "history", ids: [msg.history!], title: `#${msg.history}` })}>{t("st.show_history")}</button>}
          <button className="st-x" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* ---------------- overview */}
      <div className="toolbar st-head">
        <b>{t("st.overview")}</b>
        <span className="muted">{t("st.count", { n: shown.length, total: data.overview.length })}</span>
        <span className="st-grow" />
        <input className="mj-search" value={search} placeholder={t("st.search")} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("st.all_statuses")}</option>
          {["OK", "Low", "Empty"].map((s) => <option key={s} value={s}>{t(`st.status.${s}`)}</option>)}
        </select>
        <button className="btn-plain" onClick={() => guard(() => refresh())}>{t("mj.reload")}</button>
        <button className="btn-plain" onClick={() => download(`/api/yarn-stock/export/overview?search=${encodeURIComponent(search)}&status=${status}`, "yarn_stock_overview.xlsx")
          .catch((e) => setMsg({ kind: "err", text: errText(t, e) }))}>{t("st.excel")}</button>
      </div>
      <div className="st-table st-ov">
        <table className="at st">
          <thead><tr>
            <th>{t("st.c.yarn")}</th><th>{t("st.c.batch")}</th><th>{t("st.c.producer")}</th><th>{t("st.c.spools")}</th><th>{t("st.c.total")}</th>
            <th title={t("st.c.yarn_total_tip")}>{t("st.c.yarn_total")}</th><th title={t("st.c.minstock_tip")}>{t("st.c.minstock")}</th>
            <th>{t("st.c.status")}</th><th>{t("st.c.locations")}</th>
          </tr></thead>
          <tbody>{shown.map((g) => groupRow(g, false))}</tbody>
        </table>
      </div>

      {/* ---------------- spools */}
      {section("detail", <>
        <b>{t("st.spools")}</b>
        <span className="muted">— {selGroup ? `${selGroup.yarn} / ${selGroup.charge || t("st.no_batch")}` : t("st.select_group")}</span>
        {ro && <span className="st-ro">🔒 {t("st.view_only")}</span>}
      </>)}
      {open.detail && (
        <>
          <div className="toolbar st-btns">
            <button className="btn-plain" disabled={ro || !activeIds.length} onClick={() => setTicked(allTicked ? new Set() : new Set(activeIds))}>
              {allTicked ? t("st.deselect_all") : t("st.select_all")}</button>
            <button className="btn-green" disabled={ro} onClick={() => guard(() => setDialog({ kind: "new" }))}>{t("st.new_spools")}</button>
            <button className="btn-plain" disabled={ro} onClick={() => setDialog({ kind: "producer" })}>{t("st.new_producer")}</button>
            <button className="btn-plain" onClick={() => { const ids = tickedOrHilite(); if (!ids.length) setMsg({ kind: "err", text: t("st.tick_or_select") }); else setDialog({ kind: "usedin", ids }); }}>{t("st.used_in")}</button>
            <button className="btn-plain" title={t("st.history_tip")} onClick={() => {
              const ids = tickedOrHilite();
              if (ids.length) setDialog({ kind: "history", ids, title: ids.map((i) => `#${i}`).join(", ") });
              else if (selGroup) setDialog({ kind: "history", title: `${selGroup.yarn} / ${selGroup.charge || t("st.no_batch")} — ${t("st.all_incl_discarded")}` });
              else setMsg({ kind: "err", text: t("st.select_first") });
            }}>{t("st.history")}</button>
            <button className="btn-plain" disabled={ro} onClick={addToQueue}>{t("st.add_queue")}</button>
            <button className="btn-plain" disabled={ro} onClick={() => {
              if (!ticked.size) { setMsg({ kind: "err", text: t("st.tick_one") }); return; }
              const ids = [...ticked];
              guard(() => setDialog({ kind: "discard", ids }));
            }}>{t("st.discard")}</button>
            <button className="btn-green" disabled={ro || !dirty} onClick={saveSpools}>{t("mj.save")}{dirty ? ` (${Object.keys(edits).length})` : ""}</button>
          </div>
          <div className="st-table">
            <table className="at st">
              <thead><tr><th /><th>{t("st.c.spool")}</th><th>{t("st.c.weight")}</th><th>{t("st.c.location")}</th><th>{t("st.c.tube")}</th>
                <th>{t("st.c.producer")}</th><th>{t("st.c.received")}</th><th>{t("st.c.status")}</th></tr></thead>
              <tbody>
                {!sel && <tr><td colSpan={8} className="muted">{t("st.select_group")}</td></tr>}
                {spools.map((s) => {
                  const e = edits[s.id] ?? {};
                  const active = s.status === "in stock" && !ro;
                  const cell = (f: "weight" | "location" | "colour", v: string) => (
                    <td className={(f in e ? "dirty " : "") + (f === "weight" ? "num" : "")}>
                      {active ? <input className="st-in" value={(e[f] as string | undefined) ?? v} inputMode={f === "weight" ? "decimal" : undefined}
                        onChange={(ev) => setEdit(s, f, ev.target.value)} onClick={(ev) => ev.stopPropagation()} /> : v}
                    </td>
                  );
                  return (
                    <tr key={s.id} id={`spool-${s.id}`} className={(hilite === s.id ? "sel " : "") + (s.status !== "in stock" ? "st-gone" : "")}
                      onClick={() => setHilite(s.id)}>
                      <td><input type="checkbox" disabled={!active} checked={ticked.has(s.id)} onClick={(ev) => ev.stopPropagation()}
                        onChange={() => setTicked((x) => { const n = new Set(x); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} /></td>
                      <td>#{s.id}</td>
                      {cell("weight", kg(s.weight))}
                      {cell("location", s.location)}
                      {cell("colour", s.colour)}
                      <td className={"producer" in e ? "dirty" : ""}>
                        {active ? (
                          <select className="st-in" value={String(("producer" in e ? e.producer : s.producer_id) ?? "")} onClick={(ev) => ev.stopPropagation()}
                            onChange={(ev) => setEdit(s, "producer", ev.target.value === "" ? null : Number(ev.target.value))}>
                            <option value="">— none —</option>
                            {data.producers.map(([i, n]) => <option key={i} value={i}>{n}</option>)}
                          </select>
                        ) : pname(s.producer_id)}
                      </td>
                      <td>{s.received ?? ""}</td>
                      <td>{s.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- label queue */}
      {section("queue", <><b>{t("st.queue")}</b><span className="muted">({data.queue.length})</span></>)}
      {open.queue && (
        <>
          <div className="toolbar st-btns">
            <button className="btn-plain" disabled={ro} onClick={removeFromQueue}>{t("st.remove_selected")}</button>
            <button className="btn-green" disabled={ro || !data.queue.length} onClick={() => setDialog({ kind: "print" })}>{t("st.print")}</button>
          </div>
          <div className="st-table st-small">
            <table className="at st">
              <thead><tr><th /><th>{t("st.c.spool")}</th><th>{t("st.c.yarn")}</th><th>{t("st.c.batch")}</th><th>{t("st.c.weight")}</th></tr></thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={q.QueueID} className={queueSel.has(q.QueueID) ? "sel" : ""}
                    onClick={() => setQueueSel((x) => { const n = new Set(x); if (n.has(q.QueueID)) n.delete(q.QueueID); else n.add(q.QueueID); return n; })}>
                    <td><input type="checkbox" readOnly checked={queueSel.has(q.QueueID)} /></td>
                    <td>#{q.SpoolID}</td><td>{q.Yarn}</td><td>{q.Batch || "–"}</td><td className="num">{kg(q.Weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- rack lookup */}
      {section("rack", <b>{t("st.rack")}</b>)}
      {open.rack && (
        <>
          <div className="toolbar st-btns">
            <label className="st-goto">{t("st.rack_label")}<input className="st-rack" value={rack} placeholder="C" onChange={(e) => setRack(e.target.value)} /></label>
            <span className="st-grow" />
            <Link className={"btn-plain" + (ro ? " disabled" : "")} title={ro ? t("st.err.read_only") : t("st.stocktake_tip")}
              to={ro ? "#" : `/tools/yarn-stock/stock-take?rack=${encodeURIComponent(rack.trim())}`}
              onClick={(e) => { if (ro) e.preventDefault(); else if (dirty && !window.confirm(t("mj.discard"))) e.preventDefault(); }}>{t("st.stocktake")}</Link>
            <button className="btn-plain" onClick={() => {
              if (!rack.trim()) { setMsg({ kind: "err", text: t("st.rack_first") }); return; }
              download(`/api/yarn-stock/export/rack?prefix=${encodeURIComponent(rack.trim())}`, `rack_${rack.trim().toUpperCase()}.xlsx`)
                .catch((e) => setMsg({ kind: "err", text: errText(t, e) }));
            }}>{t("st.excel")}</button>
          </div>
          {rack.trim() && (
            <div className="st-table st-small">
              <table className="at st">
                <thead><tr><th>{t("st.c.yarn")}</th><th>{t("st.c.batch")}</th><th>{t("st.c.producer")}</th><th>{t("st.c.spools")}</th>
                  <th>{t("st.c.total")}</th><th>{t("st.c.locations")}</th></tr></thead>
                <tbody>
                  {rackRows.length ? rackRows.map((g) => groupRow(g, true))
                    : <tr><td colSpan={6} className="muted">{t("st.rack_empty", { rack: rack.trim().toUpperCase() })}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---------------- dialogs */}
      {dialog?.kind === "pending" && (
        <Modal title={t("st.pending_title")} onClose={() => setDialog(null)}>
          <p>{t("st.pending_text")}</p>
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => setDialog(null)}>{t("mj.cancel")}</button>
            <button className="btn-plain" onClick={() => { const then = dialog.then; setDialog(null); setEdits({}); then?.(); }}>{t("st.discard_changes")}</button>
            <button className="btn-green" autoFocus onClick={async () => { const then = dialog.then; setDialog(null); if (await saveSpools()) then?.(); }}>{t("mj.save")}</button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "discard" && (
        <Modal title={t("st.discard")} onClose={() => setDialog(null)}>
          <p>{t("st.discard_ask", { n: dialog.ids!.length })}</p>
          <div className="modal-buttons">
            <button className="btn-plain" autoFocus onClick={() => setDialog(null)}>{t("my.no")}</button>
            <button className="btn-danger" onClick={async () => {
              const ids = dialog.ids!;
              setDialog(null);
              try {
                const r = await request<{ discarded: number }>("POST", "/api/yarn-stock/spools/discard", { ids });
                setMsg({ kind: "ok", text: t("st.discarded", { n: r.discarded }) });
                await refresh();
              } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
            }}>{t("my.yes")}</button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "new" && (
        <NewSpoolsDialog data={data} preselect={sel} onClose={() => setDialog(null)} onProducers={(p) => setData({ ...data, producers: p })}
          onDone={async (r, yarnId) => {
            setDialog(null);
            setMsg({ kind: "ok", text: t("st.created", { n: r.ids.length }) + (r.queued ? " " + t("st.queued", { n: r.queued }) : "") });
            const d = await load();
            const g = { yarn_id: yarnId, charge: r.charge };
            setSearch(""); setStatus("");
            setSel(g);
            await loadGroup(g);
            if (d) window.setTimeout(() => document.getElementById(`grp-${key(g)}`)?.scrollIntoView({ block: "nearest" }), 50);
          }} />
      )}
      {dialog?.kind === "producer" && (
        <ProducerDialog onClose={() => setDialog(null)} onDone={(p, name) => { setDialog(null); setData({ ...data, producers: p }); setMsg({ kind: "ok", text: t("st.producer_created", { name }) }); }} />
      )}
      {dialog?.kind === "usedin" && <UsedInDialog ids={dialog.ids!} onClose={() => setDialog(null)} />}
      {dialog?.kind === "history" && (
        <HistoryDialog ids={dialog.ids} group={dialog.ids ? null : sel} title={dialog.title ?? ""} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "print" && (
        <PrintDialog count={data.queue.length} onClose={() => setDialog(null)} onPrinted={() => { setDialog(null); load(); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ dialogs */
function NewSpoolsDialog({ data, preselect, onClose, onDone, onProducers }: { data: Data; preselect: { yarn_id: number; charge: string } | null;
  onClose: () => void; onDone: (r: { ids: number[]; queued: number; charge: string }, yarnId: number) => void; onProducers: (p: [number, string][]) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ yarn_id: preselect?.yarn_id ?? data.yarns[0]?.id ?? 0, charge: preselect?.charge ?? "", weight: "5.00", count: "1",
    location: "", colour: "", producer_id: "", add_to_queue: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addProd, setAddProd] = useState(false);
  const yarn = data.yarns.find((y) => y.id === Number(v.yarn_id));
  const submit = async () => {
    const weight = Number(v.weight.replace(",", ".")), count = Number(v.count);
    if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(count) || count < 1 || count > 500) { setErr(t("st.err.bad_new_spool")); return; }
    setBusy(true);
    try {
      const r = await request<{ ids: number[]; queued: number; charge: string; partial_error: string | null }>("POST", "/api/yarn-stock/spools/new", {
        yarn_id: Number(v.yarn_id), charge: v.charge, weight, count, location: v.location, colour: v.colour,
        producer_id: v.producer_id === "" ? null : Number(v.producer_id), add_to_queue: v.add_to_queue });
      onDone(r, Number(v.yarn_id));
    } catch (e) { setErr(errText(t, e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={t("st.new_spools")} onClose={onClose}>
      <div className="st-form">
        <label>{t("st.c.yarn")}<span className="mj-fk"><Sq css={yarn?.css} />
          <select value={v.yarn_id} onChange={(e) => setV({ ...v, yarn_id: Number(e.target.value) })}>
            {data.yarns.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select></span></label>
        <label>{t("st.c.batch")}<input value={v.charge} onChange={(e) => setV({ ...v, charge: e.target.value })} /></label>
        <label>{t("st.weight_per")}<input inputMode="decimal" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} /></label>
        <label>{t("st.number")}<input type="number" min={1} max={500} value={v.count} onChange={(e) => setV({ ...v, count: e.target.value })} /></label>
        <label>{t("st.c.location")}<input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></label>
        <label>{t("st.c.tube")}<input value={v.colour} onChange={(e) => setV({ ...v, colour: e.target.value })} /></label>
        <label>{t("st.c.producer")}<span className="mj-fk">
          <select value={v.producer_id} onChange={(e) => setV({ ...v, producer_id: e.target.value })}>
            <option value="">— none —</option>
            {data.producers.map(([i, n]) => <option key={i} value={i}>{n}</option>)}
          </select>
          <button className="btn-plain" onClick={() => setAddProd(true)}>{t("st.new_short")}</button></span></label>
        <label className="st-check"><input type="checkbox" checked={v.add_to_queue} onChange={(e) => setV({ ...v, add_to_queue: e.target.checked })} />{t("st.to_queue")}</label>
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" disabled={busy || !v.yarn_id} onClick={submit}>OK</button>
      </div>
      {addProd && <ProducerDialog onClose={() => setAddProd(false)} onDone={(p, _n, id) => { onProducers(p); setV((x) => ({ ...x, producer_id: String(id) })); setAddProd(false); }} />}
    </Modal>
  );
}

function ProducerDialog({ onClose, onDone }: { onClose: () => void; onDone: (p: [number, string][], name: string, id: number) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try {
      const r = await request<{ id: number; producers: [number, string][] }>("POST", "/api/yarn-stock/producers", { name: name.trim() });
      onDone(r.producers, name.trim(), r.id);
    } catch (e) { setErr(errText(t, e)); }
  };
  return (
    <Modal title={t("st.new_producer_title")} onClose={onClose}>
      <label className="my-colour-in">{t("st.producer_name")}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) go(); }} />
      </label>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" disabled={!name.trim()} onClick={go}>OK</button>
      </div>
    </Modal>
  );
}

function UsedInDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<{ spool_id: number; experiment: string | null; series_id: number | null; vno: number | null; ply: string }[] | null>(null);
  useEffect(() => { request<{ rows: typeof rows }>("POST", "/api/yarn-stock/used-in", { ids }).then((r) => setRows(r.rows)).catch(() => setRows([])); }, [ids]);
  return (
    <Modal title={t("st.used_in_title")} onClose={onClose} wide>
      {rows === null ? <p className="muted">{t("app.loading")}</p> : !rows.length ? <p>{t("st.used_in_none")}</p> : (
        <div className="st-table st-small">
          <table className="at st">
            <thead><tr><th>{t("st.c.spool")}</th><th>{t("st.experiment")}</th><th>{t("st.series")}</th><th>{t("st.trial")}</th><th>Ply</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}><td>#{r.spool_id}</td><td>{r.experiment ?? "–"}</td>
                <td>{r.series_id ? <Link to={`/series/${r.series_id}`}>{r.series_id}</Link> : "–"}</td>
                <td>{r.vno !== null ? `V${r.vno}` : "–"}</td><td>{r.ply}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("mj.close")}</button></div>
    </Modal>
  );
}

function HistoryDialog({ ids, group, title, onClose }: { ids?: number[]; group: { yarn_id: number; charge: string } | null; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const [res, setRes] = useState<{ available: boolean; rows: { when: string; user: string; spool_id: number; change: string }[] } | null>(null);
  useEffect(() => {
    request<NonNullable<typeof res>>("POST", "/api/yarn-stock/history", ids ? { ids } : { yarn_id: group?.yarn_id, charge: group?.charge ?? "" })
      .then(setRes).catch(() => setRes({ available: false, rows: [] }));
  }, [ids, group]);
  return (
    <Modal title={t("st.history_title")} onClose={onClose} wide>
      <p><b>{title}</b></p>
      {res === null ? <p className="muted">{t("app.loading")}</p> : !res.available ? <p>{t("st.history_na")}</p> : !res.rows.length ? <p>{t("st.history_none")}</p> : (
        <div className="st-table st-small">
          <table className="at st">
            <thead><tr><th>{t("st.when")}</th><th>{t("st.user")}</th><th>{t("st.c.spool")}</th><th>{t("st.change")}</th></tr></thead>
            <tbody>{res.rows.map((r, i) => <tr key={i}><td>{r.when}</td><td>{r.user}</td><td>#{r.spool_id}</td><td>{r.change}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("mj.close")}</button></div>
    </Modal>
  );
}

function PrintDialog({ count, onClose, onPrinted }: { count: number; onClose: () => void; onPrinted: () => void }) {
  const { t } = useI18n();
  const [fields, setFields] = useState<[string, string][]>([]);
  const [tpl, setTpl] = useState<Record<string, number>>({});
  const [start, setStart] = useState(0);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    request<{ template: Record<string, number>; fields: [string, string][] }>("GET", "/api/yarn-stock/labels/template")
      .then((r) => { setTpl(r.template); setFields(r.fields); }).catch((e) => setMsg({ kind: "err", text: errText(t, e) }));
  }, [t]);
  const cols = Math.max(1, Math.round(tpl.ColumnCount || 1)), rows = Math.max(1, Math.round(tpl.RowCount || 1));
  const needH = (tpl.MarginTopMm ?? 0) + rows * (tpl.LabelHeightMm ?? 0) + Math.max(0, rows - 1) * (tpl.VGapMm ?? 0);
  const needW = (tpl.MarginLeftMm ?? 0) + cols * (tpl.LabelWidthMm ?? 0) + Math.max(0, cols - 1) * (tpl.HGapMm ?? 0);
  const pdf = async () => {
    setMsg(null);
    try {
      const res = await fetch("/api/yarn-stock/labels/pdf", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start_index: start, template: tpl }) });
      if (!res.ok) { const j = await res.json(); throw new ApiError(res.status, j.detail ?? res.statusText, j.code, j); }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      onPrinted();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
  };
  const saveTpl = async () => {
    try { await request("POST", "/api/yarn-stock/labels/template", { template: tpl }); setMsg({ kind: "ok", text: t("tl.tplSaved") }); }
    catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
  };
  return (
    <Modal title={t("st.print_title")} onClose={onClose} wide>
      <p className="muted">{t("st.print_info", { n: count })}</p>
      {(needH > (tpl.PageHeightMm ?? 1e9) || needW > (tpl.PageWidthMm ?? 1e9)) && (
        <div className="st-warn">{needH > (tpl.PageHeightMm ?? 1e9) && <div>{t("st.rows_dont_fit", { need: needH.toFixed(1), page: (tpl.PageHeightMm ?? 0).toFixed(1) })}</div>}
          {needW > (tpl.PageWidthMm ?? 1e9) && <div>{t("st.cols_dont_fit", { need: needW.toFixed(1), page: (tpl.PageWidthMm ?? 0).toFixed(1) })}</div>}</div>
      )}
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
          {fields.map(([k, label]) => (
            <label key={k}>{label}
              <input type="number" step={k.endsWith("Count") ? 1 : 0.1} value={tpl[k] ?? 0}
                onChange={(e) => setTpl((x) => ({ ...x, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
      </div>
      {msg && <div className={msg.kind === "ok" ? "rq-ok" : "login-error"}>{msg.text}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={saveTpl} disabled={!fields.length}>{t("tl.saveTpl")}</button>
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" disabled={!fields.length || !count} onClick={pdf}>{t("tl.createPdf")}</button>
      </div>
    </Modal>
  );
}
