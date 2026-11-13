import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../api";
import { useI18n } from "../i18n";
import type { MenuItem } from "./ContextMenu";

/* Machine path schema above Machine Data (DTY / ATY), read only - drawn like the desktop panel
   (ui/dty_schema_panel.py DTYSchemaWidget + ui/aty_schema.paint), data from backend/app/schema.py
   (db/machine_schema.py, shared with the desktop). Click a station = highlight its rows in the
   table, right-click = Knowledge Base page of the station (ui/kb_links.py targets). */

export type SchemaKB = { module: string; scene: number | null; station: number | null };
type Meta = Record<string, { label: string; short: string; per_ply: boolean; rows: (string | null)[]; kb: SchemaKB | null }>;
type Ply = {
  idx: number; label: string; ply?: string; pos: string; yarn: string; path?: string; role?: string | null;
  into?: number | null; at?: string | null; auto?: boolean; is_elastane?: boolean;
  values: Record<string, string | null>; tips: Record<string, string | null>;
};
export type SchemaData = {
  profile: "dty" | "aty" | null; trials: { trial_id: number; label: string; col: number }[]; trial_id: number;
  title: string; process: string; plies: Ply[]; order: number[]; main?: number | null; stations: string[];
  values: Record<string, string | null>; tips: Record<string, string | null>; warnings: string[]; meta: Meta;
};
/** Station selected in the schema -> rows (by row key) and data columns to highlight in the table. */
export type SchemaHighlight = { keys: string[]; cols: number[] } | null;

// desktop geometry and colours (DTYSchemaWidget)
const LANE_H = 58, TOP = 34, LEFT = 150, MIN_COL = 74;
const C = {
  line: "#2E7D32", bypass: "#1E88E5", el: "#8E24AA", border: "#5F6B5F", empty: "#C8CEC8", heater: "#F4A259",
  cool: "#9ED0F0", jet: "#43A047", text: "#2B2B2B", muted: "#7A847A", sel: "rgba(255,193,7,0.59)", bg: "#F4F6F3",
  effect: "#C08A1E", water: "#2386C8",
};
const ROLE_COLOUR: Record<string, string> = { core: C.line, effect: C.effect, elastane: C.el };
const ATY_SHAPE: Record<string, string> = { draw: "heater1", feed: "lw", jet: "mainjet", stabilise: "setheater" };
const FONT = 11, FONT_S = 10;

/** Cut a text to roughly `px` pixels (desktop: QFontMetrics.elidedText). */
function elide(s: string, px: number, size: number, bold = false): string {
  const cw = size * (bold ? 0.6 : 0.55);
  const max = Math.max(1, Math.floor(px / cw));
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}

type Sel = { station: string; ply: number } | null;

