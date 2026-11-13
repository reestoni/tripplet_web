import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../api";
import { useI18n } from "../i18n";

/* The bell (desktop ui/widgets/notification_panel.py): unread badge, panel with the notifications (unread first),
   ✓ marks one as read, "mark all as read", a click opens what it is about: the series (series done), Yarn Stock at
   the batch, or the experiment request. Count refreshed every 2 minutes and when the window gets the focus. */

type Item = { id: number; type: string; unread: boolean; created: string; title: string; experiment: string;
  series_id: number | null; yarn_id: number | null; charge: string; request_id: number | null; archived_version_id: number | null };

const ICON: Record<string, string> = { yarn_stock: "🧵", experiment_request: "📝", experiment_request_changed: "🔄" };

export default function Bell() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

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
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
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
      <button type="button" className="sb-bell" title={t("bell.title")} onClick={() => setOpen(!open)}>
        🔔{unread > 0 && <span className="sb-badge bell-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
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
                    {n.experiment && !(n.type in ICON) && <span className="muted">{t("bell.experiment", { e: n.experiment })}</span>}
                    <span className="bell-time">{n.created}</span>
                  </span>
                  {n.unread && <button className="bell-ok" title={t("bell.markRead")} onClick={(e) => { e.stopPropagation(); markRead(n); }}>✓</button>}
                </div>))}
          </div>
          {items && items.length > 0 && <div className="bell-foot muted">{t("bell.foot", { u: unread, n: items.length })}</div>}
        </div>
      )}
    </div>
  );
}
