import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RME, type ReactNode } from "react";

/* Right-click menus like the desktop (QMenu): items, separators, sub menus, disabled entries
   with a reason as tooltip. Closes on click outside, Escape, scroll and window resize. */

export type MenuItem =
  | { sep: true }
  | { label: string; onClick?: () => void; disabled?: boolean; title?: string; sub?: MenuItem[]; danger?: boolean };

type Open = { x: number; y: number; items: MenuItem[] };

export function useContextMenu(): { open: (e: RME | MouseEvent, items: MenuItem[]) => void; menu: ReactNode } {
  const [state, setState] = useState<Open | null>(null);
  const open = useCallback((e: RME | MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (items.length) setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  const close = useCallback(() => setState(null), []);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [state, close]);
  const menu = state ? (
    <div className="cm-back" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <MenuList items={state.items} x={state.x} y={state.y} close={close} />
    </div>
  ) : null;
  return { open, menu };
}

function MenuList({ items, x, y, close }: { items: MenuItem[]; x: number; y: number; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  // keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);
  return (
    <div ref={ref} className="cm" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()} role="menu">
      {items.map((it, i) => {
        if ("sep" in it) return <div key={i} className="cm-sep" />;
        return (
          <button key={i} role="menuitem" className={"cm-item" + (it.danger ? " danger" : "") + (it.sub ? " has-sub" : "")}
            disabled={it.disabled} title={it.title}
            onMouseEnter={(e) => {
              if (it.sub && !it.disabled) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setSub({ i, x: r.right - 2, y: r.top - 4 });
              } else setSub(null);
            }}
            onClick={(e) => {
              // touch has no hover: a tap on an entry with a sub menu opens (or closes) it
              if (it.sub) {
                if (it.disabled) return;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setSub((cur) => (cur?.i === i ? null : { i, x: r.right - 2, y: r.top - 4 }));
                return;
              }
              close();
              it.onClick?.();
            }}>
            {it.label}
            {it.sub && <span className="cm-arrow">▸</span>}
          </button>
        );
      })}
      {sub && "sub" in items[sub.i] && (items[sub.i] as { sub?: MenuItem[] }).sub && (
        <MenuList items={(items[sub.i] as { sub: MenuItem[] }).sub} x={sub.x} y={sub.y} close={close} />
      )}
    </div>
  );
}
