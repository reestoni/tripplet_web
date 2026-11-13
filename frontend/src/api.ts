// Thin wrapper around fetch for the FastAPI backend (same origin; Vite proxies /api in development).

export type User = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  access_level: number;
  access_right: string | null;
  admin_box: boolean;
  accent_colour: string | null;
};

export type Me = { user: User; mode: string; db: string; version: string; start_route: string;
  display: import("./display").DisplayPrefs };

export type NavItem = {
  key: string;
  label: string;
  icon: string | null;
  route: string;
  badge: number;
  web: boolean;
};

export type Nav = {
  pinned: NavItem[];
  sections: { title: string; icon: string; items: NavItem[] }[];
};

export type Status = { id: number; name: string };

export type ExperimentRow = {
  series_id: number;
  experiment_pk: number;
  experiment_id: string;
  series_name: string;
  machine: string;
  creation_date: string | null;
  owner: string | null;
  status_id: number | null;
  status: string | null;
  has_attach: boolean;
  experiment_request_id: string | number | null;
  has_notes: boolean;
  reports: number;
};

export type BacklogCard = {
  series_id: number;
  experiment_pk: number;
  experiment_id: string;
  series_name: string;
  machine: string;
  status: string;
  prio: number | null;
  owner: string;
  owner_colour: string | null;
  has_attach: boolean;
  has_notes: boolean;
  experiment_request_id: string | number | null;
  reports: number;
  retest: { trial: string; lab: string; note: string }[];
};

export type ArchivedRow = {
  series_id: number;
  experiment_pk: number;
  experiment_id: string;
  series_name: string;
  machine: string;
  experiment_request_id: string | number | null;
  year: string;
  xx: string;
};

export type CellNote = { id: number; text: string; user: string; when: string; trial_id: number | null };
export type PivotCell = { v: string; alert?: "red" | "orange"; notes?: CellNote[]; e?: number };
export type SeriesData = {
  series: {
    id: number;
    name: string;
    experiment_id: string;
    experiment_pk: number;
    machine: string;
    machine_type: number | null;
    status_id: number | null;
    owner: string;
    creation_date: string | null;
    notes: string;
    experiment_request_id?: string | number | null;
  };
  trials: { id: number; label: string; number: number; reference: string | null }[];
  has_rd: boolean;
  has_yarnscope: boolean;
  has_yarnscope_aty: boolean;
  playground?: boolean;
  tabs: { key: string; title: string; lazy?: boolean; rows: { title: string; info?: boolean; r?: number; cells: PivotCell[] }[]; flags: Record<string, string>; retest?: { trial: string; note: string }[]; kb?: string | null }[];
  pending_tabs: { key: string; title: string }[];
  notes: (CellNote & { where_tab: string | null; where_row: string; trial_note: boolean })[];
};

export type MachineData = {
  mode: "single" | "compact" | "groups";
  has_groups: boolean;
  message: string | null;
  columns: { c: number; notes: CellNote[]; filter: string; trial_id: number; trial_label: string; reference: string | null; ply: string;
    ply_tooltip: string; colour: string | null; colour_name: string }[];
  rows: { r: number; title: string; key: string; readonly: boolean; options?: [number | string, string][] | null; kb?: string | null;
    cells: { v: string; tip?: string; alert?: string; notes?: CellNote[]; e?: number; raw?: string | null; img?: number | string; kb?: string }[] }[];
  filter_labels: string[];
  multi_ply?: boolean;
  machine_id?: number | null;
  custom_row?: number | null;
  schema?: "dty" | "aty" | null;   // machine path schema available (SchemaPanel.tsx)
};

/** What the logged-in user may do in a series (backend/app/series_actions.py rights()). */
export type SeriesRights = { delete_trials: boolean; delete_series: boolean; move: boolean; history: boolean;
  retest: boolean; notes: boolean; write: boolean; retention_days: number };

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    let data: Record<string, unknown> | undefined;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : detail;
      code = j.code;
      data = j;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, detail, code, data);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  nav: () => request<Nav>("GET", "/api/nav"),
  login: (username: string, password: string) =>
    request<{ user: User }>("POST", "/api/auth/login", { username, password }),
  experiments: (machine?: string) =>
    request<{ machines: string[]; statuses: Status[]; rows: ExperimentRow[] }>(
      "GET",
      "/api/experiments" + (machine && machine !== "All" ? `?machine=${encodeURIComponent(machine)}` : ""),
    ),
  backlog: () =>
    request<{ boxes: (Status & { cards: BacklogCard[] })[]; archived: ArchivedRow[];
      welcome: { message: string; first_name: string } }>("GET", "/api/backlog"),
  moveCard: (series_id: number, to_status: number, machine_id?: number) =>
    request<{ ok: boolean; moved: boolean }>("POST", "/api/backlog/move", { series_id, to_status, machine_id }),
  series: (id: number) => request<SeriesData>("GET", `/api/series/${id}`),
  machine: (id: number, mode: string, source: "machine" | "rd" = "machine", custom = false) =>
    request<MachineData>("GET", `/api/series/${id}/${source}?mode=${mode}${custom ? "&custom=1" : ""}`),
  rights: (id: number) => request<SeriesRights>("GET", `/api/series/${id}/rights`),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
};

export const img = (name: string) => `/api/img/${name}`;

/** Tooltip text for notes on a value (same content as the desktop tooltip). */
/** "Learn more in Knowledge Base…" (desktop ui/kb_links): opened in a new tab, so the user stays where he was. */
export const kbItem = (t: (k: string) => string, url: string | null | undefined) =>
  url ? [{ sep: true as const }, { label: t("kb.learnMore"), onClick: () => window.open(url, "_blank") }] : [];

export function notesTip(notes?: CellNote[]): string {
  return (notes ?? []).map((n) => `${n.user || "?"}, ${n.when}: ${n.text}`).join("\n");
}
