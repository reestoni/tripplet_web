import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, img, request } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "./SeriesTools";

/* Help like the desktop:
   - context help of a screen (ui/widgets/multilang_help.py: tabs of blocks, EN/DE/ES flags) - the "?" buttons
   - help search "where do I find…?" (ui/widgets/help_search.py), F1 anywhere / sidebar "Help (F1)":
     "How do I…?" entries of all helps + Knowledge Base hits, Take me there, Open full help, feedback.
   "Ask AI" of the desktop is deliberately left out of the web app (user decision 2026-11-13).
   Contents and search come from the desktop modules via backend/app/help.py; usage events are the
   desktop's help_* events (Usage Stats -> Help). Help texts exist in EN/DE/ES/ZH. */

const HELP_LANGS = [
  { code: "en", flag: "flag_gb.svg", name: "English" },
  { code: "de", flag: "flag_de.svg", name: "Deutsch" },
  { code: "es", flag: "flag_es.svg", name: "Español" },
  { code: "zh", flag: "flag_cn.svg", name: "中文" },
];
const LANG_KEY = "tripplet.helpLang";

/** Help language: shared by all helps (desktop QSettings "Help/language"), default = app language. */
export function useHelpLang(): [string, (l: string) => void] {
  const { lang: appLang } = useI18n();
  const [lang, setLangState] = useState<string>(() => {
    try {
      const v = localStorage.getItem(LANG_KEY);
      if (v && HELP_LANGS.some((l) => l.code === v)) return v;
    } catch { /* storage blocked */ }
    return HELP_LANGS.some((l) => l.code === appLang) ? appLang : "en";
  });
  const setLang = useCallback((l: string) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* storage blocked */ }
  }, []);
  return [lang, setLang];
}

export function HelpFlags({ lang, onPick }: { lang: string; onPick: (l: string) => void }) {
  return (
    <div className="lang-flags hl-flags" role="group">
      {HELP_LANGS.map((l) => (
        <button key={l.code} type="button" className={l.code === lang ? "on" : ""} title={l.name}
          aria-pressed={l.code === lang} onClick={() => onPick(l.code)}>
          <img src={img(l.flag)} alt={l.name} />
        </button>
      ))}
    </div>
  );
}

/** Open the help from anywhere: openHelp() = search, openHelp("backlog") = context help of a screen. */
export function openHelp(screen?: string, tab?: string) {
  window.dispatchEvent(new CustomEvent("tripplet:help", { detail: { screen, tab } }));
}

/** The round "?" of a screen (desktop make_help_button). */
export function HelpButton({ screen, tab, className = "" }: { screen: string; tab?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <button type="button" className={"rq-help " + className} onClick={() => openHelp(screen, tab)} title={t(`help.tip.${screen}`)}>?</button>
  );
}

/** Lives in the Shell: F1 opens the search, events open search or context help. */
export function HelpHost() {
  const [open, setOpen] = useState<{ screen?: string; tab?: string } | null>(null);
  useEffect(() => {
    const onEvent = (e: Event) => setOpen((e as CustomEvent).detail ?? {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); setOpen({}); }
    };
    window.addEventListener("tripplet:help", onEvent);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("tripplet:help", onEvent); window.removeEventListener("keydown", onKey); };
  }, []);
  if (!open) return null;
  return open.screen
    ? <ScreenHelp screen={open.screen} tab={open.tab} onClose={() => setOpen(null)} />
    : <HelpSearch onClose={() => setOpen(null)} />;
}

/* ------------------------------------------------------------------ context help */
type Block =
  | { t: "p" | "note" | "warn"; html: string } | { t: "h"; text: string }
  | { t: "task"; q: string; steps: string[]; note: string } | { t: "ul"; items: string[] }
  | { t: "areas"; rows: [string, string][] } | { t: "table"; head: string[]; rows: string[][] }
  | { t: "svg"; src: string; w: number; h: number };
type HelpTexts = { window_title: string; close: string; tabs: { key: string; title: string; blocks: Block[] }[] };

const Html = ({ html, className, tag = "div" }: { html: string; className?: string; tag?: "div" | "span" | "li" | "td" | "b" }) => {
  const Tag = tag;
  // help texts are the desktop's own data modules (ui/widgets/help_texts_*.py), not user input
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};

