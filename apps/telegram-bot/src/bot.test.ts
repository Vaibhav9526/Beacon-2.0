import { describe, expect, it } from "vitest";
import { BeaconTelegramBot } from "./bot.js";
import type { BeaconPort, BotSession, ReportDraft, SessionStore, TelegramPort, TelegramUpdate } from "./types.js";

class MemoryStore implements SessionStore {
  sessions = new Map<number, BotSession>();
  async get(id: number) { return this.sessions.get(id) || null; }
  async set(session: BotSession) { this.sessions.set(session.chatId, structuredClone(session)); }
  async delete(id: number) { this.sessions.delete(id); }
  async all() { return [...this.sessions.values()]; }
}

class FakeTelegram implements TelegramPort {
  messages: Array<{ chatId: number; text: string; options?: Record<string, unknown> }> = [];
  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) { this.messages.push({ chatId, text, options }); return {}; }
  async answerCallbackQuery() { return {}; }
  async getFile() { return { bytes: new Uint8Array([1, 2, 3]), filePath: "test.jpg" }; }
}

class FakeBeacon implements BeaconPort {
  reports: ReportDraft[] = [];
  sos: any = null;
  async register(input: any) { return { citizen: { id: `cit-${input.deviceId}` }, token: "cses-test" }; }
  async context() { return { weather: { risk: "Low", temperature: 27, precipitation: 0, wind_speed: 4, source: "Open-Meteo" }, alerts: [], facilities: [] }; }
  async submitReport(_session: BotSession, draft: ReportDraft) { this.reports.push(draft); return { incident: { id: "inc-1", trust_state: "Unverified" }, analysis_meta: { provider: "local-deterministic/v2" }, analysis: { summary: "Flood report received" } }; }
  async activeSos() { return { sos: this.sos, assignment: null }; }
  async createSos(_session: BotSession, location: any) { this.sos = { id: "sos-1", status: "New", ...location }; return this.sos; }
  async updateSos(_token: string, _id: string, location: any) { this.sos = { ...this.sos, ...location }; return this.sos; }
  async cancelSos() { this.sos.status = "Cancelled"; return this.sos; }
  async communities() { return []; }
  async sendCommunityMessage() { return {}; }
  async translate(text: string) { return { text, available: false, provider: "test-original-retained" }; }
}

const message = (chatId: number, text?: string, extra: Record<string, unknown> = {}): TelegramUpdate => ({ update_id: Math.random(), message: { message_id: 1, chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "Judge" }, text, ...extra } });
const callback = (chatId: number, data: string): TelegramUpdate => ({ update_id: Math.random(), callback_query: { id: data, from: { id: chatId, first_name: "Judge" }, data, message: { message_id: 1, chat: { id: chatId, type: "private" } } } });

async function register(bot: BeaconTelegramBot) {
  await bot.handle(message(7, "/start"));
  await bot.handle(callback(7, "lang:en"));
  await bot.handle(message(7, "SIH Judge"));
  await bot.handle(message(7, undefined, { contact: { phone_number: "+919999999999", first_name: "SIH", user_id: 7 } }));
}

describe("BEACON Telegram citizen workflows", () => {
  it("offers and accepts all twelve language choices", async () => {
    const telegram = new FakeTelegram(), beacon = new FakeBeacon(), store = new MemoryStore();
    const bot = new BeaconTelegramBot(telegram, beacon, store);
    await bot.handle(message(9, "/start"));
    const keyboard = (telegram.messages.at(-1)?.options?.reply_markup as any).inline_keyboard.flat();
    expect(keyboard).toHaveLength(12);
    await bot.handle(callback(9, "lang:ta"));
    expect((await store.get(9))?.language).toBe("ta");
  });

  it("registers, builds a report, and sends it through the shared pipeline", async () => {
    const telegram = new FakeTelegram(), beacon = new FakeBeacon(), store = new MemoryStore();
    const bot = new BeaconTelegramBot(telegram, beacon, store);
    await register(bot);
    expect((await store.get(7))?.citizenId).toContain("telegram:7");
    await bot.handle(message(7, "/report"));
    await bot.handle(callback(7, "hazard:flood"));
    await bot.handle(callback(7, "severity:high"));
    await bot.handle(message(7, "Water rising near the bridge"));
    await bot.handle(message(7, "Evacuation route"));
    await bot.handle(message(7, undefined, { location: { latitude: 21.25, longitude: 81.63 } }));
    await bot.handle(callback(7, "report:submit"));
    expect(beacon.reports).toHaveLength(1);
    expect(beacon.reports[0]).toMatchObject({ hazardType: "flood", severity: "high", latitude: 21.25 });
    expect(telegram.messages.at(-1)?.text).toContain("Incident: inc-1");
  });

  it("requires location and explicit confirmation before creating SOS", async () => {
    const telegram = new FakeTelegram(), beacon = new FakeBeacon(), store = new MemoryStore();
    const bot = new BeaconTelegramBot(telegram, beacon, store);
    await register(bot);
    await bot.handle(message(7, "/sos"));
    expect(beacon.sos).toBeNull();
    await bot.handle(message(7, undefined, { location: { latitude: 21.25, longitude: 81.63 } }));
    expect(beacon.sos).toBeNull();
    await bot.handle(callback(7, "sos:confirm"));
    expect(beacon.sos).toMatchObject({ status: "New", latitude: 21.25 });
  });

  it("routes private dispatch events only to the owning Telegram citizen", async () => {
    const telegram = new FakeTelegram(), beacon = new FakeBeacon(), store = new MemoryStore();
    store.sessions.set(1, { chatId: 1, language: "en", step: "idle", citizenId: "cit-a", token: "a" });
    store.sessions.set(2, { chatId: 2, language: "en", step: "idle", citizenId: "cit-b", token: "b" });
    const bot = new BeaconTelegramBot(telegram, beacon, store);
    await bot.handleEvent(JSON.stringify({ event: "dispatch.updated", audience: { kind: "citizen", citizenId: "cit-a" }, payload: { status: "En route", eta_minutes: 6 } }));
    expect(telegram.messages.map((item) => item.chatId)).toEqual([1]);
  });
});
