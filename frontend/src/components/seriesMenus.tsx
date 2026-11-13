import { useCallback, useState, type MouseEvent as RME, type ReactNode } from "react";
import type { CellNote, SeriesRights } from "../api";
import { useEdit, type CellAddr, type Change } from "../edit";
import { useI18n } from "../i18n";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { DeleteTrialsDialog, FillDialog, HistoryDialog, NotesDialog, RetestDialog, type CellRef } from "./SeriesDialogs";

/* Right-click menus of Show Experiment, shared by the lab tabs, Machine Data and R&D
   (desktop: _add_cell_note_actions, _add_cell_history_action, _on_trial_header_menu,
   "Fill row", "Flag for retest", "Delete V…"). */

type Dialog =
  | { kind: "notes"; target: CellRef; where: string }
  | { kind: "history"; target: CellRef | null; where: string }
  | { kind: "fill"; tab: string; r: number; title: string; options: [number | string, string][] | null; defaultText: string }
  | { kind: "retest"; tab: string; tabTitle: string; trial: { id: number; label: string } }
  | { kind: "delete"; trialIds: number[] };

export type Trial = { id: number; label: string };

export function useSeriesMenus({ seriesId, rights, trials, mode, onChanged }: {
  seriesId: number; rights: SeriesRights | null; trials: Trial[]; mode: () => string; onChanged: () => void;
}) {
  const { t } = useI18n();
  const ed = useEdit();
  const cm = useContextMenu();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selTrials, setSelTrials] = useState<number[]>([]);

  const cellTarget = useCallback((a: CellAddr): CellRef => ({ ...a, mode: mode(),
    unit: localStorage.getItem("tripplet.jetair.unit") || "Nm3h" }), [mode]);

  const copyItems = (): MenuItem[] => [
    { sep: true },
    { label: t("cm.copy"), title: "Ctrl+C", onClick: () => document.execCommand("copy") },
    ...(ed?.canWrite ? [{ label: t("cm.clear"), title: "Delete", onClick: () => {
      const changes: Change[] = [];
      for (const a of ed.selectedAddrs()) {
        const info = ed.info(a);
        if (info?.editable) changes.push({ ...a, value: info.options ? null : "", display: "" });
      }
      ed.setMany(changes);
    } }] : []),
  ];

  /** Value cell: notes, change history (superusers), copy/clear. */
  const cellMenu = useCallback((e: RME, a: CellAddr, cell: { e?: number; notes?: CellNote[] }, where: string, extra: MenuItem[] = []) => {
    const items: MenuItem[] = [...extra];
    if (cell.e && rights?.notes) {
      const n = cell.notes?.length ?? 0;
      items.push({ label: n ? t("cm.notesN", { n }) : t("cm.addNoteMenu"),
        onClick: () => setDialog({ kind: "notes", target: cellTarget(a), where }) });
    }
    if (cell.e && rights?.history) {
      items.push({ label: t("cm.history"), onClick: () => setDialog({ kind: "history", target: cellTarget(a), where }) });
    }
    items.push(...copyItems());
    cm.open(e, items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rights, cellTarget, cm, t, ed]);

  /** Trial header: notes on the whole trial, retest (lab tabs, superusers), delete trial(s). */
  const trialMenu = useCallback((e: RME, trial: Trial, notes: CellNote[], lab?: { tab: string; title: string }) => {
    const items: MenuItem[] = [];
    if (rights?.notes) {
      items.push({ label: notes.length ? t("cm.trialNotesN", { trial: trial.label, n: notes.length }) : t("cm.trialNote", { trial: trial.label }),
        onClick: () => setDialog({ kind: "notes", target: { trial_id: trial.id }, where: trial.label }) });
    }
    if (lab && rights?.retest) {
      items.push({ label: t("cm.retestMenu", { trial: trial.label }),
        onClick: () => setDialog({ kind: "retest", tab: lab.tab, tabTitle: lab.title, trial }) });
    }
    if (rights?.write) {
      const sel = selTrials.includes(trial.id) && selTrials.length > 1 ? selTrials : [trial.id];
      items.push({ sep: true });
      const unsaved = (ed?.dirtyCount ?? 0) > 0;      // desktop: save or discard first, the columns change
      items.push({ label: sel.length > 1 ? t("cm.deleteTrialsN", { n: sel.length }) : t("cm.deleteTrial", { trial: trial.label }),
        danger: true, disabled: !rights.delete_trials || unsaved,
        title: !rights.delete_trials ? t("cm.deleteTrialsNo") : unsaved ? t("cm.saveFirst") : undefined,
        onClick: () => setDialog({ kind: "delete", trialIds: sel }) });
    }
    if (rights?.history) {
      items.push({ sep: true }, { label: t("cm.seriesHistory"), onClick: () => setDialog({ kind: "history", target: null, where: "" }) });
    }
    cm.open(e, items);
  }, [rights, selTrials, cm, t, ed]);

  /** Click on a trial header selects it (Ctrl/Shift+click adds) - "Delete n selected trials". */
  const clickTrial = useCallback((e: RME, id: number) => {
    setSelTrials((s) => {
      if (e.ctrlKey || e.metaKey) return s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      if (e.shiftKey && s.length) {
        const ids = trials.map((x) => x.id);
        const a = ids.indexOf(s[s.length - 1]), b = ids.indexOf(id);
        return [...new Set([...s, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])];
      }
      return s.length === 1 && s[0] === id ? [] : [id];
    });
  }, [trials]);

  const openFill = useCallback((tab: string, r: number, title: string, options: [number | string, string][] | null, defaultText: string) =>
    setDialog({ kind: "fill", tab, r, title, options, defaultText }), []);

  const close = () => setDialog(null);
  const dialogs: ReactNode = (
    <>
      {cm.menu}
      {dialog?.kind === "notes" && <NotesDialog seriesId={seriesId} target={dialog.target} where={dialog.where} onClose={close} onChanged={onChanged} />}
      {dialog?.kind === "history" && <HistoryDialog seriesId={seriesId} target={dialog.target} where={dialog.where} onClose={close} />}
      {dialog?.kind === "fill" && (
        <FillDialog seriesId={seriesId} tab={dialog.tab} r={dialog.r} mode={mode()} title={dialog.title} options={dialog.options}
          defaultText={dialog.defaultText} onClose={close} onFill={(ch) => ed?.setMany(ch)} />
      )}
      {dialog?.kind === "retest" && (
        <RetestDialog seriesId={seriesId} tab={dialog.tab} tabTitle={dialog.tabTitle} trial={dialog.trial} onClose={close} onDone={onChanged} />
      )}
      {dialog?.kind === "delete" && (
        <DeleteTrialsDialog seriesId={seriesId} trialIds={dialog.trialIds} onClose={close}
          onDone={() => { setSelTrials([]); onChanged(); }} />
      )}
    </>
  );
  return { cellMenu, trialMenu, clickTrial, selTrials, openFill, open: cm.open, dialogs };
}

export type SeriesMenus = ReturnType<typeof useSeriesMenus>;
