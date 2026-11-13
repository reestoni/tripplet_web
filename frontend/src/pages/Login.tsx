import { useState, type FormEvent } from "react";
import { api, ApiError, img } from "../api";
import { LangFlags, useI18n } from "../i18n";

/** startupError is a text key (e.g. "app.serverDown"). */
export default function Login({ onLoggedIn, startupError }: { onLoggedIn: () => void; startupError: string | null }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(startupError);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.code ? `login.err.${err.code}` : "app.serverDown");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <LangFlags className="login-flags" />
        <div className="login-brand">
          <img className="login-logo" src={img("tricolour_black.png")} alt="TrippleT" />
          <div>
            <div className="login-brand-title">TrippleT</div>
            <div className="login-brand-sub">HEBERLEIN</div>
          </div>
        </div>
        <h1>{t("login.title")}</h1>
        <label>
          {t("login.username")}
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          {t("login.password")}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="login-error">{t(error)}</div>}
        <button className="btn-green" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? t("login.busy") : t("login.submit")}
        </button>
      </form>
    </div>
  );
}
