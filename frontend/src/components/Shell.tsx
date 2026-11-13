import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api, img, type Me, type Nav, type NavItem } from "../api";
import { LangFlags, useI18n } from "../i18n";
import { HelpHost, openHelp } from "./Help";
import Bell from "./Notifications";
import { openQuickSearch, QuickSearchHost, RecentMenu, ScreenLog } from "./QuickSearch";
import { openWhatsNew, WhatsNewHost } from "./WhatsNew";

const COLLAPSE_KEY = "tripplet.sidebar.closed";
const NARROW_KEY = "tripplet.sidebar.narrow";

function loadClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]");
  } catch {
    return [];
  }
}

function Item({ it }: { it: NavItem }) {
  const { t } = useI18n();
  const label = t(`nav.${it.route}`) === `nav.${it.route}` ? it.label : t(`nav.${it.route}`);
  if (it.route === "/help") {
    // desktop: the sidebar "Help" opens the search window (also F1), it is not a screen
    return (
      <button type="button" className="sb-item sb-btn" onClick={() => openHelp()} title={label}>
        {it.icon ? <img src={img(it.icon)} alt="" /> : <span className="sb-dot" />}
        <span className="sb-label">{label}</span>
      </button>
    );
  }
  return (
    <NavLink to={it.route} end className={({ isActive }) => "sb-item" + (isActive ? " active" : "") + (it.web ? "" : " soon")}
      title={it.web ? label : `${label} – ${t("sb.notYet")}`}>
      {it.icon ? <img src={img(it.icon)} alt="" /> : <span className="sb-dot" />}
      <span className="sb-label">{label}</span>
      {it.badge > 0 && <span className="sb-badge">{it.badge > 9 ? "9+" : it.badge}</span>}
    </NavLink>
  );
}

export default function Shell({ me, onLogout, children }: { me: Me; onLogout: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const [nav, setNav] = useState<Nav | null>(null);
  const [closed, setClosed] = useState<string[]>(loadClosed);
  // click on the TrippleT logo = sidebar narrow (icons only) / wide, like the desktop
  const [narrow, setNarrow] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NARROW_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleNarrow = () => {
    setNarrow((v) => {
      try {
        localStorage.setItem(NARROW_KEY, v ? "0" : "1");
      } catch {
        /* storage blocked */
      }
      return !v;
    });
  };

  useEffect(() => {
    api.nav().then(setNav).catch(() => setNav({ pinned: [], sections: [] }));
  }, [me.user.id]);

  useEffect(() => {
    if (me.user.accent_colour) document.documentElement.style.setProperty("--accent", me.user.accent_colour);
  }, [me.user.accent_colour]);

  // badges change when cards move - pages announce it with this event
  useEffect(() => {
    const reload = () => api.nav().then(setNav).catch(() => undefined);
    window.addEventListener("tripplet:nav-changed", reload);
    return () => window.removeEventListener("tripplet:nav-changed", reload);
  }, []);

  const toggle = (title: string) => {
    const next = closed.includes(title) ? closed.filter((x) => x !== title) : [...closed, title];
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
      <aside className={"sidebar" + (narrow ? " narrow" : "")}>
        <button type="button" className="sb-brand" onClick={toggleNarrow} title={narrow ? t("sb.expand") : t("sb.collapse")}>
          <img className="sb-logo" src={img("tricolour.png")} alt="TrippleT" />
          <div>
            <div className="sb-brand-title">TrippleT</div>
            <div className="sb-brand-sub">HEBERLEIN · WEB {me.version}</div>
          </div>
        </button>
        {me.mode !== "prod" && <div className="sb-env">{me.mode.toUpperCase()} · {me.db}</div>}
        <nav className="sb-scroll">
          {nav?.pinned.map((it) => <Item key={it.key} it={it} />)}
          {nav && (<>
            <button type="button" className="sb-item sb-btn" onClick={openQuickSearch} title={t("qsr.title") + " (Ctrl+F)"}>
              <img src={img("quick_Search.png")} alt="" /><span className="sb-label">{t("qsr.title")} (Ctrl+F)</span>
            </button>
            <RecentMenu label={t("recent.title")} icon={img("recent.png")} />
          </>)}
          {nav?.sections.map((s) => {
            const isClosed = closed.includes(s.title);
            return (
              <div key={s.title} className="sb-section">
                <button className="sb-section-head" onClick={() => toggle(s.title)}>
                  <img src={img(s.icon)} alt="" />
                  <span>{t(`sec.${s.title}`)}</span>
                  <span className="sb-caret">{isClosed ? "▸" : "▾"}</span>
                </button>
                {!isClosed && s.items.map((it) => <Item key={it.key} it={it} />)}
              </div>
            );
          })}
        </nav>
        <div className="sb-account">
          <div className="sb-account-row">
            <div className="sb-user" title={me.user.access_right ?? ""}>
              <img src={img("user_white.png")} alt="" />
              <span>{name}</span>
            </div>
            <button type="button" className="sb-bell" title="Fresh off the Spool" onClick={openWhatsNew}>🧵</button>
            <Bell />
            <NavLink className="sb-settings" to="/settings" title={t("sb.settings")}>⚙</NavLink>
            <button className="sb-logout" onClick={onLogout}>{t("sb.logout")}</button>
          </div>
          <LangFlags className="sb-flags" />
        </div>
      </aside>
      <main className="content">{children}</main>
      <HelpHost />
      <QuickSearchHost />
      <ScreenLog />
      <WhatsNewHost />
    </div>
  );
}
