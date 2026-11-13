import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RME } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";
import { useContextMenu } from "../components/ContextMenu";

/* Air Supply Network Calculator (desktop ui/screen_air_supply.py). The browser draws and edits the network
   (same JSON as the desktop: nodes + edges); every change is solved on the server (ui/air_network.py), which
   also optimises, writes PDF / Excel and saves networks (tblAirNetwork). */

type NodeT = { id: string; kind: string; x: number; y: number; [k: string]: unknown };
type Graph = { nodes: NodeT[]; edges: [string, string][] };
type View = { label: string; flow_nl_min: number; dp: number; dp_cum: number; p_inlet: number; dn_rec: number; v: number; v_out: number;
  l_eq?: number; v_warn?: boolean; dp_warn?: boolean; sufficient?: boolean };
type OpCost = { power_kw: number; hours_year: number; energy_kwh: number; cost_chf: number; nm3_year: number; chf_per_nm3: number | null } | null;
type Source = { flow_nl_min: number; flow_m3h: number; reserve_m3h: number; req_p: number; set_p: number; margin: number; tank_l: number;
  worst_dp: number; n_jets: number; n_segs: number; status: "none" | "ok" | "low"; opcost: OpCost };
type Row = { id: string; label: string; kind: string; length: number | null; pressure: number; flow_nl_min: number; rec: string; man: string;
  v: number; dp: number; dp_cum: number; status: "ok" | "velocity" | "dp" };
type Solved = { nodes: Record<string, View>; parents: Record<string, number>; table: { rows: Row[]; total_flow_nl_min: number; total_dp: number;
  worst_dp: number; n_jets: number; n_segs: number }; source: Source; warnings: string[] };
type Meta = { jets: { id: number; name: string; diam: string; holes: number }[]; kinds: string[]; colors: Record<string, string>;
  sizes: Record<string, [number, number]>; defaults: Record<string, Record<string, unknown>>; opcost: Record<string, number>; saving: boolean };
type Tab = { key: string; name: string; netId: number | null; graph: Graph; undo: string[] };
type Opt = { diffs: { node_id: string; label: string; param: string; old_val: string; new_val: string; reason: string }[];
  changed: Record<string, string>; cost: { current: OpCost; optimized: OpCost; savings: number | null }; graph: Graph; solved: Solved };

const GRID = 20;
const nid = () => Math.random().toString(16).slice(2, 10);
const f = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const chf = (v: number) => "CHF " + Math.round(v).toLocaleString("de-CH").replace(/’/g, "'");
const snap = (v: number) => Math.round(v / GRID) * GRID;

