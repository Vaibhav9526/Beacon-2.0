import type { BeaconPort, BotSession, Language, ReportDraft } from "./types.js";

export class BeaconClient implements BeaconPort {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: init.signal || AbortSignal.timeout(25_000) });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw Object.assign(new Error(body.detail || `BEACON API HTTP ${response.status}`), { status: response.status });
    return body as T;
  }

  register(input: { name: string; phone: string; language: Language; deviceId: string }) {
    return this.request<any>("/citizens/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: input.name, phone: input.phone, language: input.language, device_id: input.deviceId }) });
  }

  context(location?: { latitude: number; longitude: number }) {
    const query = location ? `?lat=${location.latitude}&lon=${location.longitude}` : "";
    return this.request<any>(`/context${query}`);
  }

  async submitReport(session: BotSession, draft: ReportDraft, files: Array<{ bytes: Uint8Array; name: string; mime: string }>) {
    const form = new FormData();
    const fields = {
      citizen_id: session.citizenId!, hazard_type: draft.hazardType!, severity: draft.severity!, text: draft.text!,
      requested_help: draft.requestedHelp || "", latitude: String(draft.latitude), longitude: String(draft.longitude), language: session.language,
    };
    Object.entries(fields).forEach(([key, value]) => form.set(key, value));
    files.forEach((file) => {
      const copy = new Uint8Array(file.bytes.byteLength);
      copy.set(file.bytes);
      form.append("media", new Blob([copy.buffer], { type: file.mime }), file.name);
    });
    return this.request<any>("/reports", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: form });
  }

  activeSos(token: string) {
    return this.request<any>("/sos/active", { headers: { Authorization: `Bearer ${token}` } });
  }

  createSos(session: BotSession, location: { latitude: number; longitude: number }) {
    return this.request<any>("/sos", { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ citizen_id: session.citizenId, ...location, note: "Emergency assistance requested from Telegram" }) });
  }

  updateSos(token: string, sosId: string, location: { latitude: number; longitude: number }) {
    return this.request<any>(`/sos/${encodeURIComponent(sosId)}/location`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(location) });
  }

  cancelSos(token: string, sosId: string) {
    return this.request<any>(`/sos/${encodeURIComponent(sosId)}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  }

  communities() { return this.request<any[]>("/communities"); }

  sendCommunityMessage(token: string, communityId: string, body: string) {
    return this.request<any>(`/communities/${encodeURIComponent(communityId)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  }

  translate(text: string, sourceLanguage: Language, targetLanguage: Language) {
    return this.request<{ text: string; available: boolean; provider: string }>("/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source_language: sourceLanguage, target_language: targetLanguage }),
    });
  }
}
