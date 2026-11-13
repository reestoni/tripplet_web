import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";
import { useContextMenu } from "../components/ContextMenu";

/* Image Compare (desktop ui/screen_image_compare.py). Grid of frames; images of the series (db/image_compare.py)
   or files from this computer (uploaded, kept one day); VK4 / PDF / Excel / Word rendered by the server
   (ui/doc_render.py). Annotations, ATY radar, grid overlay, PNG export and project files (.ttcompare JSON)
   are done here in the browser. Rotation is a view setting (the desktop also rewrites the file on the share). */

type Src = { kind: "db"; series: number; id: number; name: string } | { kind: "local"; token: string; name: string };
type Info = { kind: "image" | "pdf" | "excel" | "word" | "vk4"; pages?: number; sheets?: string[]; channels?: { key: string; label: string }[];
  radar?: { vno: number; scores: Record<string, number | null> } | null };
export type Anno = { tool: string; color: string; size: number; text?: string; points: [number, number][] };
type Cell = { src: Src | null; whiteboard: boolean; info: Info | null; page: number; sheet: number; channel: string; rotation: number;
  zoom: number; panX: number; panY: number; annos: Anno[]; undo: string[]; radarVisible: boolean;
  radarRel: { x: number; y: number; w: number; h: number } | null; clip?: string };

export const TOOLS: [string, string][] = [["pan", "🖐"], ["arrow", "↗"], ["ellipse", "⬭"], ["rect", "▭"], ["free", "✏️"], ["text", "T"],
  ["highlight", "🖊"], ["marker", "①"], ["eraser", "⌫"], ["move", "⤢"]];
export const COLORS: Record<string, string> = { red: "#DC3232", yellow: "#F0C800", green: "#32C850", white: "#FFFFFF", blue: "#3282DC" };
export const SIZES: [number, string][] = [[2, "—"], [4, "━"], [8, "▬"]];
export const MARKERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const AXES = ["volume", "frequency", "character", "evenness", "outliers"], CODES = "VFCEO";
const UNDO_LIMIT = 10, ACTIVE = "#39A650", BG = "#1e1e1e";
const emptyCell = (): Cell => ({ src: null, whiteboard: false, info: null, page: 0, sheet: 0, channel: "", rotation: 0, zoom: 1, panX: 0, panY: 0,
  annos: [], undo: [], radarVisible: false, radarRel: null });

function srcUrl(c: Cell): string | null {
  if (c.clip) return c.clip;
  if (!c.src) return null;
  const q = `?page=${c.page}&sheet=${c.sheet}&channel=${encodeURIComponent(c.channel)}`;
  return c.src.kind === "db" ? `/api/image-compare/series/${c.src.series}/images/${c.src.id}/file${q}` : `/api/image-compare/local/${c.src.token}/file${q}`;
}

/* geometry of the drawn image inside a cell (like _FrameCell._img_rect), rotation applied to the bitmap */
function imgRect(w: number, h: number, iw: number, ih: number, c: Cell, wb: boolean) {
  if (wb || !iw) return { x: 0, y: 0, w, h };
  const s = Math.min(w / iw, h / ih) * c.zoom;
  const dw = iw * s, dh = ih * s;
  return { x: (w - dw) / 2 + c.panX, y: (h - dh) / 2 + c.panY, w: dw, h: dh };
}

function rotated(img: HTMLImageElement, deg: number): HTMLCanvasElement | HTMLImageElement {
  if (!deg) return img;
  const cv = document.createElement("canvas");
  const swap = deg % 180 !== 0;
  cv.width = swap ? img.naturalHeight : img.naturalWidth;
  cv.height = swap ? img.naturalWidth : img.naturalHeight;
  const g = cv.getContext("2d")!;
  g.translate(cv.width / 2, cv.height / 2);
  g.rotate((deg * Math.PI) / 180);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return cv;
}

