import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { img } from "./api";
import { TEXTS, type Lang, type TextKey } from "./texts";

export const LANGS: { code: Lang; flag: string; name: string; html: string }[] = [
  { code: "en", flag: "flag_gb.svg", name: "English", html: "en" },
  { code: "de", flag: "flag_de.svg", name: "Deutsch", html: "de" },
  { code: "es", flag: "flag_es.svg", name: "Español", html: "es" },
  { code: "zh", flag: "flag_cn.svg", name: "中文", html: "zh-CN" },
];

const STORE_KEY = "tripplet.lang";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && v in TEXTS) return v as Lang;
  } catch {
    /* storage blocked */
  }
  const nav = (navigator.language || "en").slice(0, 2);
  return (nav in TEXTS ? nav : "en") as Lang;
}

type Translate = (key: TextKey | string, vars?: Record<string, string | number>) => string;
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: Translate };

const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = LANGS.find((l) => l.code === lang)?.html ?? "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORE_KEY, l);
    } catch {
      /* storage blocked */
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      const table = TEXTS[lang] as Record<string, string>;
      let s = table[key] ?? (TEXTS.en as Record<string, string>)[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [lang],
  );

  return <I18n.Provider value={{ lang, setLang, t }}>{children}</I18n.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18n);
  if (!c) throw new Error("useI18n outside I18nProvider");
  return c;
}

/** Flag buttons to switch the language (login page and account area). */
export function LangFlags({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={"lang-flags " + className} role="group" aria-label={t("app.language")}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" className={l.code === lang ? "on" : ""} title={l.name}
          aria-pressed={l.code === lang} onClick={() => setLang(l.code)}>
          <img src={img(l.flag)} alt={l.name} />
        </button>
      ))}
    </div>
  );
}
