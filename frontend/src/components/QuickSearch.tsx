import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request } from "../api";
import { useI18n } from "../i18n";

/* Quick search (desktop ui/screen_quick_search.py, Ctrl+F everywhere) on db/quick_search.py: series name /
   experiment ID, jets, yarns, machines (comma = AND within a field), ↑↓ + Enter, Ctrl+click = new tab.
   "Recent" (desktop ui/recent_series.py): the last series opened in Show Experiment, shared with the desktop.
   ScreenLog: every page open is logged like a desktop screen change (Usage Stats). */

type Hit = { series_id: number; experiment: string; name: string; machine: string; reasons: string[] };
type Recent = { series_id: number; experiment: string; name: string };

export function openQuickSearch() { window.dispatchEvent(new Event("tripplet:quick-search")); }

export function QuickSearchHost() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ series: "", jet: "", yarn: "", machine: "", conclusion: "" });
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [more, setMore] = useState(0);
  const [active, setActive] = useState(0);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("tripplet:quick-search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("tripplet:quick-search", onOpen); };
  }, []);
  useEffect(() => { if (open) setTimeout(() => first.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (!open) return;
    if (!Object.values(f).some((v) => v.trim())) { setHits(null); return; }
    const h = setTimeout(() => {
      const q = new URLSearchParams(f).toString();
      request<{ results: Hit[]; more?: number }>("GET", `/api/quick-search?${q}`).then((r) => { setHits(r.results); setMore(r.more ?? 0); setActive(0); })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(h);
  }, [f, open]);

  const go = (h: Hit, newTab = false) => {
    if (newTab) { window.open(`/series/${h.series_id}`, "_blank"); return; }
    setOpen(false);
    navigate(`/series/${h.series_id}`);
  };
  if (!open) return null;
  const field = (k: keyof typeof f, ph: string, ref?: React.Ref<HTMLInputElement>) => (
    <label className="qsr-field"><span>{t(`qsr.${k}`)}</span>
      <input ref={ref} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>);
  return (
    <div className="modal-back" onMouseDown={() => setOpen(false)}>
      <div className="modal qsr" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
        else if (e.key === "ArrowDown" && hits?.length) { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
        else if (e.key === "ArrowUp" && hits?.length) { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        else if (e.key === "Enter" && hits?.[active]) go(hits[active], e.ctrlKey);
      }}>
        <h2>🔍 {t("qsr.title")}</h2>
        <div className="qsr-fields">
          {field("series", "e.g. Intermingling", first)}{field("jet", "e.g. P213, APh213")}
          {field("yarn", "e.g. PES 78f36")}{field("machine", "e.g. eAFK")}{field("conclusion", t("qsr.conclusionPh"))}
        </div>
        <div className="qsr-results">
          {hits === null ? <p className="muted">{t("qsr.hint")}</p> : !hits.length ? <p className="muted">{t("qsr.none")}</p> : (<>
            <div className="qsr-head">🔬 {t("qsr.series")} · {hits.length}{more ? ` (+${more})` : ""}</div>
            {hits.map((h, i) => (
              <div key={h.series_id} className={"qsr-row" + (i === active ? " on" : "")} onMouseEnter={() => setActive(i)}
                onClick={(e) => go(h, e.ctrlKey || e.metaKey)}>
                <div><b>{h.experiment}</b> · {h.name}</div>
                <div className="muted">{[h.machine, h.reasons.join("  ·  ")].filter(Boolean).join("    ")}</div>
              </div>))}
          </>)}
        </div>
        <div className="muted qsr-foot">{t("qsr.foot")}</div>
      </div>
    </div>
  );
}

export function RecentMenu({ label, className, children }: { label: string; className: string; children: React.ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<Recent[] | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!items) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setItems(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [items]);
  return (
    <div className="recent" ref={box}>
      <button type="button" className={className + (items ? " on" : "")} title={label} aria-label={label} onClick={(e) => {
        if (items) { setItems(null); return; }
        const r = e.currentTarget.getBoundingClientRect();     // fixed: the sidebar scrolls and would clip it
        setPos({ left: r.right + 8, top: Math.max(8, Math.min(r.top, window.innerHeight - 340)) });
        request<{ items: Recent[] }>("GET", "/api/recent").then((r) => setItems(r.items)).catch(() => setItems([]));
      }}>
        {children}
      </button>
      {items && (
        <div className="recent-menu" style={{ left: pos.left, top: pos.top }}>
          <div className="muted recent-head">{t("recent.head")}</div>
          {!items.length ? <div className="muted recent-empty">{t("recent.none")}</div> : items.map((r) => (
            <div key={r.series_id} className="recent-row" onClick={(e) => {
              if (e.ctrlKey || e.metaKey) window.open(`/series/${r.series_id}`, "_blank");
              else { setItems(null); navigate(`/series/${r.series_id}`); }
            }}>{r.experiment} <span className="muted">{r.name}</span></div>))}
        </div>)}
    </div>
  );
}

// route -> desktop screen class (so Usage Stats counts desktop and web together)
const SCREENS: [RegExp, string][] = [
  [/^\/backlog/, "BacklogScreen"], [/^\/experiments\/new/, "CreateExperimentScreen"], [/^\/experiments\/legacy/, "CreateExperimentScreen"],
  [/^\/experiments/, "AllExperimentsScreen"], [/^\/series\/new/, "CreateExperimentScreen"], [/^\/lab-machines\/new/, "CreateExperimentScreen"],
  [/^\/series\/\d+\/report/, "ReportScreen"], [/^\/series\/\d+\/add-trials/, "CreateExperimentScreen"], [/^\/series\/\d+/, "ShowExperimentScreen"],
  [/^\/requests\/new/, "CreateExperimentRequestScreen"], [/^\/requests\/\d+/, "ExperimentRequestScreen"], [/^\/requests/, "MyRequestsScreen"],
  [/^\/admin\/jets/, "ManageJetsScreen"], [/^\/admin\/yarn/, "ManageYarnScreen"], [/^\/admin\/top-plates/, "ManageTopPlatesScreen"],
  [/^\/admin\/order-types/, "ManageOrderTypeScreen"], [/^\/admin\/product-groups/, "ManageProductGroupsScreen"],
  [/^\/admin\/material/, "ManageMaterialScreen"], [/^\/superuser\/users/, "ManageUserScreen"],
  [/^\/tools\/yarn-stock/, "YarnStockScreen"], [/^\/tools\/smart-chart/, "SmartChartScreen"], [/^\/tools\/dashboards/, "DashboardsScreen"],
  [/^\/tools\/yarn-count/, "YarnCountScreen"], [/^\/tools\/jet-roi/, "NozzleCalculatorScreen"], [/^\/tools\/air-supply/, "AirSupplyScreen"],
  [/^\/tools\/image-compare/, "ImageCompareScreen"], [/^\/tools\/label-generator/, "LabelGeneratorScreen"],
  [/^\/tools\/tdms-inspector/, "TdmsInspectorScreen"], [/^\/tools\/canvas/, "CanvasScreen"], [/^\/tools\/process-playground/, "ProcessPlaygroundScreen"],
  [/^\/tools\/jet-advisor/, "JetAdvisorScreen"],
  [/^\/tools\/requirement-hub\/quick-scan/, "QuickScanScreen"], [/^\/tools\/requirement-hub/, "RequirementHubScreen"],
  [/^\/knowledge-base/, "OnboardingScreen"],
];

export function ScreenLog() {
  const loc = useLocation();
  const last = useRef("");
  useEffect(() => {
    const hit = SCREENS.find(([re]) => re.test(loc.pathname));
    const name = hit ? hit[1] : `web:${loc.pathname.replace(/\d+/g, ":id")}`;
    const key = `${name}|${loc.pathname}`;
    if (key === last.current) return;
    last.current = key;
    request("POST", "/api/screen-open", { screen: name }).catch(() => undefined);
  }, [loc.pathname]);
  return null;
}
