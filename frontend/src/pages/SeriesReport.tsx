import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { request } from "../api";
import { useI18n } from "../i18n";
import { RequestIcon } from "../components/RequestPopup";

/** The desktop's series Report page, unchanged, in an iframe (served by the backend at /report/series/:id). */
export default function SeriesReport() {
  const { t } = useI18n();
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rid = params.get("report");
  const src = `/report/series/${Number(id)}` + (rid ? `?report_id=${encodeURIComponent(rid)}` : "");
  const [erId, setErId] = useState<string | number | null>(null);
  useEffect(() => {
    setErId(null);
    request<{ request_id: string | number | null }>("GET", `/api/series/${Number(id)}/request`)
      .then((d) => setErId(d.request_id)).catch(() => setErId(null));
  }, [id]);
  return (
    <div className="report-page">
      <div className="report-bar">
        <button className="btn-plain" onClick={() => navigate(`/series/${id}`)}>← {t("rep.back")}</button>
        <span className="muted">{t("rep.hint")}</span>
        <span style={{ flex: 1 }} />
        {/* ER icon like the desktop ReportScreen header button (Qt button, not part of the HTML page) */}
        {erId != null && <RequestIcon id={erId} big />}
      </div>
      <iframe className="report-frame" src={src} title="Report" />
    </div>
  );
}
