import { img } from "../api";
import { useI18n } from "../i18n";
import { Overlay } from "./RequestPopup";

/** "How do Experiment Requests work?" - same content as the desktop
 *  ui/widgets/experiment_request_help_dialog.py (lifecycle diagram + note about the copy when editing). */
export default function RequestHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Overlay onClose={onClose} wide="rqp-help">
      <h2>{t("rqh.title")}</h2>
      <p className="muted">{t("rqh.intro")}</p>
      <img className="rqh-flow" src={img("experiment_request_flow.svg")} alt={t("rqh.title")} />
      <div className="rqh-note"><b>{t("rqh.noteHead")}</b> {t("rqh.note")}</div>
      <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{t("rqp.close")}</button></div>
    </Overlay>
  );
}
