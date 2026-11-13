import { useEffect, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";

type Grid = { columns: string[]; rows: { title: string; cells: { v: string }[] }[] };
type JetAir = { unit: string; units: Record<string, string>; consumption: Grid; atm: Grid; temp: Grid };

const UNIT_KEY = "tripplet.jetair.unit";

function Table({ title, g }: { title: string; g: Grid }) {
  return (
    <div className="ja-block">
      <h3>{title}</h3>
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
                {r.cells.map((c, i) => <td key={i}>{c.v}</td>)}
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

  useEffect(() => {
    let alive = true;
    request<JetAir>("GET", `/api/series/${seriesId}/jet-air?unit=${unit}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [seriesId, unit]);

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
            <input type="radio" checked={unit === k} onChange={() => pick(k)} /> {label}
          </label>
        ))}
      </div>
      <Table title={`${t("ja.consumption")} (${data.units[data.unit]})`} g={data.consumption} />
      <Table title={t("ja.atm")} g={data.atm} />
      <Table title={t("ja.temp")} g={data.temp} />
    </div>
  );
}
