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

export type Me = { user: User; mode: string; db: string; version: string };

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
export type PivotCell = { v: string; alert?: "red" | "orange"; notes?: CellNote[] };
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
  };
  trials: { id: number; label: string; number: number; reference: string | null }[];
  has_rd: boolean;
  tabs: { key: string; title: string; lazy?: boolean; rows: { title: string; info?: boolean; cells: PivotCell[] }[]; flags: Record<string, string> }[];
  pending_tabs: { key: string; title: string }[];
  notes: (CellNote & { where_tab: string | null; where_row: string; trial_note: boolean })[];
};

export type MachineData = {
  mode: "single" | "compact" | "groups";
  has_groups: boolean;
  message: string | null;
  columns: { notes: CellNote[]; filter: string; trial_id: number; trial_label: string; reference: string | null; ply: string;
    ply_tooltip: string; colour: string | null; colour_name: string }[];
  rows: { title: string; key: string; readonly: boolean; cells: { v: string; tip?: string; alert?: string; notes?: CellNote[] }[] }[];
  filter_labels: string[];
  multi_ply?: boolean;
};

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
    request<{ boxes: (Status & { cards: BacklogCard[] })[]; archived: ArchivedRow[] }>("GET", "/api/backlog"),
  moveCard: (series_id: number, to_status: number, machine_id?: number) =>
    request<{ ok: boolean; moved: boolean }>("POST", "/api/backlog/move", { series_id, to_status, machine_id }),
  series: (id: number) => request<SeriesData>("GET", `/api/series/${id}`),
  machine: (id: number, mode: string, source: "machine" | "rd" = "machine") =>
    request<MachineData>("GET", `/api/series/${id}/${source}?mode=${mode}`),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
};

export const img = (name: string) => `/api/img/${name}`;

/** Tooltip text for notes on a value (same content as the desktop tooltip). */
export function notesTip(notes?: CellNote[]): string {
  return (notes ?? []).map((n) => `${n.user || "?"}, ${n.when}: ${n.text}`).join("\n");
}
