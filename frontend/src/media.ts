import { useEffect, useState } from "react";

/* Tablet & mobile (MOBILE.md): the same widths as src/responsive.css. Layout lives in CSS; components ask
   useMedia() only where something must WORK differently on a phone/tablet (drawer, cards instead of tables...). */
export const PHONE = "(max-width: 599px)";
export const TABLET = "(max-width: 1024px)"; // phone + tablet = sidebar becomes a drawer
export const TOUCH = "(pointer: coarse)";

/* Tools that make no sense on a phone screen (user 2026-11-18): not in the phone sidebar, and opened anyway
   (link, bookmark) they show "open it on a PC or tablet" (PcOnly in pages/NotYet.tsx). Tablet keeps them. */
export const PHONE_HIDDEN = ["/tools/image-compare", "/tools/canvas", "/tools/smart-chart", "/tools/label-generator",
  "/tools/tdms-inspector"];

export function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setHit(m.matches);
    on();
    m.addEventListener("change", on);
    window.addEventListener("resize", on);    // also on resize (some browsers/emulators skip the change event)
    return () => { m.removeEventListener("change", on); window.removeEventListener("resize", on); };
  }, [query]);
  return hit;
}

/* Touch (finger is the main pointer) - asked at the moment of the tap. Lists that open with a double click on the
   PC (Backlog cards, All Experiments, My Requests) open with ONE tap on touch: phones send no reliable dblclick. */
export function isTouch(): boolean {
  return typeof window !== "undefined" && window.matchMedia(TOUCH).matches;
}

/* A tap on a button/link/field inside a row is that control's, not "open the row". */
export function tapOnControl(e: { target: EventTarget | null }): boolean {
  return e.target instanceof Element && !!e.target.closest("button, a, input, select, textarea, label, [role=button]");
}

/* Long press = right click, everywhere. Android Chrome fires "contextmenu" on a long press by itself; iOS Safari
   does not - there a held finger (500 ms, not moved) sends a synthetic "contextmenu" to the element under it, so
   every existing onContextMenu menu (Backlog cards, trial columns, tables...) works on touch without changes. */
let installed = false;
export function installLongPress() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  let timer = 0, x = 0, y = 0, target: EventTarget | null = null, nativeFired = false;
  const clear = () => { if (timer) window.clearTimeout(timer); timer = 0; };
  window.addEventListener("touchstart", (e) => {
    clear();
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    x = t.clientX; y = t.clientY; target = e.target; nativeFired = false;
    timer = window.setTimeout(() => {
      timer = 0;
      if (nativeFired || !(target instanceof Element) || !target.isConnected) return;
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    }, 500);
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t && Math.hypot(t.clientX - x, t.clientY - y) > 10) clear();
  }, { passive: true });
  window.addEventListener("touchend", clear, { passive: true });
  window.addEventListener("touchcancel", clear, { passive: true });
  window.addEventListener("contextmenu", (e) => { if (e.isTrusted) { nativeFired = true; clear(); } }, true);
}
