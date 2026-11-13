import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Modal } from "../components/SeriesTools";

/* Stock take (desktop ui/widgets/stock_take_round_dialog.py + stock_take_dialog.py) on
   backend/app/stock_take_api.py / db/stock_take.py.
   Overview of a round: tiles per location (rack x level), results, Excel; superusers start / close rounds and
   leave locations out. Clicking a tile opens the scan view for that location (write access, level 2).
   Moves / put-backs are saved at once; missing spools are discarded only at Finish on an explicit click. */

type Tile = { location: string; col: number; state: "open" | "ok" | "deviation" | "excluded"; excluded: boolean;
  checked_at: string | null; checked_by: string; found: number; expected: number; extra: number; now: number;
  devs: { spool_id: number | null; result: string; detail: string }[]; more_devs: number };
type Rack = { rack: string; done: number; todo: number; levels: { level: string; tiles: Tile[] }[] };
type Item = { location: string; spool_id: number | null; yarn: string; batch: string; result: string; detail: string;
  seen_at: string; deviation: boolean; by_hand: boolean; checked_by: string; checked_at: string };
type Round = { id: number; name: string; open: boolean; started: string; closed: string | null; started_by: string };
type Overview = { available: boolean; can_write: boolean; superuser: boolean; rounds: Round[]; round: Round | null;
  racks: Rack[]; items: Item[]; summary: Record<string, number> | null };
type Spool = { id: number; yarn: string; batch: string; location: string; status: string; weight: number | null };
type T = (k: string, v?: Record<string, string | number>) => string;

const RESULTS = ["found", "moved_here", "moved_elsewhere", "elsewhere", "restocked", "discarded", "unknown", "missing_kept", "missing_discarded"];
const RESULT_BG: Record<string, string> = { found: "#EAF3DE", missing_kept: "#FCEBEB", missing_discarded: "#FCEBEB", unknown: "#FCEBEB" };

function errText(t: T, e: unknown): string {
  if (e instanceof ApiError && e.code) {
    const k = `stk.err.${e.code}`;
    const s = t(k);
    if (s !== k) return s;
  }
  return e instanceof Error ? e.message : String(e);
}

