import { useEffect } from "react";

/* Browser tab title: the Shell writes "<page> – TrippleT" from the nav label of the route; a page with a better
   name (Show Experiment: experiment ID + series) sets it with usePageTitle(). */
export const PAGE_TITLE_EVENT = "tripplet:page-title";
let override: string | null = null;

export function pageTitleOverride(): string | null {
  return override;
}

export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    override = title || null;
    window.dispatchEvent(new CustomEvent(PAGE_TITLE_EVENT));
    return () => {
      override = null;
      window.dispatchEvent(new CustomEvent(PAGE_TITLE_EVENT));
    };
  }, [title]);
}
