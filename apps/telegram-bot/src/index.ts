import { createServer } from "node:http";
import { Redis } from "ioredis";
import { BeaconClient } from "./beacon.js";
import { BeaconTelegramBot } from "./bot.js";
import { TelegramClient } from "./telegram.js";
import type { BotSession, SessionStore } from "./types.js";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const apiUrl = process.env.BEACON_API_URL || "http://api:8000/api/v1";
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const healthPort = Number(process.env.TELEGRAM_HEALTH_PORT || 8082);
const sessionTtl = Number(process.env.TELEGRAM_SESSION_TTL_SECONDS || 2_592_000);
const eventChannel = "beacon:events";
const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
const subscriber = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });

class RedisSessionStore implements SessionStore {
  private key(chatId: number) { return `telegram:session:${chatId}`; }
  async get(chatId: number) {
    const value = await redis.get(this.key(chatId));
    return value ? JSON.parse(value) as BotSession : null;
  }
  async set(session: BotSession) {
    await redis.multi().set(this.key(session.chatId), JSON.stringify(session), "EX", sessionTtl).sadd("telegram:chats", String(session.chatId)).exec();
  }
  async delete(chatId: number) {
    await redis.multi().del(this.key(chatId)).srem("telegram:chats", String(chatId)).exec();
  }
  async all() {
    const chatIds = await redis.smembers("telegram:chats");
    if (!chatIds.length) return [];
    const values = await redis.mget(chatIds.map((chatId) => this.key(Number(chatId))));
    return values.flatMap((value) => value ? [JSON.parse(value) as BotSession] : []);
  }
}

let ready = false;
let botIdentity: { id: number; username: string; first_name: string } | null = null;
let lastUpdateAt: string | null = null;
let lastError: string | null = null;
let stopping = false;
let pollController: AbortController | null = null;

const healthServer = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({
    status: ready ? "ready" : token ? "starting" : "waiting_for_token",
    telegram_configured: Boolean(token),
    bot: botIdentity ? `@${botIdentity.username}` : null,
    transport: "long-polling",
    beacon_api: apiUrl,
    last_update_at: lastUpdateAt,
    last_error: lastError,
  }));
});
healthServer.listen(healthPort, "0.0.0.0");

async function sleep(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  await redis.connect();
  await subscriber.connect();
  if (!token) {
    console.log("BEACON Telegram bot is waiting for TELEGRAM_BOT_TOKEN. Create one with @BotFather and restart this service.");
    ready = false;
    return;
  }

  const telegram = new TelegramClient(token);
  const bot = new BeaconTelegramBot(telegram, new BeaconClient(apiUrl), new RedisSessionStore());
  botIdentity = await telegram.getMe();
  await telegram.deleteWebhook();
  await telegram.setCommands([
    { command: "start", description: "Register or reopen BEACON" },
    { command: "conditions", description: "Current weather and local risk" },
    { command: "alerts", description: "Verified official alerts" },
    { command: "facilities", description: "Nearby hospitals and shelters" },
    { command: "report", description: "Report an incident with evidence" },
    { command: "sos", description: "Send a confirmed emergency SOS" },
    { command: "status", description: "View SOS and responder progress" },
    { command: "cancel_sos", description: "Cancel an accidental active SOS" },
    { command: "community", description: "Approved incident communities" },
    { command: "language", description: "Change interface language" },
    { command: "help", description: "Show every command" },
    { command: "cancel", description: "Cancel the current action" },
  ]);
  await subscriber.subscribe(eventChannel);
  subscriber.on("message", (_channel, message) => void bot.handleEvent(message));
  ready = true;
  console.log(`BEACON Telegram bot @${botIdentity.username} is ready using long polling.`);

  let offset = 0;
  while (!stopping) {
    pollController = new AbortController();
    try {
      const updates = await telegram.getUpdates(offset, pollController.signal);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try { await bot.handle(update); }
        catch (error) {
          lastError = error instanceof Error ? error.message.slice(0, 240) : "Update handler failed";
          console.error("Telegram update failed", { updateId: update.update_id, error: lastError });
          const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id;
          if (chatId) await telegram.sendMessage(chatId, "⚠️ BEACON could not complete that action. Your saved session and draft are retained.").catch(() => {});
        }
        lastUpdateAt = new Date().toISOString();
      }
      lastError = null;
    } catch (error) {
      if (stopping) break;
      lastError = error instanceof Error ? error.message.slice(0, 240) : "Telegram polling failed";
      console.error("Telegram polling retry", { error: lastError });
      await sleep(2_000);
    }
  }
}

async function shutdown() {
  stopping = true; ready = false; pollController?.abort();
  healthServer.close();
  await Promise.allSettled([redis.quit(), subscriber.quit()]);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((error) => {
  lastError = error instanceof Error ? error.message : "Bot startup failed";
  console.error("BEACON Telegram startup failed", { error: lastError });
});
