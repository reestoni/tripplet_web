import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";
import { useContextMenu } from "../components/ContextMenu";
import { COLORS, drawAnno, MARKERS, SIZES, TOOLS, type Anno } from "./ImageCompare";

/* Canvas (desktop ui/screen_canvas.py): a free board for several images / documents (series images and PDFs or
   files from this computer, rendered by the server - ui/doc_render.py), moved / scaled / rotated, plus the
   annotation tools of Image Compare, background colour, grid, undo (10), PNG export and project files. */

type Src = { kind: "db"; series: number; id: number; name: string } | { kind: "pdf"; series: number; id: number; name: string }
  | { kind: "local"; token: string; name: string } | { kind: "clip"; data: string; name: string };
type Info = { kind: string; pages?: number; sheets?: string[]; channels?: { key: string; label: string }[] };
type Item = { k: string; src: Src; info: Info | null; page: number; sheet: number; channel: string; x: number; y: number; scale: number; angle: number };
type State = { items: Item[]; annos: Anno[]; bg: string };
type View = { x: number; y: number; z: number };
type Series = { id: number; name: string; experiment: string; has_images: boolean; has_pdfs: boolean };
type Entry = { id: number; name: string; pdf?: boolean };
const UNDO = 10;
const key = () => Math.random().toString(36).slice(2, 10);

function url(it: Item): string {
  const s = it.src;
  if (s.kind === "clip") return s.data;
  const q = `?page=${it.page}&sheet=${it.sheet}&channel=${encodeURIComponent(it.channel)}`;
  if (s.kind === "db") return `/api/image-compare/series/${s.series}/images/${s.id}/file${q}`;
  if (s.kind === "pdf") return `/api/image-compare/series/${s.series}/pdfs/${s.id}/file${q}`;
  return `/api/image-compare/local/${s.token}/file${q}`;
}

