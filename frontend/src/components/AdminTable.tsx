import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";

/* Editable master-data table like the desktop admin screens (Manage Jets, later Manage Yarn):
   frozen first columns, sort per header click, filter row (text = contains; number columns also
   "<5", ">=2", "1..3"), FK columns as dropdowns, bool columns as checkboxes, changed cells yellow
   until saved. The page holds the changes and saves them. */

export type Row = Record<string, unknown>;
export type FkItems = [number | string, string][];

export type AdminTableProps = {
  columns: string[];
  frozen: number;
  idCol: string;
  rows: Row[];
  fk: Record<string, FkItems>;
  boolCols: Set<string>;
  numericCols: Set<string>;
  editable: Set<string>;
  canEdit: boolean;
  changes: Record<string, Row>;
  onEdit: (id: number, col: string, value: unknown) => void;
  selected: Set<number>;
  onSelect: (ids: Set<number>) => void;
  onOpen?: (id: number) => void;
  search?: string;
  searchCols?: string[];
  header?: (col: string) => ReactNode;
  cell?: (col: string, row: Row) => ReactNode | undefined;
  narrow?: Set<string>;
  detail?: (row: Row) => ReactNode | null;
  onCount?: (shown: number) => void;
};

const FROZEN_W = [70, 170, 40];

export function displayValue(v: unknown, col: string, fk: Record<string, FkItems>, boolCols: Set<string>): string {
  if (boolCols.has(col)) return v === 1 || v === true || v === "1" ? "☑" : "☐";
  if (v === null || v === undefined) return "";
  const items = fk[col];
  if (items) {
    const hit = items.find(([i]) => String(i) === String(v));
    return hit ? hit[1] : String(v);
  }
  return String(v);
}