export function drawAnno(g: CanvasRenderingContext2D, a: Anno, toS: (p: [number, number]) => [number, number]) {
  if (!a.points.length) return;
  if (["arrow", "ellipse", "rect", "highlight"].includes(a.tool) && a.points.length < 2) return;
  const col = COLORS[a.color] || COLORS.red;
  g.save();
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = a.size; g.lineCap = "round"; g.lineJoin = "round";
  const pts = a.points.map(toS);
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  if (a.tool === "arrow") {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > 0) {
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len, s = 8 + a.size * 3;
      g.moveTo(x2, y2); g.lineTo(x2 - s * ux + s * 0.4 * uy, y2 - s * uy - s * 0.4 * ux);
      g.moveTo(x2, y2); g.lineTo(x2 - s * ux - s * 0.4 * uy, y2 - s * uy + s * 0.4 * ux);
    }
    g.stroke();
  } else if (a.tool === "ellipse") {
    g.beginPath(); g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2); g.stroke();
  } else if (a.tool === "rect") {
    g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (a.tool === "free" && pts.length >= 2) {
    g.beginPath(); g.moveTo(x1, y1); pts.slice(1).forEach(([x, y]) => g.lineTo(x, y)); g.stroke();
  } else if (a.tool === "highlight") {
    g.globalAlpha = 60 / 255; g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (a.tool === "text") {
    const px = (8 + a.size * 2) * 1.333;
    g.font = `bold ${px}px Segoe UI, Arial`;
    (a.text || "").split("\n").forEach((line, i) => g.fillText(line, x1, y1 + i * px * 1.2));
  } else if (a.tool === "marker") {
    g.font = `bold ${(10 + a.size * 2) * 1.333}px Segoe UI, Arial`;
    g.fillText(a.text || "", x1, y1);
  }
  g.restore();
}

function radarRect(c: Cell, w: number, h: number) {
  if (c.radarRel) {
    const rw = Math.max(70, Math.min(c.radarRel.w * w, w)), rh = Math.max(70, Math.min(c.radarRel.h * h, h));
    return { x: Math.max(0, Math.min(c.radarRel.x * w, w - rw)), y: Math.max(0, Math.min(c.radarRel.y * h, h - rh)), w: rw, h: rh };
  }
  const box = Math.min(130, Math.max(90, w / 3), Math.max(90, h / 2));
  return { x: w - box - 6, y: h - box - 6, w: box, h: box };
}

function drawRadar(g: CanvasRenderingContext2D, c: Cell, w: number, h: number) {
  const r = radarRect(c, w, h), sc = c.info?.radar?.scores || {};
  const box = Math.min(r.w, r.h), labelPt = Math.max(7, Math.min(12, box / 13)), titlePt = Math.max(7, Math.min(13, box / 16));
  const titleH = titlePt + 10, scoreH = labelPt + 12, midH = r.h - titleH - scoreH;
  const cx = r.x + r.w / 2, cy = r.y + titleH + midH / 2;
  const rad = Math.max(11, Math.min((midH / 2 - 9) / 1.24, (r.w / 2 - 13) / 1.24));
  const pt = (i: number, f: number): [number, number] => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return [cx + rad * f * Math.cos(a), cy + rad * f * Math.sin(a)]; };
  g.save();
  g.fillStyle = "rgba(0,0,0,0.69)"; g.strokeStyle = "rgba(255,255,255,0.24)";
  g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 6); g.fill(); g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.22)";
  [0.5, 1].forEach((f) => { g.beginPath(); for (let i = 0; i < 5; i++) { const [x, y] = pt(i, f); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); g.stroke(); });
  for (let i = 0; i < 5; i++) { const [x, y] = pt(i, 1); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
  g.beginPath();
  AXES.forEach((ax, i) => { const v = sc[ax]; const f = v == null || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(1, v / 100)); const [x, y] = pt(i, f); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.closePath(); g.fillStyle = "rgba(57,166,80,0.43)"; g.fill(); g.strokeStyle = ACTIVE; g.lineWidth = 2; g.stroke();
  g.fillStyle = "#e6e6e6"; g.font = `bold ${labelPt * 1.333}px Segoe UI`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let i = 0; i < 5; i++) { const [x, y] = pt(i, 1.24); g.fillText(CODES[i], Math.max(r.x + 9, Math.min(x, r.x + r.w - 9)), Math.max(r.y + 9, Math.min(y, r.y + r.h - 9))); }
  g.fillStyle = "#a0dcaa"; g.font = `bold ${titlePt * 1.333}px Segoe UI`;
  const vno = c.info?.radar?.vno;
  g.fillText(vno ? `ATY V${String(vno).padStart(3, "0")}` : "ATY", cx, r.y + 9);
  g.fillStyle = "#b4c8b9"; g.font = `${labelPt * 1.333}px Segoe UI`;
  g.fillText(AXES.map((ax, i) => CODES[i] + (typeof sc[ax] === "number" && Number.isFinite(sc[ax]) ? Math.round(sc[ax] as number) : "-")).join(":"), cx, r.y + r.h - labelPt - 4);
  g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = 1.3;
  [3, 7, 11].forEach((o) => { g.beginPath(); g.moveTo(r.x + r.w - 1 - o, r.y + r.h - 1); g.lineTo(r.x + r.w - 1, r.y + r.h - 1 - o); g.stroke(); });
  g.restore();
}

