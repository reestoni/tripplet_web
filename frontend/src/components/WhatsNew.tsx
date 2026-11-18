import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PHONE, TABLET, useMedia } from "../media";
import { request } from "../api";
import { HelpFlags, useHelpLang } from "./Help";

/* "Fresh off the Spool" (desktop ui/whats_new.py) on backend/app/whats_new_api.py: versions on the left (NEW for
   unseen ones), the features of the chosen version as cards with their sketch, one tab per section, search over all
   versions. Texts EN/DE/ES/ZH from the desktop module (flags shared with the help). Opens once by itself after login when
   the newest version is unseen; closing marks it seen (same value as the desktop).
   PC/tablet: a dialog (WhatsNewHost). Phone (user 2026-11-18): a normal page /whats-new (WhatsNewPage) under the top bar,
   so the menu stays usable - the host only navigates there. */

type Card = { id: string; title: string; text: string; where: string; sketch: string | null };
type Release = { index: number; version: string; when: string; unseen: boolean; current: boolean; sections: { title: string; features: Card[] }[] };
type Data = { lang: string; releases: Release[]; labels: Record<string, string>; has_unseen: boolean };
type Hit = Card & { release: number; version: string };

export function openWhatsNew() { window.dispatchEvent(new Event("tripplet:whats-new")); }

function CardView({ c, where }: { c: Card; where: string }) {
  return (
    <div className="wn-card">
      <div className="wn-card-text">
        <div className="wn-card-title">{c.title}</div>
        {/* texts come from the desktop module (our own code, simple <b>/<i> markup) */}
        <div dangerouslySetInnerHTML={{ __html: c.text }} />
        {c.where && <div className="wn-where"><span>{where}</span> <span dangerouslySetInnerHTML={{ __html: c.where }} /></div>}
      </div>
      {c.sketch && <img className="wn-sketch" src={`/api/whats-new/sketch/${c.sketch}`} alt="" />}
    </div>
  );
}

/* PC/tablet: the dialog; phone: sends the user to the page /whats-new instead (also the automatic opening). */
export function WhatsNewHost() {
  const [open, setOpen] = useState<false | "auto" | "manual">(false);
  const phone = useMedia(PHONE);
  const navigate = useNavigate();
  const checked = useRef(false);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  useEffect(() => {
    const show = (mode: "auto" | "manual") => {
      if (phoneRef.current) navigate("/whats-new", { state: { auto: mode === "auto" } });
      else setOpen(mode);
    };
    const onOpen = () => show("manual");
    window.addEventListener("tripplet:whats-new", onOpen);
    if (!checked.current) {      // once after login: open by itself if the newest version is unseen
      checked.current = true;
      request<{ has_unseen: boolean }>("GET", "/api/whats-new/status").then((r) => { if (r.has_unseen) show("auto"); }).catch(() => undefined);
    }
    return () => window.removeEventListener("tripplet:whats-new", onOpen);
  }, [navigate]);

  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal wn" onMouseDown={(e) => e.stopPropagation()}>
        <WhatsNewPanel auto={open === "auto"} onClose={close} />
      </div>
    </div>
  );
}

/* Phone: "Fresh off the Spool" as a page (route /whats-new) - leaving it marks the newest version seen like closing. */
export function WhatsNewPage() {
  const navigate = useNavigate();
  const loc = useLocation();
  const auto = !!(loc.state as { auto?: boolean } | null)?.auto;
  return (
    <div className="page wn-page">
      <WhatsNewPanel auto={auto} page onClose={() => (loc.key !== "default" ? navigate(-1) : navigate("/"))} />
    </div>
  );
}

