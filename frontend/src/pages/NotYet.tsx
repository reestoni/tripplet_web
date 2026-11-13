import { Link, useLocation } from "react-router-dom";
import { useI18n } from "../i18n";

export default function NotYet() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <div className="page">
      <h1>{t("notyet.title")}</h1>
      <div className="card">
        <p>{t("notyet.text", { path: pathname })}</p>
        <Link to="/">{t("notyet.back")}</Link>
      </div>
    </div>
  );
}
