import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";

/* Knowledge Base like the desktop (ui/screen_onboarding.py): list on the left, the module page
   (same self-contained HTML as the desktop) on the right with the scene tabs above it.
   The page talks back through document.title: "scene:<n>", "quiz:<right>:<total>",
   "open:<module>", "tool:yarn_count". Scenes never change on their own (Nutzerwunsch). */

type Quiz = { right: number; total: number; passed: boolean } | null;
type Mod = { key: string; title: string; summary: string; minutes: number; quiz: Quiz };
type Cat = { key: string; title: string; modules: Mod[]; groups: { key: string; title: string; modules: Mod[] }[] };
type Catalog = { lang: string; start: Mod | null; areas: { key: string; title: string; categories: Cat[] }[];
  ui: Record<string, string> };
type ModInfo = { key: string; title: string; summary: string; scenes: string[]; url: string };

const LAST = "tripplet.kb.module";
const CLOSED = "tripplet.kb.closedAreas";

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const store = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};

type KBWindow = Window & { goScene?: (i: number) => void; setLang?: (l: string) => void };

export default function KnowledgeBase() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const { key: routeKey } = useParams();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [mod, setMod] = useState<ModInfo | null>(null);
  const [scene, setScene] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>(() => load(CLOSED, []));
  const frame = useRef<HTMLIFrameElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const modRef = useRef<ModInfo | null>(null);
  modRef.current = mod;

  const loadCatalog = useCallback(() => {
    request<Catalog>("GET", `/api/kb/catalog?lang=${lang}`).then(setCat).catch((e) => setError(String(e.message ?? e)));
  }, [lang]);
  useEffect(loadCatalog, [loadCatalog]);

  const key = routeKey || load<string | null>(LAST, null) || cat?.start?.key || null;

  // open a module: tabs + page (the page itself is only reloaded when the module changes)
  useEffect(() => {
    if (!key) return;
    let alive = true;
    request<ModInfo>("GET", `/api/kb/module/${encodeURIComponent(key)}?lang=${lang}`)
      .then((m) => {
        if (!alive) return;
        setError(null);
        const isNew = modRef.current?.key !== m.key;
        setMod(m);
        if (isNew) {
          setScene(0);
          setSrc(`${m.url}?lang=${langRef.current}&embedded=1`);
          store(LAST, m.key);
          request("POST", "/api/kb/opened", { key: m.key }).catch(() => undefined);
        } else {
          (frame.current?.contentWindow as KBWindow | null)?.setLang?.(lang);   // in place, keeps scene + position
        }
      })
      .catch((e) => {
        if (!alive) return;
        if (!routeKey && e instanceof ApiError && e.status === 404) { store(LAST, null); return; }   // module no longer exists
        setError(e instanceof ApiError ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [key, lang, routeKey]);

  const open = (k: string) => navigate(`/knowledge-base/${k}`);

  const onTitle = useCallback((title: string) => {
    if (title.startsWith("scene:")) {
      const n = Number(title.slice(6));
      if (Number.isFinite(n)) setScene(n);
    } else if (title.startsWith("open:")) {
      navigate(`/knowledge-base/${title.slice(5)}`);
    } else if (title.startsWith("tool:")) {
      if (title.slice(5) === "yarn_count") navigate("/yarn-count");
    } else if (title.startsWith("quiz:")) {
      const [, r, tot] = title.split(":");
      const m = modRef.current;
      if (!m) return;
      request("POST", "/api/kb/quiz", { key: m.key, right: Number(r), total: Number(tot), lang: langRef.current })
        .then(() => loadCatalog()).catch(() => undefined);
    }
  }, [navigate, loadCatalog]);

  // watch document.title of the page (same origin)
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    let last = doc.title;
    const obs = new MutationObserver(() => {
      if (doc.title !== last) {
        last = doc.title;
        onTitle(doc.title);
      }
    });
    obs.observe(doc.documentElement, { subtree: true, childList: true, characterData: true });
  };

  const goScene = (i: number) => {
    setScene(i);
    (frame.current?.contentWindow as KBWindow | null)?.goScene?.(i);
  };

  const toggleArea = (a: string) => {
    const next = closed.includes(a) ? closed.filter((x) => x !== a) : [...closed, a];
    setClosed(next);
    store(CLOSED, next);
  };

  const item = (m: Mod) => (
    <button key={m.key} className={"kb-item" + (mod?.key === m.key ? " on" : "")} onClick={() => open(m.key)}
      title={[`${m.summary}  (~${m.minutes} min)`,
        m.quiz && cat ? (cat.ui[m.quiz.passed ? "quizPassed" : "quizOpen"] ?? "").replace("{r}", String(m.quiz.right)).replace("{t}", String(m.quiz.total)) : ""]
        .filter(Boolean).join("\n")}>
      {m.title}
      {m.quiz?.passed && <span className="kb-tick">✓</span>}
    </button>
  );

  return (
    <div className="kb">
      <aside className="kb-list">
        <div className="kb-kicker">{cat?.ui.kicker ?? "KNOWLEDGE BASE"}</div>
        {cat?.start && <div className="kb-start">{item(cat.start)}</div>}
        {cat?.areas.map((a) => (
          <div key={a.key} className="kb-area">
            <button className="kb-area-head" onClick={() => toggleArea(a.key)}>
              {closed.includes(a.key) ? "▸" : "▾"} {a.title.toUpperCase()}
            </button>
            {!closed.includes(a.key) && a.categories.map((c) => (
              <div key={c.key} className="kb-cat">
                <div className="kb-cat-head">{c.title}</div>
                {c.modules.map(item)}
                {c.groups.map((g) => (
                  <div key={g.key} className="kb-group">
                    <div className="kb-group-head">{g.title}</div>
                    {g.modules.map(item)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </aside>
      <section className="kb-main">
        {error && <div className="card error">{error}</div>}
        {mod && (
          <>
            <div className="kb-head">
              <h1>{mod.title}</h1>
              <div className="muted">{mod.summary}</div>
            </div>
            {mod.scenes.length > 0 && (
              <div className="se-tabs" role="tablist">
                {mod.scenes.map((n, i) => (
                  <button key={i} role="tab" aria-selected={i === scene} className={"se-tab" + (i === scene ? " on" : "")}
                    onClick={() => goScene(i)}>{n}</button>
                ))}
              </div>
            )}
          </>
        )}
        {src && <iframe ref={frame} className="kb-frame" src={src} title={mod?.title ?? "Knowledge Base"} onLoad={onLoad} />}
      </section>
    </div>
  );
}