/* ------------------------------------------------------------------ one frame */
function Frame({ cell, idx, active, tool, color, size, gridOn, gridN, onActivate, onChange, onDrop, label, register }: {
  cell: Cell; idx: number; active: boolean; tool: string; color: string; size: number; gridOn: boolean; gridN: number;
  onActivate: () => void; onChange: (c: Cell, undo?: boolean) => void; onDrop: (data: string) => void; label: string;
  register: (idx: number, fn: (() => HTMLCanvasElement | null) | null) => void }) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement | null>(null), cv = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [size2, setSize2] = useState({ w: 300, h: 200 });
  const cur = useRef<Anno | null>(null);
  const drag = useRef<{ mode: string; x: number; y: number; px: number; py: number; anno?: Anno; r0?: { x: number; y: number; w: number; h: number } } | null>(null);
  const [, force] = useState(0);
  const menu = useContextMenu();
  const [textAt, setTextAt] = useState<[number, number] | null>(null);
  const [textVal, setTextVal] = useState("");
  const url = srcUrl(cell);

  useEffect(() => {
    if (!url) { setImg(null); setErr(null); return; }
    const im = new Image();
    setLoading(true); setErr(null);
    im.onload = () => { setImg(im); setLoading(false); };
    im.onerror = () => { setImg(null); setLoading(false); setErr(t("ic.unreadable")); };
    im.src = url;
  }, [url, t]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize2({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bmp = img ? rotated(img, cell.rotation) : null;
  const bw = bmp ? (bmp instanceof HTMLImageElement ? bmp.naturalWidth : bmp.width) : 0;
  const bh = bmp ? (bmp instanceof HTMLImageElement ? bmp.naturalHeight : bmp.height) : 0;
  const ir = imgRect(size2.w, size2.h, bw, bh, cell, cell.whiteboard);
  const toRel = (x: number, y: number): [number, number] => (ir.w > 0 ? [(x - ir.x) / ir.w, (y - ir.y) / ir.h] : [x / size2.w, y / size2.h]);
  const toS = (p: [number, number]): [number, number] => [ir.x + p[0] * ir.w, ir.y + p[1] * ir.h];
  const hasContent = !!bmp || cell.whiteboard;

  const paint = useCallback((g: CanvasRenderingContext2D, w: number, h: number, forExport = false) => {
    g.fillStyle = cell.whiteboard ? "#fff" : BG; g.fillRect(0, 0, w, h);
    if (bmp) g.drawImage(bmp, ir.x, ir.y, ir.w, ir.h);
    [...cell.annos, ...(cur.current ? [cur.current] : [])].forEach((a) => drawAnno(g, a, toS));
    if (bmp && cell.radarVisible && cell.info?.radar) drawRadar(g, cell, w, h);
    if (gridOn && hasContent) {
      g.save(); g.strokeStyle = "rgba(255,255,255,0.35)"; g.setLineDash([5, 4]); g.lineWidth = 1;
      for (let i = 1; i < gridN; i++) {
        const x = ir.x + (ir.w * i) / gridN, y = ir.y + (ir.h * i) / gridN;
        g.beginPath(); g.moveTo(x, ir.y); g.lineTo(x, ir.y + ir.h); g.moveTo(ir.x, y); g.lineTo(ir.x + ir.w, y); g.stroke();
      }
      g.restore();
    }
    if (!forExport && active) { g.strokeStyle = ACTIVE; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); }
  }, [bmp, cell, ir, gridOn, gridN, hasContent, active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size2.w * dpr; c.height = size2.h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(g, size2.w, size2.h);
  });
  useEffect(() => {
    register(idx, () => {
      if (!hasContent) return null;
      const out = document.createElement("canvas");
      out.width = size2.w * 2; out.height = size2.h * 2;
      const g = out.getContext("2d")!;
      g.scale(2, 2);
      paint(g, size2.w, size2.h, true);
      return out;
    });
    return () => register(idx, null);
  }, [register, idx, paint, size2, hasContent]);

  const pos = (e: React.MouseEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const hit = (x: number, y: number): Anno | null => {
    for (let i = cell.annos.length - 1; i >= 0; i--) {
      const a = cell.annos[i];
      const pts = a.points.map(toS);
      if (["text", "marker"].includes(a.tool)) {
        const [px, py] = pts[0];
        if (x >= px - 4 && x <= px + 12 * Math.max(1, (a.text || "").length) * (a.size / 2 + 1) && y >= py - 24 && y <= py + 8) return a;
      } else if (pts.length >= 2) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        if (x >= Math.min(...xs) - 8 && x <= Math.max(...xs) + 8 && y >= Math.min(...ys) - 8 && y <= Math.max(...ys) + 8) return a;
      }
    }
    return null;
  };
  const snapshot = () => JSON.stringify(cell.annos);
  const withUndo = (annos: Anno[], prev = snapshot()) => onChange({ ...cell, annos, undo: [...cell.undo, prev].slice(-UNDO_LIMIT) });

  const down = (e: React.MouseEvent) => {
    onActivate();
    const { x, y } = pos(e);
    if (e.button === 2) {
      if (tool === "move") {
        const a = hit(x, y);
        if (a) {
          e.preventDefault();
          const set = (p: Partial<Anno>) => withUndo(cell.annos.map((q) => (q === a ? { ...q, ...p } : q)));
          menu.open(e, [{ label: t("ic.colour"), sub: Object.keys(COLORS).map((k) => ({ label: t(`ic.c.${k}`), onClick: () => set({ color: k }) })) },
            { label: t("ic.thickness"), sub: SIZES.map(([s]) => ({ label: t(`ic.size${s}`), onClick: () => set({ size: s }) })) },
            { sep: true }, { label: t("ic.delete"), danger: true, onClick: () => withUndo(cell.annos.filter((q) => q !== a)) }]);
        }
      }
      return;
    }
    if (!hasContent || e.button !== 0) return;
    if (bmp && cell.info?.radar) {
      if (x > size2.w - 46 && x < size2.w - 26 && y < 20) { onChange({ ...cell, radarVisible: !cell.radarVisible }); return; }
      if (cell.radarVisible) {
        const r = radarRect(cell, size2.w, size2.h);
        if (x >= r.x + r.w - 14 && y >= r.y + r.h - 14 && x <= r.x + r.w && y <= r.y + r.h) { drag.current = { mode: "rresize", x, y, px: 0, py: 0, r0: r }; return; }
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { drag.current = { mode: "rmove", x, y, px: 0, py: 0, r0: r }; return; }
      }
    }
    if (tool === "pan") { drag.current = { mode: "pan", x, y, px: cell.panX, py: cell.panY }; return; }
    if (tool === "text") { setTextAt([x, y]); return; }
    if (tool === "eraser") { const a = hit(x, y); if (a) withUndo(cell.annos.filter((q) => q !== a)); drag.current = { mode: "erase", x, y, px: 0, py: 0 }; return; }
    if (tool === "move") { const a = hit(x, y); if (a) drag.current = { mode: "move", x, y, px: 0, py: 0, anno: a }; return; }
    if (tool === "marker") {
      const n = cell.annos.filter((a) => a.tool === "marker").length;
      withUndo([...cell.annos, { tool: "marker", color, size, text: MARKERS[n % MARKERS.length], points: [toRel(x, y)] }]);
      return;
    }
    cur.current = { tool, color, size, points: [toRel(x, y)] };
  };
  const moveM = (e: React.MouseEvent) => {
    const { x, y } = pos(e);
    const d = drag.current;
    if (d?.mode === "pan") { if (cell.zoom > 1.01) onChange({ ...cell, panX: d.px + x - d.x, panY: d.py + y - d.y }); return; }
    if (d?.mode === "rmove" || d?.mode === "rresize") {
      const r0 = d.r0!;
      let r = d.mode === "rmove" ? { ...r0, x: r0.x + x - d.x, y: r0.y + y - d.y }
        : { ...r0, w: Math.max(70, Math.min(r0.w + x - d.x, size2.w - r0.x)), h: Math.max(70, Math.min(r0.h + y - d.y, size2.h - r0.y)) };
      r = { ...r, x: Math.max(0, Math.min(r.x, size2.w - r.w)), y: Math.max(0, Math.min(r.y, size2.h - r.h)) };
      onChange({ ...cell, radarRel: { x: r.x / size2.w, y: r.y / size2.h, w: r.w / size2.w, h: r.h / size2.h } });
      return;
    }
    if (d?.mode === "erase" && e.buttons & 1) { const a = hit(x, y); if (a) onChange({ ...cell, annos: cell.annos.filter((q) => q !== a) }); return; }
    if (d?.mode === "move" && d.anno) {
      const dx = (x - d.x) / (ir.w || size2.w), dy = (y - d.y) / (ir.h || size2.h);
      const moved = { ...d.anno, points: d.anno.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) };
      onChange({ ...cell, annos: cell.annos.map((q) => (q === d.anno ? moved : q)) });
      drag.current = { ...d, x, y, anno: moved };
      return;
    }
    if (cur.current && e.buttons & 1) {
      const p = toRel(x, y);
      if (cur.current.tool === "free") cur.current.points.push(p);
      else cur.current.points = [cur.current.points[0], p];
      force((n) => n + 1);
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === "move" && d.anno) onChange({ ...cell, undo: [...cell.undo, snapshot()].slice(-UNDO_LIMIT) });
    if (cur.current) {
      const a = cur.current;
      cur.current = null;
      if (a.points.length >= 2) withUndo([...cell.annos, a]);
      else force((n) => n + 1);
    }
  };
  const dbl = (e: React.MouseEvent) => {
    const { x, y } = pos(e);
    if (tool === "move") {
      const a = hit(x, y);
      if (a && a.tool === "text") { const s = window.prompt(t("ic.textSize"), String(a.size)); const n = Number(s); if (s && n >= 6 && n <= 72) withUndo(cell.annos.map((q) => (q === a ? { ...q, size: n } : q))); }
      return;
    }
    if (tool === "pan" && bmp) onChange({ ...cell, rotation: (cell.rotation + 90) % 360 });
  };
  const wheel = (e: React.WheelEvent) => { if (!hasContent) return; const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; onChange({ ...cell, zoom: Math.max(0.5, Math.min(10, cell.zoom * f)) }); };

  return (
    <div ref={wrap} className={"ic-frame" + (active ? " on" : "")} onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop(e.dataTransfer.getData("text/plain")); }}>
      <canvas ref={cv} style={{ width: size2.w, height: size2.h, cursor: tool === "pan" ? (cell.zoom > 1.01 ? "grab" : "default") : "crosshair" }}
        onMouseDown={down} onMouseMove={moveM} onMouseUp={up} onMouseLeave={up} onDoubleClick={dbl} onWheel={wheel}
        onContextMenu={(e) => e.preventDefault()} />
      {hasContent ? (
        <div className="ic-bar" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `frame:${idx}`)} title={t("ic.dragFrame")}>
          <span>{cell.whiteboard ? t("ic.whiteboard") : label}</span>
          {bmp && cell.info?.radar && <button title={t("ic.radarTip")} className={cell.radarVisible ? "on" : ""} onClick={() => onChange({ ...cell, radarVisible: !cell.radarVisible })}>⬠</button>}
          <button onClick={() => onChange(emptyCell())} title={t("ic.remove")}>✕</button>
        </div>
      ) : <div className="ic-empty">{loading ? t("ic.loading") : err || t("ic.drop", { pos: `(${label})` })}</div>}
      {textAt && <Modal title={t("ic.annotation")} onClose={() => setTextAt(null)}>
        <textarea rows={4} autoFocus value={textVal} placeholder={t("ic.text")} onChange={(e) => setTextVal(e.target.value)} />
        <div className="modal-buttons"><button className="btn-plain" onClick={() => setTextAt(null)}>{t("sc.cancel")}</button>
          <button className="btn-green" disabled={!textVal.trim()} onClick={() => {
            withUndo([...cell.annos, { tool: "text", color, size, text: textVal.trim(), points: [toRel(textAt[0], textAt[1])] }]);
            setTextAt(null); setTextVal("");
          }}>{t("sc.ok")}</button></div>
      </Modal>}
      {menu.menu}
    </div>
  );
}

