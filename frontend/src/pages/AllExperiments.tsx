import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, img, type ExperimentRow } from "../api";
import { useI18n } from "../i18n";
import { RequestIcon } from "../components/RequestPopup";
import { ReportIcon } from "../components/SeriesLinks";

type SortKey = "experiment_id" | "series_name" | "machine" | "creation_date" | "owner" | "status_id" | "has_attach"
  | "experiment_request_id" | "has_notes" | "reports";

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
    default:
      return (r[k] ?? "").toString();
  }
}

function fmtDate(v: string | null) {
  return v ? v.replace("T", " ") : "";
}

import { useSeriesAdmin } from "../components/SeriesAdmin";

export default function AllExperiments() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [machines, setMachines] = useState<string[]>([]);
  const [machine, setMachine] = useState("All");
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState("");
  const [expFilter, setExpFilter] = useState("");
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
    const list = rows.filter(
      (r) => (!sf || r.series_name.toLowerCase().includes(sf)) && (!ef || String(r.experiment_id).toLowerCase().includes(ef)),
    );
    const dir = sort.asc ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return x < y ? -dir : x > y ? dir : 0;
    });
  }, [rows, seriesFilter, expFilter, sort]);

  const clickHeader = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>{t("exp.title")}</h1>
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
      </div>
      {error && <div className="card error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
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
              <tr key={r.series_id} onDoubleClick={() => navigate(`/series/${r.series_id}`)} title={t("exp.open")}
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
