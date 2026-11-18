import { useCallback, useEffect, useMemo, useState } from "react";
import { request, ApiError } from "../api";
import { useI18n } from "../i18n";
import AdminTable, { type FkItems, type Row } from "../components/AdminTable";
import { Modal } from "../components/SeriesTools";
import { PHONE, useMedia } from "../media";

/* Manage User (superusers; desktop ui/screen_manage_user.py + feature_access_dialog.py) on
   backend/app/user_admin_api.py. Table edit + Save, New user (with start password), Reset password,
   Delete, Access… (tools / screens per group or person). Passwords never reach the page except as typed. */

type Data = { columns: string[]; roles: Record<string, string | null>; editable: string[]; bool_columns: string[];
  colour_columns: string[]; fk: Record<string, FkItems>; rows: Row[]; me: number; username_max: number;
  suggested_username: string; access_available: boolean };
type T = (k: string, v?: Record<string, string | number>) => string;

function errText(t: T, e: unknown): string {
  if (e instanceof ApiError && e.code) {
    const k = `mu.err.${e.code}`;
    const s = t(k, (e.data?.vars ?? {}) as Record<string, string | number>);
    if (s !== k) return e.code === "bad_value" || e.code === "bad_password" ? `${s} ${e.message}` : s;
  }
  return e instanceof Error ? e.message : String(e);
}

export default function ManageUsers() {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dialog, setDialog] = useState<null | "new" | "password" | "delete" | "access">(null);
  const dirty = Object.keys(changes).length;

  const load = useCallback(() => {
    request<Data>("GET", "/api/superuser/users").then((d) => { setData(d); setChanges({}); }).catch((e) => setLoadErr(errText(t, e)));
  }, [t]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!dirty) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);

  const sets = useMemo(() => data && { bool: new Set(data.bool_columns), editable: new Set(data.editable) }, [data]);
  const onEdit = (id: number, col: string, v: unknown) => {
    const orig = data?.rows.find((r) => Number(r.ID) === id)?.[col];
    setChanges((c) => {
      const row = { ...(c[id] ?? {}) };
      if (String(orig ?? "") === String(v ?? "")) delete row[col]; else row[col] = v;
      const n = { ...c };
      if (Object.keys(row).length) n[id] = row; else delete n[id];
      return n;
    });
  };
  const save = async () => {
    try {
      const r = await request<{ saved: number }>("POST", "/api/superuser/users/save",
        { rows: Object.entries(changes).map(([id, values]) => ({ id: Number(id), values })) });
      setMsg({ kind: "ok", text: t("mj.saved", { n: r.saved }) });
      load();
    } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
  };

  if (loadErr) return <div className="card error">{loadErr}</div>;
  if (!data || !sets) return <div className="muted">{t("app.loading")}</div>;
  const R = data.roles;
  const one = selected.size === 1 ? data.rows.find((r) => Number(r.ID) === [...selected][0]) : undefined;

  return (
    <div className="mj-page">
      <div className="page-head"><h1>{t("mu.title")}</h1><span className="muted">{t("mu.count", { n: data.rows.length })}</span></div>
      <div className="toolbar">
        <input className="mj-search" value={search} placeholder={t("mu.search")} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn-plain" onClick={() => { if (!dirty || window.confirm(t("mj.discard"))) load(); }}>{t("mj.reload")}</button>
        <span className="mj-sep" />
        <button className="btn-green" onClick={() => setDialog("new")}>{t("mu.new")}</button>
        <button className="btn-plain" disabled={!one} title={one ? "" : t("mu.selectOne")} onClick={() => setDialog("password")}>{t("mu.resetPw")}</button>
        <button className="btn-plain" disabled={!selected.size} onClick={() => setDialog("delete")}>{t("mj.delete")}</button>
        <button className="btn-plain" disabled={!data.access_available} title={t("mu.accessTip")} onClick={() => setDialog("access")}>{t("mu.access")}</button>
        <button className="btn-green mj-save" disabled={!dirty} onClick={save}>{t("mj.save")}{dirty ? ` (${dirty})` : ""}</button>
        {msg && <span className={msg.kind === "err" ? "mj-msg err" : "mj-msg"} onClick={() => setMsg(null)}>{msg.text}</span>}
      </div>
      <AdminTable columns={data.columns} frozen={2} frozenWidths={[60, 140]} idCol="ID" rows={data.rows} fk={data.fk}
        boolCols={sets.bool} numericCols={new Set(["ID"])} editable={sets.editable} canEdit changes={changes} onEdit={onEdit}
        selected={selected} onSelect={setSelected} search={search} searchCols={[R.first ?? "", R.last ?? "", R.username ?? ""].filter(Boolean)}
        cell={(c, row, val) => {
          if (!data.colour_columns.includes(c)) return undefined;
          const v = String(val(c) ?? "");
          const ok = /^#[0-9a-f]{6}$/i.test(v);
          return (
            <span className="mu-colour" onClick={(e) => e.stopPropagation()}>
              <input type="color" value={ok ? v : "#ffffff"} title={t("mu.pickColour")}
                onChange={(e) => onEdit(Number(row.ID), c, e.target.value.toUpperCase())} />
              <span className={changes[Number(row.ID)] && c in changes[Number(row.ID)] ? "mu-dirty" : ""}>{v || "–"}</span>
              {v && <button className="mu-x" title={t("mu.clearColour")} onClick={() => onEdit(Number(row.ID), c, "")}>✕</button>}
            </span>
          );
        }} />

      {dialog === "new" && <NewUser data={data} onClose={() => setDialog(null)}
        onDone={(name) => { setDialog(null); setMsg({ kind: "ok", text: t("mu.created", { name }) }); load(); }} />}
      {dialog === "password" && one && <ResetPassword id={Number(one.ID)} username={String(one[R.username ?? "UserName"] ?? "")}
        onClose={() => setDialog(null)} onDone={(name) => { setDialog(null); setMsg({ kind: "ok", text: t("mu.pwDone", { name }) }); }} />}
      {dialog === "delete" && (
        <Modal title={t("mj.delete")} onClose={() => setDialog(null)}>
          <p>{t("mu.deleteAsk", { n: selected.size })}</p>
          <p className="muted">{data.rows.filter((r) => selected.has(Number(r.ID))).map((r) => `${r[R.first ?? ""] ?? ""} ${r[R.last ?? ""] ?? ""} (${r[R.username ?? ""] ?? ""})`).join(", ")}</p>
          <div className="modal-buttons">
            <button className="btn-plain" autoFocus onClick={() => setDialog(null)}>{t("mj.cancel")}</button>
            <button className="btn-danger" onClick={async () => {
              setDialog(null);
              try {
                const r = await request<{ deleted: number }>("POST", "/api/superuser/users/delete", { ids: [...selected] });
                setMsg({ kind: "ok", text: t("mu.deleted", { n: r.deleted }) });
                setSelected(new Set());
                load();
              } catch (e) { setMsg({ kind: "err", text: errText(t, e) }); }
            }}>{t("mj.delete")}</button>
          </div>
        </Modal>
      )}
      {dialog === "access" && <AccessDialog onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setMsg({ kind: "ok", text: t("mu.accessSaved") }); }} />}
    </div>
  );
}

