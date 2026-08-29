import Constants from "expo-constants";
import { File } from "expo-file-system";
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
let renewSession: (() => Promise<string | undefined>) | undefined;
let renewalInFlight: Promise<string | undefined> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setSessionToken(token?: string) {
  sessionToken = token;
}

export function setSessionRenewal(handler?: () => Promise<string | undefined>) {
  renewSession = handler;
  if (!handler) renewalInFlight = null;
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

async function request<T>(
  path: string,
  init?: RequestInit,
  retrySession = true,
  timeout = 10_000,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  const response = await timedFetch(`${baseUrl}${path}`, { ...init, headers }, timeout);
  const payload = await response.json().catch(() => null);
  if (response.status === 401 && retrySession && renewSession) {
    renewalInFlight ||= renewSession().finally(() => {
      renewalInFlight = null;
    });
    const refreshedToken = await renewalInFlight;
    if (refreshedToken) {
      sessionToken = refreshedToken;
      return request<T>(path, init, false, timeout);
    }
  }
  if (!response.ok)
    throw new ApiError(payload?.detail || "BEACON service is unavailable", response.status);
  return payload as T;
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  timeout?: number,
): Promise<T> {
  return request<T>(path, init, true, timeout);
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
  payload.attachments.forEach((attachment) => {
    const file = new File(attachment.uri);
    if (!file.exists || file.size <= 0)
      throw new ApiError(`${attachment.name} is empty or no longer available`, 400);
    form.append("media", file, attachment.name);
  });
  return form;
}

export async function submitReport(
  payload: ReportDraft & { citizen_id: string },
) {
  return api<{ report_id: string }>("/reports", {
    method: "POST",
    body: reportForm(payload),
  }, 45_000);
}

export async function submitSos(payload: {
  citizen_id: string;
  latitude: number;
  longitude: number;
  note: string;
}) {
  return api<SosRequest>("/sos", json("POST", payload));
}
