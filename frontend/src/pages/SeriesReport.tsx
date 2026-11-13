import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";

/** The desktop's series Report page, unchanged, in an iframe (served by the backend at /report/series/:id). */
export default function SeriesReport() {
  const { t } = useI18n();
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rid = params.get("report");
  const src = `/report/series/${Number(id)}` + (rid ? `?report_id=${encodeURIComponent(rid)}` : "");
  return (
    <div className="report-page">
      <div className="report-bar">
        <button className="btn-plain" onClick={() => navigate(`/series/${id}`)}>← {t("rep.back")}</button>
        <span className="muted">{t("rep.hint")}</span>
      </div>
      <iframe className="report-frame" src={src} title="Report" />
    </div>
  );
}
