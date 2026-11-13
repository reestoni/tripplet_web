import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type SeriesData } from "../api";
import { useI18n } from "../i18n";
import MachineTable from "../components/MachineTable";

const TAB_KEY = "tripplet.series.tab";

function lastTab(): string | null {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

export default function SeriesView() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [data, setData] = useState<SeriesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .series(Number(id))
      .then((d) => {
        if (!alive) return;
        setData(d);
        const keys = ["machine", ...d.tabs.map((x) => x.key)];
        const want = lastTab();
        setTab(want && keys.includes(want) ? want : "machine");
      })
      .catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? t("se.notFound") : e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const choose = (k: string) => {
    setTab(k);
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {
      /* storage blocked */
    }
  };

  // row titles and tab names are translated; unknown ones stay as the desktop shows them
  const tr = (prefix: string, key: string, fallback: string) => {
    const k = `${prefix}.${key}`;
    const v = t(k);
    return v === k ? fallback : v;
  };

  if (error) {
    return (
      <div className="page">
        <button className="btn-plain" onClick={() => navigate(-1)}>← {t("se.back")}</button>
        <div className="card error" style={{ marginTop: 12 }}>{error}</div>
      </div>
    );
  }
  if (!data) return <div className="page muted">{t("se.loading")}</div>;

  const s = data.series;
  const current = data.tabs.find((x) => x.key === tab) ?? null;

  return (
    <div className="page page-wide">
      <div className="se-head">
        <button className="btn-plain" onClick={() => navigate(-1)} title={t("se.back")}>←</button>
        <div className="se-title">
          <h1>{s.experiment_id} – {s.name}</h1>
          <div className="se-facts">
            <span><b>{t("se.machine")}:</b> {s.machine || "–"}</span>
            <span><b>{t("se.status")}:</b> {s.status_id != null ? t(`status.${s.status_id}`) : "–"}</span>
            <span><b>{t("se.owner")}:</b> {s.owner || "–"}</span>
            <span><b>{t("se.created")}:</b> {s.creation_date ? s.creation_date.replace("T", " ").slice(0, 16) : "–"}</span>
            <span><b>{t("se.trials")}:</b> {data.trials.length}</span>
            {s.notes && (
              <button className="link-btn" onClick={() => setShowNotes((v) => !v)}>
                {t("se.notes")} {showNotes ? "▾" : "▸"}
              </button>
            )}
          </div>
        </div>
        <div className="se-actions">
          <button className="btn-green" onClick={() => navigate(`/series/${s.id}/report`)}>{t("rep.open")}</button>
          <span className="muted se-ro">{t("se.readonly")}</span>
        </div>
      </div>
      {showNotes && s.notes && <div className="card se-notes">{s.notes}</div>}

      <div className="se-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "machine"} className={"se-tab" + (tab === "machine" ? " on" : "")}
          onClick={() => choose("machine")}>
          {tr("tab", "machine", "Machine Data")}
        </button>
        {data.tabs.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === tab}
            className={"se-tab" + (x.key === tab ? " on" : "")} onClick={() => choose(x.key)}>
            {tr("tab", x.key, x.title)}
            {Object.keys(x.flags).length > 0 && <span className="flag-dot" />}
          </button>
        ))}
        {data.pending_tabs.map((x) => (
          <span key={x.key} className="se-tab soon" title={t("se.pending", { tab: tr("tab", x.key, x.title) })}>
            {tr("tab", x.key, x.title)}
          </span>
        ))}
      </div>

      {data.trials.length === 0 && <div className="card muted">{t("se.noTrials")}</div>}
      {data.trials.length > 0 && tab === "machine" && (
        <MachineTable seriesId={s.id} rowTitle={(x) => tr("row", x, x)} />
      )}
      {current && (
        <>
          <div className="table-wrap pivot-wrap">
            <table className="pivot">
              <thead>
                <tr>
                  <th className="pv-corner" />
                  {data.trials.map((tr0, c) => {
                    const flag = current.flags[String(c)];
                    const tip = [tr0.reference ? t("se.reference", { name: tr0.reference }) : "", flag ?? ""]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <th key={tr0.id} className={tr0.reference ? "ref" : ""} title={tip || undefined}>
                        {tr0.label}
                        {flag && <span className="flag-dot" />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {current.rows.map((row, r) => (
                  <tr key={r} className={row.info ? "info" : ""}>
                    <th scope="row">{tr("row", row.title, row.title)}</th>
                    {row.cells.map((cell, c) => (
                      <td key={c} className={(cell.alert ?? "") + (data.trials[c]?.reference ? " ref" : "")}>
                        {cell.v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.rows.some((r) => r.cells.some((c) => c.alert)) && (
            <div className="muted se-legend">{t("se.redHint")}</div>
          )}
        </>
      )}
    </div>
  );
}