function NewUser({ data, onClose, onDone }: { data: Data; onClose: () => void; onDone: (name: string) => void }) {
  const { t } = useI18n();
  const rights = data.fk[data.roles.access ?? ""] ?? [];
  const [v, setV] = useState({ username: data.suggested_username, first: "", last: "", access_id: rights[0]?.[0] ?? "", password: "", repeat: "" });
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try {
      const r = await request<{ username: string }>("POST", "/api/superuser/users/new", { ...v, access_id: v.access_id === "" ? null : Number(v.access_id) });
      onDone(r.username);
    } catch (e) { setErr(errText(t, e)); }
  };
  return (
    <Modal title={t("mu.new")} onClose={onClose}>
      <div className="st-form">
        <label>{t("mu.username")}<input value={v.username} maxLength={data.username_max || undefined} onChange={(e) => setV({ ...v, username: e.target.value })} /></label>
        <label>{t("mu.first")}<input value={v.first} onChange={(e) => setV({ ...v, first: e.target.value })} /></label>
        <label>{t("mu.last")}<input value={v.last} onChange={(e) => setV({ ...v, last: e.target.value })} /></label>
        <label>{t("mu.rights")}<select value={v.access_id} onChange={(e) => setV({ ...v, access_id: e.target.value })}>
          {rights.map(([i, n]) => <option key={String(i)} value={String(i)}>{n}</option>)}</select></label>
        <label>{t("mu.password")}<input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></label>
        <label>{t("mu.repeat")}<input type="password" autoComplete="new-password" value={v.repeat} onChange={(e) => setV({ ...v, repeat: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }} /></label>
      </div>
      <p className="muted">{t("mu.newHint", { n: data.username_max })}</p>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" disabled={!v.username.trim() || !v.password} onClick={go}>{t("mu.create")}</button>
      </div>
    </Modal>
  );
}

