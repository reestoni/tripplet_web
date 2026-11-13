import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api, img, type Me, type Nav, type NavItem } from "../api";

const COLLAPSE_KEY = "tripplet.sidebar.closed";

function loadClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]");
  } catch {
    return [];
  }
}

function Item({ it }: { it: NavItem }) {
  return (
    <NavLink to={it.route} end className={({ isActive }) => "sb-item" + (isActive ? " active" : "") + (it.web ? "" : " soon")}
      title={it.web ? it.label : `${it.label} – not in the web version yet`}>
      {it.icon ? <img src={img(it.icon)} alt="" /> : <span className="sb-dot" />}
      <span className="sb-label">{it.label}</span>
      {it.badge > 0 && <span className="sb-badge">{it.badge > 9 ? "9+" : it.badge}</span>}
    </NavLink>
  );
}

export default function Shell({ me, onLogout, children }: { me: Me; onLogout: () => void; children: ReactNode }) {
  const [nav, setNav] = useState<Nav | null>(null);
  const [closed, setClosed] = useState<string[]>(loadClosed);

  useEffect(() => {
    api.nav().then(setNav).catch(() => setNav({ pinned: [], sections: [] }));
  }, [me.user.id]);

  useEffect(() => {
    if (me.user.accent_colour) document.documentElement.style.setProperty("--accent", me.user.accent_colour);
  }, [me.user.accent_colour]);

  const toggle = (title: string) => {
    const next = closed.includes(title) ? closed.filter((t) => t !== title) : [...closed, title];
    setClosed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    } catch {
      /* private window */
    }
  };

  const name = [me.user.first_name, me.user.last_name].filter(Boolean).join(" ") || me.user.username;

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="sb-brand">
          <img src={img("logo-heberlein-weiss.png")} alt="Heberlein" />
          <div>
            <div className="sb-brand-title">TrippleT</div>
            <div className="sb-brand-sub">WEB · {me.version}</div>
          </div>
        </NavLink>
        {me.mode !== "prod" && <div className="sb-env">{me.mode.toUpperCase()} · {me.db}</div>}
        <nav className="sb-scroll">
          {nav?.pinned.map((it) => <Item key={it.key} it={it} />)}
          {nav?.sections.map((s) => {
            const isClosed = closed.includes(s.title);
            return (
              <div key={s.title} className="sb-section">
                <button className="sb-section-head" onClick={() => toggle(s.title)}>
                  <img src={img(s.icon)} alt="" />
                  <span>{s.title}</span>
                  <span className="sb-caret">{isClosed ? "▸" : "▾"}</span>
                </button>
                {!isClosed && s.items.map((it) => <Item key={it.key} it={it} />)}
              </div>
            );
          })}
        </nav>
        <div className="sb-account">
          <div className="sb-user" title={me.user.access_right ?? ""}>
            <img src={img("user_white.png")} alt="" />
            <span>{name}</span>
          </div>
          <button className="sb-logout" onClick={onLogout}>Log Out</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