async function download(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(res.statusText);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "download";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ------------------------------------------------------------------ the drawing */
function Canvas({ graph, meta, solved, sel, onSelect, onMove, onDrop, connectFrom, onConnect, changed, readOnly, fitKey, onNodeMenu, onEdgeMenu }: {
  graph: Graph; meta: Meta; solved: Solved | null; sel: string | null; onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void; onDrop?: () => void; connectFrom?: string | null; onConnect?: (id: string) => void;
  changed?: Record<string, string>; readOnly?: boolean; fitKey: number; onNodeMenu?: (e: RME, n: NodeT) => void; onEdgeMenu?: (e: RME, a: string, b: string) => void }) {
  const { t } = useI18n();
  const svg = useRef<SVGSVGElement | null>(null);
  const [vw, setVw] = useState({ x: 0, y: 0, z: 1 });
  const drag = useRef<{ id?: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const fit = useCallback(() => {
    const el = svg.current;
    if (!el || !graph.nodes.length) return;
    const xs = graph.nodes.flatMap((n) => [n.x - 70, n.x + 70]), ys = graph.nodes.flatMap((n) => [n.y - 50, n.y + 50]);
    const w = el.clientWidth || 800, h = el.clientHeight || 500;
    const z = Math.min(2, Math.max(0.3, Math.min(w / (Math.max(...xs) - Math.min(...xs)), h / (Math.max(...ys) - Math.min(...ys)))));
    setVw({ z, x: (w - (Math.max(...xs) + Math.min(...xs)) * z) / 2, y: (h - (Math.max(...ys) + Math.min(...ys)) * z) / 2 });
  }, [graph.nodes]);
  useEffect(() => { fit(); }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (cx - r.left - vw.x) / vw.z, y: (cy - r.top - vw.y) / vw.z };
  };
  const down = (e: RME, n?: NodeT) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (n && connectFrom !== undefined && connectFrom !== null && onConnect) { onConnect(n.id); return; }
    if (n) { onSelect?.(n.id); if (onConnect && connectFrom === null) onConnect(n.id); }
    else onSelect?.(null);
    drag.current = n && !readOnly ? { id: n.id, px: e.clientX, py: e.clientY, ox: n.x, oy: n.y, moved: false }
      : { px: e.clientX, py: e.clientY, ox: vw.x, oy: vw.y, moved: false };
  };
  const move = (e: RME) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    if (d.id) onMove?.(d.id, snap(d.ox + dx / vw.z), snap(d.oy + dy / vw.z));
    else setVw((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const up = () => { if (drag.current?.id && drag.current.moved) onDrop?.(); drag.current = null; };
  const wheel = (e: React.WheelEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    const z = Math.min(3, Math.max(0.2, vw.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const r = svg.current!.getBoundingClientRect();
    setVw({ z, x: e.clientX - r.left - p.x * z, y: e.clientY - r.top - p.y * z });
  };

  return (
    <svg ref={svg} className={"as-canvas" + (connectFrom !== undefined && connectFrom !== null ? " connecting" : "")}
      onMouseDown={(e) => down(e)} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onWheel={wheel}>
      <defs><marker id="as-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#5A6460" /></marker></defs>
      <g transform={`translate(${vw.x},${vw.y}) scale(${vw.z})`}>
        {graph.edges.map(([a, b]) => {
          const A = byId[a], B = byId[b];
          if (!A || !B) return null;
          const [bw, bh] = meta.sizes[B.kind] || [100, 40];
          const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
          const k = Math.min(bw / 2 / Math.max(Math.abs(dx), 1e-6), bh / 2 / Math.max(Math.abs(dy), 1e-6)) * len;
          const ex = B.x - dx / len * Math.min(k, len), ey = B.y - dy / len * Math.min(k, len);
          return <g key={a + ">" + b} className="as-edge" onContextMenu={(e) => { e.preventDefault(); onEdgeMenu?.(e, a, b); }}>
            <line x1={A.x} y1={A.y} x2={ex} y2={ey} stroke="transparent" strokeWidth={10} />
            <line x1={A.x} y1={A.y} x2={ex} y2={ey} stroke="#5A6460" strokeWidth={2} markerEnd="url(#as-arrow)" />
          </g>;
        })}
        {graph.nodes.map((n) => {
          const [w, h] = meta.sizes[n.kind] || [100, 40];
          const v = solved?.nodes[n.id];
          const x0 = n.x - w / 2, y0 = n.y - h / 2;
          const strip = n.kind === "jet" || n.kind === "source";
          const lines = (v?.label || n.kind).split("\n");
          const isSel = sel === n.id, isFrom = connectFrom === n.id;
          let stripTxt = "";
          if (n.kind === "jet" && v) stripTxt = v.sufficient ? t("as.jetOk", { p: f(v.p_inlet), need: f(Number(n.nozzle_pressure)) })
            : t("as.jetLow", { p: f(v.p_inlet), need: f(Number(n.nozzle_pressure)) });
          if (n.kind === "source" && solved && (solved.source.req_p > 0 || solved.source.flow_nl_min > 0))
            stripTxt = `≥ ${f(solved.source.req_p)} bar  ${f(solved.source.flow_nl_min, 1)} Nl/min`;
          const dUse = n.kind === "segment" ? (Number(n.seg_diam) > 0 ? Number(n.seg_diam) : v?.dn_rec || 0) : 0;
          return <g key={n.id} className="as-node" onMouseDown={(e) => down(e, n)} onContextMenu={(e) => { e.preventDefault(); onNodeMenu?.(e, n); }}>
            {changed?.[n.id] && <rect x={x0 - 5} y={y0 - 5} width={w + 10} height={h + 10} rx={9} fill="none" stroke="#E6A23C" strokeWidth={3} />}
            {n.kind === "reducer"
              ? <polygon points={`${x0},${y0} ${x0 + w},${y0 + 10} ${x0 + w},${y0 + h - 10} ${x0},${y0 + h}`} fill={meta.colors[n.kind]} stroke={isSel || isFrom ? "#FFC107" : "#fff"} strokeWidth={isSel || isFrom ? 3 : 1} />
              : <rect x={x0} y={y0} width={w} height={h} rx={6} fill={meta.colors[n.kind]} stroke={isSel || isFrom ? "#FFC107" : "#fff"} strokeWidth={isSel || isFrom ? 3 : 1} />}
            <text x={n.x} y={y0 + (strip ? (h - 16) / 2 : h / 2) - (lines.length - 1) * 6.5} textAnchor="middle" dominantBaseline="middle"
              fill={n.kind === "split" ? "#1C2321" : "#fff"} fontSize={11} fontWeight={600}>
              {lines.map((l, i) => <tspan key={i} x={n.x} dy={i ? 13 : 0}>{l}</tspan>)}
            </text>
            {strip && stripTxt && <g><rect x={x0 + 1} y={y0 + h - 17} width={w - 2} height={16} rx={4} fill={n.kind === "jet" && v && !v.sufficient ? "#FDECEA" : "#E6F2EA"} />
              <text x={n.x} y={y0 + h - 9} textAnchor="middle" dominantBaseline="middle" fontSize={8.5} fill={n.kind === "jet" && v && !v.sufficient ? "#C62828" : "#1F7A3A"}>{stripTxt}</text></g>}
            {v && v.flow_nl_min > 0 && <g><rect x={x0 + w - 62} y={y0 - 7} width={60} height={13} rx={3} fill="#fff" stroke="#C9D1C8" />
              <text x={x0 + w - 32} y={y0} textAnchor="middle" dominantBaseline="middle" fontSize={8.5} fill="#1C2321">{f(v.flow_nl_min, 1)} Nl/m</text></g>}
            {dUse > 0 && <g><rect x={n.x - 30} y={y0 + h - 7} width={60} height={13} rx={3} fill="#fff" stroke="#C9D1C8" />
              <text x={n.x} y={y0 + h} textAnchor="middle" dominantBaseline="middle" fontSize={8.5}>ø{Math.round(dUse)}mm{Number(n.seg_diam) > 0 ? "" : "★"}</text></g>}
            {n.kind === "reducer" && v && v.dp > 0 && <g><rect x={n.x - 40} y={y0 + h - 7} width={80} height={13} rx={3} fill="#fff" stroke="#C9D1C8" />
              <text x={n.x} y={y0 + h} textAnchor="middle" dominantBaseline="middle" fontSize={8.5}>ΔP {f(v.dp, 4)} bar</text></g>}
            {v?.v_warn && n.kind === "segment" && <g><circle cx={x0} cy={y0} r={7} fill="#e53935" /><text x={x0} y={y0 + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#fff" fontWeight={700}>!</text></g>}
            {(solved?.parents[n.id] || 0) > 1 && <g><circle cx={x0 + w} cy={y0} r={8} fill="#e53935" /><text x={x0 + w} y={y0 + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#fff" fontWeight={700}>2</text></g>}
            {changed?.[n.id] && <text x={n.x} y={y0 - 10} textAnchor="middle" fontSize={9} fill="#B7791F" fontWeight={700}>{changed[n.id]}</text>}
          </g>;
        })}
      </g>
      <g className="as-legend" transform="translate(10, 10)">
        {meta.kinds.map((k, i) => <g key={k} transform={`translate(0, ${i * 16})`}>
          <rect width={12} height={10} rx={2} fill={meta.colors[k]} /><text x={18} y={9} fontSize={10} fill="#5A6460">{t(`as.legend.${k}`)}</text></g>)}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ number input */
function Num({ label, value, onChange, min, max, step = 0.1, unit, int }: { label: string; value: unknown; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string; int?: boolean }) {
  const [txt, setTxt] = useState(String(value ?? ""));
  useEffect(() => { setTxt(String(value ?? "")); }, [value]);
  const commit = (s: string) => {
    let v = Number(s.replace(",", "."));
    if (!Number.isFinite(v)) return;
    if (int) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };
  return <label className="as-field"><span>{label}</span>
    <span className="as-in"><input type="number" value={txt} min={min} max={max} step={int ? 1 : step}
      onChange={(e) => { setTxt(e.target.value); commit(e.target.value); }} onBlur={() => setTxt(String(value ?? ""))} />{unit && <em>{unit}</em>}</span></label>;
}

function Res({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className="as-res"><span>{label}</span><b className={warn ? "warn" : ""}>{value}</b></div>;
}

/* ------------------------------------------------------------------ page */
export default function AirSupply() {
  const { t } = useI18n();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [connect, setConnect] = useState<string | null | undefined>(undefined);  // undefined = off, null = waiting for the first node
  const [opcost, setOpcost] = useState<Record<string, number>>({ hours: 16, days: 250, price: 0.22, eta: 0.7 });
  const [opt, setOpt] = useState<Opt | null>(null);
  const [showOpt, setShowOpt] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveDlg, setSaveDlg] = useState(false);
  const menu = useContextMenu();
  const dragStart = useRef<string | null>(null);

  useEffect(() => {
    request<Meta>("GET", "/api/air-supply/meta").then((m) => { setMeta(m); setOpcost(m.opcost); }).catch((e) => setMsg(String(e)));
    request<{ graph: Graph }>("GET", "/api/air-supply/example").then((d) => {
      setTabs([{ key: nid(), name: "Network 1", netId: null, graph: d.graph, undo: [] }]); setFitKey((k) => k + 1);
    });
  }, []);

  const tab = tabs[cur];
  const graph = tab?.graph;
  // solve on every change (debounced) - the server computes, the page only draws
  useEffect(() => {
    if (!graph) return;
    const h = setTimeout(() => {
      request<Solved>("POST", "/api/air-supply/solve", { graph, opcost }).then(setSolved).catch(() => undefined);
      if (showOpt) request<Opt>("POST", "/api/air-supply/optimize", { graph, opcost }).then(setOpt).catch(() => undefined);
    }, 150);
    return () => clearTimeout(h);
  }, [graph, opcost, showOpt]);

  const setGraph = useCallback((g: Graph, undo = true) => {
    setTabs((ts) => ts.map((x, i) => (i === cur ? { ...x, graph: g, undo: undo ? [...x.undo, JSON.stringify(x.graph)].slice(-60) : x.undo } : x)));
  }, [cur]);
  const undoLast = useCallback(() => {
    setTabs((ts) => ts.map((x, i) => {
      if (i !== cur || !x.undo.length) return x;
      return { ...x, graph: JSON.parse(x.undo[x.undo.length - 1]), undo: x.undo.slice(0, -1) };
    }));
  }, [cur]);
  const node = graph?.nodes.find((n) => n.id === sel) || null;
  const patchNode = (id: string, p: Record<string, unknown>) => setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) });
  const deleteNode = (id: string) => { setGraph({ nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter(([a, b]) => a !== id && b !== id) }); setSel(null); };
  const addNode = (kind: string) => {
    const off = (graph.nodes.length * 30) % 200;
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 300, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 200;
    const n: NodeT = { ...(meta!.defaults[kind] as Record<string, unknown>), id: nid(), kind, x: snap(cx + off), y: snap(cy + off) };
    setGraph({ ...graph, nodes: [...graph.nodes, n] });
    setSel(n.id);
  };
  const connectTo = (id: string) => {
    if (connect === null) { setConnect(id); return; }
    if (connect && connect !== id && !graph.edges.some(([a, b]) => a === connect && b === id)) setGraph({ ...graph, edges: [...graph.edges, [connect, id]] });
    setConnect(undefined);
  };
  const fileBody = () => ({ graph, title: tab?.name || "" });

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest("input, textarea, select, .modal")) return;
      if (e.key === "Escape") setConnect(undefined);
      if (e.key === "Delete" && sel) deleteNode(sel);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoLast(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!meta || !tab) return <div className="muted">{msg ?? t("app.loading")}</div>;
  const v = node ? solved?.nodes[node.id] : undefined;
  const src = solved?.source;
  const jetOpt = (id: unknown) => meta.jets.find((j) => j.id === Number(id));
  const rename = (n: NodeT) => { const s = window.prompt(t("as.renameQ"), String(n._custom_name || "")); if (s !== null) patchNode(n.id, { _custom_name: s.trim() }); };

  return (
    <div className="page as-page">
      <div className="page-head"><h1>{t("as.title")}</h1></div>
      <div className="as-toolbar">
        {meta.kinds.map((k) => <button key={k} className="btn-plain" onClick={() => addNode(k)}>+ {t(`as.kind.${k}`)}</button>)}
        <span className="as-sep" />
        <button className={"btn-plain" + (connect !== undefined ? " as-on" : "")} title={t("as.connectTip")} onClick={() => setConnect(connect === undefined ? null : undefined)}>
          {connect === undefined ? t("as.connect") : connect === null ? t("as.connectFrom") : t("as.connectTo")}</button>
        <button className="btn-plain" disabled={!sel} onClick={() => sel && deleteNode(sel)}>{t("as.delete")}</button>
        <button className="btn-plain" disabled={!tab.undo.length} onClick={undoLast}>{t("as.undo")}</button>
        <button className="btn-plain" onClick={() => { if (window.confirm(t("as.clearQ"))) { setGraph({ nodes: [], edges: [] }); setSel(null); } }}>{t("as.clear")}</button>
        <button className="btn-plain" disabled={graph.nodes.length > 0} title={graph.nodes.length ? t("as.exampleTip") : ""}
          onClick={() => request<{ graph: Graph }>("GET", "/api/air-supply/example").then((d) => { setGraph(d.graph); setFitKey((x) => x + 1); })}>{t("as.example")}</button>
        <button className="btn-plain" onClick={() => setFitKey((x) => x + 1)}>⊞ {t("as.fit")}</button>
        <span className="as-sep" />
        <button className="btn-plain" onClick={() => setSaveDlg(true)}>💾 {t("as.saveLoad")}</button>
        <button className="btn-plain" onClick={() => download("/api/air-supply/pdf", fileBody()).catch((e) => setMsg(String(e)))}>📄 PDF</button>
        <button className="btn-plain" onClick={() => download("/api/air-supply/excel", fileBody()).catch((e) => setMsg(String(e)))}>📊 Excel</button>
        <button className={"btn-plain" + (showOpt ? " as-on" : "")} onClick={() => setShowOpt(!showOpt)}>🔧 {t("as.optimize")}{showOpt ? " ✕" : ""}</button>
      </div>
      <div className="as-tabs">
        {tabs.map((x, i) => (
          <span key={x.key} className={"as-tab" + (i === cur ? " on" : "")} onClick={() => { setCur(i); setSel(null); setSolved(null); setOpt(null); setFitKey((k) => k + 1); }}
            onDoubleClick={() => { const s = window.prompt(t("as.renameNet"), x.name); if (s && s.trim()) setTabs(tabs.map((y, j) => (j === i ? { ...y, name: s.trim() } : y))); }}>
            {x.name}{tabs.length > 1 && <b onClick={(e) => { e.stopPropagation(); setTabs(tabs.filter((_y, j) => j !== i)); setCur(Math.max(0, i <= cur ? cur - 1 : cur)); }}>×</b>}
          </span>))}
        <button className="as-tab-add" title={t("as.newTab")} onClick={() => { setTabs([...tabs, { key: nid(), name: `Network ${tabs.length + 1}`, netId: null, graph: { nodes: [], edges: [] }, undo: [] }]); setCur(tabs.length); setSel(null); }}>+</button>
      </div>
      {(msg || (solved?.warnings.length ?? 0) > 0) && <div className="mj-msg err">{msg || t("as.warnings") + " " + solved!.warnings.join(" · ")}</div>}
      <div className="as-body">
        <div className="as-canvas-wrap">
          <Canvas graph={graph} meta={meta} solved={solved} sel={sel} onSelect={setSel} fitKey={fitKey}
            onMove={(id, x, y) => {
              if (dragStart.current === null) dragStart.current = JSON.stringify(graph);
              setTabs((ts) => ts.map((tb, i) => (i === cur ? { ...tb, graph: { ...tb.graph, nodes: tb.graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) } } : tb)));
            }}
            onDrop={() => { const before = dragStart.current; dragStart.current = null; if (before) setTabs((ts) => ts.map((tb, i) => (i === cur ? { ...tb, undo: [...tb.undo, before].slice(-60) } : tb))); }}
            connectFrom={connect} onConnect={connect !== undefined ? connectTo : undefined}
            onNodeMenu={(e, n) => { setSel(n.id); menu.open(e, [
              { label: t("as.rename"), onClick: () => rename(n) },
              { label: t("as.duplicate"), onClick: () => { const c = { ...n, id: nid(), x: n.x + GRID * 2, y: n.y + GRID * 2 }; setGraph({ ...graph, nodes: [...graph.nodes, c] }); setSel(c.id); } },
              { sep: true }, { label: t("as.delete"), danger: true, onClick: () => deleteNode(n.id) }]); }}
            onEdgeMenu={(e, a, b) => menu.open(e, [{ label: t("as.removeEdge"), danger: true, onClick: () => setGraph({ ...graph, edges: graph.edges.filter(([x, y]) => !(x === a && y === b)) }) }])} />
          {connect !== undefined && <div className="as-hint">{connect === null ? t("as.connectFromHint") : t("as.connectToHint")}</div>}
        </div>
        <aside className="as-panel">
          {!node ? <p className="muted">{t("as.selectHint")}</p> : (<>
            <h3>{v?.label.split("\n")[0] || t(`as.kind.${node.kind}`)}</h3>
            <label className="as-field"><span>{t("as.name")}</span><input value={String(node._custom_name || "")} placeholder={t("as.autoName")}
              onChange={(e) => patchNode(node.id, { _custom_name: e.target.value })} /></label>
            {node.kind === "source" && src && (<>
              <p className="muted small">{t("as.sourceInfo")}</p>
              <Num label={t("as.compPressure")} value={node.source_pressure} min={0.5} max={20} unit="bar" onChange={(x) => patchNode(node.id, { source_pressure: x })} />
              <div className="as-kpis">
                <div><span>{t("as.demand")}</span><b>{f(src.flow_nl_min, 1)}</b><em>Nl/min</em></div>
                <div><span>{t("as.demand")}</span><b>{f(src.flow_m3h)}</b><em>m³/h</em></div>
                <div><span>{t("as.minComp")}</span><b>{f(src.reserve_m3h)}</b><em>m³/h</em></div>
                <div><span>{t("as.reqP")}</span><b>{f(src.req_p)}</b><em>bar</em></div>
              </div>
              <Res label={t("as.nJets")} value={String(src.n_jets)} />
              <Res label={t("as.nSegs")} value={String(src.n_segs)} />
              <Res label={t("as.receiver")} value={src.tank_l > 0 ? `≥${Math.round(src.tank_l)} l` : "—"} />
              <div className={"as-guide " + src.status}>{src.status === "none" ? t("as.guideNone")
                : src.status === "ok" ? t("as.guideOk", { set: f(src.set_p), margin: f(src.margin, 3), req: f(src.req_p), dp: f(src.worst_dp, 3), flow: f(src.reserve_m3h, 1), tank: Math.round(src.tank_l) })
                : t("as.guideLow", { set: f(src.set_p), req: f(src.req_p), deficit: f(-src.margin, 3), dp: f(src.worst_dp, 3) })}</div>
              <h4>{t("as.opcost")}</h4>
              <Num label={t("as.hoursDay")} value={opcost.hours} min={0.1} max={24} unit="h/day" onChange={(x) => setOpcost({ ...opcost, hours: x })} />
              <Num label={t("as.daysYear")} value={opcost.days} min={1} max={365} step={1} unit="days/yr" onChange={(x) => setOpcost({ ...opcost, days: x })} />
              <Num label={t("as.price")} value={opcost.price} min={0.01} max={5} step={0.01} unit="CHF/kWh" onChange={(x) => setOpcost({ ...opcost, price: x })} />
              <Num label={t("as.eta")} value={opcost.eta} min={0.1} max={1} step={0.05} unit="η" onChange={(x) => setOpcost({ ...opcost, eta: x })} />
              {src.opcost ? (<>
                <Res label={t("as.power")} value={`${f(src.opcost.power_kw, 3)} kW`} />
                <Res label={t("as.hoursYear")} value={`${Math.round(src.opcost.hours_year)} h`} />
                <Res label={t("as.energy")} value={`${Math.round(src.opcost.energy_kwh).toLocaleString("de-CH")} kWh/yr`} />
                <div className="as-total">{chf(src.opcost.cost_chf)} / {t("as.year")}</div>
                {src.opcost.chf_per_nm3 != null && <p className="muted small">{t("as.perNm3", { v: src.opcost.chf_per_nm3.toFixed(4), n: Math.round(src.opcost.nm3_year).toLocaleString("de-CH") })}</p>}
              </>) : <p className="muted small">—</p>}
            </>)}
            {node.kind === "segment" && (<>
              <Num label={t("as.length")} value={node.seg_length} min={0.1} max={9999} unit="m" onChange={(x) => patchNode(node.id, { seg_length: x })} />
              <Num label={t("as.innerD")} value={node.seg_diam} min={0} max={200} step={1} unit={t("as.mm0auto")} onChange={(x) => patchNode(node.id, { seg_diam: x })} />
              <h4>{t("as.fittings")}</h4>
              <Num label={t("as.b90")} value={node.seg_bends_90} min={0} max={50} int unit="×" onChange={(x) => patchNode(node.id, { seg_bends_90: x })} />
              <Num label={t("as.b45")} value={node.seg_bends_45} min={0} max={50} int unit="×" onChange={(x) => patchNode(node.id, { seg_bends_45: x })} />
              {v && (<><Res label={t("as.leq")} value={`${f(v.l_eq)} m`} />
                <h4>{t("as.computed")}</h4>
                <Res label={t("as.pInlet")} value={v.p_inlet ? `${f(v.p_inlet)} bar` : "—"} />
                <Res label={t("as.recD")} value={v.dn_rec ? `ø${v.dn_rec} mm` : "—"} />
                <Res label={t("as.velocity")} value={v.v ? `${f(v.v)} m/s` : "—"} warn={v.v_warn} />
                <Res label={t("as.segDp")} value={v.dp ? `${f(v.dp, 4)} bar` : "—"} />
                <Res label={t("as.cumDp")} value={v.dp_cum ? `${f(v.dp_cum, 4)} bar` : "—"} warn={v.dp_warn} />
                <Res label={t("as.flow")} value={v.flow_nl_min ? `${f(v.flow_nl_min)} Nl/min` : "—"} /></>)}
            </>)}
            {node.kind === "reducer" && (<>
              <Num label={t("as.dIn")} value={node.red_d_in} min={1} max={200} step={1} unit="mm" onChange={(x) => patchNode(node.id, { red_d_in: x })} />
              <Num label={t("as.dOut")} value={node.red_d_out} min={1} max={200} step={1} unit="mm" onChange={(x) => patchNode(node.id, { red_d_out: x })} />
              {v && (<><h4>{t("as.computed")}</h4>
                <Res label={t("as.vIn")} value={v.v ? `${f(v.v)} m/s` : "—"} />
                <Res label={t("as.vOut")} value={v.v_out ? `${f(v.v_out)} m/s` : "—"} warn={v.v_warn} />
                <Res label={t("as.dp")} value={v.dp ? `${f(v.dp, 4)} bar` : "—"} />
                <Res label={t("as.cumDp")} value={v.dp_cum ? `${f(v.dp_cum, 4)} bar` : "—"} warn={v.dp_warn} />
                <Res label={t("as.flow")} value={v.flow_nl_min ? `${f(v.flow_nl_min)} Nl/min` : "—"} /></>)}
            </>)}
            {node.kind === "split" && <p className="muted small">{t("as.splitInfo")}</p>}
            {node.kind === "jet" && (<>
              <span className="jr-seg">{(["db", "generic"] as const).map((m) => (
                <button key={m} className={(node.nozzle_db_jet_id != null) === (m === "db") ? "on" : ""}
                  onClick={() => patchNode(node.id, m === "db" ? { nozzle_db_jet_id: meta.jets[0]?.id ?? null } : { nozzle_db_jet_id: null })}>{t(`as.nz.${m}`)}</button>))}</span>
              {node.nozzle_db_jet_id != null ? (<>
                <label className="as-field"><span>{t("as.jetType")}</span><select value={String(node.nozzle_db_jet_id)} onChange={(e) => {
                  const j = jetOpt(e.target.value);
                  patchNode(node.id, { nozzle_db_jet_id: j?.id ?? null, nozzle_db_jet_name: j?.name || "", ...(j ? { nozzle_hole_d: Number(String(j.diam).replace(",", ".")) || node.nozzle_hole_d, nozzle_n_holes: j.holes } : {}) });
                }}>{meta.jets.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
                {jetOpt(node.nozzle_db_jet_id) && <p className="muted small">Ø{jetOpt(node.nozzle_db_jet_id)!.diam} mm · {jetOpt(node.nozzle_db_jet_id)!.holes} {t("as.holes")}</p>}
              </>) : (<>
                <label className="as-field"><span>{t("as.jetName")}</span><input value={String(node.nozzle_name || "")} onChange={(e) => patchNode(node.id, { nozzle_name: e.target.value })} /></label>
                <Num label={t("as.holeD")} value={node.nozzle_hole_d} min={0.1} max={20} step={0.05} unit="mm" onChange={(x) => patchNode(node.id, { nozzle_hole_d: x })} />
                <Num label={t("as.nHoles")} value={node.nozzle_n_holes} min={1} max={50} int onChange={(x) => patchNode(node.id, { nozzle_n_holes: x })} />
              </>)}
              <h4>{t("as.common")}</h4>
              <Num label={t("as.count")} value={node.nozzle_count} min={1} max={9999} int unit="×" onChange={(x) => patchNode(node.id, { nozzle_count: x })} />
              <Num label={t("as.jetPressure")} value={node.nozzle_pressure} min={0.1} max={20} step={0.05} unit="bar" onChange={(x) => patchNode(node.id, { nozzle_pressure: x })} />
              <Num label={t("as.cd")} value={node.nozzle_cd} min={0.3} max={1} step={0.05} onChange={(x) => patchNode(node.id, { nozzle_cd: x })} />
              {v && (<><h4>{t("as.computed")}</h4>
                <Res label={t("as.flowTotal")} value={v.flow_nl_min ? `${f(v.flow_nl_min)} Nl/min` : "—"} />
                <Res label={t("as.inletSet")} value={t(v.sufficient ? "as.inletOk" : "as.inletLow", { want: f(Number(node.nozzle_pressure), 3), have: f(v.p_inlet, 3) })} warn={!v.sufficient} />
                <Res label={t("as.lineLoss")} value={v.dp_cum > 0.001 ? `+${f(v.dp_cum, 4)} bar` : t("as.negligible")} warn={v.dp_warn} /></>)}
            </>)}
          </>)}
        </aside>
      </div>
      {showOpt && opt && (
        <section className="as-opt">
          <div className="as-opt-head">🔧 {t("as.optTitle")} <span>{Object.keys(opt.changed).length ? t("as.optFixes", { n: Object.keys(opt.changed).length }) : t("as.allOk")}</span></div>
          <div className="as-cost">
            <div><span>{t("as.costNow")}</span><b>{opt.cost.current ? chf(opt.cost.current.cost_chf) : "—"}</b></div>
            <div className="arrow">→</div>
            <div><span>{t("as.costOpt")}</span><b>{opt.cost.optimized ? chf(opt.cost.optimized.cost_chf) : "—"}</b></div>
            <div><span>{t("as.savings")}</span><b className={opt.cost.savings != null && opt.cost.savings < -0.5 ? "warn" : ""}>{opt.cost.savings == null ? "—"
              : opt.cost.savings > 0.5 ? chf(opt.cost.savings) + " 🎉" : opt.cost.savings < -0.5 ? t("as.more", { v: chf(-opt.cost.savings) }) : t("as.noDiff")}</b></div>
            <div><span>{t("as.nm3Now")}</span><b>{opt.cost.current?.chf_per_nm3 != null ? `CHF ${opt.cost.current.chf_per_nm3.toFixed(4)}` : "—"}</b></div>
            <div><span>{t("as.nm3Opt")}</span><b>{opt.cost.optimized?.chf_per_nm3 != null ? `CHF ${opt.cost.optimized.chf_per_nm3.toFixed(4)}` : "—"}</b></div>
          </div>
          <div className="as-opt-body">
            <div className="as-canvas-wrap small"><Canvas graph={opt.graph} meta={meta} solved={opt.solved} sel={null} changed={opt.changed} readOnly fitKey={fitKey + 1000} /></div>
            <div className="as-diff">
              <h4>{t("as.whatChange")}</h4>
              {!opt.diffs.length ? <p className="as-ok">✅ {t("as.optimal")}</p> : (
                <table className="mj-table"><thead><tr><th>{t("as.node")}</th><th>{t("as.param")}</th><th>{t("as.current")}</th><th>→ {t("as.optimized")}</th><th>{t("as.reason")}</th></tr></thead>
                  <tbody>{opt.diffs.map((d, i) => <tr key={i} className={d.param.includes("info") ? "info" : "fix"}><td>{d.label}</td><td>{d.param}</td><td>{d.old_val}</td><td><b>{d.new_val}</b></td><td>{d.reason}</td></tr>)}</tbody></table>)}
            </div>
          </div>
        </section>)}
      {solved && (
        <section className="as-table">
          <h4>{t("as.overview")}</h4>
          <table className="mj-table"><thead><tr>{["seg", "len", "press", "flowNl", "rec", "man", "vel", "segDp", "cumDp", "status"].map((k) => <th key={k}>{t(`as.col.${k}`)}</th>)}</tr></thead>
            <tbody>{solved.table.rows.map((r) => (
              <tr key={r.id} className={sel === r.id ? "sel" : ""} onClick={() => setSel(r.id)}>
                <td>{r.label}</td><td>{r.length == null ? "—" : f(r.length, 1)}</td><td>{f(r.pressure)}</td><td>{f(r.flow_nl_min)}</td><td>{r.rec}</td><td>{r.man}</td>
                <td>{f(r.v)}</td><td>{f(r.dp, 4)}</td><td>{f(r.dp_cum, 4)}</td><td className={r.status === "ok" ? "ok" : "warn"}>{t(`as.st.${r.status}`)}</td></tr>))}</tbody></table>
          <p className="small">{t("as.sum", { flow: f(solved.table.total_flow_nl_min, 1), dp: f(solved.table.total_dp, 4), worst: f(solved.table.worst_dp, 4), j: solved.table.n_jets, s: solved.table.n_segs })}</p>
        </section>)}
      {menu.menu}
      {saveDlg && <SaveLoad tab={tab} available={meta.saving} onClose={() => setSaveDlg(false)}
        onSaved={(id, name) => setTabs(tabs.map((x, i) => (i === cur ? { ...x, netId: id, name } : x)))}
        onLoaded={(id, name, g) => { setTabs(tabs.map((x, i) => (i === cur ? { ...x, netId: id, name, graph: g, undo: [...x.undo, JSON.stringify(x.graph)] } : x))); setSel(null); setFitKey((k) => k + 1); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ save / load */
function SaveLoad({ tab, available, onClose, onSaved, onLoaded }: { tab: Tab; available: boolean; onClose: () => void;
  onSaved: (id: number, name: string) => void; onLoaded: (id: number, name: string, g: Graph) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"save" | "load">("save");
  const [list, setList] = useState<{ id: number; name: string; description: string; created_by: string; updated: string }[]>([]);
  const [name, setName] = useState(tab.name);
  const [desc, setDesc] = useState("");
  const [asNew, setAsNew] = useState(tab.netId == null);
  const [pick, setPick] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => request<{ networks: typeof list }>("GET", "/api/air-supply/networks").then((d) => setList(d.networks)).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const n = list.find((x) => x.id === tab.netId); if (n) setDesc(n.description); }, [list, tab.netId]);
  const errOf = (e: unknown) => (e instanceof ApiError && e.code ? t(`as.err.${e.code}`) : String(e));
  const save = () => request<{ id: number; name: string }>("POST", "/api/air-supply/networks", { name, description: desc, graph: tab.graph, id: asNew ? null : tab.netId })
    .then((r) => { onSaved(r.id, r.name); onClose(); }).catch((e) => setErr(errOf(e)));
  const open = () => pick != null && request<{ id: number; name: string; graph: Graph }>("GET", `/api/air-supply/networks/${pick}`)
    .then((r) => { onLoaded(r.id, r.name, r.graph); onClose(); }).catch((e) => setErr(errOf(e)));
  const del = () => { const n = list.find((x) => x.id === pick); if (n && window.confirm(t("as.deleteNetQ", { name: n.name }))) request("DELETE", `/api/air-supply/networks/${n.id}`).then(() => { setPick(null); load(); }).catch((e) => setErr(errOf(e))); };
  return (
    <Modal title={t("as.saveLoad")} onClose={onClose} wide>
      {!available ? <p className="muted">{t("as.err.unavailable")}</p> : (<>
        <span className="jr-seg"><button className={mode === "save" ? "on" : ""} onClick={() => setMode("save")}>{t("as.save")}</button>
          <button className={mode === "load" ? "on" : ""} onClick={() => setMode("load")}>{t("as.load")}</button></span>
        {mode === "save" ? (<div className="as-save">
          <label className="sc-lab">{t("as.netName")}<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="sc-lab">{t("as.description")}<textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          {tab.netId != null && <label className="st-check"><input type="checkbox" checked={asNew} onChange={() => setAsNew(!asNew)} /> {t("as.asNew")}</label>}
        </div>) : (
          <div className="sc-views">{!list.length && <p className="muted">{t("as.noNets")}</p>}
            {list.map((n) => <div key={n.id} className={"sc-view" + (pick === n.id ? " on" : "")} onClick={() => setPick(n.id)} onDoubleClick={() => { setPick(n.id); open(); }}>
              <b>{n.name}</b><div className="muted small">{n.description} {n.description && "·"} {n.created_by} · {n.updated}</div></div>)}</div>)}
        {err && <div className="login-error">{err}</div>}
        <div className="modal-buttons">
          {mode === "load" && <button className="btn-plain danger" disabled={pick == null} onClick={del}>{t("as.deleteNet")}</button>}
          <span style={{ flex: 1 }} />
          <button className="btn-plain" onClick={onClose}>{t("sc.cancel")}</button>
          {mode === "save" ? <button className="btn-green" disabled={!name.trim()} onClick={save}>{t("as.save")}</button>
            : <button className="btn-green" disabled={pick == null} onClick={open}>{t("as.load")}</button>}
        </div>
      </>)}
    </Modal>
  );
}
