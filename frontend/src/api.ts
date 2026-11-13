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

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : detail;
      code = j.code;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, detail, code);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  nav: () => request<Nav>("GET", "/api/nav"),
  login: (username: string, password: string) =>
    request<{ user: User }>("POST", "/api/auth/login", { username, password }),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
};

export const img = (name: string) => `/api/img/${name}`;
