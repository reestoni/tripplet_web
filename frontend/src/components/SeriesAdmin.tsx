import { useCallback, useEffect, useState, type MouseEvent as RME, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { DeleteSeriesDialog } from "./SeriesDialogs";

/* Right-click menu of a series in Backlog and All Experiments, like the desktop:
   open (also in a new tab), change priority, change status, rename, reassign yarn and change
   machine (superusers), delete into the recycle bin. Rules: backend/app/series_manage.py. */

type Info = {
  name: string; prefix: string; editable: string; prio: number | null; status_id: number;
  machine_id: number | null; machine: string;
  statuses: { id: number; current: boolean; allowed: boolean; reason: string | null }[];
  rights: { rename: boolean; prio: boolean; machine: boolean; reassign_yarn: boolean; delete: boolean };
};
export type SeriesRef = { series_id: number; name: string };
type Dialog =
  | { kind: "prio"; s: SeriesRef; info: Info }
  | { kind: "rename"; s: SeriesRef; info: Info }
  | { kind: "machine"; s: SeriesRef; info: Info }
  | { kind: "yarn"; s: SeriesRef }
  | { kind: "delete"; s: SeriesRef }
  | { kind: "joker"; s: SeriesRef; to: number; machines: { id: number; name: string }[] };

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
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

export function useSeriesAdmin({ onChanged, onMessage }: {
  onChanged: () => void; onMessage: (kind: "ok" | "err", text: string) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cm = useContextMenu();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  const moveErr = useCallback((e: unknown) => {
    const key = e instanceof ApiError && e.code ? `bl.err.${e.code}` : "bl.err.other";
    onMessage("err", t(key) === key ? t("bl.err.other") : t(key));
  }, [onMessage, t]);

  const move = useCallback(async (s: SeriesRef, to: number, machineId?: number) => {
    try {
      const r = await api.moveCard(s.series_id, to, machineId);
      if (r.moved) {
        onMessage("ok", t("bl.moved", { status: t(`status.${to}`) }));
        window.dispatchEvent(new Event("tripplet:nav-changed"));
      }
      setDialog(null);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "need_machine") {
        setDialog({ kind: "joker", s, to, machines: (e.data?.machines as { id: number; name: string }[]) ?? [] });
      } else moveErr(e);
    }
  }, [onChanged, onMessage, t, moveErr]);

  /** Right-click on a card / row: the menu is built from what the server allows. */
  const open = useCallback(async (e: RME, s: SeriesRef) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = { clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent;
    let info: Info;
    try {
      info = await request<Info>("GET", `/api/series/${s.series_id}/manage`);
    } catch (err) {
      onMessage("err", errText(err));
      return;
    }
    const st = (code: string | null) => (code ? (t(`bl.err.${code}`) === `bl.err.${code}` ? t("bl.err.other") : t(`bl.err.${code}`)) : undefined);
    const items: MenuItem[] = [
      { label: t("sa.open"), onClick: () => navigate(`/series/${s.series_id}`) },
      { label: t("sa.openTab"), onClick: () => window.open(`/series/${s.series_id}`, "_blank") },
      { label: t("sa.openWindow"), onClick: () => window.open(`/series/${s.series_id}`, `series${s.series_id}`, "popup,width=1400,height=900") },
      { sep: true },
      { label: t("sa.prio"), disabled: !info.rights.prio, onClick: () => setDialog({ kind: "prio", s, info }) },
      { label: t("sa.status"), sub: info.statuses.map((x) => ({
        label: (x.current ? "✓ " : "") + t(`status.${x.id}`), disabled: !x.allowed, title: st(x.reason),
        onClick: () => move(s, x.id) })) },
      { label: t("sa.rename"), disabled: !info.rights.rename, title: info.rights.rename ? undefined : t("sa.noRename"),
        onClick: () => setDialog({ kind: "rename", s, info }) },
      // desktop "Copy TrialSeries": Add Trial Series with this series' experiment and jet rows
      { label: t("sa.copySeries"), title: t("sa.copySeriesTip"), onClick: () => navigate(`/series/new?copy=${s.series_id}`) },
      { sep: true },
      { label: t("sa.yarn"), disabled: !info.rights.reassign_yarn, title: info.rights.reassign_yarn ? undefined : t("sa.superOnly"),
        onClick: () => setDialog({ kind: "yarn", s }) },
      { label: t("sa.machine"), disabled: !info.rights.machine, title: info.rights.machine ? undefined : t("sa.superOnly"),
        onClick: () => setDialog({ kind: "machine", s, info }) },
      { label: t("sa.delete"), danger: true, disabled: !info.rights.delete, title: info.rights.delete ? undefined : t("sa.noDelete"),
        onClick: () => setDialog({ kind: "delete", s }) },
    ];
    cm.open(pos, items);
  }, [cm, move, navigate, onMessage, t]);

  const done = (text: string) => { close(); onMessage("ok", text); onChanged(); };

  const dialogs = (
    <>
      {cm.menu}
      {dialog?.kind === "prio" && <PrioDialog s={dialog.s} info={dialog.info} onClose={close} onDone={() => done(t("sa.saved"))} />}
      {dialog?.kind === "rename" && <RenameDialog s={dialog.s} info={dialog.info} onClose={close} onDone={() => done(t("sa.saved"))} />}
      {dialog?.kind === "machine" && <MachineDialog s={dialog.s} info={dialog.info} onClose={close} onDone={() => done(t("sa.saved"))} />}
      {dialog?.kind === "yarn" && <YarnDialog s={dialog.s} onClose={close} onDone={(n) => done(t("sa.yarnDone", { n }))} />}
      {dialog?.kind === "delete" && <DeleteSeriesDialog seriesId={dialog.s.series_id} name={dialog.s.name} onClose={close}
        onDone={() => { window.dispatchEvent(new Event("tripplet:nav-changed")); done(t("sa.deleted")); }} />}
      {dialog?.kind === "joker" && <JokerDialog d={dialog} onClose={close} onPick={(m) => move(dialog.s, dialog.to, m)} />}
    </>
  );
  return { open, move, dialogs };
}

function PrioDialog({ s, info, onClose, onDone }: { s: SeriesRef; info: Info; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(String(info.prio ?? 0));
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try { await request("POST", `/api/series/${s.series_id}/prio`, { prio: Number(v) }); onDone(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Modal title={t("sa.prioTitle")} onClose={onClose}>
      <p className="muted">{s.name}</p>
      <label>{t("sa.prioLabel")} <input type="number" min={0} max={999} autoFocus value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} /></label>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={v === "" || Number(v) < 0 || Number(v) > 999} onClick={go}>{t("sa.ok")}</button>
      </div>
    </Modal>
  );
}

function RenameDialog({ s, info, onClose, onDone }: { s: SeriesRef; info: Info; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(info.editable);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try { await request("POST", `/api/series/${s.series_id}/rename`, { text: v }); onDone(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Modal title={t("sa.renameTitle")} onClose={onClose}>
      {info.prefix && <p className="muted">{t("sa.prefixKept", { prefix: info.prefix.trim() })}</p>}
      <div className="sa-rename">
        {info.prefix && <span className="sa-prefix">{info.prefix}</span>}
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
      </div>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={!v.trim()} onClick={go}>{t("sa.ok")}</button>
      </div>
    </Modal>
  );
}

function MachineDialog({ s, info, onClose, onDone }: { s: SeriesRef; info: Info; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<{ id: number; name: string }[] | null>(null);
  const [v, setV] = useState<number | "">(info.machine_id ?? "");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    request<{ machines: { id: number; name: string }[] }>("GET", `/api/series/${s.series_id}/machines`)
      .then((r) => setList(r.machines)).catch((e) => setErr(errText(e)));
  }, [s.series_id]);
  const go = async () => {
    try { await request("POST", `/api/series/${s.series_id}/machine`, { machine_id: v }); onDone(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Modal title={t("sa.machineTitle")} onClose={onClose}>
      <p className="muted">{s.name} – {t("sa.currentMachine", { m: info.machine || "–" })}</p>
      <select className="search" autoFocus value={v} onChange={(e) => setV(e.target.value ? Number(e.target.value) : "")}>
        <option value="">–</option>
        {list?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {err && <div className="login-error">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={v === "" || v === info.machine_id} onClick={go}>{t("sa.ok")}</button>
      </div>
    </Modal>
  );
}

type YRow = { orig_ply: string | null; orig_yid: number | null; new_yid: number | null; deleted: boolean; is_new: boolean };

function YarnDialog({ s, onClose, onDone }: { s: SeriesRef; onClose: () => void; onDone: (n: number) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<YRow[] | null>(null);
  const [choices, setChoices] = useState<{ id: number; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<{ lines: { ply: string; yarn_id: number | null }[]; choices: { id: number; name: string }[] }>(
      "GET", `/api/series/${s.series_id}/yarn-lines`).then((r) => {
      setChoices(r.choices);
      setRows(r.lines.map((l) => ({ orig_ply: l.ply, orig_yid: l.yarn_id, new_yid: l.yarn_id, deleted: false, is_new: false })));
    }).catch((e) => setErr(errText(e)));
  }, [s.series_id]);
  const upd = (i: number, p: Partial<YRow>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const shown = (current: number | null) => {
    const f = q.trim().toLowerCase();
    const list = f ? choices.filter((c) => c.name.toLowerCase().includes(f)) : choices;
    const cur = choices.find((c) => c.id === current);
    return cur && !list.includes(cur) ? [cur, ...list.slice(0, 300)] : list.slice(0, 300);
  };
  // new ply numbers like the server (lines of the same original ply stay one ply)
  const labels = (() => {
    const out: string[] = [];
    const seen = new Map<string, number>();
    rows?.forEach((r, i) => {
      if (r.deleted) { out.push(""); return; }
      const k = r.is_new || !r.orig_ply ? `new${i}` : `old${r.orig_ply}`;
      if (!seen.has(k)) seen.set(k, seen.size + 1);
      out.push(`Ply ${seen.get(k)}`);
    });
    return out;
  })();
  const save = async () => {
    if (!rows) return;
    setBusy(true); setErr(null);
    try {
      const r = await request<{ conflicts: string[]; message: string; applied: boolean; changes?: number }>(
        "POST", `/api/series/${s.series_id}/yarns/reassign`, { rows, apply: true });
      if (r.applied) onDone(r.changes ?? 0); else setErr(r.message);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={t("sa.yarnTitle")} onClose={onClose} wide>
      <p className="muted">{s.name} – {t("sa.yarnHint")}</p>
      <input className="search" placeholder={t("sa.yarnSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows && (
        <table className="grid sa-yarns">
          <thead><tr><th>{t("sa.plyNow")}</th><th>{t("sa.plyNew")}</th><th>{t("sa.yarnCol")}</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.deleted ? "sa-del" : ""}>
                <td>{r.is_new ? t("sa.newPly") : r.orig_ply}</td>
                <td>{labels[i]}</td>
                <td>
                  <select disabled={r.deleted} value={r.new_yid ?? ""} onChange={(e) => upd(i, { new_yid: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">–</option>
                    {shown(r.new_yid).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td>
                  <button className="link-btn danger" onClick={() => (r.is_new ? setRows((rs) => rs && rs.filter((_x, j) => j !== i)) : upd(i, { deleted: !r.deleted }))}>
                    {r.deleted ? t("sa.undoDelete") : t("cm.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn-plain" disabled={!rows} onClick={() => setRows((rs) => rs && [...rs, { orig_ply: null, orig_yid: null, new_yid: null, deleted: false, is_new: true }])}>
        {t("sa.addPly")}
      </button>
      {err && <div className="login-error" style={{ whiteSpace: "pre-wrap" }}>{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("cm.cancel")}</button>
        <button className="btn-green" disabled={!rows || busy || rows.some((r) => !r.deleted && r.new_yid == null)} onClick={save}>{t("sa.ok")}</button>
      </div>
    </Modal>
  );
}

function JokerDialog({ d, onClose, onPick }: { d: { s: SeriesRef; machines: { id: number; name: string }[] }; onClose: () => void; onPick: (m: number) => void }) {
  const { t } = useI18n();
  const [m, setM] = useState<number | "">("");
  return (
    <Modal title={t("bl.machine.title")} onClose={onClose}>
      <p>{t("bl.machine.text", { series: d.s.name })}</p>
      <select className="search" value={m} autoFocus onChange={(e) => setM(e.target.value ? Number(e.target.value) : "")}>
        <option value="">–</option>
        {d.machines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("bl.machine.cancel")}</button>
        <button className="btn-green" disabled={m === ""} onClick={() => m !== "" && onPick(m)}>{t("bl.machine.ok")}</button>
      </div>
    </Modal>
  );
}
