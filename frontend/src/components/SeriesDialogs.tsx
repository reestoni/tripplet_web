import { useEffect, useState, type ReactNode } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import type { Change } from "../edit";

/* Dialogs behind the right-click menus of Show Experiment (same rules as the desktop,
   checked again on the server: backend/app/series_actions.py). */

export type CellRef = { tab: string; r: number; c: number; mode?: string; unit?: string } | { trial_id: number };

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={"modal" + (wide ? " modal-wide" : "")} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

type Note = { id: number; text: string; user: string; when: string; edited: boolean; changed_since: boolean;
  can_edit: boolean; can_delete: boolean };

/** Notes on one value or on a whole trial: read, add, change (author), delete (author/superuser). */
export function NotesDialog({ seriesId, target, where, onClose, onChanged }: {
  seriesId: number; target: CellRef; where: string; onClose: () => void; onChanged: () => void;
}) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => request<{ available: boolean; notes: Note[] }>("POST", `/api/series/${seriesId}/notes/list`, target)
    .then((r) => setNotes(r.notes)).catch((e) => setErr(errText(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={t("cm.notesTitle", { where })} onClose={onClose}>
      {notes === null && !err && <div className="muted">{t("se.loading")}</div>}
      {notes?.length === 0 && <div className="muted">{t("cm.noNotes")}</div>}
      <div className="nd-list">
        {notes?.map((n) => (
          <div key={n.id} className="nd-note">
            <div className="nd-by">
              <b>{n.user || "?"}</b> · {n.when}{n.edited ? ` · ${t("cm.edited")}` : ""}
              {n.changed_since && <span className="nd-changed" title={t("cm.changedSinceTip")}>{t("cm.changedSince")}</span>}
            </div>
            {editing?.id === n.id ? (
              <>
                <textarea autoFocus rows={3} value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} />
                <div className="nd-btns">
                  <button className="btn-plain" onClick={() => setEditing(null)}>{t("cm.cancel")}</button>
                  <button className="btn-green" disabled={busy || !editing.text.trim()}
                    onClick={() => run(async () => { await request("PUT", `/api/notes/${n.id}`, { text: editing.text }); setEditing(null); })}>
                    {t("cm.saveNote")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="nd-text">{n.text}</div>
                {(n.can_edit || n.can_delete) && (
                  <div className="nd-btns">
                    {n.can_edit && <button className="link-btn" onClick={() => setEditing({ id: n.id, text: n.text })}>{t("cm.edit")}</button>}
                    {n.can_delete && <button className="link-btn danger" disabled={busy}
                      onClick={() => { if (window.confirm(t("cm.deleteNoteQ"))) run(() => request("DELETE", `/api/notes/${n.id}`)); }}>
                      {t("cm.delete")}</button>}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <textarea rows={3} placeholder={t("cm.newNote")} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.close")}</button>
        <button className="btn-green" disabled={busy || !text.trim()}
          onClick={() => run(async () => { await request("POST", `/api/series/${seriesId}/notes`, { ...target, text }); setText(""); })}>
          {t("cm.addNote")}
        </button>
      </div>
    </Modal>
  );
}

type HistRow = { when: string; who: string; old: string; new: string; trial?: string; param?: string };

/** Change history of one value, or of the whole series (superusers). */
export function HistoryDialog({ seriesId, target, where, onClose }: {
  seriesId: number; target: CellRef | null; where: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const [whole, setWhole] = useState(target === null);
  const [rows, setRows] = useState<HistRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    const p = whole ? request<{ rows: HistRow[] }>("GET", `/api/series/${seriesId}/history`)
      : request<{ rows: HistRow[] }>("POST", `/api/series/${seriesId}/history`, target);
    p.then((r) => setRows(r.rows)).catch((e) => setErr(errText(e)));
  }, [whole, seriesId, target]);
  return (
    <Modal title={t("cm.historyTitle", { where: whole ? t("cm.wholeSeries") : where })} onClose={onClose} wide>
      {target !== null && (
        <label className="md-radio"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> {t("cm.wholeSeries")}</label>
      )}
      {err && <div className="login-error">{err}</div>}
      {rows === null && !err && <div className="muted">{t("se.loading")}</div>}
      {rows && (rows.length === 0 ? <p className="muted">{t("cm.noHistory")}</p> : (
        <div className="table-wrap hist-wrap">
          <table className="grid">
            <thead><tr>
              <th>{t("cm.hWhen")}</th><th>{t("cm.hWho")}</th>
              {whole && <><th>{t("nt.trial")}</th><th>{t("cm.hParam")}</th></>}
              <th>{t("cm.hOld")}</th><th>{t("cm.hNew")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap">{r.when}</td><td className="nowrap">{r.who}</td>
                  {whole && <><td>{r.trial}</td><td>{r.param}</td></>}
                  <td>{r.old}</td><td>{r.new}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {rows && <p className="muted">{rows.length ? t("cm.historyCount", { n: rows.length }) : ""}</p>}
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("cm.close")}</button></div>
    </Modal>
  );
}

type FillInfo = { kind: "housing" | "jet" | "dropdown" | "text"; n_trials: number; plies: string[]; default: string | null; read_only: boolean };

/** "Fill row…" of Machine Data / R&D: one value into trials from..to (and chosen plies).
    The cells become unsaved edits (yellow) - saved with Save like any other change. */
export function FillDialog({ seriesId, tab, r, mode, title, options, defaultText, onClose, onFill }: {
  seriesId: number; tab: string; r: number; mode: string; title: string;
  options: [number | string, string][] | null; defaultText: string; onClose: () => void;
  onFill: (changes: Change[]) => void;
}) {
  const { t } = useI18n();
  const [info, setInfo] = useState<FillInfo | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [value, setValue] = useState("");
  const [plies, setPlies] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    request<FillInfo>("POST", `/api/series/${seriesId}/fill/info`, { tab, r, mode }).then((x) => {
      setInfo(x); setTo(x.n_trials); setPlies(x.plies);
      setValue(x.kind === "text" ? defaultText : (x.default ?? ""));
    }).catch((e) => setErr(errText(e)));
  }, [seriesId, tab, r, mode, defaultText]);
  const go = async () => {
    setErr(null);
    try {
      const res = await request<{ edits: { c: number; value: string; display: string }[] }>("POST", `/api/series/${seriesId}/fill`,
        { tab, r, mode, start: from, end: to, value: value === "" ? null : value, plies: info?.plies.length ? plies : null });
      onFill(res.edits.map((e) => ({ tab, r, c: e.c, value: e.value, display: e.display })));
      onClose();
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <Modal title={t("cm.fillTitle", { row: title })} onClose={onClose}>
      {!info && !err && <div className="muted">{t("se.loading")}</div>}
      {info && (
        <div className="fill-form">
          <label>{t("cm.fromTrial")} <input type="number" min={1} max={info.n_trials} value={from} onChange={(e) => setFrom(Number(e.target.value))} /></label>
          <label>{t("cm.toTrial")} <input type="number" min={1} max={info.n_trials} value={to} onChange={(e) => setTo(Number(e.target.value))} /></label>
          <span className="muted">{t("cm.trialRange", { n: info.n_trials })}</span>
          <label className="fill-value">{t("cm.value")}{" "}
            {info.kind === "text" || !options ? (
              <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
            ) : (
              <select autoFocus value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">–</option>
                {options.map(([id, name]) => <option key={String(id)} value={String(id)}>{name}</option>)}
              </select>
            )}
          </label>
          {info.plies.length > 0 && (
            <div className="fill-plies">
              <span className="muted">{t("cm.plies")}</span>
              {info.plies.map((p) => (
                <label key={p} className="md-radio">
                  <input type="checkbox" checked={plies.includes(p)}
                    onChange={() => setPlies((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))} /> {p}
                </label>
              ))}
            </div>
          )}
          <p className="muted">{t("cm.fillHint")}</p>
        </div>
      )}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={!info} onClick={go}>{t("cm.fill")}</button>
      </div>
    </Modal>
  );
}

/** Flag a trial for retest on a lab tab (superusers) - the series goes back to the Backlog. */
export function RetestDialog({ seriesId, tab, tabTitle, trial, onClose, onDone }: {
  seriesId: number; tab: string; tabTitle: string; trial: { id: number; label: string }; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try {
      await request("POST", `/api/series/${seriesId}/retest`, { tab, trial_id: trial.id, note });
      onDone(); onClose();
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <Modal title={t("cm.retestTitle", { trial: trial.label, tab: tabTitle })} onClose={onClose}>
      <p className="muted">{t("cm.retestText")}</p>
      <textarea autoFocus rows={3} placeholder={t("cm.retestNote")} value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" onClick={go}>{t("cm.retest")}</button>
      </div>
    </Modal>
  );
}

/** Delete trials into the recycle bin (numbers of the other trials never move). */
export function DeleteTrialsDialog({ seriesId, trialIds, onClose, onDone }: {
  seriesId: number; trialIds: number[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [p, setP] = useState<{ names: string; all: boolean; retention_days: number; rows: { what: string; n: number }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<typeof p>("POST", `/api/series/${seriesId}/trials/delete/preview`, { trial_ids: trialIds }).then(setP).catch((e) => setErr(errText(e)));
  }, [seriesId, trialIds]);
  const go = async () => {
    setBusy(true);
    try {
      await request("POST", `/api/series/${seriesId}/trials/delete`, { trial_ids: trialIds });
      onDone(); onClose();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={t("cm.delTrialsTitle")} onClose={onClose}>
      {p && (
        <>
          <p><b>{t("cm.delTrialsQ", { names: p.names, n: trialIds.length })}</b></p>
          <p>{t("cm.alsoDeleted")} {p.rows.length ? p.rows.map((x) => `${x.what}: ${x.n}`).join(", ") : t("cm.nothingElse")}</p>
          <p className="muted">{t("cm.numbersStay")}</p>
          {p.all && <p><b>{t("cm.allTrials")}</b></p>}
          <p className="muted">{t("cm.restoreHint", { days: p.retention_days })}</p>
        </>
      )}
      {!p && !err && <div className="muted">{t("se.loading")}</div>}
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-danger" disabled={!p || busy} onClick={go}>{t("cm.delete")}</button>
      </div>
    </Modal>
  );
}

/** Delete a whole series into the recycle bin (Backlog / All Experiments / Show Experiment). */
export function DeleteSeriesDialog({ seriesId, name, onClose, onDone }: {
  seriesId: number; name: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await request("POST", `/api/series/${seriesId}/delete`);
      onDone(); onClose();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={t("cm.delSeriesTitle")} onClose={onClose}>
      <p><b>{t("cm.delSeriesQ", { name })}</b></p>
      <p>{t("cm.delSeriesText")}</p>
      <p className="muted">{t("cm.restoreHint", { days: 90 })}</p>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-danger" disabled={busy} onClick={go}>{t("cm.delete")}</button>
      </div>
    </Modal>
  );
}
