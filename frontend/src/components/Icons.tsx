import { img } from "../api";
import { useI18n } from "../i18n";

/** The small status icons used in All Experiments and on Backlog cards (same PNGs as the desktop). */
export function SeriesIcons({
  attach,
  request,
  notes,
  reports,
}: {
  attach: boolean;
  request: string | number | null;
  notes: boolean;
  reports: number;
}) {
  const { t } = useI18n();
  return (
    <span className="series-icons">
      {attach && <img src={img("attach.png")} alt="" title={t("icon.attach")} />}
      {request != null && <img src={img("experiment_request.png")} alt="" title={t("icon.request", { id: request })} />}
      {notes && <img src={img("notes.png")} alt="" title={t("icon.notes")} />}
      {reports > 0 && <img src={img("analytics.png")} alt="" title={t("icon.reports", { n: reports })} />}
    </span>
  );
}
