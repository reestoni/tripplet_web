import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, img, type Me, type Nav, type NavItem } from "../api";
import { LangFlags, useI18n } from "../i18n";
import { LOGO } from "../brand";
import { HelpHost, openHelp } from "./Help";
import Bell from "./Notifications";
import { openQuickSearch, QuickSearchHost, RecentMenu, ScreenLog } from "./QuickSearch";
import { openWhatsNew, WhatsNewHost } from "./WhatsNew";
import { IconBook, IconChevron, IconClock, IconGear, IconHelp, IconLogout, IconSearch, IconSpark } from "./SidebarIcons";

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

/* Account card at the bottom: initials + full name (+ access right); click = menu with settings, language, log out. */
function UserMenu({ me, name, onLogout }: { me: Me; name: string; onLogout: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const [ver, setVer] = useState(me.avatar ?? 0);
  useEffect(() => {
    const on = (e: Event) => setVer(Number((e as CustomEvent).detail) || 0);
    window.addEventListener("tripplet:avatar", on);
    return () => window.removeEventListener("tripplet:avatar", on);
  }, []);
  const initials = ([me.user.first_name?.[0], me.user.last_name?.[0]].filter(Boolean).join("") || me.user.username.slice(0, 2)).toUpperCase();
  return (
    <div className="sb-me" ref={box}>
      {open && (
        <div className="sb-me-menu" role="menu">
          <div className="sb-me-head"><b>{name}</b><span className="muted">{me.user.username}{me.user.access_right ? ` · ${me.user.access_right}` : ""}</span></div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate("/settings"); }}><IconGear />{t("sb.settings")}</button>
          <div className="sb-me-lang"><span>{t("app.language")}</span><LangFlags /></div>
          <button type="button" role="menuitem" className="sb-me-out" onClick={onLogout}><IconLogout />{t("sb.logout")}</button>
        </div>
      )}
      <button type="button" className={"sb-me-btn" + (open ? " on" : "")} onClick={() => setOpen(!open)} title={name} aria-haspopup="menu" aria-expanded={open}>
        {ver ? <img className="sb-avatar" src={`/api/avatar/${me.user.id}?v=${ver}`} alt="" /> : <span className="sb-avatar">{initials}</span>}
        <span className="sb-me-text"><span className="sb-me-name">{name}</span>{me.user.access_right && <span className="sb-me-role">{me.user.access_right}</span>}</span>
        <span className="sb-me-caret"><IconChevron /></span>
      </button>
    </div>
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
          <img className="sb-logo" src={LOGO} alt="TrippleT" />
          <div>
            <div className="sb-brand-title">TrippleT</div>
            <div className="sb-brand-sub" title={me.release || undefined}>HEBERLEIN · WEB {me.version}</div>
          </div>
        </button>
        {(me.mode !== "prod" || me.instance) && <div className={"sb-env" + (me.mode === "prod" ? " prod" : "")}>{me.instance ? `${me.instance.toUpperCase()} · ` : ""}{me.mode.toUpperCase()} · {me.db}</div>}
        {nav && (
          <div className="sb-find">
            <button type="button" className="sb-search" onClick={openQuickSearch} title={`${t("qsr.title")} (Ctrl+F)`}>
              <IconSearch /><span className="sb-label">{t("sb.searchHint")}</span><kbd className="sb-label">Ctrl F</kbd>
            </button>
            <RecentMenu label={t("recent.title")} className="sb-tool sb-recent"><IconClock /></RecentMenu>
          </div>
        )}
        <nav className="sb-scroll">
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
          <div className="sb-tools">
            {nav?.pinned.map((it) => it.route === "/help" ? (
              <button key={it.key} type="button" className="sb-tool" onClick={() => openHelp()} title={t("nav./help")} aria-label={t("nav./help")}><IconHelp /></button>
            ) : (
              <NavLink key={it.key} to={it.route} className={({ isActive }) => "sb-tool" + (isActive ? " on" : "")}
                title={t(`nav.${it.route}`)} aria-label={t(`nav.${it.route}`)}>
                {it.route === "/knowledge-base" ? <IconBook /> : <img src={img(it.icon ?? "")} alt="" />}
              </NavLink>
            ))}
            <button type="button" className="sb-tool" onClick={openWhatsNew} title={t("sb.whatsNew")} aria-label={t("sb.whatsNew")}><IconSpark /></button>
            <Bell />
          </div>
          <UserMenu me={me} name={name} onLogout={onLogout} />
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
