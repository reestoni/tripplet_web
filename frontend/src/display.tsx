import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { request } from "./api";

/* The user's display settings for the tables (desktop ui/display_prefs.py, stored in tblUser.DisplaySettings via
   backend/app/settings_api.py - same values as the desktop): high contrast, crosshair, reading bar, warning
   symbols, colour-blind friendly colours, table zoom (Ctrl + mouse wheel on a table).
   Applied as classes on <body> and the CSS variable --tscale; crosshair + reading bar follow the selected cell
   (event "tripplet:cell-focus" from edit.tsx). */

export type DisplayPrefs = { contrast: boolean; crosshair: boolean; readbar: boolean; alert_marks: boolean;
  cb_colours: boolean; app_scale: number; scale: number; start?: string };

type Ctx = { prefs: DisplayPrefs; set: (p: Partial<DisplayPrefs>, persist?: boolean) => void; read: string | null };
const DisplayCtx = createContext<Ctx | null>(null);
export const useDisplay = () => useContext(DisplayCtx);

const SCALE_MIN = 80, SCALE_MAX = 300, SCALE_STEP = 10;

/** Header text of a body cell: every header row covering its column (rowSpan / colSpan aware). */
function headerText(td: HTMLTableCellElement): string {
  const table = td.closest("table");
  if (!table || !table.tHead) return "";
  const col = td.cellIndex;
  const parts: string[] = [];
  const carry: number[] = [];      // columns taken by rowSpan cells of earlier rows
  Array.from(table.tHead.rows).forEach((row, ri) => {
    let pos = 0;
    for (const cell of Array.from(row.cells)) {
      while (carry.includes(pos) && ri > 0) pos++;
      const span = cell.colSpan || 1;
      if (cell.rowSpan > 1) for (let k = 0; k < span; k++) carry.push(pos + k);
      if (col >= pos && col < pos + span && cell.innerText.trim() && !(ri > 0 && cell.rowSpan > 1)) parts.push(cell.innerText.trim());
      pos += span;
    }
  });
  return parts.filter((x, i) => parts.indexOf(x) === i).join(" · ");
}

export function DisplayProvider({ initial, children }: { initial: DisplayPrefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState<DisplayPrefs>(initial);
  const [read, setRead] = useState<string | null>(null);
  const saveT = useRef<number | null>(null);
  const focus = useRef<HTMLTableCellElement | null>(null);

  const set = useCallback((p: Partial<DisplayPrefs>, persist = true) => {
    setPrefs((cur) => ({ ...cur, ...p }));
    if (!persist) return;
    if (saveT.current) window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => { request("POST", "/api/settings/prefs", { prefs: p }).catch(() => undefined); }, 400);
  }, []);

  // body classes + table zoom
  useEffect(() => {
    const b = document.body.classList;
    b.toggle("pv-contrast", prefs.contrast);
    b.toggle("pv-marks", prefs.alert_marks);
    b.toggle("pv-cb", prefs.cb_colours);
    document.documentElement.style.setProperty("--tscale", String((prefs.scale || 100) / 100));
  }, [prefs]);

  // crosshair (row + column of the selected cell) via a generated style rule, reading bar text
  const paint = useCallback(() => {
    let st = document.getElementById("xh-style") as HTMLStyleElement | null;
    if (!st) { st = document.createElement("style"); st.id = "xh-style"; document.head.appendChild(st); }
    document.querySelectorAll("table[data-xh]").forEach((t) => t.removeAttribute("data-xh"));
    const td = focus.current;
    if (!td || !document.body.contains(td)) { st.textContent = ""; setRead(null); return; }
    const table = td.closest("table");
    const tr = td.parentElement as HTMLTableRowElement | null;
    if (prefs.crosshair && table && tr && tr.parentElement) {
      table.setAttribute("data-xh", "1");
      const row = Array.from(tr.parentElement.children).indexOf(tr) + 1;
      const col = td.cellIndex + 1;
      st.textContent = `table[data-xh] tbody tr:nth-child(${row}) > *, table[data-xh] tbody tr > *:nth-child(${col}) { box-shadow: inset 0 0 0 9999px var(--xh-colour); }`;
    } else st.textContent = "";
    if (prefs.readbar && tr) {
      const title = (tr.querySelector("th") as HTMLElement | null)?.innerText.trim() ?? "";
      const head = headerText(td);
      const warn = td.classList.contains("red") || td.classList.contains("orange");
      setRead(`${head ? head + " · " : ""}${title} = ${td.innerText.trim() || "–"}${warn ? "  ⚠" : ""}`);
    } else setRead(null);
  }, [prefs.crosshair, prefs.readbar]);

  useEffect(() => {
    const onFocus = (e: Event) => { focus.current = (e as CustomEvent<HTMLTableCellElement>).detail; paint(); };
    window.addEventListener("tripplet:cell-focus", onFocus);
    paint();
    return () => window.removeEventListener("tripplet:cell-focus", onFocus);
  }, [paint]);

  // Ctrl + mouse wheel on a table = table zoom (desktop FrozenFirstColumnTable), saved per user
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (!(e.target as HTMLElement | null)?.closest?.("table.pivot")) return;
      e.preventDefault();
      setPrefs((cur) => {
        const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, (cur.scale || 100) + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP)));
        if (scale !== cur.scale) {
          if (saveT.current) window.clearTimeout(saveT.current);
          saveT.current = window.setTimeout(() => { request("POST", "/api/settings/prefs", { prefs: { scale } }).catch(() => undefined); }, 500);
        }
        return { ...cur, scale };
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <DisplayCtx.Provider value={{ prefs, set, read }}>
      {children}
      {read && <div className="readbar" title="">{read}</div>}
    </DisplayCtx.Provider>
  );
}
