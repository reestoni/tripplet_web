import { useEffect, useState } from "react";

/* Tablet & mobile (MOBILE.md): the same widths as src/responsive.css. Layout lives in CSS; components ask
   useMedia() only where something must WORK differently on a phone/tablet (drawer, cards instead of tables...). */
export const PHONE = "(max-width: 599px)";
export const TABLET = "(max-width: 1024px)"; // phone + tablet = sidebar becomes a drawer
export const TOUCH = "(pointer: coarse)";

export function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setHit(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return hit;
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