function WhatsNewPanel({ auto, onClose, page }: { auto: boolean; onClose: () => void; page?: boolean }) {
  const [lang, setLang] = useHelpLang();
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  // phone/tablet (MOBILE.md): search + version choice as one bar at the top instead of the list beside the cards
  const small = useMedia(TABLET);
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    request<Data>("GET", `/api/whats-new?lang=${lang}`).then((d) => {
      setData(d);
      setSel((s) => (s < d.releases.length ? s : 0));
    }).catch(() => undefined);
  }, [lang]);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const h = setTimeout(() => {
      request<{ hits: Hit[] }>("GET", `/api/whats-new/search?lang=${lang}&q=${encodeURIComponent(q)}`).then((r) => setHits(r.hits)).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, lang]);
  useEffect(() => setTab(0), [sel]);
  // seen = when it closes, also when a page is left through the menu (desktop: closing the window)
  const autoRef = useRef(auto);
  useEffect(() => () => { request("POST", "/api/whats-new/seen", { auto: autoRef.current }).catch(() => undefined); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !page) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, page]);

  const hitCount = useMemo(() => {
    const m: Record<number, number> = {};
    for (const h of hits ?? []) m[h.release] = (m[h.release] ?? 0) + 1;
    return m;
  }, [hits]);

  const L = data?.labels ?? {};
  const rel = data?.releases[sel];
  return (
    <>
        <div className="wn-head">
          <img className="wn-logo" src="/api/whats-new/sketch/fresh_off_the_spool.png" alt="" />
          <div>{page ? <h1>{L.WINDOW_TITLE ?? "Fresh off the Spool"}</h1> : <h2>{L.WINDOW_TITLE ?? "Fresh off the Spool"}</h2>}<div className="muted">{L.SUBTITLE}</div></div>
          <span style={{ flex: 1 }} />
          <HelpFlags lang={lang} onPick={setLang} />
        </div>
        {!data ? <p className="muted">…</p> : (
          <div className={"wn-body" + (small ? " wn-compact" : "")}>
            {small && (
              <div className="wn-mnav">
                <select value={hits ? "" : sel} onChange={(e) => { setSel(Number(e.target.value)); setQ(""); }} aria-label={L.VERSIONS_TITLE}>
                  {hits && <option value="">{(L.SEARCH_RESULTS ?? "").replace("{n}", String(hits.length)).replace("{q}", q)}</option>}
                  {data.releases.map((r, i) => (
                    <option key={r.index} value={i}>
                      {L.VERSION_LABEL} {r.version} · {r.current && !r.when ? L.CURRENT_LABEL : r.when}{r.unseen ? ` · ${L.NEW_BADGE}` : ""}
                      {hits && hitCount[r.index] ? ` · ${hitCount[r.index]} ${L.HITS_LABEL}` : ""}
                    </option>))}
                </select>
                <input className="wn-search" placeholder={L.SEARCH_PLACEHOLDER} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
            <div className="wn-side">
              <input className="wn-search" placeholder={L.SEARCH_PLACEHOLDER} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="wn-vtitle">{L.VERSIONS_TITLE}</div>
              {data.releases.map((r, i) => (
                <div key={r.index} className={"wn-ver" + (i === sel && !hits ? " on" : "") + (hits && !hitCount[r.index] ? " dim" : "")}
                  onClick={() => { setSel(i); setQ(""); }}>
                  <b>{L.VERSION_LABEL} {r.version}</b>{r.unseen && <span className="wn-new">{L.NEW_BADGE}</span>}
                  <div className="muted">{r.current && !r.when ? L.CURRENT_LABEL : r.when}{hits && hitCount[r.index] ? ` · ${hitCount[r.index]} ${L.HITS_LABEL}` : ""}</div>
                </div>))}
            </div>
            <div className="wn-main">
              {hits ? (<>
                <div className="muted wn-sub">{hits.length ? (L.SEARCH_RESULTS ?? "").replace("{n}", String(hits.length)).replace("{q}", q) : (L.SEARCH_NONE ?? "").replace("{q}", q)}</div>
                {hits.map((h) => <div key={h.id}><div className="wn-hitver">{L.VERSION_LABEL} {h.version}</div><CardView c={h} where={L.WHERE_LABEL} /></div>)}
              </>) : rel && (<>
                {rel.sections.length > 1 && (
                  <div className="se-tabs">{rel.sections.map((s, i) => (
                    <button key={i} className={"se-tab" + (tab === i ? " on" : "")} onClick={() => setTab(i)}>{s.title || "–"} ({s.features.length})</button>))}</div>)}
                {(rel.sections[tab] ?? rel.sections[0])?.features.map((c) => <CardView key={c.id} c={c} where={L.WHERE_LABEL} />)}
              </>)}
            </div>
          </div>
        )}
        {/* the phone page has no close button - it is left like any page (menu, back) */}
        {!page && <div className="modal-buttons"><button className="btn-green" onClick={onClose}>{L.CLOSE ?? "Close"}</button></div>}
    </>
  );
}