function HelpBlock({ b }: { b: Block }) {
  switch (b.t) {
    case "p": return <Html html={b.html} className="hl-p" />;
    case "note": return <Html html={b.html} className="hl-p hl-note" />;
    case "warn": return <Html html={b.html} className="hl-p hl-warn" />;
    case "h": return <h3 className="hl-h">{b.text}</h3>;
    case "task":
      return (
        <div className="hl-task">
          <Html html={b.q} tag="b" />
          <ol>{b.steps.map((s, i) => <Html key={i} html={s} tag="li" />)}</ol>
          {b.note && <Html html={b.note} className="muted" />}
        </div>
      );
    case "ul": return <ul className="hl-p">{b.items.map((s, i) => <Html key={i} html={s} tag="li" />)}</ul>;
    case "areas":
      return (
        <table className="hl-areas"><tbody>
          {b.rows.map(([l, h], i) => <tr key={i}><td className="nowrap"><b>{l}</b></td><Html html={h} tag="td" /></tr>)}
        </tbody></table>
      );
    case "table":
      return (
        <table className="grid hl-table">
          <thead><tr>{b.head.map((h, i) => <Html key={i} html={h} tag="td" />)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, k) => <Html key={k} html={c} tag="td" />)}</tr>)}</tbody>
        </table>
      );
    case "svg": return b.src ? <img className="hl-svg" src={b.src} width={b.w} height={b.h} alt="" /> : null;
  }
}