/* ------------------------------------------------------------------ page */
type Series = { id: number; name: string; experiment: string };
type Img = { id: number; series_id: number; name: string };
type Local = { token: string; name: string; info: Info };

export default function ImageCompare() {
  const { t } = useI18n();
  const [cols, setCols] = useState(2), [rows, setRows] = useState(2);
  const [colsIn, setColsIn] = useState(2), [rowsIn, setRowsIn] = useState(2);
  const [cells, setCells] = useState<Cell[]>(() => Array.from({ length: 4 }, emptyCell));
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState("pan"), [color, setColor] = useState("red"), [size, setSize] = useState(2);
  const [gridOn, setGridOn] = useState(false), [gridN, setGridN] = useState(4);
  const [series, setSeries] = useState<Series[]>([]);
  const [open, setOpen] = useState<Record<number, Img[] | null>>({});
  const [locals, setLocals] = useState<Local[]>([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const exporters = useRef<Record<number, (() => HTMLCanvasElement | null) | null>>({});
  const fileIn = useRef<HTMLInputElement | null>(null), projIn = useRef<HTMLInputElement | null>(null);

  useEffect(() => { request<{ series: Series[] }>("GET", "/api/image-compare/series").then((d) => setSeries(d.series)).catch((e) => setMsg(String(e))); }, []);
  const register = useCallback((i: number, fn: (() => HTMLCanvasElement | null) | null) => { exporters.current[i] = fn; }, []);
  const setCell = (i: number, c: Cell) => setCells((cs) => cs.map((x, j) => (j === i ? c : x)));
  const n = cols * rows;
  const label = (i: number) => `${Math.floor(i / cols) + 1},${(i % cols) + 1}`;

  const assign = async (i: number, src: Src, info0?: Info) => {
    let info = info0 || null;
    if (!info && src.kind === "db") info = await request<Info>("GET", `/api/image-compare/series/${src.series}/images/${src.id}/info`).catch(() => ({ kind: "image" } as Info));
    setCells((cs) => cs.map((x, j) => (j === i ? { ...emptyCell(), src, info, channel: info?.channels?.[0]?.key || "" } : x)));
  };
  const activeRef = useRef(0);
  activeRef.current = active;
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const assignActive = async (src: Src, info?: Info) => {
    const a = activeRef.current;          // refs: several files in a row go to consecutive frames
    await assign(a, src, info);
    // advance to the next empty frame (desktop _advance_active)
    let next = a;
    for (let k = 1; k <= n; k++) { const j = (a + k) % n; if (j !== a && !cellsRef.current[j]?.src && !cellsRef.current[j]?.whiteboard) { next = j; break; } }
    activeRef.current = next;
    setActive(next);
  };
  const dropOn = (i: number, data: string) => {
    if (data.startsWith("frame:")) {
      const from = Number(data.slice(6));
      if (from === i) return;
      setCells((cs) => cs.map((x, j) => (j === i ? cs[from] : j === from ? cs[i] : x)));
      return;
    }
    try { const d = JSON.parse(data); if (d.src) assign(i, d.src, d.info); } catch { /* not ours */ }
  };
  const applyGrid = () => {
    const c = Math.max(1, Math.min(10, colsIn)), r = Math.max(1, Math.min(10, rowsIn));
    setCols(c); setRows(r);
    setCells((cs) => Array.from({ length: c * r }, (_x, i) => cs[i] || emptyCell()));
    setActive((a) => Math.min(a, c * r - 1));
  };
  const toggleSeries = (s: Series) => {
    if (open[s.id] !== undefined) { const o = { ...open }; delete o[s.id]; setOpen(o); return; }
    setOpen({ ...open, [s.id]: null });
    request<{ images: Img[] }>("GET", `/api/image-compare/series/${s.id}/images`).then((d) => setOpen((o) => ({ ...o, [s.id]: d.images })));
  };
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/image-compare/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) { setMsg(j.code ? t(`ic.err.${j.code}`) : j.detail); continue; }
      const { token, name, ...info } = j;
      setLocals((l) => [...l, { token, name, info }]);
      await assignActive({ kind: "local", token, name }, info as Info);
    }
  };
  // Ctrl+V: picture from the clipboard into the active frame (desktop keyPressEvent)
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const it = Array.from(e.clipboardData?.items || []).find((x) => x.type.startsWith("image/"));
      if (!it || (e.target as HTMLElement).closest("input, textarea")) return;
      const fr = new FileReader();
      fr.onload = () => setCell(active, { ...emptyCell(), clip: String(fr.result), src: { kind: "local", token: "", name: "clipboard" }, info: { kind: "image" } });
      fr.readAsDataURL(it.getAsFile()!);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  const saveCanvas = (cv: HTMLCanvasElement, name: string) => {
    const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = name; a.click();
  };
  const saveFrame = () => { const cv = exporters.current[active]?.(); if (!cv) { setMsg(t("ic.nothing")); return; } saveCanvas(cv, `frame_${label(active).replace(",", "_")}.png`); };
  const saveAll = () => {
    const parts = Array.from({ length: n }, (_x, i) => exporters.current[i]?.() || null);
    const any = parts.find(Boolean);
    if (!any) { setMsg(t("ic.nothing")); return; }
    const w = any.width, h = any.height, gap = 4;
    const out = document.createElement("canvas");
    out.width = cols * w + (cols - 1) * gap; out.height = rows * h + (rows - 1) * gap;
    const g = out.getContext("2d")!;
    g.fillStyle = "#111"; g.fillRect(0, 0, out.width, out.height);
    parts.forEach((p, i) => { if (p) g.drawImage(p, (i % cols) * (w + gap), Math.floor(i / cols) * (h + gap), w, h); });
    saveCanvas(out, "image_compare.png");
  };
  const saveProject = () => {
    const proj = { version: 2, web: true, cols, rows, frames: cells.slice(0, n).map((c, i) => ({
      index: i, row: Math.floor(i / cols), col: i % cols, whiteboard: c.whiteboard, rotation: c.rotation, zoom: c.zoom, pan_x: c.panX, pan_y: c.panY,
      series_id: c.src?.kind === "db" ? c.src.series : null, image_id: c.src?.kind === "db" ? c.src.id : null,
      is_local: c.src?.kind === "local", label: c.src?.name || "", vk4_channel: c.channel, page: c.page, sheet: c.sheet,
      annotations: c.annos.map((a) => ({ tool: a.tool, color: a.color, size: a.size, text: a.text || "", points: a.points })),
      undo_stack: c.undo, radar_visible: c.radarVisible, radar_custom: !!c.radarRel, radar_rel: c.radarRel || {} })) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(proj, null, 2)], { type: "application/json" }));
    a.download = "compare.ttcompare"; a.click();
  };
  const loadProject = async (f: File | undefined) => {
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      const c = Math.max(1, Math.min(10, p.cols || 2)), r = Math.max(1, Math.min(10, p.rows || 2));
      setCols(c); setRows(r); setColsIn(c); setRowsIn(r);
      const missing: string[] = [];
      const next: Cell[] = Array.from({ length: c * r }, emptyCell);
      for (const fd of p.frames || []) {
        const i = Number(fd.index);
        if (!(i >= 0 && i < c * r)) continue;
        const base: Cell = { ...emptyCell(), whiteboard: !!fd.whiteboard, rotation: fd.rotation || 0, zoom: fd.zoom || 1, panX: fd.pan_x || 0, panY: fd.pan_y || 0,
          channel: fd.vk4_channel || "", page: fd.page || 0, sheet: fd.sheet || 0, annos: (fd.annotations || []).map((a: Anno) => ({ ...a, points: a.points || [] })),
          undo: fd.undo_stack || [], radarVisible: !!fd.radar_visible, radarRel: fd.radar_custom ? fd.radar_rel : null };
        if (fd.series_id && fd.image_id) {
          base.src = { kind: "db", series: fd.series_id, id: fd.image_id, name: fd.label || "" };
          base.info = await request<Info>("GET", `/api/image-compare/series/${fd.series_id}/images/${fd.image_id}/info`).catch(() => { missing.push(fd.label || String(fd.image_id)); return null; });
        } else if (fd.image_path || fd.is_local) {
          missing.push(fd.label || fd.image_path);
        }
        next[i] = base;
      }
      setCells(next); setActive(0);
      setMsg(missing.length ? t("ic.missing", { names: missing.join(", ") }) : null);
    } catch (e) { setMsg(String(e)); }
  };

  const ac = cells[active];
  const ql = q.trim().toLowerCase();
  const shown = series.filter((s) => !ql || `${s.experiment} ${s.name}`.toLowerCase().includes(ql) || (open[s.id] || []).some((i) => i.name.toLowerCase().includes(ql)));
  const dragItem = (src: Src, info?: Info) => (e: React.DragEvent) => e.dataTransfer.setData("text/plain", JSON.stringify({ src, info }));

  return (
    <div className="page ic-page">
      <div className="page-head"><h1>{t("ic.title")}</h1></div>
      <div className="ic-toolbar">
        <span>{t("ic.grid")}</span>
        <input type="number" min={1} max={10} value={colsIn} title={t("ic.cols")} onChange={(e) => setColsIn(Number(e.target.value))} />×
        <input type="number" min={1} max={10} value={rowsIn} title={t("ic.rows")} onChange={(e) => setRowsIn(Number(e.target.value))} />
        <button className="btn-green" onClick={applyGrid}>{t("ic.apply")}</button>
        <span className="ic-sep" />
        <span>{t("ic.activeFrame")} <b>{label(active)}</b></span>
        <span className="ic-sep" />
        {TOOLS.map(([k, ic]) => <button key={k} className={"ic-tool" + (tool === k ? " on" : "")} title={t(`ic.tool.${k}`)} onClick={() => setTool(k)}>{ic}</button>)}
        <span className="ic-sep" />
        {Object.entries(COLORS).map(([k, c]) => <button key={k} className={"ic-col" + (color === k ? " on" : "")} style={{ background: c }} title={t(`ic.c.${k}`)} onClick={() => setColor(k)} />)}
        {SIZES.map(([s, ic]) => <button key={s} className={"ic-tool" + (size === s ? " on" : "")} title={t(`ic.size${s}`)} onClick={() => setSize(s)}>{ic}</button>)}
        <span className="ic-sep" />
        <button className="btn-plain" title={t("ic.undoTip")} disabled={!ac?.undo.length}
          onClick={() => ac && setCell(active, { ...ac, annos: JSON.parse(ac.undo[ac.undo.length - 1]), undo: ac.undo.slice(0, -1) })}>↩ {t("ic.undo")}</button>
        <button className="btn-plain" onClick={() => setCells(cells.map((c) => ({ ...c, annos: [], undo: c.annos.length ? [...c.undo, JSON.stringify(c.annos)].slice(-UNDO_LIMIT) : c.undo })))}>🗑 {t("ic.clearAll")}</button>
        <button className={"btn-plain" + (gridOn ? " ic-on" : "")} onClick={() => setGridOn(!gridOn)}>⊞ {t("ic.gridOverlay")}</button>
        <input type="number" min={2} max={20} value={gridN} title={t("ic.divisions")} onChange={(e) => setGridN(Math.max(2, Math.min(20, Number(e.target.value))))} />
        <span className="ic-sep" />
        <button className="btn-plain" title={t("ic.saveFrameTip")} onClick={saveFrame}>💾 {t("ic.saveFrame")}</button>
        <button className="btn-plain" title={t("ic.saveAllTip")} onClick={saveAll}>🖼 {t("ic.saveAll")}</button>
        <button className="btn-plain" onClick={saveProject}>📁 {t("ic.saveProject")}</button>
        <button className="btn-plain" onClick={() => projIn.current?.click()}>📂 {t("ic.loadProject")}</button>
        <input ref={projIn} type="file" accept=".ttcompare,.json" hidden onChange={(e) => { loadProject(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {ac?.info && (ac.info.kind !== "image") && (
        <div className="ic-sub">
          {ac.info.kind === "vk4" && (ac.info.channels || []).map((ch) => <button key={ch.key} className={"btn-plain" + (ac.channel === ch.key ? " ic-on" : "")} onClick={() => setCell(active, { ...ac, channel: ch.key })}>{ch.label}</button>)}
          {(ac.info.kind === "pdf" || ac.info.kind === "word") && (ac.info.pages || 1) > 1 && <label>{t("ic.page")} <select value={ac.page} onChange={(e) => setCell(active, { ...ac, page: Number(e.target.value) })}>
            {Array.from({ length: ac.info.pages || 1 }, (_x, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>}
          {ac.info.kind === "excel" && (ac.info.sheets || []).length > 1 && <label>{t("ic.sheet")} <select value={ac.sheet} onChange={(e) => setCell(active, { ...ac, sheet: Number(e.target.value) })}>
            {(ac.info.sheets || []).map((s, i) => <option key={i} value={i}>{s}</option>)}</select></label>}
        </div>)}
      {msg && <div className="mj-msg err">{msg} <button className="mu-x" onClick={() => setMsg(null)}>✕</button></div>}
      <div className="ic-body">
        <aside className="ic-list">
          <input className="mj-search" placeholder={t("ic.filter")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ic-actions">
            <button className="btn-plain" onClick={() => fileIn.current?.click()}>＋ {t("ic.local")}</button>
            <button className="btn-plain" onClick={() => { setCell(active, { ...emptyCell(), whiteboard: true }); }}>⬜ {t("ic.whiteboard")}</button>
            <input ref={fileIn} type="file" multiple hidden accept=".png,.jpg,.jpeg,.bmp,.webp,.gif,.tif,.tiff,.vk4,.pdf,.xlsx,.xlsm,.xls,.docx,.doc"
              onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </div>
          {locals.length > 0 && <div className="ic-group"><div className="ic-ghead">{t("ic.localFiles")}</div>
            {locals.map((l) => <div key={l.token} className="ic-item" draggable onDragStart={dragItem({ kind: "local", token: l.token, name: l.name }, l.info)}
              onClick={() => assignActive({ kind: "local", token: l.token, name: l.name }, l.info)}>{l.name}</div>)}</div>}
          {shown.map((s) => (
            <div key={s.id} className="ic-group">
              <div className="ic-ghead" onClick={() => toggleSeries(s)}>{open[s.id] !== undefined ? "▾" : "▸"} {s.experiment} · {s.name}</div>
              {open[s.id] === null && <div className="muted small">{t("app.loading")}</div>}
              {(open[s.id] || []).filter((i) => !ql || i.name.toLowerCase().includes(ql) || `${s.experiment} ${s.name}`.toLowerCase().includes(ql)).map((i) => {
                const src: Src = { kind: "db", series: s.id, id: i.id, name: i.name };
                return <div key={i.id} className="ic-item" draggable onDragStart={dragItem(src)} onClick={() => assignActive(src)} title={t("ic.itemTip")}>{i.name}</div>;
              })}
            </div>))}
        </aside>
        <div className="ic-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {cells.slice(0, n).map((c, i) => (
            <Frame key={i} cell={c} idx={i} active={i === active} tool={tool} color={color} size={size} gridOn={gridOn} gridN={gridN}
              onActivate={() => setActive(i)} onChange={(nc) => setCell(i, nc)} onDrop={(d) => dropOn(i, d)} register={register}
              label={c.src ? (c.src.kind === "db" ? `S${c.src.series}  ${c.src.name}` : c.src.name) : label(i)} />))}
        </div>
      </div>
    </div>
  );
}

