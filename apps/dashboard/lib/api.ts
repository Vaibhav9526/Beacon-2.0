export function getApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined")
    return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
  return "http://localhost:8000/api/v1";
}

export function getWsUrl(token?: string) {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return getApiBase().replace(/^http/, "ws") + "/ws" + query;
}
export const authHeaders = {
  Authorization: "Bearer official_admin",
  "Content-Type": "application/json",
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.detail ||
        "BEACON service is unavailable",
    );
  return response.json();
}