function ResetPassword({ id, username, onClose, onDone }: { id: number; username: string; onClose: () => void; onDone: (name: string) => void }) {
  const { t } = useI18n();
  const [pw, setPw] = useState("");
  const [rep, setRep] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try { await request("POST", `/api/superuser/users/${id}/password`, { password: pw, repeat: rep }); onDone(username); }
    catch (e) { setErr(errText(t, e)); }
  };
  return (
    <Modal title={t("mu.resetPwFor", { name: username })} onClose={onClose}>
      <div className="st-form">
        <label>{t("mu.newPassword")}<input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>{t("mu.repeat")}<input type="password" autoComplete="new-password" value={rep} onChange={(e) => setRep(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }} /></label>
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" disabled={!pw} onClick={go}>{t("mu.setPw")}</button>
      </div>
    </Modal>
  );
}

/* Access… (desktop FeatureAccessDialog): rows = tools / screens by sidebar section, columns = groups (read, write,
   admin) then every active non-superuser. Click cycles: default (grey) -> Yes -> No -> default; a person's setting
   wins over the group. The effective value is computed by the same rule as db/feature_access.decide. */
type Feat = { key: string; label: string; section: string; min_level: number; route: string | null };
type AccessData = { available: boolean; features: Feat[]; groups: { id: number; name: string; level: number }[];
  users: { id: number; name: string; group: number | null }[]; group_rules: Record<string, Record<string, boolean>>;
  user_rules: Record<string, Record<string, boolean>> };

function AccessDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<AccessData | null>(null);
  const [g, setG] = useState<Record<string, Record<string, boolean>>>({});
  const [u, setU] = useState<Record<string, Record<string, boolean>>>({});
  const [err, setErr] = useState<string | null>(null);
  const phone = useMedia(PHONE);
  useEffect(() => {
    request<AccessData>("GET", "/api/superuser/users/access").then((x) => { setD(x); setG(x.group_rules); setU(x.user_rules); })
      .catch((e) => setErr(errText(t, e)));
  }, [t]);
  if (!d) return <Modal title={t("mu.access")} onClose={onClose}><p className="muted">{err ?? t("app.loading")}</p></Modal>;
  const levelOf = Object.fromEntries(d.groups.map((x) => [x.id, x.level]));
  const featMin = Object.fromEntries(d.features.map((f) => [f.key, f.min_level]));
  // same order as db/feature_access.decide: person > group > default (level >= min level)
  const decide = (key: string, level: number, ur: Record<string, boolean>, gr: Record<string, boolean>) =>
    key in ur ? ur[key] : key in gr ? gr[key] : level >= (featMin[key] ?? 0);
  const cols = [...d.groups.map((x) => ({ kind: "g" as const, id: x.id, name: x.name, group: x.id })),
    ...d.users.map((x) => ({ kind: "u" as const, id: x.id, name: x.name, group: x.group }))];
  const cycle = (kind: "g" | "u", id: number, key: string) => {
    const set = kind === "g" ? setG : setU;
    set((s) => {
      const cur = s[String(id)]?.[key];
      const next = { ...(s[String(id)] ?? {}) };
      if (cur === undefined) next[key] = true; else if (cur) next[key] = false; else delete next[key];
      return { ...s, [String(id)]: next };
    });
  };
  const save = async () => {
    try { await request("POST", "/api/superuser/users/access", { group_rules: g, user_rules: u }); onSaved(); }
    catch (e) { setErr(errText(t, e)); }
  };
  // phone (MOBILE.md): one list at a time - "by person" (what may X do?) or "by tool" (who may use Y?)
  if (phone) {
    const setRule = (kind: "g" | "u", id: number, key: string, val: boolean | undefined) => {
      const set = kind === "g" ? setG : setU;
      set((st) => {
        const next = { ...(st[String(id)] ?? {}) };
        if (val === undefined) delete next[key]; else next[key] = val;
        return { ...st, [String(id)]: next };
      });
    };
    return (
      <Modal title={t("mu.accessTitle")} onClose={onClose} wide>
        <AccessPhone d={d} g={g} u={u} cols={cols} decide={decide} levelOf={levelOf} setRule={setRule} />
        {err && <div className="mj-msg err">{err}</div>}
        <div className="modal-buttons">
          <button className="btn-plain" title={t("mu.resetAllTip")} onClick={() => { setG({}); setU({}); }}>{t("mu.resetAll")}</button>
          <button className="btn-green" onClick={save}>{t("mj.save")}</button>
        </div>
      </Modal>
    );
  }
  let lastSection = "";
  return (
    <Modal title={t("mu.accessTitle")} onClose={onClose} wide>
      <p className="muted">{t("mu.accessIntro")}</p>
      <div className="st-table mu-access">
        <table className="at st">
          <thead><tr><th />{cols.map((c) => <th key={c.kind + c.id} className={c.kind === "g" ? "mu-group" : ""}>{c.kind === "g" ? `${t("mu.group")} ${c.name}` : c.name}</th>)}</tr></thead>
          <tbody>
            {d.features.flatMap((f) => {
              const out = [];
              if (f.section !== lastSection) {
                lastSection = f.section;
                out.push(<tr key={"s" + f.section} className="mu-sec"><td colSpan={cols.length + 1}>{t(`sec.${f.section}`)}</td></tr>);
              }
              out.push(
                <tr key={f.key}>
                  <th scope="row">{f.route ? t(`nav.${f.route}`) : f.label}</th>
                  {cols.map((c) => {
                    const own = (c.kind === "g" ? g : u)[String(c.id)]?.[f.key];
                    const gr = c.group != null ? g[String(c.group)] ?? {} : {};
                    const eff = c.kind === "g" ? decide(f.key, levelOf[c.id] ?? 0, {}, gr)
                      : decide(f.key, c.group != null ? levelOf[c.group] ?? 0 : 0, u[String(c.id)] ?? {}, gr);
                    return (
                      <td key={c.kind + c.id} className={"mu-cell " + (own === undefined ? "def" : own ? "yes" : "no")}
                        title={own === undefined ? (c.kind === "g" ? t("mu.tipDefault") : t("mu.tipAsGroup")) + " " + (eff ? t("mu.allowed") : t("mu.notAllowed")) : (own ? t("mu.allowed") : t("mu.blocked"))}
                        onClick={() => cycle(c.kind, c.id, f.key)}>
                        {own === undefined ? (eff ? t("mu.yesLow") : "–") : own ? t("mu.yes") : t("mu.no")}
                      </td>
                    );
                  })}
                </tr>);
              return out;
            })}
          </tbody>
        </table>
      </div>
      {err && <div className="mj-msg err">{err}</div>}
      <div className="modal-buttons">
        <button className="btn-plain" title={t("mu.resetAllTip")} onClick={() => { setG({}); setU({}); }}>{t("mu.resetAll")}</button>
        <span className="st-grow" />
        <button className="btn-plain" onClick={onClose}>{t("mj.cancel")}</button>
        <button className="btn-green" onClick={save}>{t("mj.save")}</button>
      </div>
    </Modal>
  );
}

type AccessCol = { kind: "g" | "u"; id: number; name: string; group: number | null };
type Rules = Record<string, Record<string, boolean>>;

/* Phone view of Access…: a switch "by person | by tool", a picker, then ONE list with a 3-way switch per line
   (Default · Yes · No) and what finally applies (person > group > level, db/feature_access.decide). */
