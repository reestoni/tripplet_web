import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";
import { useContextMenu } from "../components/ContextMenu";
import { boardLink, copyText } from "../links";
import { COLORS, drawAnno, MARKERS, SIZES, TOOLS, type Anno } from "./ImageCompare";

/* Canvas (desktop ui/screen_canvas.py): a free board for several images / documents (series images and PDFs or
   files from this computer, rendered by the server - ui/doc_render.py), moved / scaled / rotated, plus the
   annotation tools of Image Compare, background colour, grid, undo (10) and PNG export.
   Boards are stored in the database (db/canvas_boards.py via /api/canvas/boards, shared with the desktop): optional
   series, autosave, version check (409 = someone else saved in between). ?board=<id> opens one, ?series=<id> shows
   the boards of that series and ties new boards to it. Item geometry = board format: centre, shown size, angle. */

type Src = { kind: "series_image"; series: number; id: number } | { kind: "series_pdf"; series: number; id: number }
  | { kind: "file"; file: string } | { kind: "upload"; token: string; name: string } | { kind: "clip"; data: string };
type Info = { kind: string; pages?: number; sheets?: string[]; channels?: { key: string; label: string }[] };
type Item = { id: string; label: string; src: Src; info: Info | null; page: number; sheet: number; channel: string;
  cx: number; cy: number; w: number; h: number; angle: number };
type State = { items: Item[]; annos: Anno[]; bg: string };
type View = { x: number; y: number; z: number };
type Series = { id: number; name: string; experiment: string; has_images: boolean; has_pdfs: boolean };
type Entry = { id: number; name: string; pdf?: boolean };
type BoardRow = { id: number; title: string; series_id: number | null; series: string; experiment: string; version: number;
  created_by_name: string; updated_by_name: string; updated: string };
type Board = { id: number | null; title: string; series_id: number | null; version: number; can_edit: boolean; can_delete: boolean;
  updated_by_name?: string; updated?: string };
const UNDO = 10;
const AUTOSAVE_MS = 4000;
const key = () => Math.random().toString(36).slice(2, 10);
const NEW_BOARD: Board = { id: null, title: "", series_id: null, version: 0, can_edit: true, can_delete: false };

function url(it: Item, boardId: number | null): string {
  const s = it.src;
  if (s.kind === "clip") return s.data;
  const q = `?page=${it.page}&sheet=${it.sheet}&channel=${encodeURIComponent(it.channel)}`;
  if (s.kind === "series_image") return `/api/image-compare/series/${s.series}/images/${s.id}/file${q}`;
  if (s.kind === "series_pdf") return `/api/image-compare/series/${s.series}/pdfs/${s.id}/file${q}`;
  if (s.kind === "file") return `/api/canvas/boards/${boardId}/files/${encodeURIComponent(s.file)}${q}`;
  return `/api/image-compare/local/${s.token}/file${q}`;
}
function infoUrl(it: Item, boardId: number | null): string | null {
  const s = it.src;
  if (s.kind === "series_image") return `/api/image-compare/series/${s.series}/images/${s.id}/info`;
  if (s.kind === "series_pdf") return `/api/image-compare/series/${s.series}/pdfs/${s.id}/info`;
  if (s.kind === "file" && boardId) return `/api/canvas/boards/${boardId}/files/${encodeURIComponent(s.file)}/info`;
  return null;
}
const loadImage = (u: string) => new Promise<HTMLImageElement | null>((res) => {
  const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = u;
});
// the document the server stores (info is only for this page)
const toDoc = (s: State) => ({ format: "tripplet-board", version: 1, bg: s.bg, annos: s.annos,
  items: s.items.map(({ info: _i, ...rest }) => rest) });

