import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { useDisplay, type DisplayPrefs } from "../display";

/* The user's own settings (desktop ui/widgets/user_settings_dialog.py + ui/screen_change_pw.py) on
   backend/app/settings_api.py - same stored values as the desktop. */

type Data = { welcome: string; welcome_max: number; first_name: string; accent: string; default_accent: string;
  user_id: number; avatar: number; initials: string;
  prefs: DisplayPrefs; start_options: { key: string; nav_route: string | null; web: boolean }[]; can_store: boolean };

export function PasswordForm({ onDone, submit }: { onDone: () => void;
  submit: (old: string, nw: string, rep: string) => Promise<unknown> }) {
  const { t } = useI18n();
  const [v, setV] = useState({ old: "", nw: "", rep: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await submit(v.old, v.nw, v.rep); setV({ old: "", nw: "", rep: "" }); onDone(); }
    catch (e) { setErr(e instanceof ApiError && e.code ? t(`pw.err.${e.code}`) : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="st-form">
      <label>{t("pw.old")}<input type="password" autoComplete="current-password" value={v.old} onChange={(e) => setV({ ...v, old: e.target.value })} /></label>
      <label>{t("pw.new")}<input type="password" autoComplete="new-password" value={v.nw} onChange={(e) => setV({ ...v, nw: e.target.value })} /></label>
      <label>{t("pw.repeat")}<input type="password" autoComplete="new-password" value={v.rep} onChange={(e) => setV({ ...v, rep: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} /></label>
      {err && <div className="login-error set-full">{err}</div>}
      <div className="set-full"><button type="button" className="btn-green" disabled={busy || !v.old || !v.nw || !v.rep} onClick={go}>{t("pw.change")}</button></div>
    </div>
  );
}

/* Profile picture (db/user_avatar.py, the same file as the desktop): stored right away, not with "Save". */
function AvatarBox({ d }: { d: Data }) {
  const { t } = useI18n();
  const [ver, setVer] = useState(d.avatar);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const changed = (v: number) => { setVer(v); window.dispatchEvent(new CustomEvent("tripplet:avatar", { detail: v })); };
  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/settings/avatar", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.code ? t(`set.avatarErr.${j.code}`) : String(j.detail ?? r.status));
      else changed(j.avatar);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setErr(null);
    try { await request("DELETE", "/api/settings/avatar"); changed(0); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <section className="set-box">
      <h2>{t("set.avatar")}</h2>
      <div className="set-row set-avatar">
        {ver ? <img className="set-avatar-img" src={`/api/avatar/${d.user_id}?v=${ver}`} alt="" />
          : <span className="set-avatar-img sb-avatar">{d.initials}</span>}
        <button type="button" className="btn-green" disabled={busy} onClick={() => input.current?.click()}>{t("set.avatarChoose")}</button>
        {ver > 0 && <button type="button" className="btn-plain" disabled={busy} onClick={remove}>{t("set.avatarRemove")}</button>}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      </div>
      {err && <div className="login-error">{err}</div>}
      <p className="muted">{t("set.avatarHint")}</p>
    </section>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const disp = useDisplay();
  const [d, setD] = useState<Data | null>(null);
  const [welcome, setWelcome] = useState("");
  const [accent, setAccent] = useState("#39a650");
  const [start, setStart] = useState("backlog");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    request<Data>("GET", "/api/settings").then((x) => {
      setD(x); setWelcome(x.welcome); setAccent(x.accent); setStart(x.prefs.start || "backlog");
    }).catch((e) => setMsg({ kind: "err", text: String(e) }));
  }, []);

  // Close = back to the screen the settings were opened from (opened directly -> start page).
  const navigate = useNavigate();
  const loc = useLocation();
  const close = () => { if (loc.key !== "default") navigate(-1); else navigate("/"); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (document.querySelector("[role=dialog], .modal-backdrop")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!d || !disp) return <div className="muted">{msg?.text ?? t("app.loading")}</div>;
  const p = disp.prefs;

  const save = async () => {
    try {
      await request("POST", "/api/settings", { welcome, accent, start,
        prefs: { contrast: p.contrast, crosshair: p.crosshair, readbar: p.readbar, alert_marks: p.alert_marks, cb_colours: p.cb_colours, scale: p.scale } });
      document.documentElement.style.setProperty("--accent", accent);
      setMsg({ kind: "ok", text: t("set.saved") });
    } catch (e) { setMsg({ kind: "err", text: e instanceof ApiError && e.code ? t(`set.err.${e.code}`) : String(e) }); }
  };
  const tog = (k: keyof DisplayPrefs) => disp.set({ [k]: !p[k] } as Partial<DisplayPrefs>, false);

  return (
    <div className="page set-page">
      <div className="page-head"><h1>{t("set.title")}</h1>
        <button type="button" className="set-close" title={`${t("set.close")} (Esc)`} onClick={close}>✕ {t("set.close")}</button></div>

      <AvatarBox d={d} />

      <section className="set-box">
        <h2>{t("set.welcome")}</h2>
        <input className="mj-search set-wide" maxLength={d.welcome_max} value={welcome} placeholder={t("bl.welcome", { name: d.first_name })}
          onChange={(e) => setWelcome(e.target.value)} />
        <p className="muted">{t("set.welcomeHint", { n: d.welcome_max })}</p>
      </section>

      <section className="set-box">
        <h2>{t("set.start")}</h2>
        <label className="st-goto">{t("set.startLabel")}
          <select value={start} onChange={(e) => setStart(e.target.value)}>
            {d.start_options.map((o) => <option key={o.key} value={o.key}>{o.nav_route ? t(`nav.${o.nav_route}`) : o.key}{o.web ? "" : ` (${t("set.desktopOnly")})`}</option>)}
          </select></label>
        <p className="muted">{t("set.startHint")}</p>
      </section>

      <section className="set-box">
        <h2>{t("set.theme")}</h2>
        <div className="set-themes">
          {(["classic", "modern", "night", "blueprint"] as const).map((k) => (
            <label key={k} className={"set-theme" + ((p.theme ?? "classic") === k ? " on" : "")}>
              <input type="radio" name="theme" checked={(p.theme ?? "classic") === k} onChange={() => disp.set({ theme: k })} />
              <span className={"set-theme-swatch " + k} aria-hidden="true"><i /><b /></span>
              <span><b>{t(`set.theme.${k}`)}</b><br /><span className="muted small">{t(`set.theme.${k}Hint`)}</span></span>
            </label>
          ))}
        </div>
        <p className="muted">{t("set.themeHint")}</p>
      </section>

      <section className="set-box">
        <h2>{t("set.accent")}</h2>
        <span className="set-row">
          <input type="color" value={accent} onChange={(e) => { setAccent(e.target.value); document.documentElement.style.setProperty("--accent", e.target.value); }} />
          <code>{accent}</code>
          <button className="btn-plain" onClick={() => { setAccent(d.default_accent); document.documentElement.style.setProperty("--accent", d.default_accent); }}>{t("set.defaultGreen")}</button>
        </span>
      </section>

      <section className="set-box">
        <h2>{t("set.textSize")}</h2>
        <p className="muted">{t("set.textSizeWeb")}</p>
      </section>

      <section className="set-box">
        <h2>{t("set.tables")}</h2>
        {(["contrast", "crosshair", "readbar", "alert_marks", "cb_colours"] as const).map((k) => (
          <label key={k} className="st-check set-check"><input type="checkbox" checked={!!p[k]} onChange={() => tog(k)} /> {t(`set.${k}`)}</label>
        ))}
        <p className="muted">{t("set.zoomHint")} {p.scale !== 100 && <>{t("set.zoomNow", { n: p.scale })} <button className="btn-plain" onClick={() => disp.set({ scale: 100 }, false)}>100 %</button></>}</p>
        <table className="pivot set-preview" onClick={(e) => { const td = (e.target as HTMLElement).closest("td"); if (td) window.dispatchEvent(new CustomEvent("tripplet:cell-focus", { detail: td })); }}>
          <thead><tr><th className="pv-corner" /><th>V1</th><th>V2</th><th>V3</th></tr></thead>
          <tbody>
            <tr><th scope="row">{t("set.pvTenacity")}</th><td>42.1</td><td className="red">38.7</td><td>41.9</td></tr>
            <tr><th scope="row">{t("set.pvElong")}</th><td className="orange">21.5</td><td>24.0</td><td>23.8</td></tr>
            <tr><th scope="row">{t("set.pvShrink")}</th><td>5.2</td><td>5.0</td><td>5.4</td></tr>
          </tbody>
        </table>
        <p className="muted">{t("set.previewHint")}</p>
      </section>

      <div className="toolbar">
        <button className="btn-green" onClick={save}>{t("mj.save")}</button>
        {msg && <span className={msg.kind === "err" ? "mj-msg err" : "mj-msg"}>{msg.text}</span>}
      </div>

      <section className="set-box">
        <h2>{t("pw.title")}</h2>
        {pwDone ? <p className="mj-msg">{t("pw.done")}</p> : (
          <PasswordForm onDone={() => setPwDone(true)}
            submit={(old, nw, rep) => request("POST", "/api/settings/password", { old, new: nw, repeat: rep })} />
        )}
      </section>
    </div>
  );
}
