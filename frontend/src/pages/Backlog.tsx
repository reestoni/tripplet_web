import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type ArchivedRow, type BacklogCard, type Status } from "../api";
import { SeriesIcons } from "../components/Icons";
import { useSeriesAdmin } from "../components/SeriesAdmin";
import { useI18n } from "../i18n";

type Box = Status & { cards: BacklogCard[] };
type Drag = { seriesId: number; from: number; name: string };
type MachineAsk = { drag: Drag; to: number; machines: { id: number; name: string }[] };

const ARCHIVED = 5;
const MIME = "application/x-tripplet-series";

function Card({ c, statusId, onOpen, onDragStart, onDragEnd, dragging, onMenu }: {
  c: BacklogCard; statusId: number; onOpen: () => void; onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void; dragging: boolean; onMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useI18n();
  // second line like the desktop card: Experiment ID • Machine • Status • Prio n • Owner
  const sub = [c.experiment_id, c.machine, t(`status.${statusId}`), c.prio != null ? `Prio ${c.prio}` : "", c.owner]
    .filter(Boolean)
    .join("  •  ");
  const retestTip = c.retest.length
    ? `${t("bl.retestTip")}\n` + c.retest.map((f) => `${f.trial} · ${f.lab}${f.note ? ` — ${f.note}` : ""}`).join("\n")
    : undefined;
  return (
    <div className={"bl-card" + (dragging ? " dragging" : "")} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      style={c.owner_colour ? { borderLeftColor: c.owner_colour } : undefined}
      onDoubleClick={onOpen} onContextMenu={onMenu} title={retestTip ?? t("exp.open")}>
      <div className="bl-title">
        <span>{c.series_name}</span>
        {c.retest.length > 0 && <span className="bl-retest">{t("bl.retest")}</span>}
      </div>
      <div className="bl-sub">
        <span>{sub}</span>
        <SeriesIcons attach={c.has_attach} request={c.experiment_request_id} notes={c.has_notes} reports={c.reports} seriesId={c.series_id} />
      </div>
    </div>
  );
}

function Archived({ rows, onOpen, onDragStart, onDragEnd, onMenu }: {
  rows: ArchivedRow[]; onOpen: (r: ArchivedRow) => void;
  onDragStart: (e: DragEvent, r: ArchivedRow) => void; onDragEnd: () => void;
  onMenu: (e: React.MouseEvent, r: ArchivedRow) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = (r: ArchivedRow) =>
      !s || [r.series_name, r.experiment_id, r.machine].some((v) => v.toLowerCase().includes(s));
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
    <>
      <input className="search" placeholder={t("bl.searchArchived")} value={q} onChange={(e) => setQ(e.target.value)} />
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
                          <div key={r.series_id} className="arch-row" draggable onDragStart={(e) => onDragStart(e, r)}
                            onDragEnd={onDragEnd} onDoubleClick={() => onOpen(r)} onContextMenu={(e) => onMenu(e, r)}
                            title={t("exp.open")}>
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
    </>
  );
}

export default function Backlog() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [archived, setArchived] = useState<ArchivedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [ask, setAsk] = useState<MachineAsk | null>(null);
  const [machine, setMachine] = useState<number | "">("");

  const load = useCallback(() => {
    return api
      .backlog()
      .then((d) => {
        setBoxes(d.boxes);
        setArchived(d.archived);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.kind === "ok" ? 2500 : 7000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const open = (seriesId: number) => navigate(`/series/${seriesId}`);
  const admin = useSeriesAdmin({ onChanged: () => { void load(); }, onMessage: (kind, text) => setToast({ kind, text }) });

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.setData(MIME, String(d.seriesId));
    e.dataTransfer.effectAllowed = "move";
    setDrag(d);
  };
  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  const doMove = async (d: Drag, to: number, machineId?: number) => {
    setBusy(true);
    try {
      const r = await api.moveCard(d.seriesId, to, machineId);
      if (r.moved) {
        setToast({ kind: "ok", text: t("bl.moved", { status: t(`status.${to}`) }) });
        window.dispatchEvent(new Event("tripplet:nav-changed"));
      }
      setAsk(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "need_machine") {
        const machines = (e.data?.machines as { id: number; name: string }[]) ?? [];
        setMachine("");
        setAsk({ drag: d, to, machines });
      } else {
        const key = e instanceof ApiError && e.code ? `bl.err.${e.code}` : "bl.err.other";
        const text = t(key) === key ? t("bl.err.other") : t(key);
        setToast({ kind: "err", text });
      }
    } finally {
      setBusy(false);
    }
  };

  const dropProps = (statusId: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!drag || drag.from === statusId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== statusId) setOver(statusId);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const d = drag;
      endDrag();
      if (d && d.from !== statusId) void doMove(d, statusId);
    },
  });

  const boxClass = (id: number) =>
    "bl-box" + (id === ARCHIVED ? " bl-archived" : "") + (drag && drag.from !== id ? " can-drop" : "") +
    (over === id ? " drop-over" : "");

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>{t("bl.title")}</h1>
        <span className="muted">{busy ? t("bl.moving") : t("bl.hint")}</span>
      </div>
      {error && <div className="card error">{error}</div>}
      {!boxes && !error && <div className="muted">{t("app.loading")}</div>}
      {boxes && (
        <div className="board">
          {boxes.map((b) => (
            <div key={b.id} className={boxClass(b.id)} {...dropProps(b.id)}>
              <div className="bl-head">
                <span>{t(`status.${b.id}`)}</span>
                <span className="bl-count">{b.cards.length}</span>
              </div>
              <div className="bl-list">
                {b.cards.map((c) => (
                  <Card key={c.series_id} c={c} statusId={b.id} onOpen={() => open(c.series_id)}
                    dragging={drag?.seriesId === c.series_id} onDragEnd={endDrag}
                    onMenu={(e) => admin.open(e, { series_id: c.series_id, name: c.series_name })}
                    onDragStart={(e) => startDrag(e, { seriesId: c.series_id, from: b.id, name: c.series_name })} />
                ))}
                {b.cards.length === 0 && <div className="muted bl-empty">{t("bl.empty")}</div>}
              </div>
            </div>
          ))}
          <div className={boxClass(ARCHIVED)} {...dropProps(ARCHIVED)}>
            <div className="bl-head">
              <span>{t("status.5")}</span>
              <span className="bl-count">{archived.length}</span>
            </div>
            <Archived rows={archived} onOpen={(r) => open(r.series_id)} onDragEnd={endDrag}
              onMenu={(e, r) => admin.open(e, { series_id: r.series_id, name: r.series_name })}
              onDragStart={(e, r) => startDrag(e, { seriesId: r.series_id, from: ARCHIVED, name: r.series_name })} />
          </div>
        </div>
      )}

      {admin.dialogs}
      {toast && <div className={"toast " + toast.kind} onClick={() => setToast(null)}>{toast.text}</div>}

      {ask && (
        <div className="modal-back" onClick={() => setAsk(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>{t("bl.machine.title")}</h2>
            <p>{t("bl.machine.text", { series: ask.drag.name })}</p>
            <select className="search" value={machine} autoFocus
              onChange={(e) => setMachine(e.target.value ? Number(e.target.value) : "")}>
              <option value="">–</option>
              {ask.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="modal-buttons">
              <button className="btn-plain" onClick={() => setAsk(null)}>{t("bl.machine.cancel")}</button>
              <button className="btn-green" disabled={machine === "" || busy}
                onClick={() => machine !== "" && doMove(ask.drag, ask.to, machine)}>
                {t("bl.machine.ok")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
