import { img } from "../api";

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
  return (
    <span className="series-icons">
      {attach && <img src={img("attach.png")} alt="" title="Image or PDF attached" />}
      {request != null && <img src={img("experiment_request.png")} alt="" title={`Experiment Request ${request}`} />}
      {notes && <img src={img("notes.png")} alt="" title="Series has notes" />}
      {reports > 0 && <img src={img("analytics.png")} alt="" title={`${reports} saved report(s)`} />}
    </span>
  );
}