export function ScreenHelp({ screen, tab, onClose }: { screen: string; tab?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [lang, setLang] = useHelpLang();
  const [texts, setTexts] = useState<Record<string, HelpTexts> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState<string | null>(tab ?? null);
  useEffect(() => {
    request<{ texts: Record<string, HelpTexts> }>("GET", `/api/help/screen/${screen}`).then((r) => setTexts(r.texts))
      .catch((e) => setErr(e instanceof ApiError ? t("help.noHelp") : String(e)));
  }, [screen, t]);
  const tx = texts ? texts[lang] ?? texts.en ?? Object.values(texts)[0] : null;
  const tabs = tx?.tabs ?? [];
  const active = tabs.find((x) => x.key === cur) ?? tabs[0];
  return (
    <Modal title={tx?.window_title ?? t("help.title")} onClose={onClose} wide>
      <div className="hl-dialog">
        {texts && <HelpFlags lang={lang} onPick={setLang} />}
        {err && <p className="login-error">{err}</p>}
        {!texts && !err && <p className="muted">{t("app.loading")}</p>}
        {tabs.length > 1 && (
          <div className="se-tabs">
            {tabs.map((x) => (
              <button key={x.key} className={"se-tab" + (x.key === active?.key ? " on" : "")} onClick={() => setCur(x.key)}>{x.title}</button>
            ))}
          </div>
        )}
        <div className="hl-body">{active?.blocks.map((b, i) => <HelpBlock key={`${active.key}${i}`} b={b} />)}</div>
        <div className="modal-buttons"><button className="btn-plain" onClick={onClose}>{tx?.close ?? t("rqp.close")}</button></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ help search (F1) */
type Entry = { q: string; steps: string[]; note: string };
type Hit = {
  key: string; screen: string; tab: string; best_lang: string; by_lang: Record<string, Entry>;
  kb: boolean; route: string; web_ready: boolean; screen_name?: string; needs_series?: boolean; has_areas?: boolean;
  full_help?: boolean; summary?: Record<string, string>;
};
const plain = (h: string) => {
  const d = document.createElement("div");
  d.innerHTML = h;
  return (d.textContent ?? "").replace(/\s+/g, " ").trim();
};

function HelpSearch({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [lang, setLang] = useHelpLang();
  const [pinned, setPinned] = useState(false);         // a flag was clicked: stop following the question's language
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [fbGiven, setFbGiven] = useState<Set<string>>(new Set());
  const opened = useRef<string | null>(null);
  const state = useRef({ q: "", n: 0 });
  state.current = { q: q.trim(), n: hits.length };

  const log = (event: string, detail: string) =>
    request("POST", "/api/help/log", { event, detail: detail.slice(0, 250) }).catch(() => undefined);

  useEffect(() => {
    // closing without opening anything = help_search_noresult / _noclick (desktop done())
    return () => {
      const s = state.current;
      if (s.q && opened.current == null) log(s.n ? "help_search_noclick" : "help_search_noresult", `${s.q} | hits=${s.n}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const qq = q.trim();
    if (!qq) { setHits([]); return; }
    const h = window.setTimeout(() => {
      request<{ hits: Hit[] }>("GET", `/api/help/search?q=${encodeURIComponent(qq)}`).then((r) => {
        setHits(r.hits); setSel(0);
        if (r.hits.length && !pinned && r.hits[0].best_lang !== lang && HELP_LANGS.some((l) => l.code === r.hits[0].best_lang)) {
          setLang(r.hits[0].best_lang);
        }
      }).catch(() => setHits([]));
    }, 200);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hit = hits[sel] ?? null;
  const entry = (h: Hit) => h.by_lang[lang] ?? h.by_lang[h.best_lang];
  const fbId = hit && q.trim() ? `${q.trim()} -> ${hit.key}` : null;

  const go = (h: Hit | null = hit) => {
    if (!h) return;
    if (!h.kb && !h.web_ready) return;
    opened.current = h.key;
    log("help_search_open", `${q.trim()} -> ${h.key}`);
    onClose();
    navigate(h.route);
  };
  const full = () => {
    if (!hit || hit.kb) return;
    opened.current = hit.key;
    log("help_search_open", `${q.trim()} -> ${hit.key} (full help)`);
    onClose();
    openHelp(hit.screen, hit.tab);
  };
  const feedback = (up: boolean) => {
    if (!fbId || fbGiven.has(fbId)) return;
    setFbGiven(new Set(fbGiven).add(fbId));
    log(up ? "help_feedback_up" : "help_feedback_down", fbId);
  };

  const detail = useMemo(() => {
    if (!hit) return null;
    const e = entry(hit);
    if (hit.kb) {
      return (
        <>
          <p className="hl-where kb">{t("help.kb")}</p>
          <Html html={e.q} className="hl-q" />
          <p>{hit.summary?.[e === hit.by_lang[lang] ? lang : hit.best_lang] ?? ""}</p>
          <p className="muted">{t("help.kbHint")}</p>
        </>
      );
    }
    return (
      <>
        <p className="hl-where">{t("help.screen")}: {hit.screen_name}</p>
        <Html html={e.q} className="hl-q" />
        <ol>{e.steps.map((s, i) => <Html key={i} html={s} tag="li" />)}</ol>
        {e.note && <Html html={e.note} className="muted" />}
        {hit.needs_series && <p className="hl-warn hl-p">{t("help.needsSeries")}</p>}
        {hit.has_areas && <p className="muted hl-small">{t("help.areas")}</p>}
        {!hit.web_ready && <p className="muted hl-small">{t("help.notInWeb")}</p>}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit, lang, t]);

  return (
    <Modal title={t("help.title")} onClose={onClose} wide>
      <div className="hl-search">
        <HelpFlags lang={lang} onPick={(l) => { setLang(l); setPinned(true); }} />
        <div className="hl-qrow">
          <input className="search" autoFocus value={q} placeholder={t("help.placeholder")} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        </div>
        <p className="muted hl-hint">
          {!q.trim() ? t("help.hint") : hits.length === 0 ? t("help.none") : ""}
        </p>
        <div className="hl-split">
          <div className="hl-list" role="listbox">
            {hits.map((h, i) => (
              <button key={h.key} role="option" aria-selected={i === sel} className={"hl-item" + (i === sel ? " on" : "") + (h.kb ? " kb" : "")}
                onClick={() => setSel(i)} onDoubleClick={() => go(h)}>
                <span>{plain(entry(h).q)}</span>
                <small>{h.kb ? t("help.kb") : h.screen_name}</small>
              </button>
            ))}
          </div>
          <div className="hl-detail">
            {detail}
            {hit && (
              <div className="hl-actions">
                {fbId && (fbGiven.has(fbId) ? <span className="muted">{t("help.fbThanks")}</span> : (
                  <>
                    <span className="muted">{t("help.fbQ")}</span>
                    <button className="btn-plain" onClick={() => feedback(true)}>{t("help.fbUp")}</button>
                    <button className="btn-plain" onClick={() => feedback(false)}>{t("help.fbDown")}</button>
                  </>
                ))}
                <span style={{ flex: 1 }} />
                {!hit.kb && hit.full_help !== false && <button className="btn-plain" onClick={full}>{t("help.full")}</button>}
                <button className="btn-green" disabled={!hit.kb && !hit.web_ready} onClick={() => go()}
                  title={!hit.kb && !hit.web_ready ? t("help.notInWeb") : undefined}>{hit.kb ? t("help.kbOpen") : t("help.go")}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
