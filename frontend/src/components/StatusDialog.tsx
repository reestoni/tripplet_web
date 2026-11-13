import { useState } from "react";
import { useI18n } from "../i18n";

export type StatusAsk = { row: number; title: string; newId: number; mode: "reason" | "confirm"; message: string };

/** Denial reason / confirmation when a superuser changes a request status (rules: db/experiment_requests.set_status). */
export default function StatusDialog({ ask, onOk, onCancel }: { ask: StatusAsk; onOk: (reason?: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{ask.mode === "reason" ? t("rq.denyTitle") : t("rq.confirmTitle")}</h2>
        <p className="muted">{ask.title}</p>
        {ask.mode === "reason" ? (
          <textarea className="search rq-reason" autoFocus value={reason} placeholder={t("rq.denyReason")}
            onChange={(e) => setReason(e.target.value)} />
        ) : (
          <p style={{ whiteSpace: "pre-wrap" }}>{ask.message}</p>
        )}
        <div className="modal-buttons">
          <button className="btn-plain" onClick={onCancel}>{t("bl.machine.cancel")}</button>
          <button className="btn-green" disabled={ask.mode === "reason" && !reason.trim()}
            onClick={() => onOk(ask.mode === "reason" ? reason.trim() : undefined)}>
            {t("rq.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