export default function Canvas() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const ctxSeries = Number(params.get("series")) || null;
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
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  useEffect(() => { if (!linkMsg) return; const h = window.setTimeout(() => setLinkMsg(null), 2500); return () => window.clearTimeout(h); }, [linkMsg]);
  const [textAt, setTextAt] = useState<[number, number] | null>(null), [textVal, setTextVal] = useState("");
  // board (database)
  const [board, setBoard] = useState<Board>({ ...NEW_BOARD, series_id: ctxSeries });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [conflict, setConflict] = useState<{ by: string } | null>(null);
  const [boardsReady, setBoardsReady] = useState(true);
  const [picker, setPicker] = useState<BoardRow[] | null>(null), [pickAll, setPickAll] = useState(!ctxSeries);
  const [askTitle, setAskTitle] = useState<null | "new" | "copy">(null), [titleVal, setTitleVal] = useState("");
  const [tieSeries, setTieSeries] = useState(true);
  const cv = useRef<HTMLCanvasElement | null>(null), wrap = useRef<HTMLDivElement | null>(null);
  const imgs = useRef<Record<string, HTMLImageElement>>({});
  const [, force] = useState(0);
  const cur = useRef<Anno | null>(null);
  const drag = useRef<{ mode: string; x: number; y: number; vx?: number; vy?: number; moved?: boolean; start?: Record<string, [number, number]>; anno?: Anno } | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null), projIn = useRef<HTMLInputElement | null>(null);
  const menu = useContextMenu();
  const boardId = board.id;

  useEffect(() => { request<{ series: Series[] }>("GET", "/api/image-compare/canvas-series").then((d) => setSeries(d.series)).catch((e) => setMsg(String(e))); }, []);
  useEffect(() => {
    st.items.forEach((it) => {
      const u = url(it, boardId);
      if (imgs.current[u]) return;
      const im = new Image();
      im.onload = () => force((n) => n + 1);
      im.onerror = () => setMsg(t("ic.unreadable"));
      im.src = u;
      imgs.current[u] = im;
    });
  }, [st.items, boardId, t]);

  const push = useCallback((prev: State) => setUndo((u) => [...u, JSON.stringify(prev)].slice(-UNDO)), []);
  const change = (next: State, withUndo = true) => { if (withUndo) push(st); setSt(next); setDirty(true); };
  const bitmap = (it: Item) => { const im = imgs.current[url(it, boardId)]; return im && im.complete && im.naturalWidth ? im : null; };
  const toBoard = (cx: number, cy: number): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z];
  };
  const inside = (it: Item, p: [number, number]) => {
    const a = (-it.angle * Math.PI) / 180, dx = p[0] - it.cx, dy = p[1] - it.cy;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(rx) <= it.w / 2 && Math.abs(ry) <= it.h / 2;
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
      const im = bitmap(it);
      g.save();
      g.translate(it.cx, it.cy);
      g.rotate((it.angle * Math.PI) / 180);
      if (im) g.drawImage(im, -it.w / 2, -it.h / 2, it.w, it.h); else { g.fillStyle = "#333"; g.fillRect(-it.w / 2, -it.h / 2, it.w, it.h); }
      const bar = Math.min(20, it.h / 4);
      g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(-it.w / 2, -it.h / 2, it.w, bar);
      g.fillStyle = "#ddd"; g.font = `${Math.max(6, bar * 0.6)}px Segoe UI`; g.textBaseline = "middle"; g.fillText(it.label, -it.w / 2 + 4, -it.h / 2 + bar / 2);
      if (!forExport && sel.includes(it.id)) { g.strokeStyle = "#39A650"; g.lineWidth = 3 / v.z; g.strokeRect(-it.w / 2, -it.h / 2, it.w, it.h); }
      g.restore();
    });
    [...st.annos, ...(cur.current ? [cur.current] : [])].forEach((a) => drawAnno(g, a, (p) => p));
    g.restore();
  }, [st, grid, divs, sel, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---------------------------------------------------------------- boards
  const bounds = useCallback((s: State) => {
    const xs: number[] = [], ys: number[] = [];
    s.items.forEach((it) => { const d = Math.hypot(it.w, it.h) / 2; xs.push(it.cx - d, it.cx + d); ys.push(it.cy - d, it.cy + d); });
    s.annos.forEach((a) => a.points.forEach(([x, y]) => { xs.push(x); ys.push(y + 30); }));
    if (!xs.length) return { x: -400, y: -300, w: 800, h: 600 };
    const x = Math.min(...xs) - 20, y = Math.min(...ys) - 20;
    return { x, y, w: Math.max(...xs) + 20 - x, h: Math.max(...ys) + 20 - y };
  }, []);
  const fit = useCallback((s: State) => {
    const b = bounds(s), wr = wrap.current;
    if (!wr) return;
    const z = Math.min(2, Math.min(wr.clientWidth / b.w, wr.clientHeight / b.h));
    setView({ z, x: (wr.clientWidth - b.w * z) / 2 - b.x * z, y: (wr.clientHeight - b.h * z) / 2 - b.y * z });
  }, [bounds]);

  const applyBoard = useCallback(async (id: number) => {
    try {
      const b = await request<{ id: number; title: string; series_id: number | null; version: number; can_edit: boolean; can_delete: boolean;
        updated_by_name: string; updated: string; content: { bg: string; items: Omit<Item, "info">[]; annos: Anno[] } }>("GET", `/api/canvas/boards/${id}`);
      const items: Item[] = await Promise.all(b.content.items.map(async (it) => {
        const base = { ...it, info: null } as Item;
        const iu = infoUrl(base, b.id);
        return { ...base, info: iu ? await request<Info>("GET", iu).catch(() => null) : null };
      }));
      const s = { items, annos: b.content.annos, bg: b.content.bg };
      setSt(s); setUndo([]); setSel([]); setDirty(false); setConflict(null); setSaving("idle");
      setBoard({ id: b.id, title: b.title, series_id: b.series_id, version: b.version, can_edit: b.can_edit, can_delete: b.can_delete,
        updated_by_name: b.updated_by_name, updated: b.updated });
      setTimeout(() => fit(s), 30);
    } catch (e) {
      setMsg(e instanceof ApiError && e.code ? t(`cv.err.${e.code}`) : String(e));
    }
  }, [fit, t]);

  const listBoards = useCallback((all: boolean) => {
    request<{ ready: boolean; boards: BoardRow[] }>("GET", `/api/canvas/boards${!all && ctxSeries ? `?series=${ctxSeries}` : ""}`)
      .then((d) => { setBoardsReady(d.ready); setPicker(d.boards); }).catch((e) => setMsg(String(e)));
  }, [ctxSeries]);

  // ?board= opens it, ?series= shows the boards of the series
  useEffect(() => {
    const b = Number(params.get("board"));
    if (b) applyBoard(b);
    else if (ctxSeries) listBoards(false);
    else request<{ ready: boolean }>("GET", "/api/canvas/boards").then((d) => setBoardsReady(d.ready)).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (s: State, b: Board): Promise<boolean> => {
    if (!b.id || !b.can_edit) return false;
    setSaving("saving");
    try {
      const r = await request<{ version: number; content: { items: Omit<Item, "info">[] } | null }>("PUT", `/api/canvas/boards/${b.id}`,
        { content: toDoc(s), version: b.version, title: b.title, series_id: b.series_id });
      // uploads / clipboard pictures became board files: take over the new sources
      if (r.content) {
        const bySrc = new Map(r.content.items.map((x) => [x.id, x.src]));
        setSt((cur2) => ({ ...cur2, items: cur2.items.map((it) => (bySrc.has(it.id) && (it.src.kind === "upload" || it.src.kind === "clip") ? { ...it, src: bySrc.get(it.id)! } : it)) }));
      }
      setBoard((x) => ({ ...x, version: r.version }));
      setDirty(false); setSaving("saved");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") setConflict({ by: String((e.data as { by?: string })?.by || "") });
      else setMsg(e instanceof ApiError && e.code ? t(`cv.err.${e.code}`) : String(e));
      setSaving("error");
      return false;
    }
  }, [t]);

  const createBoard = async (title: string, copy: boolean) => {
    const sid = tieSeries ? (copy ? board.series_id : (board.series_id ?? ctxSeries)) : null;
    try {
      const r = await request<{ id: number; version: number }>("POST", "/api/canvas/boards", { title, series_id: sid, content: toDoc(st) });
      setParams({ board: String(r.id) }, { replace: true });
      await applyBoard(r.id);
    } catch (e) { setMsg(e instanceof ApiError && e.code ? t(`cv.err.${e.code}`) : String(e)); }
  };

  // autosave a few seconds after the last change
  useEffect(() => {
    if (!dirty || !board.id || !board.can_edit || conflict) return;
    const h = setTimeout(() => { save(st, board); }, AUTOSAVE_MS);
    return () => clearTimeout(h);
  }, [st, dirty, board, conflict, save]);
  // unsaved changes: warn when leaving
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const saveNow = () => { if (board.id) save(st, board); else { setTitleVal(""); setTieSeries(!!(board.series_id ?? ctxSeries)); setAskTitle("new"); } };
  const newBoard = () => {
    if (dirty && !window.confirm(t("cv.discardQ"))) return;
    setSt({ items: [], annos: [], bg: "#1e1e1e" }); setUndo([]); setSel([]); setDirty(false); setConflict(null); setSaving("idle");
    setBoard({ ...NEW_BOARD, series_id: ctxSeries });
    setParams(ctxSeries ? { series: String(ctxSeries) } : {}, { replace: true });
    setPicker(null);
  };
  const openBoard = (id: number) => {
    if (dirty && !window.confirm(t("cv.discardQ"))) return;
    setPicker(null);
    setParams({ board: String(id) }, { replace: true });
    applyBoard(id);
  };
  const deleteBoard = async () => {
    if (!board.id || !window.confirm(t("cv.deleteQ", { title: board.title }))) return;
    try { await request("DELETE", `/api/canvas/boards/${board.id}`); setDirty(false); newBoard(); }
    catch (e) { setMsg(e instanceof ApiError && e.code ? t(`cv.err.${e.code}`) : String(e)); }
  };

  // ---------------------------------------------------------------- adding things
  const add = async (src: Src, label: string, info0?: Info) => {
    const base: Item = { id: key(), label, src, info: info0 || null, page: 0, sheet: 0, channel: "", cx: 0, cy: 0, w: 300, h: 225, angle: 0 };
    if (!base.info) { const iu = infoUrl(base, boardId); if (iu) base.info = await request<Info>("GET", iu).catch(() => null); }
    base.channel = base.info?.channels?.[0]?.key || "";
    const im = await loadImage(url(base, boardId));
    if (im) { imgs.current[url(base, boardId)] = im; const s = Math.min(0.5, 900 / Math.max(im.naturalWidth, im.naturalHeight)); base.w = im.naturalWidth * s; base.h = im.naturalHeight * s; }
    const wr = wrap.current!;
    setSt((prev) => {      // functional: several uploads in a row must not overwrite each other
      const n = prev.items.length;
      const it = { ...base, cx: (wr.clientWidth / 2 - view.x) / view.z + (n % 6) * 30, cy: (wr.clientHeight / 2 - view.y) / view.z + (n % 6) * 30 };
      setUndo((u) => [...u, JSON.stringify(prev)].slice(-UNDO));
      return { ...prev, items: [...prev.items, it] };
    });
    setDirty(true);
    setSel([base.id]);
  };
  // page / sheet / channel change: keep the width, take the new aspect ratio
  const setVariant = async (it: Item, p: Partial<Item>) => {
    const next = { ...it, ...p };
    const im = await loadImage(url(next, boardId));
    if (im) { imgs.current[url(next, boardId)] = im; next.h = next.w * im.naturalHeight / im.naturalWidth; }
    change({ ...st, items: st.items.map((i) => (i.id === it.id ? next : i)) });
  };
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      const fd = new FormData(); fd.append("file", f);
      const res = await fetch("/api/image-compare/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) { setMsg(j.code ? t(`ic.err.${j.code}`) : j.detail); continue; }
      const { token, name, ...info } = j;
      setLocals((l) => [...l, { token, name, info }]);
      await add({ kind: "upload", token, name }, name, info as Info);
    }
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const it = Array.from(e.clipboardData?.items || []).find((x) => x.type.startsWith("image/"));
      if (!it || (e.target as HTMLElement).closest("input, textarea")) return;
      const fr = new FileReader();
      fr.onload = () => add({ kind: "clip", data: String(fr.result) }, "clipboard", { kind: "image" });
      fr.readAsDataURL(it.getAsFile()!);
    };
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); return; }
      if ((e.target as HTMLElement).closest("input, textarea, select, .modal")) return;
      if (e.key === "Delete" && sel.length) { change({ ...st, items: st.items.filter((i) => !sel.includes(i.id)) }); setSel([]); }
    };
    window.addEventListener("paste", paste); window.addEventListener("keydown", keys);
    return () => { window.removeEventListener("paste", paste); window.removeEventListener("keydown", keys); };
  });

  // ---------------------------------------------------------------- mouse
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
        const ns = e.ctrlKey ? (sel.includes(it.id) ? sel.filter((k) => k !== it.id) : [...sel, it.id]) : (sel.includes(it.id) ? sel : [it.id]);
        setSel(ns);
        if (ns.includes(it.id)) drag.current = { mode: "items", x: p[0], y: p[1], start: Object.fromEntries(st.items.filter((i) => ns.includes(i.id)).map((i) => [i.id, [i.cx, i.cy]])) };
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
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 1) { push(st); d.moved = true; setDirty(true); }
      setSt((s) => ({ ...s, items: s.items.map((i) => (d.start![i.id] ? { ...i, cx: d.start![i.id][0] + dx, cy: d.start![i.id][1] + dy } : i)) }));
      return;
    }
    if (d?.mode === "erase" && e.buttons & 1) {
      const it = itemAt(p);
      if (it) { change({ ...st, items: st.items.filter((i) => i !== it) }); return; }
      const a = annoAt(p);
      if (a) { setSt((s) => ({ ...s, annos: s.annos.filter((x) => x !== a) })); setDirty(true); }
      return;
    }
    if (d?.mode === "move" && d.anno) {
      const dx = p[0] - d.x, dy = p[1] - d.y;
      const moved = { ...d.anno, points: d.anno.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
      setSt((s) => ({ ...s, annos: s.annos.map((x) => (x === d.anno ? moved : x)) }));
      setDirty(true);
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
      if (it) { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; if (it.w * f >= 10 && it.w * f <= 50000) change({ ...st, items: st.items.map((i) => (i === it ? { ...i, w: i.w * f, h: i.h * f } : i)) }); return; }
      const z = Math.max(0.02, Math.min(50, view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setView({ z, x: e.clientX - r.left - p[0] * z, y: e.clientY - r.top - p[1] * z });
      return;
    }
    if (e.shiftKey) setView({ ...view, x: view.x - e.deltaY }); else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
  };
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const stop = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    c.addEventListener("wheel", stop, { passive: false });
    return () => c.removeEventListener("wheel", stop);
  }, []);

  const savePng = () => {
    const b = bounds(st), out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(b.w)); out.height = Math.max(1, Math.round(b.h));
    const g = out.getContext("2d")!;
    paint(g, out.width, out.height, { x: -b.x, y: -b.y, z: 1 }, true);
    try { const a = document.createElement("a"); a.href = out.toDataURL("image/png"); a.download = `${board.title || "canvas"}.png`; a.click(); } catch { setMsg(t("cv.exportFailed")); }
  };
  // older project files (web .ttcanvas v2: top-left + scale of the natural size) -> board items
  const importProject = async (f: File | undefined) => {
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      const missing: string[] = [];
      const items: Item[] = [];
      for (const im of p.images || p.items || []) {
        const s0 = im.src || im.source;
        const src: Src | null = s0?.kind === "db" ? { kind: "series_image", series: s0.series, id: s0.id }
          : s0?.kind === "pdf" ? { kind: "series_pdf", series: s0.series, id: s0.id }
            : s0?.kind === "series_image" || s0?.kind === "series_pdf" ? s0 : null;
        if (!src) { missing.push(im.label || im.path || "?"); continue; }
        const it: Item = { id: key(), label: im.label || "", src, info: null, page: im.pdf_page || im.page || 0, sheet: im.excel_sheet || im.sheet || 0,
          channel: im.vk4_channel || im.channel || "", cx: im.cx ?? 0, cy: im.cy ?? 0, w: im.w ?? 300, h: im.h ?? 225, angle: im.angle || 0 };
        const iu = infoUrl(it, null);
        it.info = iu ? await request<Info>("GET", iu).catch(() => null) : null;
        if (!it.info) { missing.push(it.label); continue; }
        if (im.cx === undefined) {          // old format: top-left + scale
          const bm = await loadImage(url(it, null));
          const nw = bm?.naturalWidth || 200, nh = bm?.naturalHeight || 150, sc = im.scale || 1;
          it.w = nw * sc; it.h = nh * sc; it.cx = (im.x || 0) + it.w / 2; it.cy = (im.y || 0) + it.h / 2;
        }
        items.push(it);
      }
      const s = { items, annos: p.annotations || p.annos || [], bg: p.bg_color || p.bg || "#1e1e1e" };
      change(s);
      setTimeout(() => fit(s), 30);
      setMsg(missing.length ? t("ic.missing", { names: missing.join(", ") }) : null);
    } catch (e) { setMsg(String(e)); }
  };

  const one = sel.length === 1 ? st.items.find((i) => i.id === sel[0]) : undefined;
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
  // the series of the board (or of the page context) first in the list
  const homeSeries = board.series_id ?? ctxSeries;
  const ordered = homeSeries ? [...shown.filter((s) => s.id === homeSeries), ...shown.filter((s) => s.id !== homeSeries)] : shown;
  const seriesLabel = (id: number | null) => { const s = series.find((x) => x.id === id); return s ? `${s.experiment} · ${s.name}` : id ? `#${id}` : ""; };
  const status = !board.id ? t("cv.notSaved") : saving === "saving" ? t("cv.saving") : dirty ? t("cv.unsaved")
    : t("cv.savedInfo", { v: board.version });

  return (
    <div className="page ic-page">
      <div className="page-head cv-head">
        <h1>{t("cv.title")}</h1>
        {boardsReady && (<>
          <input className="cv-title" value={board.title} placeholder={t("cv.untitled")} disabled={!board.can_edit}
            onChange={(e) => { setBoard({ ...board, title: e.target.value }); if (board.id) setDirty(true); }} />
          {board.series_id && <span className="cv-series" title={t("cv.seriesTip")}>🔬 {seriesLabel(board.series_id)}</span>}
          <span className={"cv-status" + (dirty ? " dirty" : "")}>{status}</span>
          <span style={{ flex: 1 }} />
          <button className="btn-plain" onClick={() => { setPickAll(!ctxSeries); listBoards(!ctxSeries); }}>📋 {t("cv.boards")}</button>
          <button className="btn-plain" onClick={newBoard}>＋ {t("cv.newBoard")}</button>
          {board.can_edit && <button className="btn-green" disabled={saving === "saving" || (!!board.id && !dirty)} onClick={saveNow} title="Ctrl+S">{t("cv.save")}</button>}
          {board.id && board.can_edit && <button className="btn-plain" onClick={() => { setTitleVal(`${board.title} (2)`); setTieSeries(!!board.series_id); setAskTitle("copy"); }}>{t("cv.saveCopy")}</button>}
          {board.id && <button className="btn-plain" title={t("lk.boardTip")}
            onClick={async () => setLinkMsg(t(await copyText(boardLink(board.id!)) ? "lk.copied" : "lk.failed"))}>🔗{linkMsg ? ` ${linkMsg}` : ""}</button>}
          {board.can_delete && <button className="btn-plain mj-danger" onClick={deleteBoard}>🗑</button>}
        </>)}
      </div>
      {!boardsReady && <div className="muted small">{t("cv.noTable")}</div>}
      {board.id && !board.can_edit && <div className="rb-banner">{t("cv.readOnly")}</div>}
      {conflict && (
        <div className="rb-banner">{t("cv.conflict", { by: conflict.by || "?" })}
          <button className="btn-plain" onClick={() => { setDirty(false); board.id && applyBoard(board.id); }}>{t("cv.reload")}</button>
          <button className="btn-plain" onClick={() => { setTitleVal(`${board.title} (2)`); setTieSeries(!!board.series_id); setAskTitle("copy"); }}>{t("cv.saveCopy")}</button>
        </div>)}
      <div className="ic-toolbar">
        {TOOLS.map(([k, ic]) => <button key={k} className={"ic-tool" + (tool === k ? " on" : "")} title={t(k === "pan" ? "cv.toolPan" : `ic.tool.${k}`)} onClick={() => setTool(k)}>{ic}</button>)}
        <span className="ic-sep" />
        {Object.entries(COLORS).map(([k, c]) => <button key={k} className={"ic-col" + (color === k ? " on" : "")} style={{ background: c }} title={t(`ic.c.${k}`)} onClick={() => setColor(k)} />)}
        {SIZES.map(([s2, ic]) => <button key={s2} className={"ic-tool" + (size === s2 ? " on" : "")} title={t(`ic.size${s2}`)} onClick={() => setSize(s2)}>{ic}</button>)}
        <span className="ic-sep" />
        <button className="btn-plain" disabled={!undo.length} title={t("cv.undoTip")} onClick={() => { setSt(JSON.parse(undo[undo.length - 1])); setUndo(undo.slice(0, -1)); setDirty(true); }}>↩ {t("ic.undo")}</button>
        <button className="btn-plain" onClick={() => { if (window.confirm(t("cv.clearQ"))) { change({ ...st, items: [], annos: [] }); setSel([]); } }}>🗑 {t("cv.clear")}</button>
        <button className={"btn-plain" + (grid ? " ic-on" : "")} onClick={() => setGrid(!grid)}>⊞ {t("ic.gridOverlay")}</button>
        <input type="number" min={2} max={50} value={divs} title={t("ic.divisions")} onChange={(e) => setDivs(Math.max(2, Math.min(50, Number(e.target.value))))} />
        <label className="btn-plain cv-bg" title={t("cv.bgTip")}>🎨 <input type="color" value={st.bg} onChange={(e) => change({ ...st, bg: e.target.value })} /></label>
        <span className="ic-sep" />
        <button className="btn-plain" onClick={savePng}>💾 {t("cv.exportPng")}</button>
        <button className="btn-plain" onClick={() => fit(st)}>⌖ {t("cv.reset")}</button>
        <button className="btn-plain" title={t("cv.importTip")} onClick={() => projIn.current?.click()}>📂 {t("cv.import")}</button>
        <input ref={projIn} type="file" accept=".ttcanvas,.json" hidden onChange={(e) => { importProject(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {one?.info && one.info.kind !== "image" && (
        <div className="ic-sub">
          {one.info.kind === "vk4" && (one.info.channels || []).map((ch) => <button key={ch.key} className={"btn-plain" + (one.channel === ch.key ? " ic-on" : "")}
            onClick={() => setVariant(one, { channel: ch.key })}>{ch.label}</button>)}
          {(one.info.kind === "pdf" || one.info.kind === "word") && (one.info.pages || 1) > 1 && <label>{t("ic.page")} <select value={one.page}
            onChange={(e) => setVariant(one, { page: Number(e.target.value) })}>
            {Array.from({ length: one.info.pages || 1 }, (_x, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>}
          {one.info.kind === "excel" && (one.info.sheets || []).length > 1 && <label>{t("ic.sheet")} <select value={one.sheet}
            onChange={(e) => setVariant(one, { sheet: Number(e.target.value) })}>
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
            {locals.map((l) => <div key={l.token} className="ic-item" onClick={() => add({ kind: "upload", token: l.token, name: l.name }, l.name, l.info)}>{l.name}</div>)}</div>}
          {ordered.map((s) => (
            <div key={s.id} className={"ic-group" + (s.id === homeSeries ? " cv-home" : "")}>
              <div className="ic-ghead" onClick={() => toggleSeries(s)}>{open[s.id] !== undefined ? "▾" : "▸"} {s.experiment} · {s.name}</div>
              {open[s.id] === null && <div className="muted small">{t("app.loading")}</div>}
              {(open[s.id] || []).filter((i) => (typeFilter === "all" || (typeFilter === "pdf") === !!i.pdf) && (!ql || i.name.toLowerCase().includes(ql) || `${s.experiment} ${s.name}`.toLowerCase().includes(ql)))
                .map((i) => <div key={(i.pdf ? "p" : "i") + i.id} className="ic-item" title={t("cv.itemTip")}
                  onClick={() => add(i.pdf ? { kind: "series_pdf", series: s.id, id: i.id } : { kind: "series_image", series: s.id, id: i.id }, i.name)}>{i.pdf ? "📄 " : ""}{i.name}</div>)}
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
      {askTitle && <Modal title={t(askTitle === "copy" ? "cv.saveCopy" : "cv.saveNew")} onClose={() => setAskTitle(null)}>
        <label className="cv-field">{t("cv.titleLabel")}<input autoFocus value={titleVal} maxLength={200} onChange={(e) => setTitleVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && titleVal.trim()) { setAskTitle(null); createBoard(titleVal.trim(), askTitle === "copy"); } }} /></label>
        {(askTitle === "copy" ? board.series_id : (board.series_id ?? ctxSeries)) && <label className="cv-check"><input type="checkbox" checked={tieSeries} onChange={(e) => setTieSeries(e.target.checked)} />
          {t("cv.tieSeries", { s: seriesLabel(askTitle === "copy" ? board.series_id : (board.series_id ?? ctxSeries)) })}</label>}
        <p className="muted small">{t("cv.sharedHint")}</p>
        <div className="modal-buttons"><button className="btn-plain" onClick={() => setAskTitle(null)}>{t("sc.cancel")}</button>
          <button className="btn-green" disabled={!titleVal.trim()} onClick={() => { setAskTitle(null); createBoard(titleVal.trim(), askTitle === "copy"); }}>{t("cv.save")}</button></div>
      </Modal>}
      {picker && <Modal title={t("cv.boards")} wide onClose={() => setPicker(null)}>
        {ctxSeries && <div className="ic-actions">
          <button className={"btn-plain" + (!pickAll ? " ic-on" : "")} onClick={() => { setPickAll(false); listBoards(false); }}>{t("cv.thisSeries", { s: seriesLabel(ctxSeries) })}</button>
          <button className={"btn-plain" + (pickAll ? " ic-on" : "")} onClick={() => { setPickAll(true); listBoards(true); }}>{t("cv.allBoards")}</button></div>}
        {!picker.length ? <p className="muted">{t("cv.noBoards")}</p> : (
          <div className="cv-boards">
            <table className="mj-table"><thead><tr><th>{t("cv.titleLabel")}</th><th>{t("cv.seriesCol")}</th><th>{t("cv.changed")}</th><th>{t("cv.createdBy")}</th></tr></thead>
              <tbody>{picker.map((b) => (
                <tr key={b.id} className={"cv-row" + (b.id === board.id ? " on" : "")} onClick={() => openBoard(b.id)}>
                  <td><b>{b.title}</b></td><td>{b.series_id ? `${b.experiment} · ${b.series}` : "–"}</td>
                  <td>{b.updated}{b.updated_by_name ? ` · ${b.updated_by_name}` : ""}</td><td>{b.created_by_name}</td></tr>))}</tbody></table>
          </div>)}
        <div className="modal-buttons"><button className="btn-plain" onClick={() => setPicker(null)}>{t("sc.cancel")}</button>
          <button className="btn-green" onClick={newBoard}>＋ {t("cv.newBoard")}</button></div>
      </Modal>}
    </div>
  );
}
