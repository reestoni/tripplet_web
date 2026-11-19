import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/* Touch replacement for hover tooltips (MOBILE.md): a finger has no hover, so the browser never shows `title` and
   EditCell's quick tooltip box (jet / spool details, housing picture) never opens. A TAP on a table cell or header
   (td / th, or anything with data-tip) opens the same text in a box below it; tapping anywhere else (also the box)
   closes it. Only for finger/pen taps - the mouse keeps the normal hover tooltips, the PC view is unchanged.

   Read in the CAPTURE phase: the tap may also open the cell editor, and React then re-renders the same <td>
   without its title - the text is taken before that. */

type Tip = { el: Element; text: string; img?: string };

const CONTROLS = "button, a, input, select, textarea, label, [role=button]";

function tipOf(el: HTMLElement): { text: string; img?: string } | null {
  const own = el.dataset.tip ?? "";
  const title = el.getAttribute("title") ?? "";
  // a title that only repeats what the cell already shows (e.g. column names) is no help
  const extra = title && title.trim() !== el.innerText.trim() ? title : "";
  const text = [own, extra].filter(Boolean).join("\n\n");
  const img = el.dataset.tipImg || undefined;
  return text || img ? { text, img } : null;
}

export default function TapTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const location = useLocation();

  useEffect(() => { setTip(null); }, [location.pathname, location.search]);

  useEffect(() => {
    let pointer = "mouse";
    const onDown = (e: PointerEvent) => { pointer = e.pointerType; };
    const onClick = (e: MouseEvent) => {
      if (pointer !== "touch" && pointer !== "pen") return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const cell = target && !target.closest(CONTROLS) ? target.closest<HTMLElement>("td, th, [data-tip]") : null;
      const found = cell ? tipOf(cell) : null;
      if (!cell || !found) { if (tipRef.current) setTip(null); return; }
      // same cell again: a read-only cell closes its box, an editable one (editor opened) keeps it
      if (tipRef.current?.el === cell && !cell.classList.contains("editable")) { setTip(null); return; }
      setTip({ el: cell, ...found });
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  // below the cell, above it when there is no room; follows the cell while the table scrolls
  useLayoutEffect(() => {
    if (!tip) { setPos(null); return; }
    const place = () => {
      if (!tip.el.isConnected) { setTip(null); return; }
      const r = tip.el.getBoundingClientRect();
      const w = box.current?.offsetWidth ?? 280, h = box.current?.offsetHeight ?? 120;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = r.bottom + 6;
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
      setPos({ left, top });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className="hover-pop tap-tip" role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 8, top: 8, visibility: "hidden" }}>
      {tip.text && <pre className="hover-tip">{tip.text}</pre>}
      {tip.img && <img className="hover-img" src={tip.img} alt="" onLoad={() => setTip((t) => (t ? { ...t } : t))} />}
    </div>
  );
}
