import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, request } from "../api";
import { PasswordForm } from "./Settings";
import { LangFlags, useI18n } from "../i18n";
import { LOGO_BLACK } from "../brand";

/** startupError is a text key (e.g. "app.serverDown"). */
export default function Login({ onLoggedIn, startupError }: { onLoggedIn: () => void; startupError: string | null }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(startupError);
  useEffect(() => setError(startupError), [startupError]);      // server back: the message goes away by itself
  const [errVars, setErrVars] = useState<Record<string, string | number>>({});
  const [initial, setInitial] = useState<string | null>(null);   // user name: password = user name -> set a new one

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      onLoggedIn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "insecure_password") { setInitial(username.trim()); setError(null); }
      else {
        const d = (err instanceof ApiError && err.data) || {};
        const left = typeof d.left === "number" ? d.left : null;
        setErrVars({ n: typeof d.minutes === "number" ? d.minutes : 15, left: left ?? 0 });
        setError(err instanceof ApiError && err.code
          ? (err.code === "invalid" && left !== null && left <= 2 ? "login.err.invalidLeft" : `login.err.${err.code}`)
          : "app.serverDown");
      }
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
          <img className="login-logo" src={LOGO_BLACK} alt="TrippleT" />
          <div>
            <div className="login-brand-title">TrippleT</div>
            <div className="login-brand-sub">HEBERLEIN</div>
          </div>
        </div>
        {initial ? (<>
          <h1>{t("pw.initialTitle")}</h1>
          <p className="muted">{t("pw.initialHint")}</p>
          <PasswordForm onDone={onLoggedIn}
            submit={(old, nw, rep) => request("POST", "/api/auth/initial-password", { username: initial, old, new: nw, repeat: rep })} />
          <button type="button" className="btn-plain" onClick={() => setInitial(null)}>{t("pw.back")}</button>
        </>) : (<>
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
        {error === "app.serverDown" ? <div className="login-down">⚠ {t("app.serverDown")}<br /><span>{t("app.serverRetry")}</span></div>
          : error && <div className="login-error">{t(error, errVars)}</div>}
        <button className="btn-green" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? t("login.busy") : t("login.submit")}
        </button>
        </>)}
      </form>
    </div>
  );
}
