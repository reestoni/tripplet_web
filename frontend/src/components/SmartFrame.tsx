import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";
import { CalcDialog, ColourDialog, FairDialog, FilterDialog, type Answer, type Summary } from "./SmartDialogs";

/* The desktop's dashboard page (ui/smart_dashboard_html.py) in an iframe, served at /api/smart/page with
   /report-assets/smart_bridge.js instead of Qt's web channel. One server session per open page (sid).
   The bridge sends the page's own calls to the server; calls that open a desktop dialog arrive here by
   postMessage, and the answers of the dialogs go back to the page as commands (postMessage "smart-cmds"). */

export function newSid(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.().replace(/-/g, "")
    ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Dlg = { kind: "filter"; scope: string; vid: string; index: number } | { kind: "calc"; key: string }
  | { kind: "colour"; vid: string; label: string; current: string } | { kind: "fair"; vid: string };

export function useSmartFrame(sid: string, readOnly: boolean, enabled: boolean) {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);

  const send = useCallback((cmds: [string, unknown][]) => {
    if (cmds?.length) frame.current?.contentWindow?.postMessage({ type: "smart-cmds", cmds }, location.origin);
  }, []);
  const apply = useCallback((a: Answer | null | undefined) => {
    if (!a) return;
    if (a.summary) setSummary(a.summary);
    if (a.cmds) send(a.cmds);
    if (a.download) download(a.download);
  }, [send]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data || e.source !== frame.current?.contentWindow) return;
      const m = e.data as Record<string, unknown> & { type: string };
      switch (m.type) {
        case "smart-ready": setReady(true); break;
        case "smart-summary": if (m.summary) setSummary(m.summary as Summary); break;
        case "smart-download": download(String(m.url)); break;
        case "smart-error": setError(m.status === 404 ? t("sc.lost") : String(m.detail || t("sc.failed"))); break;
        case "smart-fair": setDlg({ kind: "fair", vid: String(m.vid) }); break;
        case "smart-trial":
          request<{ series_id: number }>("GET", `/api/smart/${sid}/trial/${Number(m.tid)}`)
            .then((x) => window.open(`/series/${x.series_id}`, "_blank")).catch(() => undefined);
          break;
        default:
          if (readOnly) break;
          if (m.type === "smart-filter") setDlg({ kind: "filter", scope: String(m.scope), vid: String(m.vid || ""), index: Number(m.index) });
          else if (m.type === "smart-calc") setDlg({ kind: "calc", key: String(m.key || "") });
          else if (m.type === "smart-colour") setDlg({ kind: "colour", vid: String(m.vid), label: String(m.label || ""), current: String(m.current || "") });
          else if (m.type === "smart-excel") download(`/api/smart/${sid}/excel?vid=${encodeURIComponent(String(m.vid))}`);
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [sid, readOnly, t]);

  const close = useCallback(() => setDlg(null), []);
  const dialogs = !dlg ? null
    : dlg.kind === "filter" ? <FilterDialog sid={sid} scope={dlg.scope} vid={dlg.vid} index={dlg.index} onClose={close} onDone={apply} />
    : dlg.kind === "calc" ? <CalcDialog sid={sid} calcKey={dlg.key} onClose={close} onDone={apply} />
    : dlg.kind === "colour" ? <ColourDialog sid={sid} vid={dlg.vid} label={dlg.label} current={dlg.current} onClose={close} onDone={apply} />
    : <FairDialog sid={sid} vid={dlg.vid} onClose={close} onDone={apply} />;

  const element = useMemo(() => enabled
    ? <iframe ref={frame} className="smart-frame" src={`/api/smart/page?sid=${encodeURIComponent(sid)}`} title="Dashboard" />
    : null, [enabled, sid]);

  return { element, dialogs, apply, send, summary, setSummary, ready, error, setError };
}

export function SummaryBar({ s }: { s: Summary | null }) {
  const { t } = useI18n();
  const nf = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  if (!s) return <div className="sc-count">{t("sc.loading")}</div>;
  return (
    <div className="sc-count">
      <b>{nf(s.trials)}</b> {t("sc.match", { s: nf(s.series), m: s.machines, j: s.jets })}
      <span className="sc-count-hint">{t(s.refs ? "sc.countHintRefs" : "sc.countHint")}</span>
    </div>
  );
}