function AccessPhone({ d, g, u, cols, decide, levelOf, setRule }: {
  d: AccessData; g: Rules; u: Rules; cols: AccessCol[];
  decide: (key: string, level: number, ur: Record<string, boolean>, gr: Record<string, boolean>) => boolean;
  levelOf: Record<string, number>;
  setRule: (kind: "g" | "u", id: number, key: string, val: boolean | undefined) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"person" | "tool">("person");
  const [colKey, setColKey] = useState(cols[0] ? cols[0].kind + cols[0].id : "");
  const [feat, setFeat] = useState(d.features[0]?.key ?? "");
  const [only, setOnly] = useState(false);
  const [q, setQ] = useState("");
  const featName = (f: Feat) => (f.route ? t(`nav.${f.route}`) : f.label);
  const colName = (c: AccessCol) => (c.kind === "g" ? `${t("mu.group")} ${c.name}` : c.name);
  const own = (c: AccessCol, key: string) => (c.kind === "g" ? g : u)[String(c.id)]?.[key];
  const groupName = (id: number | null) => d.groups.find((x) => x.id === id)?.name ?? "";
  // what applies and why
  const why = (c: AccessCol, key: string): { on: boolean; how: string } => {
    const gr = c.group != null ? g[String(c.group)] ?? {} : {};
    const o = own(c, key);
    if (c.kind === "g") return { on: decide(key, levelOf[c.id] ?? 0, {}, gr), how: o === undefined ? t("mu.viaLevel") : "" };
    const on = decide(key, c.group != null ? levelOf[c.group] ?? 0 : 0, u[String(c.id)] ?? {}, gr);
    if (o !== undefined) return { on, how: "" };
    return { on, how: key in gr ? t("mu.viaGroup", { g: groupName(c.group) }) : t("mu.viaLevel") };
  };
  const nOwn = (c: AccessCol) => Object.keys((c.kind === "g" ? g : u)[String(c.id)] ?? {}).length;
  const nFeat = (key: string) => cols.filter((c) => own(c, key) !== undefined).length;
  const ql = q.trim().toLowerCase();

  const sw = (c: AccessCol, key: string) => {
    const o = own(c, key);
    const w = why(c, key);
    return (
      <div className="mua-ctl">
        <div className="mua-seg" role="group">
          <button type="button" className={o === undefined ? "on" : ""} onClick={() => setRule(c.kind, c.id, key, undefined)}>{t("mu.stDefault")}</button>
          <button type="button" className={o === true ? "on yes" : ""} onClick={() => setRule(c.kind, c.id, key, true)}>{t("mu.yes")}</button>
          <button type="button" className={o === false ? "on no" : ""} onClick={() => setRule(c.kind, c.id, key, false)}>{t("mu.no")}</button>
        </div>
        <span className={"mua-eff " + (w.on ? "yes" : "no")}>→ {w.on ? t("mu.allowed") : t("mu.notAllowed")}{w.how ? ` (${w.how})` : ""}</span>
      </div>
    );
  };

  let lastSection = "";
  const col = cols.find((c) => c.kind + c.id === colKey) ?? cols[0];
  const f = d.features.find((x) => x.key === feat) ?? d.features[0];
  return (
    <div className="mua">
      <div className="mua-mode jr-seg">
        <button type="button" className={mode === "person" ? "on" : ""} onClick={() => setMode("person")}>{t("mu.byPerson")}</button>
        <button type="button" className={mode === "tool" ? "on" : ""} onClick={() => setMode("tool")}>{t("mu.byTool")}</button>
      </div>
      {mode === "person" ? (
        <select className="mua-pick" value={colKey} onChange={(e) => setColKey(e.target.value)}>
          {cols.map((c) => <option key={c.kind + c.id} value={c.kind + c.id}>{colName(c)}{nOwn(c) ? ` (${nOwn(c)})` : ""}</option>)}
        </select>
      ) : (
        <select className="mua-pick" value={feat} onChange={(e) => setFeat(e.target.value)}>
          {d.features.map((x) => <option key={x.key} value={x.key}>{featName(x)}{nFeat(x.key) ? ` (${nFeat(x.key)})` : ""}</option>)}
        </select>
      )}
      <div className="mua-filters">
        <input className="mj-search" value={q} placeholder={t("mu.accSearch")} onChange={(e) => setQ(e.target.value)} />
        <label className="mua-only"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> {t("mu.onlyOverrides")}</label>
      </div>
      <div className="mua-list">
        {mode === "person" && col && d.features.flatMap((x) => {
          if (only && own(col, x.key) === undefined) return [];
          if (ql && !featName(x).toLowerCase().includes(ql)) return [];
          const out = [];
          if (x.section !== lastSection) {
            lastSection = x.section;
            out.push(<div key={"s" + x.section} className="mua-sec">{t(`sec.${x.section}`)}</div>);
          }
          out.push(<div key={x.key} className="mua-row"><div className="mua-name">{featName(x)}</div>{sw(col, x.key)}</div>);
          return out;
        })}
        {mode === "tool" && f && cols.flatMap((c) => {
          if (only && own(c, f.key) === undefined) return [];
          if (ql && !colName(c).toLowerCase().includes(ql)) return [];
          return [<div key={c.kind + c.id} className={"mua-row" + (c.kind === "g" ? " grp" : "")}><div className="mua-name">{colName(c)}</div>{sw(c, f.key)}</div>];
        })}
        {only && ((mode === "person" && col && nOwn(col) === 0) || (mode === "tool" && f && nFeat(f.key) === 0)) && (
          <p className="muted">{t("mu.noOverrides")}</p>
        )}
      </div>
    </div>
  );
}