function toNum(s: string): number | null {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function matches(filter: string, text: string, raw: unknown, numeric: boolean): boolean {
  const f = filter.trim();
  if (!f) return true;
  if (numeric) {
    const range = f.match(/^(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)$/);
    const cmp = f.match(/^(<=|>=|<|>|=)\s*(-?[\d.,]+)$/);
    const n = raw === null || raw === undefined || raw === "" ? null : toNum(String(raw));
    if (range) {
      const lo = toNum(range[1]), hi = toNum(range[2]);
      return n !== null && lo !== null && hi !== null && n >= lo && n <= hi;
    }
    if (cmp) {
      const x = toNum(cmp[2]);
      if (n === null || x === null) return false;
      return cmp[1] === "<" ? n < x : cmp[1] === "<=" ? n <= x : cmp[1] === ">" ? n > x : cmp[1] === ">=" ? n >= x : n === x;
    }
  }
  return text.toLowerCase().includes(f.toLowerCase());
}

export default function AdminTable(p: AdminTableProps) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{ id: number; col: string } | null>(null);
  const [editing, setEditing] = useState<{ id: number; col: string } | null>(null);
  const anchor = useRef<number | null>(null);

  const value = (row: Row, col: string) => {
    const id = Number(row[p.idCol]);
    const ch = p.changes[id];
    return ch && col in ch ? ch[col] : row[col];
  };
  const text = (row: Row, col: string) => displayValue(value(row, col), col, p.fk, p.boolCols);

  const shown = useMemo(() => {
    const terms = (p.search ?? "").trim().toLowerCase();
    let out = p.rows.filter((r) => {
      if (terms && !(p.searchCols ?? []).some((c) => text(r, c).toLowerCase().includes(terms))) return false;
      for (const [c, f] of Object.entries(filters)) {
        if (f && !matches(f, text(r, c), value(r, c), p.numericCols.has(c))) return false;
      }
      return true;
    });
    if (sort) {
      const num = p.numericCols.has(sort.col) && !p.fk[sort.col];
      out = [...out].sort((a, b) => {
        const va = num ? value(a, sort.col) : text(a, sort.col).toLowerCase();
        const vb = num ? value(b, sort.col) : text(b, sort.col).toLowerCase();
        const ea = va === null || va === undefined || va === "", eb = vb === null || vb === undefined || vb === "";
        if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;      // empty always last
        if (num) return (Number(va) - Number(vb)) * sort.dir;
        return String(va).localeCompare(String(vb)) * sort.dir;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rows, p.changes, p.search, filters, sort, p.fk]);

  useEffect(() => { p.onCount?.(shown.length); }, [shown.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const clickHeader = (col: string) =>
    setSort((s) => (!s || s.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));

  const selectRow = (id: number, e: React.MouseEvent) => {
    const next = new Set(e.ctrlKey || e.metaKey ? p.selected : []);
    if (e.shiftKey && anchor.current !== null) {
      const ids = shown.map((r) => Number(r[p.idCol]));
      const a = ids.indexOf(anchor.current), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((i) => next.add(i));
    } else if ((e.ctrlKey || e.metaKey) && next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      anchor.current = id;
    }
    p.onSelect(next);
  };

  const canEditCell = (col: string) => p.canEdit && p.editable.has(col);

  const clickCell = (row: Row, col: string, e: React.MouseEvent) => {
    const id = Number(row[p.idCol]);
    const same = active && active.id === id && active.col === col;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey) && same && canEditCell(col) && !p.boolCols.has(col)) setEditing({ id, col });
    setActive({ id, col });
    if (!same || !p.selected.has(id) || e.ctrlKey || e.shiftKey) selectRow(id, e);
  };

  const commit = (id: number, col: string, raw: unknown) => {
    setEditing(null);
    const row = p.rows.find((r) => Number(r[p.idCol]) === id);
    if (!row) return;
    const cur = value(row, col);
    if (String(cur ?? "") === String(raw ?? "")) return;
    p.onEdit(id, col, raw);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    // Ctrl+C: selected rows as tab-separated text (desktop copy_selection_to_clipboard, for Excel)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && p.selected.size) {
      e.preventDefault();
      const rows = shown.filter((r) => p.selected.has(Number(r[p.idCol])));
      const cols = p.columns.filter((c) => !p.narrow?.has(c));
      const tsv = [cols.join("\t"), ...rows.map((r) => cols.map((c) => text(r, c).replace(/[\t\n]/g, " ")).join("\t"))].join("\n");
      navigator.clipboard?.writeText(tsv).catch(() => undefined);
      return;
    }
    if (!active) return;
    if ((e.key === "Enter" || e.key === "F2") && canEditCell(active.col) && !p.boolCols.has(active.col)) {
      e.preventDefault();
      setEditing(active);
    }
  };

  const left = (i: number) => FROZEN_W.slice(0, i).reduce((a, b) => a + b, 0);
  const frozenStyle = (i: number) =>
    i < p.frozen ? { position: "sticky" as const, left: left(i), width: FROZEN_W[i], minWidth: FROZEN_W[i], maxWidth: FROZEN_W[i], zIndex: 2 } : undefined;

  const editor = (row: Row, col: string) => {
    const id = Number(row[p.idCol]);
    const v = value(row, col);
    const items = p.fk[col];
    if (items) {
      return (
        <select autoFocus className="at-edit" defaultValue={v === null || v === undefined ? "" : String(v)}
          onChange={(e) => commit(id, col, e.target.value === "" ? null : items.find(([i]) => String(i) === e.target.value)?.[0] ?? e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(null)}>
          <option value="" />
          {items.map(([i, n]) => <option key={String(i)} value={String(i)}>{n}</option>)}
        </select>
      );
    }
    return (
      <input autoFocus className="at-edit" defaultValue={v === null || v === undefined ? "" : String(v)}
        inputMode={p.numericCols.has(col) ? "decimal" : undefined}
        onBlur={(e) => commit(id, col, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(id, col, (e.target as HTMLInputElement).value);
          if (e.key === "Escape") setEditing(null);
        }} />
    );
  };

  return (
    <div className="at-wrap" tabIndex={0} onKeyDown={onKey}>
      <table className="at">
        <thead>
          <tr>
            {p.columns.map((c, i) => (
              <th key={c} style={frozenStyle(i)} className={(i === p.frozen - 1 ? "at-lastfrozen " : "") + (p.narrow?.has(c) ? "at-narrow" : "")}
                onClick={() => clickHeader(c)} title={c}>
                {p.header ? p.header(c) : c}
                {sort?.col === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                {filters[c] ? " ⏷" : ""}
              </th>
            ))}
          </tr>
          <tr className="at-filters">
            {p.columns.map((c, i) => (
              <th key={c} style={frozenStyle(i)} className={i === p.frozen - 1 ? "at-lastfrozen" : ""}>
                {p.narrow?.has(c) ? null : (
                  <input value={filters[c] ?? ""} placeholder={t("adm.filter")}
                    title={p.numericCols.has(c) && !p.fk[c] ? t("adm.filter_num") : t("adm.filter_text")}
                    onChange={(e) => setFilters((f) => ({ ...f, [c]: e.target.value }))} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const id = Number(row[p.idCol]);
            const ch = p.changes[id];
            const det = p.detail?.(row);
            return (
              <Fragment key={id}>
                <tr className={p.selected.has(id) ? "sel" : ""}>
                  {p.columns.map((c, i) => {
                    const special = p.cell?.(c, row);
                    const isEdit = editing && editing.id === id && editing.col === c;
                    const dirty = ch && c in ch;
                    const cls = [i === p.frozen - 1 ? "at-lastfrozen" : "", dirty ? "dirty" : "",
                      active && active.id === id && active.col === c ? "active" : "",
                      p.numericCols.has(c) && !p.fk[c] ? "num" : "", !canEditCell(c) ? "ro" : ""].join(" ");
                    if (special !== undefined) {
                      return <td key={c} style={frozenStyle(i)} className={cls + " at-special"}
                        onClick={(e) => selectRow(id, e)}>{special}</td>;
                    }
                    if (p.boolCols.has(c)) {
                      const on = value(row, c) === 1 || value(row, c) === true;
                      return (
                        <td key={c} style={frozenStyle(i)} className={cls + " at-bool"} onClick={(e) => { setActive({ id, col: c }); selectRow(id, e); }}>
                          <input type="checkbox" checked={on} disabled={!canEditCell(c)}
                            onChange={() => p.onEdit(id, c, on ? 0 : 1)} onClick={(e) => e.stopPropagation()} />
                        </td>
                      );
                    }
                    return (
                      <td key={c} style={frozenStyle(i)} className={cls}
                        onClick={(e) => !isEdit && clickCell(row, c, e)}
                        onDoubleClick={() => !canEditCell(c) && p.onOpen?.(id)}>
                        {isEdit ? editor(row, c) : text(row, c)}
                      </td>
                    );
                  })}
                </tr>
                {det && (
                  <tr className="at-detail">
                    <td colSpan={p.columns.length}><div className="at-detail-in">{det}</div></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {Object.values(filters).some(Boolean) && (
        <button className="btn-plain at-clear" onClick={() => setFilters({})}>✕ {t("adm.clear_filters")}</button>
      )}
    </div>
  );
}

/* Drag & drop list of the movable columns + "Save layout" (desktop ColumnOrderDialog: reordering
   alone is not saved, only the button saves it for this user). */
export function ColumnOrderDialog(props: { columns: string[]; onChange: (cols: string[]) => void; onSave: () => void;
  onClose: () => void; label?: (c: string) => string }) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...props.columns];
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c);
    props.onChange(next);
    setSaved(false);
  };
  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="modal at-cols" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{t("adm.cols_title")}</h2>
        <p className="muted">{t("adm.cols_hint")}</p>
        <ul>
          {props.columns.map((c, i) => (
            <li key={c} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
              className={drag === i ? "dragging" : ""}>
              <span className="at-grip">⠿</span> {props.label ? props.label(c) : c}
              <span className="at-arrows">
                <button disabled={i === 0} onClick={() => move(i, i - 1)}>▲</button>
                <button disabled={i === props.columns.length - 1} onClick={() => move(i, i + 1)}>▼</button>
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-buttons">
          {saved && <span className="muted">{t("adm.cols_saved")}</span>}
          <button className="btn-green" onClick={() => { props.onSave(); setSaved(true); }}>{t("adm.cols_save")}</button>
          <button className="btn-plain" onClick={props.onClose}>{t("adm.close")}</button>
        </div>
      </div>
    </div>
  );
}
