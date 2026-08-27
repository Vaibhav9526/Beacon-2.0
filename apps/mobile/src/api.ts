import Constants from "expo-constants";
import { Community, ContextPayload, ReportDraft, SosRequest } from "./types";

const configured = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
const debuggerHost =
  Constants.expoConfig?.hostUri?.split(":")[0] ||
  Constants.expoGoConfig?.debuggerHost?.split(":")[0];
const candidates = Array.from(
  new Set(
    [
      configured,
      debuggerHost ? `http://${debuggerHost}:8000/api/v1` : undefined,
      "http://10.0.2.2:8000/api/v1",
    ].filter(Boolean),
  ),
) as string[];

let baseUrl = candidates[0];
let sessionToken: string | undefined;

export function setSessionToken(token?: string) {
  sessionToken = token;
}

async function timedFetch(url: string, init?: RequestInit, timeout = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveApiBase() {
  for (const candidate of candidates) {
    try {
      const response = await timedFetch(`${candidate}/health`, undefined, 1800);
      if (response.ok) {
        baseUrl = candidate;
        return candidate;
      }
    } catch {
      /* Offline is a supported state. */
    }
  }
  return baseUrl;
}

export function getApiBase() {
  return baseUrl;
}
export function getWebSocketUrl() {
  const query = sessionToken
    ? `?token=${encodeURIComponent(sessionToken)}`
    : "";
  return `${baseUrl.replace(/^http/, "ws")}/ws${query}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  const response = await timedFetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.detail || "BEACON service is unavailable");
  return payload as T;
}

export function json(method: "POST" | "PATCH", value: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export async function fetchContext(latitude: number, longitude: number) {
  return api<ContextPayload>(`/context?lat=${latitude}&lon=${longitude}`);
}

export async function fetchCommunities() {
  return api<Community[]>("/communities");
}

export function reportForm(payload: ReportDraft & { citizen_id: string }) {
  const form = new FormData();
  form.append("citizen_id", payload.citizen_id);
  form.append("hazard_type", payload.hazard_type);
  form.append("severity", payload.severity);
  form.append("text", payload.text);
  form.append("requested_help", payload.requested_help);
  form.append("latitude", String(payload.coordinate.latitude));
  form.append("longitude", String(payload.coordinate.longitude));
  payload.attachments.forEach((attachment) =>
    form.append("media", {
      uri: attachment.uri,
      name: attachment.name,
      type: attachment.mimeType,
    } as unknown as Blob),
  );
  return form;
}

export async function submitReport(
  payload: ReportDraft & { citizen_id: string },
) {
  return api<{ report_id: string }>("/reports", {
    method: "POST",
    body: reportForm(payload),
  });
}

export async function submitSos(payload: {
  citizen_id: string;
  latitude: number;
  longitude: number;
  note: string;
}) {
  return api<SosRequest>("/sos", json("POST", payload));
}
