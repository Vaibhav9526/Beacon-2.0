import { BeaconClient } from "../apps/telegram-bot/dist/beacon.js";
import { BeaconTelegramBot } from "../apps/telegram-bot/dist/bot.js";

const base = process.env.BEACON_API_URL || "http://127.0.0.1:8000/api/v1";
const check = (condition, message) => { if (!condition) throw new Error(message); };
const json = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.detail || "failed"}`);
  return body;
};

class Store {
  sessions = new Map();
  async get(id) { return this.sessions.get(id) || null; }
  async set(session) { this.sessions.set(session.chatId, structuredClone(session)); }
  async delete(id) { this.sessions.delete(id); }
  async all() { return [...this.sessions.values()]; }
}
class Telegram {
  messages = [];
  async sendMessage(chatId, text, options) { this.messages.push({ chatId, text, options }); return {}; }
  async answerCallbackQuery() { return {}; }
  async getFile() {
    return { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"), filePath: "evidence.png" };
  }
}
let updateId = 1;
const message = (text, extra = {}) => ({ update_id: updateId++, message: { message_id: updateId, chat: { id: 7001, type: "private" }, from: { id: 7001, first_name: "Telegram" }, text, ...extra } });
const callback = (data) => ({ update_id: updateId++, callback_query: { id: `cb-${updateId}`, from: { id: 7001, first_name: "Telegram" }, data, message: { message_id: updateId, chat: { id: 7001, type: "private" } } } });

const login = await json("/authority/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@beacon.local", password: "BeaconDemo!26" }) });
const authority = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
await json("/demo/reset", { method: "POST", headers: authority, body: "{}" });

try {
  const telegram = new Telegram(), store = new Store();
  const bot = new BeaconTelegramBot(telegram, new BeaconClient(base), store);
  await bot.handle(message("/start"));
  await bot.handle(callback("lang:en"));
  await bot.handle(message("Telegram Judge"));
  await bot.handle(message(undefined, { contact: { phone_number: "+919000007001", first_name: "Telegram", user_id: 7001 } }));
  await bot.handle(message("/report"));
  await bot.handle(callback("hazard:flood"));
  await bot.handle(callback("severity:high"));
  await bot.handle(message("Flood water rising beside the Telegram demo road"));
  await bot.handle(message("Safe route and assessment"));
  await bot.handle(message(undefined, { location: { latitude: 21.2514, longitude: 81.6296 } }));
  await bot.handle(message(undefined, { photo: [{ file_id: "photo-1", file_unique_id: "photo-unique", file_size: 68, width: 1, height: 1 }] }));
  await bot.handle(callback("report:submit"));
  check(telegram.messages.some((item) => item.text.includes("Report submitted")), "Telegram report acknowledgement missing");

  let queue = await json("/authority/queue", { headers: authority });
  check(queue.incidents.length === 1 && queue.incidents[0].reports[0].original_text.includes("Telegram demo"), "Telegram report did not enter authority queue");

  await bot.handle(message("/sos"));
  await bot.handle(message(undefined, { location: { latitude: 21.2514, longitude: 81.6296 } }));
  queue = await json("/authority/queue", { headers: authority });
  check(queue.sos.length === 0, "SOS was sent before Telegram confirmation");
  await bot.handle(callback("sos:confirm"));
  queue = await json("/authority/queue", { headers: authority });
  check(queue.sos.length === 1, "Confirmed Telegram SOS did not enter authority queue");
  await bot.handle(message("/cancel_sos"));
  const session = await store.get(7001);
  const active = await new BeaconClient(base).activeSos(session.token);
  check(active.sos === null, "Telegram SOS cancellation failed");

  console.log(JSON.stringify({ ok: true, registered: true, report_to_authority: true, media_forwarded: true, sos_confirmation_guard: true, sos_cancelled: true, telegram_messages: telegram.messages.length }));
} finally {
  await json("/demo/reset", { method: "POST", headers: authority, body: "{}" });
}
