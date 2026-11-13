import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ArchivedRow, type BacklogCard, type Status } from "../api";
import { SeriesIcons } from "../components/Icons";

type Box = Status & { cards: BacklogCard[] };

function Card({ c, onOpen }: { c: BacklogCard; onOpen: () => void }) {
  // second line like the desktop card: Experiment ID • Machine • Status • Prio n • Owner
  const sub = [c.experiment_id, c.machine, c.status, c.prio != null ? `Prio ${c.prio}` : "", c.owner]
    .filter(Boolean)
    .join("  •  ");
  const retestTip = c.retest.length
    ? "Open retest flag:\n" + c.retest.map((f) => `${f.trial} · ${f.lab}${f.note ? ` — ${f.note}` : ""}`).join("\n")
    : undefined;
  return (
    <div className="bl-card" style={c.owner_colour ? { borderLeftColor: c.owner_colour } : undefined}
      onDoubleClick={onOpen} title={retestTip ?? "Double-click to open"}>
      <div className="bl-title">
        <span>{c.series_name}</span>
        {c.retest.length > 0 && <span className="bl-retest">RETEST</span>}
      </div>
      <div className="bl-sub">
        <span>{sub}</span>
        <SeriesIcons attach={c.has_attach} request={c.experiment_request_id} notes={c.has_notes} reports={c.reports} />
      </div>
    </div>
  );
}

function Archived({ rows, onOpen }: { rows: ArchivedRow[]; onOpen: (r: ArchivedRow) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hit = (r: ArchivedRow) =>
      !t || [r.series_name, r.experiment_id, r.machine].some((v) => v.toLowerCase().includes(t));
    const years = new Map<string, Map<string, ArchivedRow[]>>();
    for (const r of rows.filter(hit)) {
      if (!years.has(r.year)) years.set(r.year, new Map());
      const xx = years.get(r.year)!;
      if (!xx.has(r.xx)) xx.set(r.xx, []);
      xx.get(r.xx)!.push(r);
    }
    return [...years.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([year, xx]) => ({ year, xx: [...xx.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)) }));
  }, [rows, q]);
  const searching = q.trim() !== "";
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="bl-box bl-archived">
      <div className="bl-head">
        <span>Archived</span>
        <span className="bl-count">{rows.length}</span>
      </div>
      <input className="search" placeholder="Search archived…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="bl-list">
        {groups.map((g) => {
          const n = g.xx.reduce((s, [, list]) => s + list.length, 0);
          const yOpen = searching || open[g.year];
          return (
            <div key={g.year}>
              <button className="acc acc-0" onClick={() => toggle(g.year)}>
                {yOpen ? "▾" : "▸"} {g.year} <span className="muted">({n})</span>
              </button>
              {yOpen &&
                g.xx.map(([xx, list]) => {
                  const k = `${g.year}-${xx}`;
                  const xOpen = searching || open[k];
                  return (
                    <div key={k}>
                      <button className="acc acc-1" onClick={() => toggle(k)}>
                        {xOpen ? "▾" : "▸"} {xx} <span className="muted">({list.length})</span>
                      </button>
                      {xOpen &&
                        list.map((r) => (
                          <div key={r.series_id} className="arch-row" onDoubleClick={() => onOpen(r)} title="Double-click to open">
                            <span>{r.experiment_id} · {r.series_name}</span>
                            <span className="muted">{r.machine}</span>
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Backlog() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [archived, setArchived] = useState<ArchivedRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .backlog()
      .then((d) => {
        setBoxes(d.boxes);
        setArchived(d.archived);
      })
      .catch((e) => setError(e.message));
  }, []);

  const open = (seriesId: number) => navigate(`/series/${seriesId}`);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>Backlog</h1>
        <span className="muted">Read only for now – moving cards and changing status come later.</span>
      </div>
      {error && <div className="card error">{error}</div>}
      {!boxes && !error && <div className="muted">Loading…</div>}
      {boxes && (
        <div className="board">
          {boxes.map((b) => (
            <div key={b.id} className="bl-box">
              <div className="bl-head">
                <span>{b.name}</span>
                <span className="bl-count">{b.cards.length}</span>
              </div>
              <div className="bl-list">
                {b.cards.map((c) => (
                  <Card key={c.series_id} c={c} onOpen={() => open(c.series_id)} />
                ))}
                {b.cards.length === 0 && <div className="muted bl-empty">Empty</div>}
              </div>
            </div>
          ))}
          <Archived rows={archived} onOpen={(r) => open(r.series_id)} />
        </div>
      )}
    </div>
  );
}
