import { useEffect, useMemo, useState } from "react";
import { api, notesTip, type CellNote, type MachineData } from "../api";
import { useI18n } from "../i18n";
import { EditCell, useEdit } from "../edit";
import type { MenuItem } from "./ContextMenu";
import type { SeriesMenus } from "./seriesMenus";

const MODE_KEY = "tripplet.machine.mode";

/** Machine Data tab (read only): columns = trial x ply, two header rows like the desktop. */
const HIDDEN_KEY = (machine: number | null | undefined) => `tripplet.hiddenRows.machine_${machine ?? 0}`;

function loadHidden(machine: number | null | undefined): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY(machine)) || "[]");
  } catch {
    return [];
  }
}

export default function MachineTable({ seriesId, rowTitle, source = "machine", menus }: {
  seriesId: number; rowTitle: (t: string) => string; source?: "machine" | "rd"; menus?: SeriesMenus;
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
  const [custom, setCustom] = useState(false);              // desktop: Custom Group row off at start
  const [hidden, setHidden] = useState<string[]>([]);       // rows the user hid (by title, per machine; Machine Data only)
  const [selRows, setSelRows] = useState<string[]>([]);
  const ed = useEdit();
  const locked = !!ed?.hasDirty(source);   // unsaved edits refer to this view's rows/columns

  useEffect(() => {
    let alive = true;
    setData(null);
    api
      .machine(seriesId, mode, source, custom)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
        if (source === "machine") setHidden(loadHidden(d.machine_id));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [seriesId, mode, source, custom, ed?.reloadKey]);

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
    const out: { id: number; label: string; ref: string | null; n: number; notes: CellNote[] }[] = [];
    for (const { c } of visible) {
      const last = out[out.length - 1];
      if (last && last.id === c.trial_id) last.n += 1;
      else out.push({ id: c.trial_id, label: c.trial_label, ref: c.reference, n: 1, notes: c.notes });
    }
    return out;
  }, [visible]);

  const saveHidden = (titles: string[]) => {
    setHidden(titles);
    try {
      localStorage.setItem(HIDDEN_KEY(data?.machine_id), JSON.stringify(titles));
    } catch {
      /* storage blocked */
    }
  };
  // a hidden block is marked on the next visible row (or at the bottom of the last one) - click shows it again
  const markers = useMemo(() => {
    const out = new Map<number, { where: "top" | "bottom"; titles: string[] }>();
    if (!data) return out;
    let pending: string[] = [];
    let last = -1;
    data.rows.forEach((row, i) => {
      if (hidden.includes(row.title)) pending.push(row.title);
      else {
        if (pending.length) out.set(i, { where: "top", titles: pending });
        pending = [];
        last = i;
      }
    });
    if (pending.length && last >= 0) out.set(last, { where: "bottom", titles: pending });
    return out;
  }, [data, hidden]);

  const titleMenu = (e: React.MouseEvent, row: MachineData["rows"][number], i: number) => {
    if (!menus || !data) return;
    const items: MenuItem[] = [];
    if (ed?.canWrite && !row.readonly) {
      const first = visible.map(({ i: ci }) => row.cells[ci]).find((c) => c?.e && c.v !== "");
      items.push({ label: t("cm.fillRow"), onClick: () => menus.openFill(source, row.r, rowTitle(row.title), row.options ?? null, first?.v ?? "") });
    }
    if (source === "machine") {
      const isCustom = data.custom_row != null && row.r === data.custom_row;
      const target = selRows.includes(row.title) && selRows.length > 1 ? selRows : [row.title];
      if (!isCustom) {
        items.push({ sep: true }, { label: target.length > 1 ? t("cm.hideRows", { n: target.length }) : t("cm.hideRow"),
          onClick: () => { saveHidden([...new Set([...hidden, ...target])]); setSelRows([]); } });
      }
      const mk = markers.get(i);
      if (mk) items.push({ label: t("cm.showHere", { n: mk.titles.length }), onClick: () => saveHidden(hidden.filter((x) => !mk.titles.includes(x))) });
      const n = data.rows.filter((r) => hidden.includes(r.title)).length;
      if (n) items.push({ label: t("cm.showAll", { n }), onClick: () => saveHidden([]) });
      if (data.custom_row != null) {
        items.push({ sep: true }, { label: custom ? t("cm.hideCustom") : t("cm.showCustom"), onClick: () => setCustom((x) => !x) });
      }
    }
    menus.open(e, items);
  };

  if (error) return <div className="card error">{error}</div>;
  const nHidden = data ? data.rows.filter((r) => hidden.includes(r.title)).length : 0;

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
      {nHidden > 0 && data && (
        <div className="md-hidden">
          <button className="btn-plain" onClick={(e) => menus?.open(e, [
            { label: t("cm.showAllRows"), onClick: () => saveHidden([]) }, { sep: true },
            ...data.rows.filter((r) => hidden.includes(r.title)).map((r) => ({
              label: t("cm.showRow", { row: rowTitle(r.title) }), onClick: () => saveHidden(hidden.filter((x) => x !== r.title)) })),
          ])}>{t("cm.rowsHidden", { n: nHidden })} ▾</button>
        </div>
      )}
      {!data && <div className="muted">{t("md.loading")}</div>}
      {data?.message && <div className="card muted">{data.message}</div>}
      {data && !data.message && (
        <div className="table-wrap pivot-wrap">
          <table className="pivot machine">
            <thead>
              <tr>
                <th className="pv-corner" rowSpan={2} />
                {spans.map((s, k) => (
                  <th key={k} colSpan={s.n} className={(s.ref ? "ref" : "") + (menus?.selTrials.includes(s.id) ? " th-sel" : "")
                    + (s.notes.length ? " has-note" : "")}
                    title={[s.ref ? t("se.reference", { name: s.ref }) : "", notesTip(s.notes)].filter(Boolean).join("\n") || undefined}
                    onClick={(e) => menus?.clickTrial(e, s.id)}
                    onContextMenu={(e) => menus?.trialMenu(e, { id: s.id, label: s.label }, s.notes)}>
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
              {data.rows.map((row, r) => hidden.includes(row.title) ? null : (
                <tr key={r} className={row.readonly ? "info" : ""}>
                  <th scope="row" className={(markers.get(r) ? `hid-${markers.get(r)!.where}` : "") + (selRows.includes(row.title) ? " th-sel" : "")}
                    title={markers.get(r) ? t("cm.hiddenHere", { rows: markers.get(r)!.titles.map(rowTitle).join(", ") }) : undefined}
                    onClick={(e) => {
                      const mk = markers.get(r);
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const onLine = mk && (mk.where === "top" ? e.clientY - rect.top < 6 : rect.bottom - e.clientY < 6);
                      if (mk && onLine) { saveHidden(hidden.filter((x) => !mk.titles.includes(x))); return; }
                      setSelRows((s0) => (e.ctrlKey || e.metaKey ? (s0.includes(row.title) ? s0.filter((x) => x !== row.title) : [...s0, row.title])
                        : (s0.length === 1 && s0[0] === row.title ? [] : [row.title])));
                    }}
                    onContextMenu={(e) => titleMenu(e, row, r)}>{rowTitle(row.title)}</th>
                  {visible.map(({ c, i }) => {
                    const cell = row.cells[i];
                    return (
                      <EditCell key={i} addr={{ tab: source, r: row.r, c: c.c }} text={cell.v} raw={cell.raw}
                        editable={!!cell.e} options={row.options ?? null}
                        className={(cell.alert ?? "") + (c.reference ? " ref" : "") + (cell.notes ? " has-note" : "")}
                        title={[cell.tip, notesTip(cell.notes)].filter(Boolean).join("\n") || undefined}
                        onContextMenu={menus ? (e, a) => menus.cellMenu(e, a, cell, `${c.trial_label}${c.ply ? " · " + c.ply : ""} · ${rowTitle(row.title)}`,
                          ed?.canWrite && !row.readonly ? [{ label: t("cm.fillRow"), onClick: () => menus.openFill(source, row.r, rowTitle(row.title),
                            row.options ?? null, cell.v) }, { sep: true }] : []) : undefined} />
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