export default function StockTake() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [data, setData] = useState<Overview | null>(null);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [tab, setTab] = useState<"locations" | "results">("locations");
  const [onlyDev, setOnlyDev] = useState(true);
  const [locFilter, setLocFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tile: Tile; x: number; y: number } | null>(null);
  const [ask, setAsk] = useState<null | { text: string; yes: () => void }>(null);
  const [starting, setStarting] = useState(false);
  const [check, setCheck] = useState<null | { location: string; round: Round | null }>(null);

  const load = useCallback(async (rid: number | null = roundId) => {
    try {
      const d = await request<Overview>("GET", "/api/yarn-stock/stock-take" + (rid ? `?round_id=${rid}` : ""));
      setData(d);
      setRoundId(d.round?.id ?? null);
    } catch (e) { setMsg(errText(t, e)); }
  }, [roundId, t]);
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = data?.round ?? null;
  const isOpen = !!r?.open;
  const tLabel = (code: string) => t(`stk.res.${code}`);

  const post = async (url: string, body: unknown) => {
    try { await request("POST", url, body); await load(); } catch (e) { setMsg(errText(t, e)); }
  };

  const clickTile = (tile: Tile) => {
    if (!data || !r) return;
    if (!isOpen || !data.can_write) { showResults(tile.location); return; }
    if (tile.excluded) {
      if (data.superuser) setAsk({ text: t("stk.include_ask", { loc: tile.location }), yes: () => post("/api/yarn-stock/stock-take/exclude", { round_id: r.id, location: tile.location, excluded: false }) });
      else setMsg(t("stk.left_out_info", { loc: tile.location }));
      return;
    }
    startCheck(tile);
  };
  const startCheck = (tile: Tile) => {
    if (tile.checked_at) setAsk({ text: t("stk.again_ask", { loc: tile.location, when: tile.checked_at, by: tile.checked_by || "?" }), yes: () => setCheck({ location: tile.location, round: r }) });
    else setCheck({ location: tile.location, round: r });
  };
  const showResults = (loc: string) => { setOnlyDev(false); setLocFilter(loc); setTab("results"); };
  const setExcluded = (tile: Tile, excluded: boolean) => {
    const go = () => post("/api/yarn-stock/stock-take/exclude", { round_id: r!.id, location: tile.location, excluded });
    if (excluded && tile.checked_at) setAsk({ text: t("stk.leave_out_checked", { loc: tile.location }), yes: go });
    else go();
  };
  const closeRound = () => {
    if (!data || !r) return;
    const open = data.racks.flatMap((x) => x.levels.flatMap((l) => l.tiles)).filter((x) => x.state === "open").map((x) => x.location);
    let text = t("stk.close_ask", { name: r.name });
    if (open.length) text += "\n\n" + t("stk.close_open", { n: open.length, locs: open.slice(0, 30).join(", ") + (open.length > 30 ? " …" : "") });
    text += "\n\n" + t("stk.close_after");
    setAsk({ text, yes: () => post("/api/yarn-stock/stock-take/close", { round_id: r.id }) });
  };

  const items = useMemo(() => {
    const f = locFilter.trim().toUpperCase();
    return (data?.items ?? []).filter((it) => (!onlyDev || it.deviation) && (!f || it.location.startsWith(f)));
  }, [data, onlyDev, locFilter]);

  if (check) {
    return <CheckView location={check.location} round={check.round} prefix={params.get("rack") ?? ""}
      onDone={() => { setCheck(null); load(); }} />;
  }
  if (!data) return <div className="muted">{msg ?? t("app.loading")}</div>;
  const sum = data.summary;

  return (
    <div className="stk-page" onClick={() => setMenu(null)}>
      <div className="page-head">
        <Link to="/tools/yarn-stock" className="btn-plain">← {t("st.title")}</Link>
        <h1>{r ? r.name : t("stk.title")}</h1>
        {data.rounds.length > 1 && (
          <label className="st-goto">{t("stk.round")}
            <select value={roundId ?? ""} onChange={(e) => load(Number(e.target.value))}>
              {data.rounds.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.open ? t("stk.open") : t("stk.closed_on", { d: (x.closed ?? "").slice(0, 10) })})</option>)}
            </select></label>
        )}
      </div>
      <p className="stk-info">
        {!data.available ? t("stk.not_available")
          : !r ? (data.superuser ? t("stk.no_round_su") : t("stk.no_round"))
          : r.open ? t("stk.started_open", { when: r.started, by: r.started_by || "?" })
          : t("stk.started_closed", { when: r.started, by: r.started_by || "?", closed: r.closed ?? "" })}
      </p>
      {r && sum && (
        <div className="stk-prog">
          <div className="stk-bar"><div style={{ width: `${(100 * sum.checked) / Math.max(1, sum.to_check)}%` }} /></div>
          <b>{t("stk.progress", { done: sum.checked, total: sum.to_check })}{sum.excluded ? " · " + t("stk.left_out_n", { n: sum.excluded }) : ""}</b>
        </div>
      )}
      <div className="toolbar">
        {data.available && data.superuser && !isOpen && <button className="btn-green" onClick={() => setStarting(true)}>{t("stk.start")}</button>}
        {data.available && data.superuser && isOpen && <button className="btn-plain" onClick={closeRound}>{t("stk.close")}</button>}
        {!isOpen && data.can_write && <button className="btn-plain" onClick={() => setCheck({ location: "", round: null })}>{t("stk.single")}</button>}
        <span className="st-grow" />
        <button className="btn-plain" disabled={!data.available} title={t("stk.refresh_tip")} onClick={() => load()}>{t("stk.refresh")}</button>
        <button className="btn-plain" disabled={!r} onClick={async () => {
          try {
            const res = await fetch(`/api/yarn-stock/stock-take/export?round_id=${r!.id}`, { credentials: "same-origin" });
            if (!res.ok) throw new Error(res.statusText);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(await res.blob());
            a.download = `${r!.name.replace(/[^\w-]+/g, "_")}.xlsx`;
            a.click();
          } catch (e) { setMsg(errText(t, e)); }
        }}>{t("st.excel")}</button>
      </div>
      {msg && <div className="st-msg err">{msg}<button className="st-x" onClick={() => setMsg(null)}>✕</button></div>}

      {r && (
        <>
          <div className="se-tabs">
            <button className={"se-tab" + (tab === "locations" ? " on" : "")} onClick={() => setTab("locations")}>{t("stk.locations")}</button>
            <button className={"se-tab" + (tab === "results" ? " on" : "")} onClick={() => setTab("results")}>{t("stk.results")}</button>
          </div>
          {tab === "locations" ? (
            <>
              <div className="stk-legend">
                {(["open", "ok", "deviation", "excluded"] as const).map((s) => <span key={s}><i className={"stk-tile stk-" + s} /> {t(`stk.st.${s}`)}</span>)}
                <span className="st-grow" /><span className="muted">{t("stk.tile_hint")}</span>
              </div>
              {!data.racks.length && <p className="muted">{t("stk.no_locations")}</p>}
              {data.racks.map((rack) => (
                <div key={rack.rack} className="stk-rack">
                  <div><b>{rack.rack ? t("stk.rack", { rack: rack.rack }) : t("stk.other_locations")}</b> <span className="muted">{t("stk.rack_done", { done: rack.done, todo: rack.todo })}</span></div>
                  <div className="stk-grid">
                    {rack.levels.map((lv, li) => lv.tiles.map((tile) => (
                      <button key={tile.location} className={"stk-tile stk-" + tile.state} style={{ gridRow: li + 1, gridColumn: tile.col + 1 }}
                        title={[tile.location, tile.state === "excluded" ? t("stk.tip_left_out") : tile.checked_at
                          ? t("stk.tip_checked", { when: tile.checked_at, by: tile.checked_by || "?", found: tile.found, expected: tile.expected }) : t("stk.tip_open"),
                          ...tile.devs.map((d) => `${d.spool_id !== null ? "#" + d.spool_id + " " : ""}${tLabel(d.result)}${d.detail ? ` (${d.detail})` : ""}`),
                          ...(tile.more_devs ? [t("stk.more", { n: tile.more_devs })] : [])].join("\n")}
                        onClick={(e) => { e.stopPropagation(); clickTile(tile); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ tile, x: e.clientX, y: e.clientY }); }}>
                        <b>{tile.location}</b>
                        <span>{tile.state === "excluded" ? t("stk.st.excluded") : tile.state === "open"
                          ? (isOpen ? t("stk.n_spools", { n: tile.now }) : t("stk.not_checked"))
                          : `${tile.found}/${tile.expected}${tile.extra ? ` +${tile.extra}` : ""}`}</span>
                      </button>
                    )))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              {sum && (
                <p className="stk-sum">
                  {[t("stk.sum_checked", { done: sum.checked, total: sum.to_check }),
                    t("stk.sum_found", { n: sum.found }) + (sum.found_by_hand ? " " + t("stk.sum_by_hand", { n: sum.found_by_hand }) : ""),
                    ...RESULTS.filter((c) => c !== "found" && sum[c]).map((c) => `${sum[c]} × ${tLabel(c)}`),
                    ...(sum.missing_seen_elsewhere ? [t("stk.sum_seen", { n: sum.missing_seen_elsewhere })] : [])].join(" · ")}
                </p>
              )}
              <div className="toolbar">
                <label className="st-check"><input type="checkbox" checked={onlyDev} onChange={(e) => setOnlyDev(e.target.checked)} /> {t("stk.only_dev")}</label>
                <label className="st-goto">{t("st.c.location")}<input className="st-rack" value={locFilter} placeholder="C21" onChange={(e) => setLocFilter(e.target.value)} /></label>
              </div>
              <div className="st-table">
                <table className="at st">
                  <thead><tr><th>{t("st.c.location")}</th><th>{t("st.c.spool")}</th><th>{t("st.c.yarn")}</th><th>{t("st.c.batch")}</th>
                    <th>{t("stk.result")}</th><th>{t("stk.detail")}</th><th>{t("stk.checked_by")}</th><th>{t("stk.checked_at")}</th></tr></thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} style={{ background: it.seen_at ? "#FAEEDA" : RESULT_BG[it.result] ?? "#FAEEDA" }}>
                        <td>{it.location}</td><td>{it.spool_id !== null ? `#${it.spool_id}` : ""}</td><td>{it.yarn}</td><td>{it.batch}</td>
                        <td>{tLabel(it.result)}</td>
                        <td>{[it.by_hand ? t("stk.by_hand_note") : it.detail, it.seen_at ? t("stk.seen_at", { loc: it.seen_at.replace(/^seen at /, "") }) : ""].filter(Boolean).join("; ")}</td>
                        <td>{it.checked_by}</td><td>{it.checked_at}</td>
                      </tr>
                    ))}
                    {!items.length && <tr><td colSpan={8} className="muted">{t("stk.no_results")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {menu && r && (
        <div className="cm" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {isOpen && data.can_write && !menu.tile.excluded && (
            <button className="cm-item" onClick={() => { setMenu(null); startCheck(menu.tile); }}>{menu.tile.checked_at ? t("stk.check_again") : t("stk.check_this")}</button>)}
          {menu.tile.checked_at && <button className="cm-item" onClick={() => { setMenu(null); showResults(menu.tile.location); }}>{t("stk.show_results")}</button>}
          {isOpen && data.superuser && (menu.tile.excluded
            ? <button className="cm-item" onClick={() => { setMenu(null); setExcluded(menu.tile, false); }}>{t("stk.include")}</button>
            : <button className="cm-item" onClick={() => { setMenu(null); setExcluded(menu.tile, true); }}>{t("stk.leave_out")}</button>)}
        </div>
      )}
      {ask && (
        <Modal title={t("stk.title")} onClose={() => setAsk(null)}>
          <p className="stk-pre">{ask.text}</p>
          <div className="modal-buttons">
            <button className="btn-plain" autoFocus onClick={() => setAsk(null)}>{t("my.no")}</button>
            <button className="btn-green" onClick={() => { const y = ask.yes; setAsk(null); y(); }}>{t("my.yes")}</button>
          </div>
        </Modal>
      )}
      {starting && <StartRound onClose={() => setStarting(false)} onStarted={(id) => { setStarting(false); load(id); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ start a round (superusers) */
function StartRound({ onClose, onStarted }: { onClose: () => void; onStarted: (id: number) => void }) {
  const { t, lang } = useI18n();
  const [racks, setRacks] = useState<{ rack: string; locations: string[] }[] | null>(null);
  const [name, setName] = useState(() => `${t("stk.title")} ${new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : lang, { month: "long", year: "numeric" })}`);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { request<{ racks: { rack: string; locations: string[] }[] }>("GET", "/api/yarn-stock/stock-take/locations").then((r) => setRacks(r.racks)).catch((e) => setErr(errText(t, e))); }, [t]);
  const all = (racks ?? []).flatMap((r) => r.locations);
  const toggle = (locs: string[], on: boolean) => setOff((o) => { const n = new Set(o); locs.forEach((l) => (on ? n.delete(l) : n.add(l))); return n; });
  const go = async () => {
    try { onStarted((await request<{ id: number }>("POST", "/api/yarn-stock/stock-take/start", { name, excluded: [...off] })).id); }
    catch (e) { setErr(errText(t, e)); }
  };
  return (
    <Modal title={t("stk.start_title")} onClose={onClose}>
      <label className="my-colour-in">{t("stk.round_name")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <p className="muted">{t("stk.start_info")}</p>
      <div className="stk-tree">
        {racks === null ? <span className="muted">{t("app.loading")}</span> : racks.map((r) => {
          const on = r.locations.filter((l) => !off.has(l)).length;
          return (
            <div key={r.rack}>
              <label><button className="st-toggle" onClick={(e) => { e.preventDefault(); setOpen((o) => { const n = new Set(o); if (n.has(r.rack)) n.delete(r.rack); else n.add(r.rack); return n; }); }}>{open.has(r.rack) ? "▾" : "▸"}</button>
                <input type="checkbox" checked={on === r.locations.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < r.locations.length; }}
                  onChange={(e) => toggle(r.locations, e.target.checked)} /> {r.rack ? t("stk.rack", { rack: r.rack }) : t("stk.other_locations")} <span className="muted">({on}/{r.locations.length})</span></label>
              {open.has(r.rack) && <div className="stk-tree-locs">{r.locations.map((l) => (
                <label key={l}><input type="checkbox" checked={!off.has(l)} onChange={(e) => toggle([l], e.target.checked)} /> {l}</label>))}</div>}
            </div>
          );
        })}
      </div>
      <div className="toolbar">
        <button className="btn-plain" onClick={() => setOff(new Set())}>{t("st.select_all")}</button>
        <button className="btn-plain" onClick={() => setOff(new Set(all))}>{t("stk.select_none")}</button>
        <span className="muted">{t("stk.included", { n: all.length - off.size, total: all.length })}</span>
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" disabled={!racks} onClick={go}>{t("stk.start_btn")}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ the scan view (one location / rack) */
type OtherScan = { id: number; code: string; detail: string; yarn: string; batch: string; registered: string; result: string };

function CheckView({ location, round, prefix, onDone }: { location: string; round: Round | null; prefix: string; onDone: () => void }) {
  const { t } = useI18n();
  const exact = round !== null;
  const [spools, setSpools] = useState<Map<number, Spool> | null>(null);
  const [locInput, setLocInput] = useState(location || prefix);
  const [loc, setLoc] = useState("");
  const [expected, setExpected] = useState<number[]>([]);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState<Set<number>>(new Set());
  const [others, setOthers] = useState<OtherScan[]>([]);
  const [scan, setScan] = useState("");
  const [fb, setFb] = useState<{ kind: "ok" | "warn" | "error" | "info"; text: string }>({ kind: "info", text: t("stk.fb_load") });
  const [askLoc, setAskLoc] = useState<null | { text: string; spool: Spool; mode: "move" | "restock"; value: string }>(null);
  const [finishing, setFinishing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const focus = () => window.setTimeout(() => scanRef.current?.focus(), 0);
  const hasProgress = found.size > 0 || others.length > 0;

  useEffect(() => {
    request<{ spools: Spool[] }>("GET", "/api/yarn-stock/stock-take/spools").then((r) => {
      const m = new Map(r.spools.map((s) => [s.id, s]));
      setSpools(m);
      if (location || prefix) loadLoc(location || prefix, m);
    }).catch((e) => setFb({ kind: "error", text: errText(t, e) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLoc = (raw: string, m = spools) => {
    const p = raw.trim().toUpperCase();
    if (!p || !m) { setFb({ kind: "warn", text: t("stk.fb_enter_loc") }); return; }
    const exp = [...m.values()].filter((s) => s.status === "in stock"
      && (exact ? s.location.trim().toUpperCase() === p : s.location.trim().toUpperCase().startsWith(p))).map((s) => s.id).sort((a, b) => a - b);
    setLoc(p); setExpected(exp); setFound(new Set()); setManual(new Set()); setOthers([]);
    setFb({ kind: "info", text: t("stk.fb_ready") });
    focus();
  };

  const desc = (s: Spool) => `${s.yarn} / ${t("stk.batch_x", { b: s.batch || "–" })}`;
  const addOther = (s: Spool | undefined, id: number, registered: string, result: string, code: string, detail = "") =>
    setOthers((o) => [...o, { id, code, detail, yarn: s?.yarn ?? "–", batch: s?.batch || "–", registered, result }]);

  const onScan = async () => {
    const raw = scan;
    setScan("");
    if (!raw.trim()) return;
    if (!loc) { setFb({ kind: "warn", text: t("stk.fb_load_first") }); return; }
    const sid = (await request<{ spool_id: number | null }>("GET", `/api/yarn-stock/stock-take/parse?text=${encodeURIComponent(raw)}`)).spool_id;
    if (sid === null) { setFb({ kind: "error", text: t("stk.fb_not_spool", { text: raw.trim().slice(0, 40) }) }); return; }
    if (manual.has(sid)) {
      setManual((m) => { const n = new Set(m); n.delete(sid); return n; });
      setFb({ kind: "ok", text: t("stk.fb_confirmed", { id: sid }) });
      return;
    }
    if (found.has(sid) || others.some((o) => o.id === sid)) { setFb({ kind: "warn", text: t("stk.fb_already", { id: sid }) }); return; }
    const s = spools?.get(sid);
    if (expected.includes(sid)) {
      setFound((f) => new Set(f).add(sid));
      setFb({ kind: "ok", text: t("stk.fb_found", { id: sid, desc: desc(s!), loc: s!.location || "–" }) });
    } else if (!s) {
      addOther(undefined, sid, "–", t("stk.r_unknown"), "unknown");
      setFb({ kind: "error", text: t("stk.fb_unknown", { id: sid }) });
    } else if (s.status !== "in stock") {
      setAskLoc({ text: t("stk.ask_restock", { id: sid, desc: desc(s) }), spool: s, mode: "restock", value: loc });
    } else {
      setAskLoc({ text: t("stk.ask_move", { id: sid, desc: desc(s), old: s.location || "–" }), spool: s, mode: "move", value: loc });
    }
  };

  const answerLoc = async (value: string | null) => {
    const a = askLoc!;
    setAskLoc(null);
    const s = a.spool;
    const nl = (value ?? "").trim().toUpperCase();
    if (a.mode === "move") {
      const old = s.location || "–";
      if (!nl || nl === s.location.toUpperCase()) {
        addOther(s, s.id, old, t("stk.r_elsewhere"), "elsewhere", `registered at ${old}`);
        setFb({ kind: "warn", text: t("stk.fb_left", { id: s.id, old }) });
      } else {
        try {
          await request("POST", "/api/yarn-stock/stock-take/move", { spool_id: s.id, location: nl });
          setSpools((m) => new Map(m!).set(s.id, { ...s, location: nl }));
          const here = nl === loc;
          addOther(s, s.id, old, t("stk.r_moved", { loc: nl }), here ? "moved_here" : "moved_elsewhere", here ? `from ${old}` : `from ${old} to ${nl}`);
          setFb({ kind: "ok", text: t("stk.fb_moved", { id: s.id, old, loc: nl }) });
        } catch (e) { setFb({ kind: "error", text: errText(t, e) }); }
      }
    } else if (!nl) {
      addOther(s, s.id, t("stk.discarded_word"), t("stk.r_disc_unchanged"), "discarded");
      setFb({ kind: "warn", text: t("stk.fb_disc_left", { id: s.id }) });
    } else {
      try {
        await request("POST", "/api/yarn-stock/stock-take/restock", { spool_id: s.id, location: nl });
        setSpools((m) => new Map(m!).set(s.id, { ...s, status: "in stock", location: nl }));
        addOther(s, s.id, t("stk.discarded_word"), t("stk.r_restocked", { loc: nl }), "restocked", `at ${nl}`);
        setFb({ kind: "ok", text: t("stk.fb_restocked", { id: s.id, loc: nl }) });
      } catch (e) { setFb({ kind: "error", text: errText(t, e) }); }
    }
    focus();
  };

  const markHand = (sid: number) => {
    if (found.has(sid)) { setFb({ kind: "info", text: t("stk.fb_already_found", { id: sid }) }); return; }
    setFound((f) => new Set(f).add(sid)); setManual((m) => new Set(m).add(sid));
    setFb({ kind: "ok", text: t("stk.fb_by_hand", { id: sid, desc: desc(spools!.get(sid)!) }) });
    focus();
  };
  const undo = (sid: number) => {
    setFound((f) => { const n = new Set(f); n.delete(sid); return n; });
    setManual((m) => { const n = new Set(m); n.delete(sid); return n; });
    setFb({ kind: "info", text: t("stk.fb_undone", { id: sid }) });
    focus();
  };

  const missing = expected.filter((i) => !found.has(i));
  const finish = async (discard: boolean) => {
    setBusy(true);
    try {
      await request("POST", "/api/yarn-stock/stock-take/finish", {
        round_id: round?.id ?? null, location: loc, expected_ids: expected, found_ids: [...found], manual_ids: [...manual],
        others: others.map((o) => ({ spool_id: o.id, code: o.code, detail: o.detail })), discard_missing: discard });
      onDone();
    } catch (e) { setFinishing(false); setFb({ kind: "error", text: errText(t, e) }); } finally { setBusy(false); }
  };
  const moved = others.filter((o) => o.code === "moved_here" || o.code === "moved_elsewhere").length;
  const back = others.filter((o) => o.code === "restocked").length;
  const close = () => { if (hasProgress) setLeaving(true); else onDone(); };

  return (
    <div className="stk-page stk-check">
      <div className="page-head">
        <h1>{t("stk.check_title")}{exact ? ` – ${location}` : ""}{round ? ` (${round.name})` : ""}</h1>
      </div>
      <div className="toolbar">
        <label className="st-goto">{t("stk.loc_label")}
          <input value={locInput} readOnly={exact} placeholder="E / E12" onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadLoc(locInput); }} /></label>
        {!exact && <button className="btn-plain" onClick={() => loadLoc(locInput)}>{t("stk.load")}</button>}
      </div>
      {loc && <p>{exact ? t("stk.expected_exact", { n: expected.length, loc }) : t("stk.expected_prefix", { n: expected.length, loc })}</p>}
      <label className="stk-scan">{t("stk.scan_label")}
        <input ref={scanRef} autoFocus value={scan} placeholder={t("stk.scan_ph")} onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(); } }} disabled={!spools} /></label>
      <div className={"stk-fb stk-fb-" + fb.kind}>{fb.text}</div>
      {loc && <b>{t("stk.found_n", { n: found.size, total: expected.length })}{manual.size ? " " + t("stk.by_hand_n", { n: manual.size }) : ""}{others.length ? " · " + t("stk.others_n", { n: others.length }) : ""}</b>}

      <div><b>{t("stk.expected_head")}</b> <span className="muted">{t("stk.expected_hint")}</span></div>
      <div className="st-table">
        <table className="at st">
          <thead><tr><th>{t("stk.found")}</th><th>{t("st.c.spool")}</th><th>{t("st.c.yarn")}</th><th>{t("st.c.batch")}</th><th>{t("st.c.location")}</th><th>{t("st.c.weight")}</th></tr></thead>
          <tbody>
            {expected.map((sid) => {
              const s = spools!.get(sid)!;
              const f = found.has(sid), m = manual.has(sid);
              return (
                <tr key={sid} style={{ background: f ? (m ? "#E3EEF9" : "#EAF3DE") : undefined }} title={m ? t("stk.by_hand_tip") : ""}
                  onDoubleClick={() => markHand(sid)} onContextMenu={(e) => { e.preventDefault(); if (f) undo(sid); else markHand(sid); }}>
                  <td>{m ? t("stk.by_hand") : f ? t("my.yes") : ""}</td><td>#{sid}</td><td>{s.yarn}</td><td>{s.batch || "–"}</td><td>{s.location || "–"}</td>
                  <td className="num">{s.weight !== null ? s.weight.toFixed(2) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div><b>{t("stk.others_head")}</b></div>
      <div className="st-table st-small">
        <table className="at st">
          <thead><tr><th>{t("st.c.spool")}</th><th>{t("st.c.yarn")}</th><th>{t("st.c.batch")}</th><th>{t("stk.registered_at")}</th><th>{t("stk.result")}</th></tr></thead>
          <tbody>{others.map((o) => <tr key={o.id}><td>#{o.id}</td><td>{o.yarn}</td><td>{o.batch}</td><td>{o.registered}</td><td>{o.result}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="modal-buttons">
        <button className="btn-green" disabled={!loc} onClick={() => setFinishing(true)}>{t("stk.finish")}</button>
        <button className="btn-plain" onClick={close}>{t("mj.cancel")}</button>
      </div>

      {askLoc && (
        <Modal title={t("stk.title")} onClose={() => answerLoc(null)}>
          <p className="stk-pre">{askLoc.text}</p>
          <input className="mj-search" autoFocus value={askLoc.value} onChange={(e) => setAskLoc({ ...askLoc, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") answerLoc(askLoc.value); }} />
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => answerLoc(null)}>{askLoc.mode === "move" ? t("stk.leave_unchanged") : t("stk.leave_discarded")}</button>
            <button className="btn-green" disabled={!askLoc.value.trim()} onClick={() => answerLoc(askLoc.value)}>OK</button>
          </div>
        </Modal>
      )}
      {finishing && (
        <Modal title={t("stk.finish_title")} onClose={() => { setFinishing(false); focus(); }}>
          <p>{t("stk.finish_found", { loc, n: found.size, total: expected.length })}</p>
          {(moved > 0 || back > 0) && <p>{t("stk.finish_saved", { moved, back })}</p>}
          {missing.length ? (
            <>
              <p>{t("stk.finish_missing", { n: missing.length, ids: missing.slice(0, 15).map((i) => "#" + i).join(", ") + (missing.length > 15 ? " …" : "") })}</p>
              <p>{t("stk.finish_what")}</p>
            </>
          ) : <p>{t("stk.finish_all")}</p>}
          <div className="modal-buttons">
            <button className="btn-plain" onClick={() => { setFinishing(false); focus(); }}>{t("stk.back_scan")}</button>
            {missing.length > 0 && <button className="btn-danger" disabled={busy} onClick={() => finish(true)}>{t("stk.discard_missing")}</button>}
            <button className="btn-green" disabled={busy} onClick={() => finish(false)}>{missing.length ? t("stk.keep_missing") : t("mj.close")}</button>
          </div>
        </Modal>
      )}
      {leaving && (
        <Modal title={t("stk.leave_title")} onClose={() => setLeaving(false)}>
          <p>{t("stk.leave_text")}</p>
          <div className="modal-buttons">
            <button className="btn-plain" autoFocus onClick={() => { setLeaving(false); focus(); }}>{t("my.no")}</button>
            <button className="btn-green" onClick={onDone}>{t("my.yes")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
