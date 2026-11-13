import type { Me } from "../api";
import { useI18n } from "../i18n";

export default function Home({ me }: { me: Me }) {
  const { t } = useI18n();
  const first = me.user.first_name || me.user.username;
  const level = `${me.user.access_level}${me.user.access_right ? ` (${me.user.access_right})` : ""}`;
  return (
    <div className="page">
      <h1>{t("home.welcome", { name: first })}</h1>
      <div className="card">
        <p>{t("home.intro")}</p>
        <p className="muted">{t("home.connected", { db: me.db, mode: me.mode, level })}</p>
        <p className="muted">{t("home.grey")}</p>
      </div>
    </div>
  );
}
