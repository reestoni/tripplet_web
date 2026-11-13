import { useEffect, useMemo, useState } from "react";
import { api, notesTip, type MachineData } from "../api";
import { useI18n } from "../i18n";
import { EditCell, useEdit } from "../edit";

const MODE_KEY = "tripplet.machine.mode";

/** Machine Data tab (read only): columns = trial x ply, two header rows like the desktop. */
export default function MachineTable({ seriesId, rowTitle, source = "machine" }: {
  seriesId: number; rowTitle: (t: string) => string; source?: "machine" | "rd";
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<string>(() => {
    try {
      return localStorage.getItem(MODE_KEY) || "single";
    } catch {
      return "single";
    }
  });
  const [data, setData] = useState<MachineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const ed = useEdit();
  const locked = !!ed?.hasDirty(source);   // unsaved edits refer to this view's rows/columns

  useEffect(() => {
    let alive = true;
    setData(null);
    api
      .machine(seriesId, mode, source)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [seriesId, mode, source, ed?.reloadKey]);

  const choose = (m: string) => {
    setMode(m);
    setOff([]);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage blocked */
    }
  };

  // "Show:" filter (desktop checkboxes) - hide columns whose label is switched off
  const visible = useMemo(() => {
    if (!data) return [];
    return data.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.filter || !off.includes(c.filter));
  }, [data, off]);

  // trial label spans over its ply columns (header row 1)
  const spans = useMemo(() => {
    const out: { label: string; ref: string | null; n: number }[] = [];
    for (const { c } of visible) {
      const last = out[out.length - 1];
      if (last && (last as { id?: number }).id === c.trial_id) last.n += 1;
      else out.push(Object.assign({ label: c.trial_label, ref: c.reference, n: 1 }, { id: c.trial_id }));
    }
    return out;
  }, [visible]);

  if (error) return <div className="card error">{error}</div>;

  return (
    <>
      <div className="md-bar">
        {(["single", "groups", "compact"] as const).map((m) =>
          m === "groups" && data && !data.has_groups ? null : (
            <label key={m} className="md-radio">
              <input type="radio" checked={mode === m} disabled={locked && mode !== m} onChange={() => choose(m)} /> {t(`md.${m}`)}
            </label>
          ),
        )}
        {data && data.filter_labels.length > 1 && (
          <span className="md-filter">
            <span className="muted">{t("md.show")}</span>
            {data.filter_labels.map((l) => (
              <label key={l} className="md-radio">
                <input type="checkbox" checked={!off.includes(l)}
                  onChange={() => setOff((o) => (o.includes(l) ? o.filter((x) => x !== l) : [...o, l]))} /> {l}
              </label>
            ))}
          </span>
        )}
      </div>
      {!data && <div className="muted">{t("md.loading")}</div>}
      {data?.message && <div className="card muted">{data.message}</div>}
      {data && !data.message && (
        <div className="table-wrap pivot-wrap">
          <table className="pivot machine">
            <thead>
              <tr>
                <th className="pv-corner" rowSpan={2} />
                {spans.map((s, k) => (
                  <th key={k} colSpan={s.n} className={s.ref ? "ref" : ""} title={s.ref ? t("se.reference", { name: s.ref }) : undefined}>
                    {s.label}
                  </th>
                ))}
              </tr>
              <tr className="ply-row">
                {visible.map(({ c, i }) => (
                  <th key={i} className={(c.reference ? "ref" : "") + (c.notes.length ? " has-note" : "")}
                    title={[c.ply_tooltip, c.colour_name ? t("md.colour", { c: c.colour_name }) : "", notesTip(c.notes)]
                      .filter(Boolean).join("\n") || undefined}>
                    {c.colour && <span className="yarn-dot" style={{ background: c.colour }} />}
                    {c.ply}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, r) => (
                <tr key={r} className={row.readonly ? "info" : ""}>
                  <th scope="row">{rowTitle(row.title)}</th>
                  {visible.map(({ c, i }) => {
                    const cell = row.cells[i];
                    return (
                      <EditCell key={i} addr={{ tab: source, r: row.r, c: c.c }} text={cell.v} raw={cell.raw}
                        editable={!!cell.e} options={row.options ?? null}
                        className={(cell.alert ?? "") + (c.reference ? " ref" : "") + (cell.notes ? " has-note" : "")}
                        title={[cell.tip, notesTip(cell.notes)].filter(Boolean).join("\n") || undefined} />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
