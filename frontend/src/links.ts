/* Links into this app - same format as the desktop "Copy web link" (tripplet_project db/web_links.py):
     /series/<id>[?tab=<key>][&trial=<trial id>]   /series/<id>/report?report=<id>   /tools/canvas?board=<id> */

function build(path: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return `${window.location.origin}${path}${qs ? `?${qs}` : ""}`;
}

export const seriesLink = (id: number, tab?: string | null, trial?: number | null) => build(`/series/${id}`, { tab, trial });
export const reportLink = (seriesId: number, reportId: number) => build(`/series/${seriesId}/report`, { report: reportId });
export const boardLink = (boardId: number) => build("/tools/canvas", { board: boardId });

/** Copy text to the clipboard (also without HTTPS, where navigator.clipboard is missing). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Scroll a trial column into view and flash it (th[data-trial] in Machine Data and the lab tabs). */
export function flashTrial(trialId: number, tries = 10) {
  const th = document.querySelector<HTMLElement>(`th[data-trial="${trialId}"]`);
  if (!th) {
    if (tries > 0) window.setTimeout(() => flashTrial(trialId, tries - 1), 300);   // table still loading
    return;
  }
  th.scrollIntoView({ block: "nearest", inline: "center" });
  th.classList.add("jump-flash");
  window.setTimeout(() => th.classList.remove("jump-flash"), 2400);
}
