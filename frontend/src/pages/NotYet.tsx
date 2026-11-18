import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PHONE, useMedia } from "../media";
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

/** Phone: these tools are left out (media.ts PHONE_HIDDEN) - a note instead of the page. */
export function PcOnly({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const phone = useMedia(PHONE);
  if (!phone) return <>{children}</>;
  return (
    <div className="page">
      <div className="card pc-only">
        <p>🖥 {t("mob.pcOnly")}</p>
        <button className="btn-plain" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>← {t("se.back")}</button>
      </div>
    </div>
  );
}
