import { useCallback, useEffect, useRef, useState } from "react";
import { IconBell } from "./SidebarIcons";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { TABLET, useMedia } from "../media";
import { request } from "../api";
import { useI18n } from "../i18n";

/* The bell (desktop ui/widgets/notification_panel.py): unread badge, panel with the notifications (unread first),
   ✓ marks one as read, "mark all as read", a click opens what it is about: the series (series done), Yarn Stock at
   the batch, or the experiment request. Count refreshed every 2 minutes and when the window gets the focus. */

type Item = { id: number; type: string; unread: boolean; created: string; title: string; experiment: string;
  series_id: number | null; yarn_id: number | null; charge: string; request_id: number | null; archived_version_id: number | null };

const ICON: Record<string, string> = { yarn_stock: "🧵", experiment_request: "📝", experiment_request_changed: "🔄",
  series_conclusion: "✅", yarnscope_auto_dty: "🔬", yarnscope_auto_aty: "🔬" };

export default function Bell() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const small = useMedia(TABLET);   // phone/tablet: the pop-up goes to the page body (the menu closes)
  const portal = (el: React.ReactElement) => (small ? createPortal(el, document.body) : el);

  const refresh = useCallback(() => {
    request<{ unread: number }>("GET", "/api/notifications/count").then((r) => setUnread(r.unread)).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 120000);
    window.addEventListener("focus", refresh);
    window.addEventListener("tripplet:bell", refresh);
    return () => { window.clearInterval(id); window.removeEventListener("focus", refresh); window.removeEventListener("tripplet:bell", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    request<{ items: Item[]; unread: number }>("GET", "/api/notifications").then((r) => { setItems(r.items); setUnread(r.unread); })
      .catch(() => setItems([]));
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (box.current && !box.current.contains(n) && !panel.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const markRead = (n: Item) => {
    if (!n.unread) return;
    setItems((l) => l && l.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
    request<{ unread: number }>("POST", `/api/notifications/${n.id}/read`).then((r) => setUnread(r.unread)).catch(() => undefined);
  };
  const go = (n: Item) => {
    if (n.type === "yarn_stock") {
      markRead(n);
      if (n.yarn_id != null) navigate(`/tools/yarn-stock?yarn=${n.yarn_id}&charge=${encodeURIComponent(n.charge)}`);
    } else if (n.type === "experiment_request" || n.type === "experiment_request_changed") {
      markRead(n);
      if (n.request_id) navigate(`/requests/${n.request_id}`);
    } else if ((n.type === "yarnscope_auto_dty" || n.type === "yarnscope_auto_aty") && n.series_id) {
      markRead(n);                                   // automatic analysis (backend yarnscope_auto.py)
      navigate(`/series/${n.series_id}?tab=${n.type === "yarnscope_auto_aty" ? "yarnscope_aty" : "yarnscope"}`);
    } else if (n.type === "series_conclusion" && n.series_id) {
      markRead(n);
      navigate(`/series/${n.series_id}?tab=conclusion`);
    } else if (n.series_id) navigate(`/series/${n.series_id}`);
    setOpen(false);
  };
  const readAll = () => {
    setItems((l) => l && l.map((x) => ({ ...x, unread: false })));
    setUnread(0);
    request("POST", "/api/notifications/read-all").catch(() => undefined);
  };
  const tag = (ty: string) => t(`bell.type.${ty in ICON ? ty : "series"}`);

  return (
    <div className="bell" ref={box}>
      <button type="button" className={"sb-tool" + (open ? " on" : "")} title={t("bell.title")} aria-label={t("bell.title")} onClick={() => setOpen(!open)}>
        <IconBell />{unread > 0 && <span className="sb-badge bell-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {/* on the page body, not inside the sidebar: on phone/tablet the menu closes when the panel opens */}
      {open && portal(
        <div className="bell-panel" ref={panel}>
          <div className="bell-head">
            <b>{t("bell.title")}</b>
            {unread > 0 && <span className="bell-new">{t("bell.new", { n: unread })}</span>}
            <span style={{ flex: 1 }} />
            {unread > 0 && <button className="btn-plain" onClick={readAll}>{t("bell.readAll")}</button>}
          </div>
          <div className="bell-list">
            {items === null ? <p className="muted bell-empty">…</p> : !items.length ? <p className="muted bell-empty">{t("bell.none")}</p>
              : items.map((n) => (
                <div key={n.id} className={"bell-item" + (n.unread ? " unread" : "")} onClick={() => go(n)}>
                  <span className="bell-dot" />
                  <span className="bell-icon">{ICON[n.type] ?? "📦"}</span>
                  <span className="bell-text">
                    <span className="bell-tag">{tag(n.type)}</span>
                    <span className="bell-name">{n.title}</span>
                    {n.experiment && (!(n.type in ICON) || n.type === "series_conclusion" || n.type.startsWith("yarnscope_auto")) && <span className="muted">{t("bell.experiment", { e: n.experiment })}</span>}
                    <span className="bell-time">{n.created}</span>
                  </span>
                  {n.unread && <button className="bell-ok" title={t("bell.markRead")} onClick={(e) => { e.stopPropagation(); markRead(n); }}>✓</button>}
                </div>))}
          </div>
          {items && items.length > 0 && <div className="bell-foot muted">{t("bell.foot", { u: unread, n: items.length })}</div>}
        </div>)}
    </div>
  );
}
