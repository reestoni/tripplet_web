import { useEffect, useMemo, useState } from "react";
import { ApiError, request } from "../api";
import { useI18n } from "../i18n";
import { Plot } from "../components/YarnScopeView";

/* Usage Stats (desktop ui/screen_usage_stats.py) on db/usage_stats.py - superusers only.
   Dashboard (ranking of screens / features, logins per day), then the raw tables (sortable). Screen / feature
   names are the logged event names (not translated); the help kinds are translated by key. */

type R = Record<string, string | number | null>;
type Data = { logins: R[]; screens: R[]; features: R[]; ranking: R[]; login_timeline: R[]; help: R[]; help_summary: string;
  help_totals: Record<string, number> };
type Tab = "dash" | "logins" | "screens" | "features" | "help";

const COLS: Record<Exclude<Tab, "dash">, string[]> = {
  logins: ["Username", "Logins", "LastLogin"],
  screens: ["Screen", "Opens", "Users", "LastUsed"],
  features: ["Feature", "Detail", "Uses", "Users", "LastUsed"],
  help: ["Kind", "Question", "Result", "Count", "Users", "LastUsed"],
};

function Table({ rows, cols }: { rows: R[]; cols: string[] }) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ c: string; desc: boolean } | null>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    let l = rows;
    if (q.trim()) { const w = q.toLowerCase(); l = l.filter((r) => cols.some((c) => String(r[c] ?? "").toLowerCase().includes(w))); }
    if (sort) {
      l = [...l].sort((a, b) => {
        const x = a[sort.c], y = b[sort.c];
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
        return sort.desc ? -r : r;
      });
    }
    return l;
  }, [rows, cols, sort, q]);
  return (<>
    <input className="mj-search us-search" placeholder={t("us.filter")} value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="us-wrap">
      <table className="pp-table us-table">
        <thead><tr>{cols.map((c) => <th key={c} onClick={() => setSort((s) => (s && s.c === c ? { c, desc: !s.desc } : { c, desc: true }))}>
          {t(`us.col.${c}`)}{sort?.c === c ? (sort.desc ? " ▼" : " ▲") : ""}</th>)}</tr></thead>
        <tbody>{shown.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === "number" ? "num" : ""}>
          {c === "Kind" ? t(`us.kind.${r.KindKey}`) : String(r[c] ?? "")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </>);
}

export default function UsageStats() {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dash");
  const load = () => {
    setErr(null);
    request<Data>("GET", "/api/superuser/usage-stats").then(setData)
      .catch((e) => setErr(e instanceof ApiError && e.code ? t(`us.err.${e.code}`) : String(e)));
  };
  useEffect(load, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#39A650";
  const ranking = useMemo(() => {
    if (!data) return null;
    const rows = [...data.ranking].reverse();
    return { traces: [{ type: "bar", orientation: "h", y: rows.map((r) => (r.EventType === "screen_open" ? String(r.Name) : `★ ${r.Name}`)),
      x: rows.map((r) => r.Cnt), marker: { color: rows.map((r) => (r.EventType === "screen_open" ? accent : "#E0A030")) } }],
      layout: { height: 420, margin: { l: 220, r: 20, t: 10, b: 40 }, xaxis: { title: { text: t("us.opens") } } } };
  }, [data, accent, t]);
  const timeline = useMemo(() => data && ({
    traces: [{ type: "bar", x: data.login_timeline.map((r) => String(r.Day)), y: data.login_timeline.map((r) => r.Cnt), marker: { color: accent } }],
    layout: { height: 260, margin: { l: 50, r: 20, t: 10, b: 70 }, yaxis: { title: { text: t("us.logins") } }, xaxis: { type: "category", tickangle: -60 } },
  }), [data, accent, t]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t("us.title")}</h1>
        <button className="btn-plain" onClick={load}>{t("mj.reload")}</button>
        {data && <span className="muted">{t("us.status", { u: data.logins.length, s: data.screens.length, f: data.features.length })}</span>}
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      {data && (<>
        <div className="se-tabs">
          {(["dash", "logins", "screens", "features", "help"] as Tab[]).map((x) => (
            <button key={x} className={"se-tab" + (tab === x ? " on" : "")} onClick={() => setTab(x)}>{t(`us.tab.${x}`)}</button>))}
        </div>
        {tab === "dash" ? (
          <div className="us-dash">
            <section className="jr-card"><h2>{t("us.rankTitle")}</h2>{data.ranking.length && ranking ? <div className="us-plot-l"><Plot data={ranking.traces} layout={ranking.layout} /></div> : <p className="muted">{t("us.noData")}</p>}</section>
            <section className="jr-card"><h2>{t("us.loginTitle")}</h2>{data.login_timeline.length && timeline ? <div className="us-plot-s"><Plot data={timeline.traces} layout={timeline.layout} /></div> : <p className="muted">{t("us.noData")}</p>}</section>
          </div>
        ) : tab === "help" ? (<>
          <p className="muted">{data.help.length || Object.values(data.help_totals).some(Boolean)
            ? Object.entries(data.help_totals).map(([k, n]) => `${t(`us.kind.${k}`)}: ${n}`).join(" · ") : t("us.noHelp")}</p>
          <Table rows={data.help} cols={COLS.help} />
        </>) : <Table key={tab} rows={data[tab]} cols={COLS[tab]} />}
      </>)}
    </div>
  );
}
