import { lazy, type ComponentType } from "react";
import { useI18n } from "./i18n";

const RELOAD_KEY = "tripplet.chunkReload";

/** React.lazy for a page. If its file cannot be loaded because a new release replaced it while the tab stayed
 *  open, reload the page once (index.html is never cached, so the reload brings the new release). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().then(
      (m) => {
        try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage blocked */ }
        return m;
      },
      (err) => {
        let reloaded = false;
        try { reloaded = sessionStorage.getItem(RELOAD_KEY) === "1"; sessionStorage.setItem(RELOAD_KEY, "1"); } catch { /* storage blocked */ }
        if (!reloaded) {
          window.location.reload();
          return new Promise<{ default: T }>(() => undefined);   // keep the spinner until the reload
        }
        throw err;
      },
    ),
  );
}

export function PageLoading() {
  const { t } = useI18n();
  return <div className="page-loading">{t("app.loading")}</div>;
}
