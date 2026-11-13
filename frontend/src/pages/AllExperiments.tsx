import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, img, type ExperimentRow } from "../api";

type SortKey = "experiment_id" | "series_name" | "machine" | "creation_date" | "owner" | "status_id" | "has_attach"
  | "experiment_request_id" | "has_notes" | "reports";

const COLUMNS: { key: SortKey; label: string; icon?: boolean }[] = [
  { key: "experiment_id", label: "Experiment ID" },
  { key: "series_name", label: "Trial Series Name" },
  { key: "machine", label: "Machine" },
  { key: "creation_date", label: "Creation Date" },
  { key: "owner", label: "Owner" },
  { key: "status_id", label: "Status" },
  { key: "has_attach", label: "AM", icon: true },
  { key: "experiment_request_id", label: "ER", icon: true },
  { key: "has_notes", label: "NT", icon: true },
  { key: "reports", label: "RE", icon: true },
];

const TITLES: Partial<Record<SortKey, string>> = {
  has_attach: "Attachment (image or PDF)",
  experiment_request_id: "Experiment Request",
  has_notes: "Notes",
  reports: "Saved reports",
};

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

export default function AllExperiments() {
  const navigate = useNavigate();
  const [machines, setMachines] = useState<string[]>([]);
  const [machine, setMachine] = useState("All");
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState("");
  const [expFilter, setExpFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "experiment_id", asc: false });

  useEffect(() => {
    let alive = true;
    setRows(null);
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
  }, [machine]);

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
        <h1>Experiments</h1>
        <span className="muted">{rows ? `${shown.length} of ${rows.length} series` : "Loading…"}</span>
      </div>
      <div className="toolbar">
        <div className="chips">
          {machines.map((m) => (
            <button key={m} className={"chip" + (m === machine ? " on" : "")} onClick={() => setMachine(m)}>
              {m}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Filter Trial Series Name…" value={seriesFilter}
          onChange={(e) => setSeriesFilter(e.target.value)} />
        <input className="search narrow" placeholder="Filter Experiment ID…" value={expFilter}
          onChange={(e) => setExpFilter(e.target.value)} />
      </div>
      {error && <div className="card error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.icon ? "icon-col" : ""} title={TITLES[c.key]} onClick={() => clickHeader(c.key)}>
                  {c.label}
                  {sort.key === c.key && <span className="sort">{sort.asc ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.series_id} onDoubleClick={() => navigate(`/series/${r.series_id}`)} title="Double-click to open">
                <td className="nowrap">{r.experiment_id}</td>
                <td>{r.series_name}</td>
                <td className="nowrap">{r.machine}</td>
                <td className="nowrap">{fmtDate(r.creation_date)}</td>
                <td>{r.owner ?? ""}</td>
                <td className="nowrap">{r.status ?? ""}</td>
                <td className="icon-col">{r.has_attach && <img src={img("attach.png")} alt="yes" />}</td>
                <td className="icon-col">
                  {r.experiment_request_id != null && (
                    <img src={img("experiment_request.png")} alt="yes" title={`Experiment Request ${r.experiment_request_id}`} />
                  )}
                </td>
                <td className="icon-col">{r.has_notes && <img src={img("notes.png")} alt="yes" />}</td>
                <td className="icon-col">
                  {r.reports > 0 && <img src={img("analytics.png")} alt="yes" title={`${r.reports} saved report(s)`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
