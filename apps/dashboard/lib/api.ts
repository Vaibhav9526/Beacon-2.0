export type AuthorityUser = { id: string; name: string; email: string; role: "admin" | "responder"; organization: string; jurisdiction: string; mfa_ready: boolean };
export type AuthoritySession = { token: string; user: AuthorityUser; expires_at: string };
const SESSION_KEY = "beacon.authority.session.v1";

export function getApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined")
    return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
  return "http://localhost:8000/api/v1";
}

export function getAuthoritySession(): AuthoritySession | null {
  if (typeof window === "undefined") return null;
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null") as AuthoritySession | null;
    if (!session?.token || !session.user?.id || Date.parse(session.expires_at) <= Date.now()) { clearAuthoritySession(); return null; }
    return session;
  } catch { clearAuthoritySession(); return null; }
}
export function setAuthoritySession(session: AuthoritySession) { if (typeof window !== "undefined") window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)); return session; }
export function clearAuthoritySession() { if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_KEY); }
export function getCurrentToken() { return getAuthoritySession()?.token; }
export function getAuthHeaders(includeJson = true): Record<string, string> { const token = getCurrentToken(); return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(includeJson ? { "Content-Type": "application/json" } : {}) }; }

export function getWsUrl(token = getCurrentToken()) {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return getApiBase().replace(/^http/, "ws") + "/ws" + query;
}
export const authHeaders = Object.defineProperties({}, {
  Authorization: { enumerable: true, get: () => { const token = getCurrentToken(); return token ? `Bearer ${token}` : ""; } },
  "Content-Type": { enumerable: true, value: "application/json" },
}) as Record<string, string>;

export async function loginAuthority(email: string, password: string) {
  const session = await api<AuthoritySession>("/authority/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) }, false);
  return setAuthoritySession(session);
}

const DEMO_ROLE_CREDENTIALS: Record<AuthorityUser["role"], { email: string; password: string }> = {
  admin: { email: "admin@beacon.local", password: "BeaconDemo!26" },
  responder: { email: "responder@beacon.local", password: "ResponderDemo!26" },
};

export function loginAuthorityRole(role: AuthorityUser["role"]) {
  const credentials = DEMO_ROLE_CREDENTIALS[role];
  return loginAuthority(credentials.email, credentials.password);
}

export async function api<T>(path: string, init: RequestInit = {}, authenticate = true): Promise<T> {
  const headers = new Headers(init.headers);
  const token = authenticate ? getCurrentToken() : undefined;
  if (token && !headers.get("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${getApiBase()}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });
  if (!response.ok) {
    if (response.status === 401 && authenticate) {
      clearAuthoritySession();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("beacon:authority-session-expired"));
    }
    throw new Error(
      (await response.json().catch(() => null))?.detail ||
        (response.status === 401 ? "Your authority session has expired. Sign in again." : "BEACON service is unavailable"),
    );
  }
  return response.json();
}