export default function SchemaPanel({ seriesId, mode, reloadKey, follow, visibleKeys, onHighlight, openMenu }: {
  seriesId: number; mode: string; reloadKey?: unknown;
  follow: { trial: number; key: string | null; c: number; n: number } | null;   // cell clicked in the table
  visibleKeys: string[];                                                          // row keys shown in the table
  onHighlight: (h: SchemaHighlight) => void;
  openMenu?: (e: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [trial, setTrial] = useState(0);
  const [data, setData] = useState<SchemaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [width, setWidth] = useState(1000);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    request<SchemaData>("GET", `/api/series/${seriesId}/schema?mode=${mode}${trial ? `&trial=${trial}` : ""}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [seriesId, mode, trial, reloadKey]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // a click in the table: the schema shows that trial and marks the station of the row
  useEffect(() => {
    if (!follow) return;
    if (follow.trial !== (data?.trial_id ?? trial)) setTrial(follow.trial);
    const meta = data?.meta;
    const st = meta && follow.key ? Object.keys(meta).find((s) => meta[s].rows.includes(follow.key)) : undefined;
    setSel(st ? { station: st, ply: meta![st].per_ply ? follow.c : -1 } : null);
    setHint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow?.n]);

  // new data (other trial / mode / reload): selection of another trial no longer applies
  useEffect(() => {
    if (sel && sel.ply >= 0 && data && !data.plies.some((p) => p.idx === sel.ply)) {
      setSel(null);
      onHighlight(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const xs = useMemo(() => {
    const st = (data?.stations ?? []).filter((s) => s !== "creel");
    const out: Record<string, number> = {};
    if (!st.length) return out;
    const w = Math.max(width - LEFT - 20, st.length * MIN_COL);
    const step = w / st.length;
    st.forEach((s, i) => (out[s] = LEFT + step * (i + 0.5)));
    return out;
  }, [data, width]);

  if (error) return <div className="card error">{error}</div>;
  if (!data) return <div className="muted schema-loading">{t("schema.loading")}</div>;
  if (!data.profile) return null;
  const d = data;
  const aty = d.profile === "aty";
  const meta = d.meta;
  const stationOrder = Object.keys(meta);
  const pos = (s: string) => {
    const i = stationOrder.indexOf(s);
    return i < 0 ? stationOrder.length : i;
  };

  const plies: Ply[] = d.plies.length ? d.plies : [{ label: "", pos: "", yarn: "", path: "full", values: {}, tips: {}, idx: -1, into: null, at: null }];
  const order = d.order.length ? d.order : plies.map((_, i) => i);
  const nCols = (d.stations.length || 1);
  const svgW = Math.max(width, LEFT + nCols * MIN_COL + 20);
  const svgH = TOP + Math.max(1, plies.length) * LANE_H + 30;
  const laneY: Record<number, number> = {};
  order.forEach((k, n) => (laneY[k] = TOP + n * LANE_H + 14));
  const keys = Object.keys(xs);
  const xEnd = xs.winder ?? svgW - 30;

  const isSel = (station: string, ply: number) =>
    !!sel && sel.station === station && (sel.ply === -1 || sel.ply === ply || ply === -1);

  const kbOf = (s: string) => meta[s]?.kb ?? null;
  const openKB = (kb: SchemaKB) => {
    const q = [kb.scene ? `scene=${kb.scene}` : "", kb.station ? `station=${kb.station}` : ""].filter(Boolean).join("&");
    navigate(`/knowledge-base/${kb.module}${q ? "?" + q : ""}`);
  };

  // click a station: highlight its rows (per-ply stations: only that ply's column) - click again clears
  const click = (station: string, ply: number) => {
    if (sel && sel.station === station && sel.ply === ply) {
      setSel(null);
      setHint(null);
      onHighlight(null);
      return;
    }
    setSel({ station, ply });
    const rows = (meta[station]?.rows ?? []).filter((k): k is string => !!k);
    const cols = meta[station]?.per_ply && ply >= 0 ? [ply] : d.plies.map((p) => p.idx);
    const label = meta[station]?.label ?? station;
    const vis = rows.filter((k) => visibleKeys.includes(k));
    if (!rows.length) setHint(t("schema.noFields", { s: label }));
    else if (!vis.length) setHint(t("schema.rowsHidden", { s: label }));
    else setHint(t("schema.highlighted", { s: label, n: vis.length }));
    onHighlight(rows.length ? { keys: rows, cols } : null);
  };
  const menu = (e: React.MouseEvent, station: string) => {
    const kb = kbOf(station);
    if (!kb) return;
    e.preventDefault();
    const items: MenuItem[] = [{ label: t("schema.kb"), onClick: () => openKB(kb) }];
    if (openMenu) openMenu(e, items);
    else openKB(kb);
  };
  const tipText = (station: string, tip: string | null | undefined) =>
    [meta[station]?.label ?? station, tip || t("schema.noValues"), t("schema.clickTip"), kbOf(station) ? t("schema.rightTip") : ""]
      .filter(Boolean).join("\n");

  const shapes: ReactElement[] = [];
  let n = 0;
  const key = () => `s${n++}`;

  // one station: shape, value text (2 lines) and the click area
  const station = (s: string, x: number, y: number, ply: number, value: string | null | undefined, tip: string | null | undefined) => {
    const empty = !value;
    const border = empty ? C.empty : C.border;
    const shape = aty ? (ATY_SHAPE[s] ?? s) : s;
    const out: ReactElement[] = [];
    if (isSel(s, ply)) out.push(<rect key={key()} x={x - 22} y={y - 17} width={44} height={42} rx={6} fill={C.sel} />);
    const st = { stroke: border, strokeWidth: 1.4 };
    if (shape === "wetting") {
      out.push(<rect key={key()} x={x - 14} y={y - 9} width={28} height={18} rx={4} fill={empty ? "#E3F1FB" : "#9ED0F0"} {...st} />);
      for (const k of [-6, 0, 6]) out.push(<line key={key()} x1={x + k} y1={y - 15} x2={x + k} y2={y - 10} stroke={C.water} strokeWidth={1.2} />);
    } else if (shape.startsWith("lw")) {
      const f = empty ? "#FFFFFF" : "#E8F5E9";
      out.push(<circle key={key()} cx={x - 7} cy={y - 7} r={6} fill={f} {...st} />, <circle key={key()} cx={x + 7} cy={y + 7} r={6} fill={f} {...st} />);
    } else if (shape === "heater1" || shape === "setheater") {
      out.push(<rect key={key()} x={x - 18} y={y - 6} width={36} height={12} rx={3} fill={empty ? "#FBE3CC" : C.heater} {...st} />);
    } else if (shape === "cooling") {
      out.push(<rect key={key()} x={x - 16} y={y - 4} width={32} height={8} rx={2} fill={C.cool} {...st} />);
    } else if (shape === "friction") {
      for (const k of [-8, 0, 8]) out.push(<ellipse key={key()} cx={x + k} cy={y} rx={4} ry={10} fill={empty ? "#FFFFFF" : "#E0E0E0"} {...st} />);
    } else if (shape === "mainjet" || shape === "prejet" || shape === "jet3") {
      out.push(<rect key={key()} x={x - 11} y={y - 9} width={22} height={18} rx={4} fill={empty ? "#E8F5E9" : C.jet} {...st} />,
        <path key={key()} d={`M${x} ${y - 9}L${x} ${y - 15}M${x - 3} ${y - 13}L${x} ${y - 9}L${x + 3} ${y - 13}`} stroke={border} strokeWidth={1.2} fill="none" />);
    } else if (shape === "winder") {
      out.push(<circle key={key()} cx={x} cy={y} r={11} fill="#FFFFFF" {...st} />, <circle key={key()} cx={x} cy={y} r={4} fill="#FFFFFF" {...st} />);
    } else {
      out.push(<rect key={key()} x={x - 16} y={y - 11} width={32} height={22} fill="#FFFFFF" {...st} />);
    }
    if (value) {
      const lines = String(value).split("\n").slice(0, 2);
      const multi = String(value).includes("\n");
      lines.forEach((line, i) => {
        const bold = i === 0 && multi;
        out.push(<text key={key()} x={x} y={y + 12 + i * 13 + 11} textAnchor="middle" fontSize={FONT_S} fontWeight={bold ? 700 : 400}
          fill={i === 0 ? C.text : C.muted}>{elide(line, MIN_COL + 6, FONT_S, bold)}</text>);
      });
    }
    out.push(
      <rect key={key()} className="schema-hit" x={x - MIN_COL / 2 + 2} y={y - 16} width={MIN_COL - 4} height={52} fill="transparent"
        onClick={() => click(s, ply)} onContextMenu={(e) => menu(e, s)}>
        <title>{tipText(s, tip)}</title>
      </rect>,
    );
    shapes.push(...out);
  };

  // creel / separate source label
  const creel = (x: number, y: number, w: number, top: string, yarn: string, colour: string, st: string, ply: number, tip: string | null | undefined) => {
    if (isSel(st, ply)) shapes.push(<rect key={key()} x={x - 3} y={y - 18} width={w + 6} height={36} rx={6} fill={C.sel} />);
    shapes.push(
      <circle key={key()} cx={x + 9} cy={y} r={9} fill="#FFFFFF" stroke={colour} strokeWidth={1.6} />,
      <circle key={key()} cx={x + 9} cy={y} r={3} fill="#FFFFFF" stroke={colour} strokeWidth={1.6} />,
      <text key={key()} x={x + 24} y={y - 15 + 11} fontSize={FONT} fontWeight={700} fill={C.text}>{elide(top, w - 24, FONT, true)}</text>,
      <text key={key()} x={x + 24} y={y + 11} fontSize={FONT_S} fill={C.muted}>{elide(yarn, w - 24, FONT_S)}</text>,
      <rect key={key()} className="schema-hit" x={x} y={y - 15} width={w} height={30} fill="transparent"
        onClick={() => click(st, ply)} onContextMenu={(e) => menu(e, st)}>
        <title>{tipText(st, tip)}</title>
      </rect>,
    );
  };

  const header: ReactElement[] = [
    <text key="title" x={8} y={17} fontSize={FONT} fontWeight={700} fill={C.text}>{d.title}</text>,
  ];
  const proc = aty ? d.process : d.process || t("schema.noProcess");
  header.push(
    <text key="proc" x={8} y={29} fontSize={FONT_S} fill={aty || d.process ? C.line : C.muted}>{elide(proc, LEFT - 10, FONT_S)}</text>,
  );
  if (!aty) {
    header.push(
      <rect key="proc-hit" className="schema-hit" x={8} y={18} width={LEFT - 10} height={14} fill="transparent"
        onClick={() => click("process", -1)} onContextMenu={(e) => menu(e, "process")}>
        <title>{tipText("process", d.tips.process)}</title>
      </rect>,
    );
    if (isSel("process", -1)) header.unshift(<rect key="proc-sel" x={5} y={16} width={LEFT - 4} height={18} rx={4} fill={C.sel} />);
  }
  for (const s of keys) {
    header.push(<text key={`h-${s}`} x={xs[s]} y={20} textAnchor="middle" fontSize={FONT} fill={C.muted}>{meta[s]?.short ?? s}</text>);
  }

  const lanes: ReactElement[] = [];
  if (aty) {
    const yMain = laneY[order[0]];
    const perPly = keys.filter((s) => meta[s]?.per_ply);
    const xJoin = xs.jet ?? xEnd;
    const xBefore = xs.wetting ?? Math.max(LEFT, ...perPly.map((s) => xs[s]));
    const xRise = (xBefore + xJoin) / 2;
    for (const k of order) {
      const pl = plies[k];
      const y = laneY[k];
      const colour = ROLE_COLOUR[pl.role ?? ""] ?? C.muted;
      const dPath = y === yMain ? `M${LEFT - 8} ${y}L${xEnd + 18} ${y}`
        : `M${LEFT - 8} ${y}L${xRise - 14} ${y}C${xRise + 6} ${y} ${xRise + 6} ${yMain} ${xJoin - 18} ${yMain}`;
      lanes.push(<path key={`l${k}`} d={dPath} stroke={colour} strokeWidth={2.4} fill="none" />);
      const label = pl.role && pl.ply ? `${pl.label} · ${pl.ply}` : pl.label;
      creel(8, y, LEFT - 18, label + (pl.pos ? ` · Pos ${pl.pos}` : ""), pl.yarn, colour, "creel", pl.idx, pl.tips.creel);
      for (const s of perPly) station(s, xs[s], y, pl.idx, pl.values[s], pl.tips[s]);
    }
    lanes.push(<line key="main" x1={xJoin - 18} y1={yMain} x2={xEnd + 18} y2={yMain} stroke={C.line} strokeWidth={3} />);
    for (const s of keys) if (!meta[s]?.per_ply) station(s, xs[s], yMain, -1, d.values[s], d.tips[s]);
  } else {
    const perPly = keys.filter((s) => meta[s]?.per_ply && s !== "elastane");
    let main = d.main ?? order[0] ?? 0;
    if (!(main in laneY)) main = order[0];
    const joinX = (s: string) => {
      let x = xs[s];
      if (x === undefined) {   // station not drawn (e.g. jet 3 hidden): next drawn one
        const later = keys.filter((k) => pos(k) > pos(s));
        x = later.length ? xs[later[0]] : xEnd;
      }
      return x;
    };
    for (const k of order) {
      const pl = plies[k];
      const y = laneY[k];
      const kind = pl.path ?? "full";
      const colour = kind === "bypass" ? C.bypass : kind === "elastane" ? C.el : C.line;
      const sw = k === main ? 2.6 : 2.2;
      const dash = kind === "bypass" ? `${sw * 4} ${sw * 2}` : kind === "elastane" ? `${sw} ${sw * 2}` : undefined;
      let x0 = LEFT - 8;
      if (kind === "elastane") {
        const xa = joinX(pl.at || "lw2");
        const before = keys.filter((kk) => xs[kk] < xa - 1);
        x0 = before.length >= 2 ? xs[before[before.length - 2]] : before.length ? xs[before[before.length - 1]] : LEFT;
      }
      let dPath: string, xStop: number;
      if (k === main || pl.into == null) {
        dPath = `M${x0} ${y}L${xEnd + 18} ${y}`;
        xStop = xEnd + 18;
      } else {
        const xa = joinX(pl.at || "lw2");
        const xr = xa - MIN_COL * 0.55;   // rise left of the station's value text
        const yt = laneY[pl.into] ?? laneY[main];
        dPath = `M${x0} ${y}L${xr - 12} ${y}C${xr} ${y} ${xr} ${yt} ${xa - 16} ${yt}`;
        xStop = xr - 6;
      }
      lanes.push(<path key={`l${k}`} d={dPath} stroke={colour} strokeWidth={sw} strokeDasharray={dash} fill="none" />);
      if (kind === "elastane") {
        const left = Math.max(8, x0 - 2.4 * MIN_COL);
        const top = pl.is_elastane ? t("schema.elastane") : `${pl.label} · ${t("schema.ownSource")}`;
        const yarn = [pl.values.elastane, pl.yarn].filter(Boolean).join(" · ");
        const tip = [pl.tips.creel, pl.tips.lw1, pl.tips.elastane].filter(Boolean).join("\n");
        creel(left, y, x0 - left - 4, top, yarn, colour, "elastane", pl.idx, tip);
        continue;
      }
      creel(8, y, LEFT - 18, pl.label + (pl.pos ? ` · Pos ${pl.pos}` : ""), pl.yarn, colour, "creel", pl.idx, pl.tips.creel);
      for (const s of perPly) {
        const x = xs[s];
        if (x >= xStop) continue;
        if (kind === "bypass" && ["heater1", "cooling", "friction", "lw0", "prejet"].includes(s)) continue;
        station(s, x, y, pl.idx, pl.values[s], pl.tips[s]);
      }
    }
    const yMain = laneY[main];
    for (const s of keys) if (!meta[s]?.per_ply) station(s, xs[s], yMain, -1, d.values[s], d.tips[s]);
  }

  const selKB = sel ? kbOf(sel.station) : null;
  const warn = d.warnings.length > 0;
  const text = hint ?? (warn ? t(aty ? "schema.warnNote" : "schema.warnMerge", { w: d.warnings.join(" · ") })
    : t(aty ? "schema.hintAty" : "schema.hint"));

  return (
    <div className="schema-panel">
      {d.trials.length > 1 && (
        <div className="schema-trials">
          <span className="muted">{t("schema.trial")}</span>
          <select value={d.trial_id} onChange={(e) => { setTrial(Number(e.target.value)); setSel(null); setHint(null); onHighlight(null); }}>
            {d.trials.map((tr) => <option key={tr.trial_id} value={tr.trial_id}>{tr.label}</option>)}
          </select>
        </div>
      )}
      <div className="schema-scroll" ref={wrap}>
        <svg className="schema-svg" width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
          onClick={(e) => { if (e.target === e.currentTarget) { setSel(null); setHint(null); onHighlight(null); } }}>
          <rect x={0} y={0} width={svgW} height={svgH} fill={C.bg} pointerEvents="none" />
          {header}
          {lanes}
          {shapes}
        </svg>
      </div>
      <div className={"schema-hint" + (warn && !hint ? " warn" : "")}>
        <span>{text}</span>
        {selKB && <button className="btn-plain schema-kb" onClick={() => openKB(selKB)}>{t("schema.kb")}</button>}
      </div>
    </div>
  );
}
