import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, img, type ExperimentRow } from "../api";
import { useI18n } from "../i18n";
import { RequestIcon } from "../components/RequestPopup";
import { ReportIcon } from "../components/SeriesLinks";

type SortKey = "experiment_id" | "series_name" | "machine" | "creation_date" | "owner" | "status_id" | "has_attach"
  | "experiment_request_id" | "has_notes" | "reports" | "outcome" | "summary";

const COLUMNS: { key: SortKey; icon?: boolean }[] = [
  { key: "experiment_id" },
  { key: "series_name" },
  { key: "machine" },
  { key: "creation_date" },
  { key: "owner" },
  { key: "status_id" },
  { key: "has_attach", icon: true },
  { key: "experiment_request_id", icon: true },
  { key: "has_notes", icon: true },
  { key: "reports", icon: true },
];
// conclusion columns (db/series_conclusion.py), only when the database has the table
const CONCL_COLUMNS: { key: SortKey; icon?: boolean }[] = [{ key: "outcome" }, { key: "summary" }];

// same sort keys as the desktop (_sort_key in screen_all_experiments.py)
function sortValue(r: ExperimentRow, k: SortKey): string | number {
  switch (k) {
    case "series_name":
    case "machine":
    case "owner":
      return (r[k] ?? "").toString().toLowerCase();
    case "status_id":
      return r.status_id ?? 0;
    case "has_attach":
    case "has_notes":
      return r[k] ? 1 : 0;
    case "experiment_request_id":
      return r.experiment_request_id == null ? 0 : 1;
    case "reports":
      return r.reports ? 1 : 0;
    case "outcome": {
      const o = r.conclusion?.outcome;
      const i = o ? (OUTCOMES as readonly string[]).indexOf(o) : -1;
      return i >= 0 ? i + 1 : r.conclusion ? 9 : 99;
    }
    case "summary":
      return (r.conclusion?.summary ?? "").toLowerCase() || "￿";   // empty last
    default:
      return (r[k] ?? "").toString();
  }
}

function fmtDate(v: string | null) {
  return v ? v.replace("T", " ") : "";
}

import { useSeriesAdmin } from "../components/SeriesAdmin";
import { OUTCOMES, OutcomeDot } from "../components/ConclusionTab";
import { HelpButton } from "../components/Help";
import { openSeriesFrom } from "./Backlog";

export default function AllExperiments() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [machines, setMachines] = useState<string[]>([]);
  const [machine, setMachine] = useState("All");
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState("");
  const [expFilter, setExpFilter] = useState("");
  const [conclFilter, setConclFilter] = useState("");     // "", "any", "none" or an outcome
  const [hasConcl, setHasConcl] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "experiment_id", asc: false });
  const [reload, setReload] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const admin = useSeriesAdmin({ onChanged: () => setReload((x) => x + 1), onMessage: (kind, text) => setToast({ kind, text }) });
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.kind === "ok" ? 2500 : 7000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    let alive = true;
    if (!reload) setRows(null);          // after a change keep the list (and the scroll position)
    api
      .experiments(machine)
      .then((d) => {
        if (!alive) return;
        setMachines(d.machines);
        setRows(d.rows);
        setHasConcl(!!d.conclusions);
        setError(null);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [machine, reload]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const sf = seriesFilter.trim().toLowerCase();
    const ef = expFilter.trim().toLowerCase();
    const keepC = (r: ExperimentRow) => !conclFilter || (conclFilter === "any" ? !!r.conclusion
      : conclFilter === "none" ? !r.conclusion : r.conclusion?.outcome === conclFilter);
    const list = rows.filter(
      (r) => (!sf || r.series_name.toLowerCase().includes(sf)) && (!ef || String(r.experiment_id).toLowerCase().includes(ef)) && keepC(r),
    );
    const dir = sort.asc ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return x < y ? -dir : x > y ? dir : 0;
    });
  }, [rows, seriesFilter, expFilter, conclFilter, sort]);

  const clickHeader = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>{t("exp.title")}</h1>
        <HelpButton screen="all_experiments" />
        <span className="muted">
          {rows ? t("exp.count", { shown: shown.length, total: rows.length }) : t("app.loading")}
        </span>
      </div>
      <div className="toolbar">
        <div className="chips">
          {machines.map((m) => (
            <button key={m} className={"chip" + (m === machine ? " on" : "")} onClick={() => setMachine(m)}>
              {m === "All" ? t("exp.all") : m}
            </button>
          ))}
        </div>
        <input className="search" placeholder={t("exp.filterSeries")} value={seriesFilter}
          onChange={(e) => setSeriesFilter(e.target.value)} />
        <input className="search narrow" placeholder={t("exp.filterExp")} value={expFilter}
          onChange={(e) => setExpFilter(e.target.value)} />
        {hasConcl && (
          <select className="search narrow" value={conclFilter} onChange={(e) => setConclFilter(e.target.value)}>
            <option value="">{t("cc.filterAll")}</option>
            <option value="any">{t("cc.filterAny")}</option>
            <option value="none">{t("cc.filterNone")}</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{t(`cc.o.${o}`)}</option>)}
          </select>
        )}
      </div>
      {error && <div className="card error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {[...COLUMNS, ...(hasConcl ? CONCL_COLUMNS : [])].map((c) => (
                <th key={c.key} className={c.icon ? "icon-col" : ""} title={c.icon ? t(`exp.tip.${c.key}`) : undefined}
                  onClick={() => clickHeader(c.key)}>
                  {t(`exp.col.${c.key}`)}
                  {sort.key === c.key && <span className="sort">{sort.asc ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.series_id} onDoubleClick={(e) => openSeriesFrom(e, r.series_id, (id) => navigate(`/series/${id}`))} title={t("exp.openTip")}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); window.open(`/series/${r.series_id}`, "_blank"); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                onContextMenu={(e) => admin.open(e, { series_id: r.series_id, name: r.series_name })}>
                <td className="nowrap">{r.experiment_id}</td>
                <td>{r.series_name}</td>
                <td className="nowrap">{r.machine}</td>
                <td className="nowrap">{fmtDate(r.creation_date)}</td>
                <td>{r.owner ?? ""}</td>
                <td className="nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                  {/* status dropdown like the desktop: same rules as moving cards in the Backlog */}
                  <select className="status-sel" value={r.status_id ?? ""}
                    onChange={(e) => admin.move({ series_id: r.series_id, name: r.series_name }, Number(e.target.value))}>
                    {r.status_id == null && <option value="">–</option>}
                    {[1, 2, 3, 4, 5].map((sid) => <option key={sid} value={sid}>{t(`status.${sid}`)}</option>)}
                  </select>
                </td>
                <td className="icon-col">{r.has_attach && <img src={img("attach.png")} alt="yes" />}</td>
                <td className="icon-col">
                  <RequestIcon id={r.experiment_request_id} />
                </td>
                <td className="icon-col">{r.has_notes && <img src={img("notes.png")} alt="yes" />}</td>
                <td className="icon-col">
                  <ReportIcon seriesId={r.series_id} count={r.reports} />
                </td>
                {hasConcl && (
                  <>
                    <td className="nowrap">{r.conclusion && <><OutcomeDot outcome={r.conclusion.outcome} />{r.conclusion.outcome ? t(`cc.o.${r.conclusion.outcome}`) : ""}</>}</td>
                    <td className="cc-sumcell" title={r.conclusion?.summary || undefined}>{r.conclusion?.summary ?? ""}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {admin.dialogs}
      {toast && <div className={"toast " + toast.kind} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}