export default function Canvas() {
  const { t } = useI18n();
  const [st, setSt] = useState<State>({ items: [], annos: [], bg: "#1e1e1e" });
  const [undo, setUndo] = useState<string[]>([]);
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState("pan"), [color, setColor] = useState("red"), [size, setSize] = useState(2);
  const [grid, setGrid] = useState(false), [divs, setDivs] = useState(10);
  const [series, setSeries] = useState<Series[]>([]);
  const [open, setOpen] = useState<Record<number, Entry[] | null>>({});
  const [locals, setLocals] = useState<{ token: string; name: string; info: Info }[]>([]);
  const [q, setQ] = useState(""), [typeFilter, setTypeFilter] = useState<"all" | "img" | "pdf">("all");
  const [msg, setMsg] = useState<string | null>(null);
  const [textAt, setTextAt] = useState<[number, number] | null>(null), [textVal, setTextVal] = useState("");
  const cv = useRef<HTMLCanvasElement | null>(null), wrap = useRef<HTMLDivElement | null>(null);
  const imgs = useRef<Record<string, HTMLImageElement>>({});
  const [, force] = useState(0);
  const cur = useRef<Anno | null>(null);
  const drag = useRef<{ mode: string; x: number; y: number; vx?: number; vy?: number; start?: Record<string, [number, number]>; anno?: Anno } | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null), projIn = useRef<HTMLInputElement | null>(null);
  const menu = useContextMenu();

  useEffect(() => { request<{ series: Series[] }>("GET", "/api/image-compare/canvas-series").then((d) => setSeries(d.series)).catch((e) => setMsg(String(e))); }, []);
  // load the bitmaps of the items
  useEffect(() => {
    st.items.forEach((it) => {
      const u = url(it);
      if (imgs.current[u]) return;
      const im = new Image();
      im.onload = () => force((n) => n + 1);
      im.onerror = () => setMsg(t("ic.unreadable"));
      im.src = u;
      imgs.current[u] = im;
    });
  }, [st.items, t]);

  const push = useCallback((prev: State) => setUndo((u) => [...u, JSON.stringify(prev)].slice(-UNDO)), []);
  const change = (next: State, withUndo = true) => { if (withUndo) push(st); setSt(next); };
  const bitmap = (it: Item) => { const im = imgs.current[url(it)]; return im && im.complete && im.naturalWidth ? im : null; };
  const dims = (it: Item) => { const im = bitmap(it); return im ? [im.naturalWidth, im.naturalHeight] : [200, 150]; };
  const toBoard = (cx: number, cy: number): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z];
  };
  // is board point p inside item it (rotation around the centre)?
  const inside = (it: Item, p: [number, number]) => {
    const [w, h] = dims(it), cx = it.x + (w * it.scale) / 2, cy = it.y + (h * it.scale) / 2;
    const a = (-it.angle * Math.PI) / 180, dx = p[0] - cx, dy = p[1] - cy;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(rx) <= (w * it.scale) / 2 && Math.abs(ry) <= (h * it.scale) / 2;
  };
  const itemAt = (p: [number, number]) => [...st.items].reverse().find((it) => inside(it, p)) || null;
  const annoAt = (p: [number, number]) => {
    for (let i = st.annos.length - 1; i >= 0; i--) {
      const a = st.annos[i];
      const xs = a.points.map((q2) => q2[0]), ys = a.points.map((q2) => q2[1]);
      const pad = 10 / view.z + (["text", "marker"].includes(a.tool) ? 20 : 0);
      if (p[0] >= Math.min(...xs) - pad && p[0] <= Math.max(...xs) + pad * (["text", "marker"].includes(a.tool) ? 4 : 1)
        && p[1] >= Math.min(...ys) - pad && p[1] <= Math.max(...ys) + pad) return a;
    }
    return null;
  };

  const paint = useCallback((g: CanvasRenderingContext2D, w: number, h: number, v: View, forExport = false) => {
    g.fillStyle = st.bg; g.fillRect(0, 0, w, h);
    g.save(); g.translate(v.x, v.y); g.scale(v.z, v.z);
    if (grid && !forExport) {
      const x0 = -v.x / v.z, y0 = -v.y / v.z, x1 = x0 + w / v.z, y1 = y0 + h / v.z;
      const step = Math.max(40, Math.max(x1 - x0, y1 - y0) / divs);
      g.strokeStyle = "rgba(255,255,255,0.14)"; g.lineWidth = 1 / v.z; g.setLineDash([4 / v.z, 4 / v.z]);
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
      g.setLineDash([]);
    }
    st.items.forEach((it) => {
      const [iw, ih] = dims(it), im = bitmap(it);
      g.save();
      g.translate(it.x + (iw * it.scale) / 2, it.y + (ih * it.scale) / 2);
      g.rotate((it.angle * Math.PI) / 180);
      g.scale(it.scale, it.scale);
      if (im) g.drawImage(im, -iw / 2, -ih / 2); else { g.fillStyle = "#333"; g.fillRect(-iw / 2, -ih / 2, iw, ih); }
      g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(-iw / 2, -ih / 2, iw, 20);
      g.fillStyle = "#ddd"; g.font = "12px Segoe UI"; g.textBaseline = "middle"; g.fillText(it.src.name, -iw / 2 + 4, -ih / 2 + 10);
      if (!forExport && sel.includes(it.k)) { g.strokeStyle = "#39A650"; g.lineWidth = 3 / it.scale; g.strokeRect(-iw / 2, -ih / 2, iw, ih); }
      g.restore();
    });
    [...st.annos, ...(cur.current ? [cur.current] : [])].forEach((a) => drawAnno(g, a, (p) => p));
    g.restore();
  }, [st, grid, divs, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cv.current, wr = wrap.current;
    if (!c || !wr) return;
    const dpr = window.devicePixelRatio || 1, w = wr.clientWidth, h = wr.clientHeight;
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px";
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(g, w, h, view);
  });
  useEffect(() => { const ro = new ResizeObserver(() => force((n) => n + 1)); if (wrap.current) ro.observe(wrap.current); return () => ro.disconnect(); }, []);

  // ---- adding things
  const add = async (src: Src, info0?: Info) => {
    let info = info0 || null;
    if (!info && (src.kind === "db" || src.kind === "pdf"))
      info = await request<Info>("GET", src.kind === "db" ? `/api/image-compare/series/${src.series}/images/${src.id}/info` : `/api/image-compare/series/${src.series}/pdfs/${src.id}/info`).catch(() => null);
    const wr = wrap.current!;
    const [cx, cy] = [(wr.clientWidth / 2 - view.x) / view.z, (wr.clientHeight / 2 - view.y) / view.z];
    const k = key();
    setSt((prev) => {      // functional: several uploads in a row must not overwrite each other
      const n = prev.items.length;
      const it: Item = { k, src, info, page: 0, sheet: 0, channel: info?.channels?.[0]?.key || "", x: cx - 150 + (n % 6) * 30, y: cy - 100 + (n % 6) * 30, scale: 0.5, angle: 0 };
      setUndo((u) => [...u, JSON.stringify(prev)].slice(-UNDO));
      return { ...prev, items: [...prev.items, it] };
    });
    setSel([k]);
  };
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      const fd = new FormData(); fd.append("file", f);
      const res = await fetch("/api/image-compare/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) { setMsg(j.code ? t(`ic.err.${j.code}`) : j.detail); continue; }
      const { token, name, ...info } = j;
      setLocals((l) => [...l, { token, name, info }]);
      await add({ kind: "local", token, name }, info as Info);
    }
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const it = Array.from(e.clipboardData?.items || []).find((x) => x.type.startsWith("image/"));
      if (!it || (e.target as HTMLElement).closest("input, textarea")) return;
      const fr = new FileReader();
      fr.onload = () => add({ kind: "clip", data: String(fr.result), name: "clipboard" }, { kind: "image" });
      fr.readAsDataURL(it.getAsFile()!);
    };
    const keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, .modal")) return;
      if (e.key === "Delete" && sel.length) { change({ ...st, items: st.items.filter((i) => !sel.includes(i.k)) }); setSel([]); }
    };
    window.addEventListener("paste", paste); window.addEventListener("keydown", keys);
    return () => { window.removeEventListener("paste", paste); window.removeEventListener("keydown", keys); };
  });

  // ---- mouse
  const down = (e: React.MouseEvent) => {
    const p = toBoard(e.clientX, e.clientY);
    if (e.button === 2) {
      e.preventDefault();
      if (tool === "move") {
        const a = annoAt(p);
        if (a) {
          const set = (pp: Partial<Anno>) => change({ ...st, annos: st.annos.map((x) => (x === a ? { ...x, ...pp } : x)) });
          menu.open(e, [{ label: t("ic.colour"), sub: Object.keys(COLORS).map((k) => ({ label: t(`ic.c.${k}`), onClick: () => set({ color: k }) })) },
            { label: t("ic.thickness"), sub: SIZES.map(([s2]) => ({ label: t(`ic.size${s2}`), onClick: () => set({ size: s2 }) })) },
            { sep: true }, { label: t("ic.delete"), danger: true, onClick: () => change({ ...st, annos: st.annos.filter((x) => x !== a) }) }]);
        }
      }
      return;
    }
    if (e.button !== 0) return;
    if (tool === "pan") {
      const it = itemAt(p);
      if (it) {
        const ns = e.ctrlKey ? (sel.includes(it.k) ? sel.filter((k) => k !== it.k) : [...sel, it.k]) : (sel.includes(it.k) ? sel : [it.k]);
        setSel(ns);
        if (ns.includes(it.k)) drag.current = { mode: "items", x: p[0], y: p[1], start: Object.fromEntries(st.items.filter((i) => ns.includes(i.k)).map((i) => [i.k, [i.x, i.y]])) };
        return;
      }
      setSel([]);
      drag.current = { mode: "view", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (tool === "eraser") {
      const it = itemAt(p);
      if (it) { change({ ...st, items: st.items.filter((i) => i !== it) }); return; }
      const a = annoAt(p);
      if (a) change({ ...st, annos: st.annos.filter((x) => x !== a) });
      drag.current = { mode: "erase", x: 0, y: 0 };
      return;
    }
    if (tool === "move") { const a = annoAt(p); if (a) { push(st); drag.current = { mode: "move", x: p[0], y: p[1], anno: a }; } return; }
    if (tool === "text") { setTextAt(p); return; }
    if (tool === "marker") {
      const n = st.annos.filter((a) => a.tool === "marker").length;
      change({ ...st, annos: [...st.annos, { tool: "marker", color, size, text: MARKERS[n % MARKERS.length], points: [p] }] });
      return;
    }
    cur.current = { tool, color, size, points: [p] };
  };
  const moveM = (e: React.MouseEvent) => {
    const d = drag.current, p = toBoard(e.clientX, e.clientY);
    if (d?.mode === "view") { setView({ ...view, x: d.vx! + e.clientX - d.x, y: d.vy! + e.clientY - d.y }); return; }
    if (d?.mode === "items" && d.start) {
      const dx = p[0] - d.x, dy = p[1] - d.y;
      if (!(d as { moved?: boolean }).moved && Math.abs(dx) + Math.abs(dy) > 1) { push(st); (d as { moved?: boolean }).moved = true; }
      setSt((s) => ({ ...s, items: s.items.map((i) => (d.start![i.k] ? { ...i, x: d.start![i.k][0] + dx, y: d.start![i.k][1] + dy } : i)) }));
      return;
    }
    if (d?.mode === "erase" && e.buttons & 1) {
      const it = itemAt(p);
      if (it) { change({ ...st, items: st.items.filter((i) => i !== it) }); return; }
      const a = annoAt(p);
      if (a) setSt((s) => ({ ...s, annos: s.annos.filter((x) => x !== a) }));
      return;
    }
    if (d?.mode === "move" && d.anno) {
      const dx = p[0] - d.x, dy = p[1] - d.y;
      const moved = { ...d.anno, points: d.anno.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
      setSt((s) => ({ ...s, annos: s.annos.map((x) => (x === d.anno ? moved : x)) }));
      drag.current = { ...d, x: p[0], y: p[1], anno: moved };
      return;
    }
    if (cur.current && e.buttons & 1) {
      if (cur.current.tool === "free") cur.current.points.push(p); else cur.current.points = [cur.current.points[0], p];
      force((n) => n + 1);
    }
  };
  const up = () => {
    drag.current = null;
    if (cur.current) {
      const a = cur.current;
      cur.current = null;
      if (a.points.length >= 2) change({ ...st, annos: [...st.annos, a] }); else force((n) => n + 1);
    }
  };
  const dbl = (e: React.MouseEvent) => {
    const p = toBoard(e.clientX, e.clientY);
    if (tool === "pan") {
      const it = itemAt(p);
      if (it) {
        const nearest = Math.round(it.angle / 90) * 90;
        const angle = Math.abs((it.angle % 360) - (nearest % 360)) < 0.5 ? (it.angle + 90) % 360 : nearest % 360;
        change({ ...st, items: st.items.map((i) => (i === it ? { ...i, angle } : i)) });
      }
    } else if (tool === "move") {
      const a = annoAt(p);
      if (a && a.tool === "text") { const s2 = window.prompt(t("ic.textSize"), String(a.size)); const n = Number(s2); if (s2 && n >= 6 && n <= 72) change({ ...st, annos: st.annos.map((x) => (x === a ? { ...x, size: n } : x)) }); }
    }
  };
  const wheel = (e: React.WheelEvent) => {
    const r = cv.current!.getBoundingClientRect();
    const p = toBoard(e.clientX, e.clientY);
    if (e.ctrlKey) {
      const it = tool === "pan" ? itemAt(p) : null;
      if (it) { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; change({ ...st, items: st.items.map((i) => (i === it ? { ...i, scale: Math.max(0.05, Math.min(20, i.scale * f)) } : i)) }); return; }
      const z = Math.max(0.02, Math.min(50, view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setView({ z, x: e.clientX - r.left - p[0] * z, y: e.clientY - r.top - p[1] * z });
      return;
    }
    if (e.shiftKey) setView({ ...view, x: view.x - e.deltaY }); else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
  };
  // ctrl+wheel must not zoom the page
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const stop = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    c.addEventListener("wheel", stop, { passive: false });
    return () => c.removeEventListener("wheel", stop);
  }, []);

  const bounds = () => {
    const xs: number[] = [], ys: number[] = [];
    st.items.forEach((it) => { const [w, h] = dims(it); const d = Math.hypot(w, h) * it.scale / 2, cx = it.x + (w * it.scale) / 2, cy = it.y + (h * it.scale) / 2; xs.push(cx - d, cx + d); ys.push(cy - d, cy + d); });
    st.annos.forEach((a) => a.points.forEach(([x, y]) => { xs.push(x); ys.push(y + 30); }));
    if (!xs.length) return { x: -400, y: -300, w: 800, h: 600 };
    const x = Math.min(...xs) - 20, y = Math.min(...ys) - 20;
    return { x, y, w: Math.max(...xs) + 20 - x, h: Math.max(...ys) + 20 - y };
  };
  const resetView = () => {
    const b = bounds(), wr = wrap.current!;
    const z = Math.min(2, Math.min(wr.clientWidth / b.w, wr.clientHeight / b.h));
    setView({ z, x: (wr.clientWidth - b.w * z) / 2 - b.x * z, y: (wr.clientHeight - b.h * z) / 2 - b.y * z });
  };
  const savePng = () => {
    const b = bounds(), out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(b.w)); out.height = Math.max(1, Math.round(b.h));
    const g = out.getContext("2d")!;
    paint(g, out.width, out.height, { x: -b.x, y: -b.y, z: 1 }, true);
    try { const a = document.createElement("a"); a.href = out.toDataURL("image/png"); a.download = "canvas.png"; a.click(); } catch { setMsg(t("cv.exportFailed")); }
  };
  const saveProject = () => {
    const proj = { version: 2, web: true, bg_color: st.bg, view, images: st.items.filter((i) => i.src.kind !== "clip").map((i) => ({
      label: i.src.name, source: i.src.kind === "local" ? { kind: "local" } : i.src, vk4_channel: i.channel, pdf_page: i.page, excel_sheet: i.sheet,
      x: i.x, y: i.y, angle: i.angle, scale: i.scale })), annotations: st.annos, undo_stack: undo };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(proj, null, 2)], { type: "application/json" }));
    a.download = "canvas.ttcanvas"; a.click();
  };
  const loadProject = async (f: File | undefined) => {
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      const missing: string[] = [];
      const items: Item[] = [];
      for (const im of p.images || []) {
        const s = im.source;
        if (s && (s.kind === "db" || s.kind === "pdf") && s.series && s.id) {
          const info = await request<Info>("GET", s.kind === "db" ? `/api/image-compare/series/${s.series}/images/${s.id}/info` : `/api/image-compare/series/${s.series}/pdfs/${s.id}/info`).catch(() => null);
          if (!info) missing.push(im.label);
          items.push({ k: key(), src: s, info, page: im.pdf_page || 0, sheet: im.excel_sheet || 0, channel: im.vk4_channel || "", x: im.x || 0, y: im.y || 0, scale: im.scale || 1, angle: im.angle || 0 });
        } else missing.push(im.label || im.path || "?");
      }
      setSt({ items, annos: p.annotations || [], bg: p.bg_color || "#1e1e1e" });
      setUndo((p.undo_stack || []).filter((x: unknown) => typeof x === "string"));
      if (p.view) setView(p.view);
      setMsg(missing.length ? t("ic.missing", { names: missing.join(", ") }) : null);
    } catch (e) { setMsg(String(e)); }
  };

  const one = sel.length === 1 ? st.items.find((i) => i.k === sel[0]) : undefined;
  const ql = q.trim().toLowerCase();
  const shown = series.filter((s) => (typeFilter === "all" || (typeFilter === "img" ? s.has_images : s.has_pdfs))
    && (!ql || `${s.experiment} ${s.name}`.toLowerCase().includes(ql) || (open[s.id] || []).some((i) => i.name.toLowerCase().includes(ql))));
  const toggleSeries = (s: Series) => {
    if (open[s.id] !== undefined) { const o = { ...open }; delete o[s.id]; setOpen(o); return; }
    setOpen({ ...open, [s.id]: null });
    Promise.all([s.has_images ? request<{ images: Entry[] }>("GET", `/api/image-compare/series/${s.id}/images`).then((d) => d.images) : Promise.resolve([] as Entry[]),
      s.has_pdfs ? request<{ pdfs: Entry[] }>("GET", `/api/image-compare/series/${s.id}/pdfs`).then((d) => d.pdfs.map((x) => ({ ...x, pdf: true }))) : Promise.resolve([] as Entry[])])
      .then(([a, b]) => setOpen((o) => ({ ...o, [s.id]: [...a, ...b] })));
  };

  return (
    <div className="page ic-page">
      <div className="page-head"><h1>{t("cv.title")}</h1></div>
      <div className="ic-toolbar">
        {TOOLS.map(([k, ic]) => <button key={k} className={"ic-tool" + (tool === k ? " on" : "")} title={t(k === "pan" ? "cv.toolPan" : `ic.tool.${k}`)} onClick={() => setTool(k)}>{ic}</button>)}
        <span className="ic-sep" />
        {Object.entries(COLORS).map(([k, c]) => <button key={k} className={"ic-col" + (color === k ? " on" : "")} style={{ background: c }} title={t(`ic.c.${k}`)} onClick={() => setColor(k)} />)}
        {SIZES.map(([s2, ic]) => <button key={s2} className={"ic-tool" + (size === s2 ? " on" : "")} title={t(`ic.size${s2}`)} onClick={() => setSize(s2)}>{ic}</button>)}
        <span className="ic-sep" />
        <button className="btn-plain" disabled={!undo.length} title={t("cv.undoTip")} onClick={() => { setSt(JSON.parse(undo[undo.length - 1])); setUndo(undo.slice(0, -1)); }}>↩ {t("ic.undo")}</button>
        <button className="btn-plain" onClick={() => { if (window.confirm(t("cv.clearQ"))) { change({ ...st, items: [], annos: [] }); setSel([]); } }}>🗑 {t("cv.clear")}</button>
        <button className={"btn-plain" + (grid ? " ic-on" : "")} onClick={() => setGrid(!grid)}>⊞ {t("ic.gridOverlay")}</button>
        <input type="number" min={2} max={50} value={divs} title={t("ic.divisions")} onChange={(e) => setDivs(Math.max(2, Math.min(50, Number(e.target.value))))} />
        <label className="btn-plain cv-bg" title={t("cv.bgTip")}>🎨 <input type="color" value={st.bg} onChange={(e) => change({ ...st, bg: e.target.value })} /></label>
        <span className="ic-sep" />
        <button className="btn-plain" onClick={savePng}>💾 {t("cv.saveAs")}</button>
        <button className="btn-plain" onClick={resetView}>⌖ {t("cv.reset")}</button>
        <button className="btn-plain" onClick={saveProject}>📁 {t("ic.saveProject")}</button>
        <button className="btn-plain" onClick={() => projIn.current?.click()}>📂 {t("ic.loadProject")}</button>
        <input ref={projIn} type="file" accept=".ttcanvas,.json" hidden onChange={(e) => { loadProject(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {one?.info && one.info.kind !== "image" && (
        <div className="ic-sub">
          {one.info.kind === "vk4" && (one.info.channels || []).map((ch) => <button key={ch.key} className={"btn-plain" + (one.channel === ch.key ? " ic-on" : "")}
            onClick={() => change({ ...st, items: st.items.map((i) => (i === one ? { ...i, channel: ch.key } : i)) })}>{ch.label}</button>)}
          {(one.info.kind === "pdf" || one.info.kind === "word") && (one.info.pages || 1) > 1 && <label>{t("ic.page")} <select value={one.page}
            onChange={(e) => change({ ...st, items: st.items.map((i) => (i === one ? { ...i, page: Number(e.target.value) } : i)) })}>
            {Array.from({ length: one.info.pages || 1 }, (_x, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>}
          {one.info.kind === "excel" && (one.info.sheets || []).length > 1 && <label>{t("ic.sheet")} <select value={one.sheet}
            onChange={(e) => change({ ...st, items: st.items.map((i) => (i === one ? { ...i, sheet: Number(e.target.value) } : i)) })}>
            {(one.info.sheets || []).map((s2, i) => <option key={i} value={i}>{s2}</option>)}</select></label>}
        </div>)}
      {msg && <div className="mj-msg err">{msg} <button className="mu-x" onClick={() => setMsg(null)}>✕</button></div>}
      <div className="ic-body">
        <aside className="ic-list">
          <input className="mj-search" placeholder={t("ic.filter")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ic-actions">
            {(["all", "img", "pdf"] as const).map((k) => <button key={k} className={"btn-plain" + (typeFilter === k ? " ic-on" : "")} onClick={() => setTypeFilter(k)}>{t(`cv.type.${k}`)}</button>)}
          </div>
          <div className="ic-actions"><button className="btn-plain" onClick={() => fileIn.current?.click()}>＋ {t("ic.local")}</button>
            <input ref={fileIn} type="file" multiple hidden accept=".png,.jpg,.jpeg,.bmp,.webp,.gif,.tif,.tiff,.vk4,.pdf,.xlsx,.xlsm,.xls,.docx,.doc" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /></div>
          {locals.length > 0 && <div className="ic-group"><div className="ic-ghead">{t("ic.localFiles")}</div>
            {locals.map((l) => <div key={l.token} className="ic-item" onClick={() => add({ kind: "local", token: l.token, name: l.name }, l.info)}>{l.name}</div>)}</div>}
          {shown.map((s) => (
            <div key={s.id} className="ic-group">
              <div className="ic-ghead" onClick={() => toggleSeries(s)}>{open[s.id] !== undefined ? "▾" : "▸"} {s.experiment} · {s.name}</div>
              {open[s.id] === null && <div className="muted small">{t("app.loading")}</div>}
              {(open[s.id] || []).filter((i) => (typeFilter === "all" || (typeFilter === "pdf") === !!i.pdf) && (!ql || i.name.toLowerCase().includes(ql) || `${s.experiment} ${s.name}`.toLowerCase().includes(ql)))
                .map((i) => <div key={(i.pdf ? "p" : "i") + i.id} className="ic-item" title={t("cv.itemTip")}
                  onClick={() => add(i.pdf ? { kind: "pdf", series: s.id, id: i.id, name: i.name } : { kind: "db", series: s.id, id: i.id, name: i.name })}>{i.pdf ? "📄 " : ""}{i.name}</div>)}
            </div>))}
        </aside>
        <div ref={wrap} className="cv-board">
          <canvas ref={cv} onMouseDown={down} onMouseMove={moveM} onMouseUp={up} onMouseLeave={up} onDoubleClick={dbl} onWheel={wheel}
            onContextMenu={(e) => e.preventDefault()} style={{ cursor: tool === "pan" ? "grab" : "crosshair" }} />
          <div className="cv-hint">{t("cv.hint")}</div>
        </div>
      </div>
      {menu.menu}
      {textAt && <Modal title={t("ic.annotation")} onClose={() => setTextAt(null)}>
        <textarea rows={4} autoFocus value={textVal} placeholder={t("ic.text")} onChange={(e) => setTextVal(e.target.value)} />
        <div className="modal-buttons"><button className="btn-plain" onClick={() => setTextAt(null)}>{t("sc.cancel")}</button>
          <button className="btn-green" disabled={!textVal.trim()} onClick={() => { change({ ...st, annos: [...st.annos, { tool: "text", color, size, text: textVal.trim(), points: [textAt] }] }); setTextAt(null); setTextVal(""); }}>{t("sc.ok")}</button></div>
      </Modal>}
    </div>
  );
}
