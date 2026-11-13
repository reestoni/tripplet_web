import { useEffect, useState } from "react";
import { request } from "../api";
import { Modal } from "./SeriesTools";
import { useI18n } from "../i18n";
import { EditCell, useEdit } from "../edit";

type Grid = { columns: string[]; rows: { title: string; r: number; cells: { v: string; e?: number }[] }[] };
type JetAir = { unit: string; units: Record<string, string>; consumption: Grid; atm: Grid; temp: Grid };

const UNIT_KEY = "tripplet.jetair.unit";

function Table({ title, g, tab, fill }: { title: string; g: Grid; tab: string; fill?: boolean }) {
  const { t } = useI18n();
  const ed = useEdit();
  const [v, setV] = useState("");
  const ok = /^\s*[+-]?\d+(?:[.,]\d+)?\s*$/.test(v);
  // "Apply to all" (desktop _fill_all_jet_air): every editable cell of this grid gets the value - unsaved until Save
  const applyAll = () => {
    if (!ed || !ok) return;
    const val = v.trim().replace(",", ".");
    ed.setMany(g.rows.flatMap((r) => r.cells.map((c, i) => ({ c, i })).filter(({ c }) => !!c.e)
      .map(({ i }) => ({ tab, r: r.r, c: i, value: val, display: val }))));
  };
  return (
    <div className="ja-block">
      <h3 className="ja-head">{title}
        {fill && ed?.canWrite && (
          <span className="ja-fill">
            <input value={v} placeholder={t("ja.fillPh")} onChange={(e) => setV(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyAll(); }} />
            <button className="btn-plain" disabled={!ok} onClick={applyAll}>{t("ja.applyAll")}</button>
          </span>
        )}
      </h3>
      <div className="table-wrap">
        <table className="pivot">
          <thead>
            <tr>
              <th className="pv-corner" />
              {g.columns.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.title}>
                <th scope="row">{r.title}</th>
                {r.cells.map((c, i) => <EditCell key={i} addr={{ tab, r: r.r, c: i }} text={c.v} editable={!!c.e} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Jet Air Consumption: rows = physical jets, columns = pressure steps (three grids like the desktop). */
export default function JetAirView({ seriesId }: { seriesId: number }) {
  const { t } = useI18n();
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem(UNIT_KEY) || "Nm3h";
    } catch {
      return "Nm3h";
    }
  });
  const [data, setData] = useState<JetAir | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const [sync, setSync] = useState<null | { status: string; to_insert: number; orphans: { jet: string; plate: string; has_data: boolean }[] }>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ed = useEdit();

  // "Sync physical jets" (desktop _sync_jet_air_physical_jets, db/jet_air_sync)
  const startSync = async () => {
    setMsg(null);
    try {
      const p = await request<NonNullable<typeof sync>>("GET", `/api/series/${seriesId}/jet-air/sync-plan`);
      if (p.status === "changes") setSync(p);
      else setMsg(p.status === "in_sync" ? t("ja.inSync") : p.status === "nothing_found" ? t("ja.nothingFound") : t("ja.syncNA"));
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const doSync = async () => {
    setSync(null);
    try {
      const r = await request<{ added: number; deleted: number }>("POST", `/api/series/${seriesId}/jet-air/sync`);
      setMsg(t("ja.synced", { added: r.added, deleted: r.deleted }));
      setAgain((x) => x + 1);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    let alive = true;
    request<JetAir>("GET", `/api/series/${seriesId}/jet-air?unit=${unit}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [seriesId, unit, ed?.reloadKey, again]);

  if (error) return <div className="card error">{error}</div>;
  if (!data) return <div className="muted">{t("app.loading")}</div>;
  const pick = (u: string) => {
    setUnit(u);
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      /* storage blocked */
    }
  };
  return (
    <div className="ja-wrap">
      <div className="md-bar">
        <span className="muted">{t("ja.unit")}</span>
        {Object.entries(data.units).map(([k, label]) => (
          <label key={k} className="md-radio">
            <input type="radio" checked={unit === k} disabled={!!ed?.hasDirty("jet_air") && unit !== k} onChange={() => pick(k)} /> {label}
          </label>
        ))}
        {ed?.canWrite && (
          <button className="btn-plain ja-sync" disabled={!!ed?.hasDirty("jet_air")} title={ed?.hasDirty("jet_air") ? t("ja.saveFirst") : t("ja.syncTip")}
            onClick={startSync}>{t("ja.sync")}</button>
        )}
        {msg && <span className="muted">{msg}</span>}
      </div>
      <Table tab="jet_air" title={`${t("ja.consumption")} (${data.units[data.unit]})`} g={data.consumption} />
      <Table tab="jet_air_atm" title={t("ja.atm")} g={data.atm} fill />
      <Table tab="jet_air_temp" title={t("ja.temp")} g={data.temp} fill />
      {sync && (
        <Modal title={t("ja.sync")} onClose={() => setSync(null)}>
          {sync.to_insert > 0 && <p>{t("ja.willAdd", { n: sync.to_insert })}</p>}
          {sync.orphans.length > 0 && (
            <>
              <p>{t("ja.orphans")}</p>
              <ul>{sync.orphans.map((o, i) => (
                <li key={i}>{o.jet} / Plate {o.plate || "–"} – {o.has_data ? t("ja.keepData") : t("ja.deleteEmpty")}</li>))}</ul>
            </>
          )}
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => setSync(null)}>{t("mj.cancel")}</button>
            <button className="btn-green" autoFocus onClick={doSync}>{t("ja.syncGo")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
