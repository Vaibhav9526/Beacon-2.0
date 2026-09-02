import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { mkdir, readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as s from "./schema.js";
import { analyzeExtensionScreenshot, analyzeReport, redactPII, transcribeAudio, translateForExtension } from "./ai.js";
import { config, serviceReadiness } from "./config.js";
import { readLocalMedia, storeMedia } from "./media.js";
import { INDIAN_LANGUAGES, translateText } from "./translation.js";
import { verifyClaim } from "./verification.js";
import { z } from "zod";

const EVENT_CHANNEL = "beacon:events";
const INSTANCE_ID = randomUUID();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
});
const db = drizzle(pool, { schema: s });
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || "info", redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.api_secret"] },
  bodyLimit: Math.max(12 * 1024 * 1024, config.uploads.maxFileBytes * config.uploads.maxFiles + 1_000_000),
  // Vision extraction + bounded evidence research can legitimately take more
  // than ten seconds. The previous socket timeout terminated healthy requests
  // mid-flight and surfaced as intermittent extension failures.
  connectionTimeout: 65_000,
  requestTimeout: 60_000,
  keepAliveTimeout: 72_000,
});
type Principal = { kind: "official"; id: string; role: "admin" | "responder" } | { kind: "citizen"; id: string };
type Audience = { kind: "authority" } | { kind: "authenticated" } | { kind: "citizen"; citizenId: string };
const sockets = new Map<any, Principal>();
const supportedLanguageCodes = new Set(INDIAN_LANGUAGES.map((item) => item.code));

const coordinateSchema = z.object({
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
});
const citizenSessionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(8).max(15)),
  language: z.string().trim().min(2).max(8).refine((value) => supportedLanguageCodes.has(value as any), "Unsupported language code").default("en"),
  device_id: z.string().trim().min(8).max(160),
});
const reportFieldsSchema = coordinateSchema.extend({
  citizen_id: z.string().trim().min(4).max(100),
  hazard_type: z.string().trim().min(2).max(60),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  text: z.string().trim().min(3).max(4_000),
  requested_help: z.string().trim().max(500).default(""),
  language: z.string().trim().min(2).max(8).optional(),
  evidence_count: z.coerce.number().int().min(0).max(4).default(0),
});
const sosSchema = coordinateSchema.extend({
  citizen_id: z.string().trim().min(4).max(100),
  note: z.string().trim().max(500).default("Emergency assistance requested"),
});
const communityMessageSchema = z.object({
  body: z.string().trim().min(1).max(1_000),
  source_language: z.string().trim().min(2).max(8).refine((value) => supportedLanguageCodes.has(value as any), "Unsupported language code").optional(),
});

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const publicArea = (lat: number, lon: number) => `Ward area near ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
const snake = (value: any): any => {
  if (Array.isArray(value)) return value.map(snake);
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), snake(item)]));
  return value;
};
const safeError = (reply: FastifyReply, code: number, detail: string) => reply.code(code).send({ detail });
const parseBody = <T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  safeError(reply, 400, result.error.issues[0]?.message || "Invalid request payload");
  return null;
};
const hashPassword = (password: string) => { const salt = randomBytes(16).toString("hex"); return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`; };
const verifyPassword = (password: string, stored: string) => {
  if (!stored.startsWith("scrypt$")) return stored === password;
  const [, salt, expectedHex] = stored.split("$");
  const actual = scryptSync(password, salt, 32), expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

async function ensureSchema() {
  const migration = await readFile(join(root, "drizzle", "0000_beacon.sql"), "utf8");
  await pool.query(migration);
}

async function seed() {
  const demoOfficials = [
    { id: "official_admin", name: "Vaibhav Sharma", email: "admin@beacon.local", password: "BeaconDemo!26", role: "admin" as const, organization: "Raipur District Control", jurisdiction: "Raipur", mfaReady: true },
    { id: "official_responder", name: "Ravi Sahu", email: "responder@beacon.local", password: "ResponderDemo!26", role: "responder" as const, organization: "NDRF Demo Unit", jurisdiction: "Raipur", mfaReady: true },
  ];
  await db.insert(s.officialUsers).values(demoOfficials.map((user) => ({ ...user, password: hashPassword(user.password) }))).onConflictDoNothing();
  for (const demo of demoOfficials) {
    const [stored] = await db.select({ password: s.officialUsers.password }).from(s.officialUsers).where(eq(s.officialUsers.id, demo.id)).limit(1);
    await db.update(s.officialUsers).set({
      name: demo.name,
      email: demo.email,
      role: demo.role,
      organization: demo.organization,
      jurisdiction: demo.jurisdiction,
      mfaReady: demo.mfaReady,
    }).where(eq(s.officialUsers.id, demo.id));
    if (stored && !stored.password.startsWith("scrypt$")) await db.update(s.officialUsers).set({ password: hashPassword(demo.password) }).where(eq(s.officialUsers.id, demo.id));
  }
  await db.insert(s.facilities).values([
    { id: "fac_aiims", name: "AIIMS Raipur", kind: "hospital", latitude: 21.2589, longitude: 81.5783, verified: true },
    { id: "fac_dks", name: "Dr. B. R. Ambedkar Hospital", kind: "hospital", latitude: 21.2521, longitude: 81.6318, verified: true },
    { id: "fac_shelter", name: "Shankar Nagar Civic Shelter", kind: "shelter", latitude: 21.2528, longitude: 81.6572, capacity: 120, verified: true },
  ]).onConflictDoNothing();
  await pool.query("UPDATE facilities SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE location IS NULL");
}

async function rateLimit(key: string, limit: number, seconds: number) {
  try {
    const count = await redis.incr(`rate:${key}`);
    if (count === 1) await redis.expire(`rate:${key}`, seconds);
    if (count > limit) throw Object.assign(new Error("Too many requests. Please wait and try again."), { statusCode: 429 });
  } catch (error: any) {
    if (error?.statusCode === 429) throw error;
    app.log.warn({ err: error, key }, "Redis rate limiter unavailable; allowing request");
  }
}

async function emit(event: string, payload: any, audience: Audience = { kind: "authority" }) {
  const envelope = { event, payload: snake(payload), audience, at: new Date().toISOString(), origin: INSTANCE_ID };
  broadcast(envelope);
  try {
    await redis.publish(EVENT_CHANNEL, JSON.stringify(envelope));
  } catch (error) {
    app.log.warn({ err: error, event }, "Redis publish unavailable; event delivered to local clients only");
  }
}

function broadcast(envelope: { event: string; payload: any; audience?: Audience; at: string; origin?: string }) {
  const outbound = JSON.stringify({ event: envelope.event, payload: envelope.payload, at: envelope.at });
  for (const [socket, principal] of sockets) {
    const audience = envelope.audience;
    const allowed = (!audience && principal.kind === "official") || audience?.kind === "authenticated" || (audience?.kind === "authority" && principal.kind === "official") || (audience?.kind === "citizen" && (principal.kind === "official" || principal.id === audience.citizenId));
    if (allowed && socket.readyState === 1) {
      try { socket.send(outbound); }
      catch (error) { sockets.delete(socket); app.log.warn({ err: error }, "Realtime client send failed"); }
    }
  }
}

async function audit(actorId: string, action: string, entityType: string, entityId: string, reason?: string, detail: Record<string, any> = {}) {
  await db.insert(s.auditEvents).values({ id: id("aud"), actorId, action, entityType, entityId, reason, detail });
}

async function resolvePrincipal(token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  let userId: string | undefined;
  if (config.demoAuth && token.startsWith("official_")) userId = token;
  else {
    const [session] = await db.select().from(s.officialSessions).where(and(eq(s.officialSessions.id, token), sql`${s.officialSessions.expiresAt} > now()`)).limit(1);
    userId = session?.officialUserId;
  }
  const [user] = userId ? await db.select().from(s.officialUsers).where(eq(s.officialUsers.id, userId)).limit(1) : [];
  if (user) return { kind: "official", id: user.id, role: user.role };
  const [citizenSession] = await db.select().from(s.citizenSessions).where(and(eq(s.citizenSessions.id, token), sql`${s.citizenSessions.expiresAt} > now()`)).limit(1);
  return citizenSession ? { kind: "citizen", id: citizenSession.citizenId } : null;
}

async function requireOfficial(request: FastifyRequest, reply: FastifyReply, role?: "admin" | "responder") {
  const principal = await resolvePrincipal(request.headers.authorization?.replace("Bearer ", ""));
  if (!principal || principal.kind !== "official") return safeError(reply, 401, "Authority session required");
  const [user] = await db.select().from(s.officialUsers).where(eq(s.officialUsers.id, principal.id)).limit(1);
  if (!user) return safeError(reply, 401, "Unknown authority session");
  if (role && user.role !== role) return safeError(reply, 403, `${role} role required`);
  return user;
}

async function requireCitizen(request: FastifyRequest, reply: FastifyReply, citizenId: string) {
  const principal = await resolvePrincipal(request.headers.authorization?.replace("Bearer ", ""));
  if (!principal || principal.kind !== "citizen") { safeError(reply, 401, "Citizen session required"); return false; }
  if (principal.id !== citizenId) { safeError(reply, 403, "Citizen session does not own this request"); return false; }
  return true;
}

type CachedMessageTranslation = {
  text: string;
  provider: string;
  translated_at: string;
};

async function localizeCommunityMessage(message: typeof s.messages.$inferSelect, targetLanguage: string) {
  const { translations: storedTranslations, ...publicMessage } = message;
  const sourceLanguage = supportedLanguageCodes.has(message.sourceLanguage as any) ? message.sourceLanguage : "en";
  if (sourceLanguage === targetLanguage) {
    return { ...publicMessage, body: message.body, originalBody: message.body, sourceLanguage, displayLanguage: sourceLanguage, translated: false, translationAvailable: true, translationProvider: "original" };
  }

  const translations = (storedTranslations && typeof storedTranslations === "object" ? storedTranslations : {}) as Record<string, CachedMessageTranslation>;
  const cached = translations[targetLanguage];
  if (cached?.text) {
    return { ...publicMessage, body: cached.text, originalBody: message.body, sourceLanguage, displayLanguage: targetLanguage, translated: true, translationAvailable: true, translationProvider: cached.provider };
  }

  const failureKey = `translation-failure:${message.id}:${targetLanguage}`;
  const recentFailure = await redis.get(failureKey).catch(() => null);
  if (recentFailure) {
    const failure = JSON.parse(recentFailure) as { provider?: string };
    return { ...publicMessage, body: message.body, originalBody: message.body, sourceLanguage, displayLanguage: sourceLanguage, requestedLanguage: targetLanguage, translated: false, translationAvailable: false, translationProvider: failure.provider || "unavailable" };
  }

  // Cloud providers never receive the sender's name, phone number, email, or coordinates.
  const safeText = redactPII(message.body, [message.senderName]).text;
  const result = await translateText(safeText, sourceLanguage, targetLanguage, { aiFallback: true });
  if (result.available && result.text.trim()) {
    const entry: CachedMessageTranslation = { text: result.text, provider: result.provider, translated_at: new Date().toISOString() };
    await db.update(s.messages).set({ translations: sql`coalesce(${s.messages.translations}, '{}'::jsonb) || ${JSON.stringify({ [targetLanguage]: entry })}::jsonb` }).where(eq(s.messages.id, message.id));
    return { ...publicMessage, body: entry.text, originalBody: message.body, sourceLanguage, displayLanguage: targetLanguage, translated: true, translationAvailable: true, translationProvider: entry.provider };
  }

  await redis.set(failureKey, JSON.stringify({ provider: result.provider }), "EX", 300).catch(() => undefined);
  return { ...publicMessage, body: message.body, originalBody: message.body, sourceLanguage, displayLanguage: sourceLanguage, requestedLanguage: targetLanguage, translated: false, translationAvailable: false, translationProvider: result.provider };
}

function normalizedTokens(text: string) {
  return new Set(text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((token) => token.length > 2));
}

function textSimilarity(left: string, right: string) {
  const a = normalizedTokens(left), b = normalizedTokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

async function deliveryLedger(entityType: string, entityId: string, notification: { title?: string; body?: string } = {}) {
  const connectedCitizens = new Set([...sockets.values()].filter((principal) => principal.kind === "citizen").map((principal) => principal.id)).size;
  const attempts: typeof s.deliveryAttempts.$inferInsert[] = [{ id: id("del"), entityType, entityId, channel: "notification/realtime-local", status: connectedCitizens ? "accepted" : "not_connected", detail: connectedCitizens ? `Sent to ${connectedCitizens} connected citizen device(s) for Android notification-bar presentation` : "No citizen app is connected; the official feed remains available on reconnect" }];
  let externalDelivered = connectedCitizens > 0;
  const fcmTokens = String(process.env.FCM_TEST_TOKENS || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 100);
  if (process.env.FCM_SERVER_KEY && fcmTokens.length) {
    try {
      const response = await fetch("https://fcm.googleapis.com/fcm/send", { method: "POST", signal: AbortSignal.timeout(6_000), headers: { Authorization: `key=${process.env.FCM_SERVER_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ registration_ids: fcmTokens, notification: { title: notification.title || "BEACON official update", body: notification.body || "Open BEACON for verified guidance." }, data: { entity_type: entityType, entity_id: entityId } }) });
      externalDelivered ||= response.ok;
      attempts.push({ id: id("del"), entityType, entityId, channel: "push/fcm", status: response.ok ? "delivered" : "failed", detail: response.ok ? `Accepted for ${fcmTokens.length} configured test device(s)` : `FCM returned HTTP ${response.status}` });
    } catch { attempts.push({ id: id("del"), entityType, entityId, channel: "push/fcm", status: "failed", detail: "FCM request failed; no credential or token detail logged" }); }
  } else attempts.push({ id: id("del"), entityType, entityId, channel: "push/fcm", status: "not_configured", detail: process.env.FCM_SERVER_KEY ? "FCM_TEST_TOKENS is empty; outbound delivery restricted to test devices" : "FCM_SERVER_KEY is not set" });
  attempts.push({ id: id("del"), entityType, entityId, channel: "official-feed/reconnect", status: externalDelivered ? "not_needed" : "available", detail: externalDelivered ? "A live notification path accepted the update" : "Verified content remains available from the API when the citizen app reconnects" });
  await db.insert(s.deliveryAttempts).values(attempts);
}

function configuredSmsRecipients() {
  return String(process.env.TEXTBELT_TEST_RECIPIENTS || process.env.MSG91_TEST_RECIPIENTS || "")
    .split(",")
    .map((item) => item.replace(/\D/g, ""))
    .filter((item) => /^\d{10,15}$/.test(item))
    .slice(0, 25);
}

async function dispatchTextbelt(title: string, message: string, recipients: string[]) {
  if (!config.textbelt.url || !recipients.length) return null;
  const endpoint = `${config.textbelt.url}/${config.textbelt.region === "us" ? "text" : config.textbelt.region}`;
  const results = await Promise.all(recipients.map(async (number) => {
    try {
      const body = new URLSearchParams({ number, message: `${title}: ${message}`.slice(0, 320) });
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => ({})) as { success?: boolean; message?: string };
      return { accepted: response.ok && result.success === true, detail: String(result.message || `HTTP ${response.status}`).slice(0, 140) };
    } catch (error) {
      return { accepted: false, detail: error instanceof Error ? error.message.slice(0, 140) : "Textbelt request failed" };
    }
  }));
  const accepted = results.filter((result) => result.accepted).length;
  return {
    accepted,
    failed: results.length - accepted,
    detail: accepted === results.length
      ? `Textbelt accepted ${accepted} test recipient(s); carrier delivery is unconfirmed`
      : `Textbelt accepted ${accepted}/${results.length}; ${results.find((result) => !result.accepted)?.detail || "SMTP gateway rejected the request"}`,
  };
}

async function dispatchAuthoritySms(
  entityId: string,
  title: string,
  message: string,
  recipients = configuredSmsRecipients(),
) {
  if (config.textbelt.url) {
    const textbelt = recipients.length
      ? await dispatchTextbelt(title, message, recipients)
      : { accepted: 0, failed: 0, detail: "No Textbelt test recipients configured; message retained without external delivery" };
    const attempt: typeof s.deliveryAttempts.$inferInsert = {
      id: id("del"), entityType: "manual_sms", entityId,
      channel: "sms/textbelt",
      status: textbelt && textbelt.accepted === recipients.length && recipients.length ? "accepted" : "queued",
      detail: textbelt?.detail || "Textbelt request failed; message retained for retry",
    };
    await db.insert(s.deliveryAttempts).values(attempt);
    return attempt;
  }
  const attempt: typeof s.deliveryAttempts.$inferInsert = {
    id: id("del"),
    entityType: "manual_sms",
    entityId,
    channel: "sms/msg91",
    status: "queued",
    detail: "SMS retained for configured test recipients",
  };
  if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_TEMPLATE_ID || !recipients.length) {
    attempt.detail = !recipients.length
      ? "No test recipients configured; message retained without external delivery"
      : "MSG91 credentials incomplete; message retained for store-and-forward";
  } else {
    const variable = process.env.MSG91_MESSAGE_VARIABLE || "BEACON_MESSAGE";
    try {
      const response = await fetch("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        signal: AbortSignal.timeout(6_000),
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          short_url: "0",
          recipients: recipients.map((mobiles) => ({
            mobiles,
            [variable]: `${title}: ${message}`.slice(0, 320),
          })),
        }),
      });
      attempt.status = response.ok ? "delivered" : "queued";
      attempt.detail = response.ok
        ? `Accepted for ${recipients.length} configured test recipient(s)`
        : `MSG91 returned HTTP ${response.status}; message remains in the delivery ledger`;
    } catch {
      attempt.status = "queued";
      attempt.detail = "MSG91 request failed; message is retained for store-and-forward";
    }
  }
  await db.insert(s.deliveryAttempts).values(attempt);
  return attempt;
}

await app.register(cors, { origin: true, methods: ["GET", "POST", "PATCH", "DELETE"] });
await app.register(multipart, { limits: { files: config.uploads.maxFiles, fileSize: config.uploads.maxFileBytes, fields: 16, parts: config.uploads.maxFiles + 16 } });
await app.register(websocket);
await app.register(swagger, { openapi: { info: { title: "BEACON Crisis Intelligence API", version: "2.0.0" } } });
await app.register(swaggerUi, { routePrefix: "/docs" });

app.setErrorHandler((error: any, _request, reply) => {
  const statusCode = Number(error.statusCode) || 500;
  if (statusCode >= 500) app.log.error(error);
  else app.log.warn({ statusCode, message: error.message }, "Request rejected");
  reply.code(statusCode).send({ detail: statusCode < 500 ? error.message : "BEACON service error", request_id: id("err") });
});

app.get("/api/v1", async () => ({
  name: "BEACON Crisis Intelligence API",
  status: "ready",
  version: "2.0.0",
  health: "/api/v1/health",
  documentation: "/docs",
  note: "Use the BEACON citizen app or authority dashboard to submit authenticated requests.",
}));

app.get("/api/v1/health", async () => {
  const pg = await pool.query("SELECT PostGIS_Version() AS postgis");
  const redisPing = await redis.ping().catch(() => "DEGRADED");
  return { status: redisPing === "PONG" ? "ready" : "degraded", database: "postgresql/postgis", postgis: pg.rows[0].postgis, redis: redisPing, realtime_clients: sockets.size, services: serviceReadiness(), time: new Date().toISOString() };
});

app.get("/api/v1/ws", { websocket: true }, async (socket: any, request: any) => {
  const principal = await resolvePrincipal(String(request.query?.token || ""));
  if (!principal) { socket.send(JSON.stringify({ event: "error", payload: { detail: "Authenticated realtime session required" } })); socket.close(1008, "Unauthorized"); return; }
  sockets.set(socket, principal);
  socket.send(JSON.stringify({ event: "connected", payload: { at: new Date().toISOString(), transport: "redis-websocket", audience: principal.kind } }));
  socket.on("message", (raw: Buffer) => { if (raw.toString() === "ping") socket.send(JSON.stringify({ event: "pong", payload: { at: new Date().toISOString() } })); });
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
});

app.post("/api/v1/citizens/session", async (request: any, reply) => {
  await rateLimit(`session:${request.ip}`, 12, 60);
  const body = parseBody(citizenSessionSchema, request.body, reply);
  if (!body) return;
  const [existing] = await db.select().from(s.citizens).where(and(eq(s.citizens.phone, body.phone), eq(s.citizens.deviceId, body.device_id))).limit(1);
  let citizen = existing || { id: id("cit"), name: body.name, phone: body.phone, language: body.language || "en", deviceId: body.device_id, createdAt: new Date() };
  if (!existing) [citizen] = await db.insert(s.citizens).values(citizen).returning();
  else [citizen] = await db.update(s.citizens).set({ name: body.name, language: body.language || existing.language }).where(eq(s.citizens.id, existing.id)).returning();
  const token = id("cses"), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await db.insert(s.citizenSessions).values({ id: token, citizenId: citizen.id, deviceId: body.device_id, expiresAt });
  return { citizen: snake(citizen), token, expires_at: expiresAt.toISOString() };
});

app.patch("/api/v1/citizens/:id/language", async (request: any, reply) => {
  if (!(await requireCitizen(request, reply, request.params.id))) return;
  const language = String(request.body?.language || "").trim();
  if (!supportedLanguageCodes.has(language as any)) return safeError(reply, 400, "Unsupported language code");
  const [citizen] = await db.update(s.citizens).set({ language }).where(eq(s.citizens.id, request.params.id)).returning();
  if (!citizen) return safeError(reply, 404, "Citizen not found");
  await emit("citizen.language.updated", { citizen_id: citizen.id, language }, { kind: "citizen", citizenId: citizen.id });
  return { citizen: snake(citizen), translation_cache: "per-message/per-language" };
});

app.get("/api/v1/languages", async () => ({ languages: INDIAN_LANGUAGES, provider: "BHASHINI", configured: serviceReadiness().language.configured }));

app.post("/api/v1/translate", async (request: any, reply) => {
  await rateLimit(`translate:${request.ip}`, 20, 60);
  const body = request.body as { text?: string; source_language?: string; target_language?: string };
  const source = String(body.source_language || ""), target = String(body.target_language || "en"), text = String(body.text || "").trim();
  const supported = new Set(INDIAN_LANGUAGES.map((item) => item.code));
  if (!text || text.length > 2_000) return safeError(reply, 400, "Translation text must contain 1–2000 characters");
  if (!supported.has(source as any) || !supported.has(target as any)) return safeError(reply, 400, "Unsupported language code");
  return translateText(redactPII(text).text, source, target);
});

app.post("/api/v1/extension/translate", async (request: any, reply) => {
  await rateLimit(`extension-translate:${request.ip}`, 20, 60);
  const body = request.body as { text?: string; source_language?: string; target_language?: string };
  const source = String(body.source_language || "auto"), target = String(body.target_language || "en"), text = String(body.text || "").trim();
  if (!text || text.length > 20_000) return safeError(reply, 400, "Translation text must contain 1–20,000 characters");
  return translateForExtension(redactPII(text).text, source, target);
});

app.post("/api/v1/extension/fact-check", async (request: any, reply) => {
  await rateLimit(`extension-fact-check:${request.ip}`, 12, 60);
  const body = request.body as { image?: string; page_title?: string; page_url?: string };
  const match = String(body.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return safeError(reply, 400, "A JPEG, PNG, or WebP screenshot is required");
  if (match[2].length > 10_000_000) return safeError(reply, 413, "Screenshot is too large");
  const cacheKey = `extension-fact-check:${createHash("sha256").update(match[2]).digest("hex")}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try { return { ...JSON.parse(cached), cached: true }; } catch { /* refresh malformed cache */ }
  }
  const analysis = await analyzeExtensionScreenshot({ mime: match[1], data: match[2] }, String(body.page_title || "").slice(0, 300));
  const verification = await verifyClaim(analysis.result.search_query);
  const verdict = verification.verdict === "Corroborating coverage" ? "Unverified" : verification.verdict === "Insufficient external evidence" ? "Unverified" : verification.verdict;
  const result = { ok: true, claim: analysis.result.claim, verdict, reasoning: `${analysis.result.reasoning} ${verification.summary}`, sources: verification.sources, tone: verdict === "Contradicted" ? "red" : verdict === "Supported" ? "teal" : "amber", confidence: verification.confidence, confidence_basis: verification.confidence_basis, provider: `${analysis.provider} · ${verification.providers.join(" + ") || "external checks unavailable"}`, errors: [...analysis.errors, ...verification.errors], human_review_required: true };
  await redis.set(cacheKey, JSON.stringify(result), "EX", 600).catch(() => undefined);
  return result;
});

app.post("/api/v1/authority/login", async (request: any, reply) => {
  await rateLimit(`authority-login:${request.ip}`, 10, 60);
  const { email, password } = request.body as { email: string; password: string };
  const [user] = await db.select().from(s.officialUsers).where(eq(s.officialUsers.email, email)).limit(1);
  if (!user || !verifyPassword(password, user.password)) return safeError(reply, 401, "Invalid local demo credentials");
  const token = id("ses");
  await db.insert(s.officialSessions).values({ id: token, officialUserId: user.id, expiresAt: new Date(Date.now() + 12 * 60 * 60_000) });
  const { password: _password, ...safe } = user;
  return { user: snake(safe), token, expires_at: new Date(Date.now() + 12 * 60 * 60_000).toISOString() };
});

app.get("/api/v1/context", async (request: any) => {
  const parsed = coordinateSchema.safeParse({ latitude: request.query?.lat ?? 21.2514, longitude: request.query?.lon ?? 81.6296 });
  const { latitude: lat, longitude: lon } = parsed.success ? parsed.data : { latitude: 21.2514, longitude: 81.6296 };
  const key = `weather:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  let weather: any = null;
  try { weather = JSON.parse((await redis.get(key)) || "null"); } catch { weather = null; }
  if (!weather) {
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&timezone=auto`, { signal: AbortSignal.timeout(3500) });
      const current = (await response.json() as any).current;
      weather = { temperature: current.temperature_2m, wind_speed: current.wind_speed_10m, precipitation: current.precipitation, risk: current.precipitation >= 10 ? "Elevated" : "Low", source: "Open-Meteo", observed_at: current.time };
      await redis.set(key, JSON.stringify(weather), "EX", 300).catch(() => undefined);
    } catch { weather = { temperature: null, wind_speed: null, precipitation: null, risk: "Unknown", source: "weather temporarily unavailable", observed_at: null, stale: true }; }
  }
  const [allFacilities, activeAlerts, unverified, verifiedIncidents] = await Promise.all([
    db.select().from(s.facilities), db.select().from(s.alerts).where(and(eq(s.alerts.status, "active"), sql`(${s.alerts.expiresAt} IS NULL OR ${s.alerts.expiresAt} > now())`)).orderBy(desc(s.alerts.publishedAt)), db.select().from(s.incidents).where(inArray(s.incidents.trustState, ["Unverified", "Corroborated"])).orderBy(desc(s.incidents.createdAt)), db.select().from(s.incidents).where(eq(s.incidents.trustState, "Verified")).orderBy(desc(s.incidents.updatedAt)),
  ]);
  const approximateIncident = (incident: typeof verifiedIncidents[number]) => ({ ...incident, latitude: Number(incident.latitude.toFixed(2)), longitude: Number(incident.longitude.toFixed(2)) });
  const publicVerified = verifiedIncidents.map(approximateIncident);
  const publicUnverified = unverified.map(approximateIncident);
  const incidentLocations = new Map(publicVerified.map((incident) => [incident.id, { latitude: incident.latitude, longitude: incident.longitude, approximate_area: incident.approximateArea }]));
  const alertsWithLocation = activeAlerts.map((alert) => ({ ...alert, ...(alert.incidentId ? incidentLocations.get(alert.incidentId) : {}) }));
  return { weather, facilities: snake(allFacilities), alerts: snake(alertsWithLocation), unverified: snake(publicUnverified), verified: snake(publicVerified), verified_incidents: snake(publicVerified) };
});

app.get("/api/v1/media/local/:storageKey", async (request: any, reply) => {
  if (!(await requireOfficial(request, reply))) return;
  const [evidence] = await db.select().from(s.mediaEvidence).where(and(eq(s.mediaEvidence.storageKey, request.params.storageKey), eq(s.mediaEvidence.provider, "local"))).limit(1);
  if (!evidence) return safeError(reply, 404, "Evidence not found");
  const content = await readLocalMedia(request.params.storageKey);
  return reply.header("Cache-Control", "private, max-age=300").type(evidence.mimeType).send(content);
});

app.post("/api/v1/authority/reports/:reportId/media/:index/transcribe", async (request: any, reply) => {
  const principal = await requireOfficial(request, reply);
  if (!principal) return;
  const mediaIndex = Number(request.params.index);
  if (!Number.isInteger(mediaIndex) || mediaIndex < 0) return safeError(reply, 400, "Invalid media index");
  const [report] = await db.select({ id: s.reports.id, media: s.reports.media }).from(s.reports).where(eq(s.reports.id, request.params.reportId)).limit(1);
  if (!report) return safeError(reply, 404, "Report not found");
  const media = Array.isArray(report.media) ? [...report.media as any[]] : [];
  const item = media[mediaIndex];
  if (!item || item.resource_type !== "audio") return safeError(reply, 404, "Audio evidence not found");
  const [evidence] = await db.select().from(s.mediaEvidence).where(and(eq(s.mediaEvidence.reportId, report.id), eq(s.mediaEvidence.url, item.url))).limit(1);
  if (!evidence) return safeError(reply, 404, "Retained audio file not found");
  let content: Buffer;
  if (evidence.provider === "local") {
    content = await readLocalMedia(evidence.storageKey);
  } else {
    const source = new URL(evidence.secureUrl || evidence.url);
    if (source.protocol !== "https:" || !source.hostname.endsWith("cloudinary.com")) return safeError(reply, 400, "Untrusted media source");
    const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return safeError(reply, 502, "Unable to retrieve retained audio");
    content = Buffer.from(await response.arrayBuffer());
  }
  const transcript = await transcribeAudio(content, evidence.mimeType, evidence.originalName);
  const updated = {
    ...item,
    transcript_original: transcript.transcript_original,
    detected_language: transcript.detected_language,
    translation_en: transcript.translation_en,
    transcription_provider: transcript.provider,
    transcription_available: transcript.available,
    transcription_errors: transcript.errors,
  };
  media[mediaIndex] = updated;
  await db.update(s.reports).set({ media }).where(eq(s.reports.id, report.id));
  await audit(principal.id, "audio_transcribed", "report", report.id, undefined, { media_index: mediaIndex, provider: transcript.provider, available: transcript.available });
  return updated;
});

app.post("/api/v1/reports", async (request: any, reply) => {
  await rateLimit(`report:${request.ip}`, 8, 60);
  const fields: Record<string, string> = {}, pendingMedia: Array<{ buffer: Buffer; name: string; mime: string }> = [];
  for await (const part of request.parts()) {
    if (part.type === "file") {
      const content = await part.toBuffer();
      pendingMedia.push({ buffer: content, name: String(part.filename || "evidence"), mime: part.mimetype });
    } else fields[part.fieldname] = String(part.value);
  }
  const body = parseBody(reportFieldsSchema, fields, reply);
  if (!body) return;
  if (pendingMedia.length !== body.evidence_count)
    return safeError(reply, 422, `Expected ${body.evidence_count} evidence file(s), received ${pendingMedia.length}`);
  const { citizen_id: citizenId, hazard_type: hazardType, severity, text, latitude, longitude } = body;
  if (!(await requireCitizen(request, reply, citizenId))) return;
  const [citizen] = await db.select({ id: s.citizens.id, name: s.citizens.name, language: s.citizens.language }).from(s.citizens).where(eq(s.citizens.id, citizenId)).limit(1);
  if (!citizen) return safeError(reply, 404, "Citizen session not found");
  const storedMedia = await Promise.all(pendingMedia.map(async (item) => {
    const stored = await storeMedia(item.buffer, item.name, item.mime);
    return {
      ...stored,
      transcriptOriginal: undefined as string | undefined,
      detectedLanguage: undefined as string | undefined,
      translationEn: undefined as string | undefined,
      transcriptionProvider: stored.resourceType === "audio" ? "queued" : undefined,
      transcriptionAvailable: stored.resourceType === "audio" ? false : undefined,
      transcriptionErrors: stored.resourceType === "audio" ? [] as string[] : undefined,
    };
  }));
  const nearby = await pool.query(`SELECT * FROM incidents WHERE hazard_type=$1 AND created_at > now()-($4::text || ' hours')::interval AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $5) ORDER BY created_at DESC LIMIT 8`, [hazardType, longitude, latitude, config.clustering.windowHours, config.clustering.distanceMeters]);
  let best: { row: any; similarity: number; mediaHashMatch: boolean } | undefined;
  const nearbyIds = nearby.rows.map((row: any) => String(row.id));
  const nearbyReports = nearbyIds.length
    ? await db.select({ incidentId: s.reports.incidentId, originalText: s.reports.originalText, media: s.reports.media }).from(s.reports).where(inArray(s.reports.incidentId, nearbyIds))
    : [];
  const nearbyReportsByIncident = new Map<string, typeof nearbyReports>();
  for (const relatedReport of nearbyReports) {
    const grouped = nearbyReportsByIncident.get(relatedReport.incidentId) || [];
    grouped.push(relatedReport);
    nearbyReportsByIncident.set(relatedReport.incidentId, grouped);
  }
  for (const row of nearby.rows) {
    const related = nearbyReportsByIncident.get(row.id) || [];
    const similarity = Math.max(0, ...related.map((report) => textSimilarity(text, report.originalText)));
    const previousHashes = new Set(related.flatMap((report) => Array.isArray(report.media) ? (report.media as any[]).map((item) => item.sha256) : []));
    const mediaHashMatch = storedMedia.some((item) => previousHashes.has(item.sha256));
    if (!best || similarity > best.similarity || (mediaHashMatch && !best.mediaHashMatch)) best = { row, similarity, mediaHashMatch };
  }
  const match = best && (best.mediaHashMatch || best.similarity >= config.clustering.textSimilarity) ? best : undefined;
  const reportLanguage = body.language || citizen.language;
  const redactedForProviders = redactPII(text, [citizen.name]).text;
  const translation = await translateText(redactedForProviders, reportLanguage, "en");
  const analysisInput = { text, hazardType, severity, language: reportLanguage, citizenName: citizen.name, translation, duplicate: { nearbyCount: nearby.rowCount || 0, textSimilarity: best?.similarity || 0, mediaHashMatch: best?.mediaHashMatch || false } };
  const analysis = await analyzeReport(analysisInput, { cloud: false });
  let incident: any;
  if (match) {
    const count = match.row.report_count + 1;
    const state = count >= 2 && match.row.trust_state === "Unverified" ? "Corroborated" : match.row.trust_state;
    [incident] = await db.update(s.incidents).set({ reportCount: count, trustState: state, analysisSummary: analysis.result.summary, updatedAt: new Date() }).where(eq(s.incidents.id, match.row.id)).returning();
  } else {
    [incident] = await db.insert(s.incidents).values({ id: id("inc"), title: `${hazardType[0].toUpperCase()}${hazardType.slice(1)} reported`, hazardType, severity, trustState: "Unverified", latitude, longitude, approximateArea: publicArea(latitude, longitude), reportCount: 1, status: "New", analysisSummary: analysis.result.summary }).returning();
    await pool.query("UPDATE incidents SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [incident.id]);
  }
  const reportId = id("rep");
  const media = storedMedia.map((item) => ({
    name: item.originalName,
    content_type: item.mimeType,
    sha256: item.sha256,
    provider: item.provider,
    url: item.url,
    resource_type: item.resourceType,
    bytes: item.bytes,
    fallback_reason: item.fallbackReason,
    transcript_original: item.transcriptOriginal,
    detected_language: item.detectedLanguage,
    translation_en: item.translationEn,
    transcription_provider: item.transcriptionProvider,
    transcription_available: item.transcriptionAvailable,
    transcription_errors: item.transcriptionErrors,
  }));
  await db.insert(s.reports).values({ id: reportId, citizenId, incidentId: incident.id, hazardType, severity, originalText: text, translatedText: analysis.result.translation_en, requestedHelp: body.requested_help || null, latitude, longitude, approximateArea: publicArea(latitude, longitude), trustState: "Unverified", media });
  if (storedMedia.length) await db.insert(s.mediaEvidence).values(storedMedia.map((item) => ({ id: id("med"), reportId, provider: item.provider, storageKey: item.storageKey, url: item.url, secureUrl: item.secureUrl, originalName: item.originalName, mimeType: item.mimeType, resourceType: item.resourceType, bytes: item.bytes, sha256: item.sha256, fallbackReason: item.fallbackReason })));
  await pool.query("UPDATE reports SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [reportId]);
  const analysisRunId = id("ana");
  await db.insert(s.analysisRuns).values({ id: analysisRunId, incidentId: incident.id, provider: analysis.meta.provider, latencyMs: analysis.meta.latency_ms, confidence: analysis.meta.confidence, result: analysis.result, errors: analysis.meta.errors, fallbackPath: analysis.meta.fallback_path });
  await audit(citizenId, "report_created", "report", reportId, undefined, { incident_id: incident.id, media_count: storedMedia.length, ai_provider: analysis.meta.provider, ai_redactions: analysis.meta.redactions });
  await emit(match ? "incident.updated" : "incident.created", incident);
  void (async () => {
    const verification = await verifyClaim(translation.text);
    const enriched = await analyzeReport({ ...analysisInput, verification });
    await Promise.all([
      db.update(s.analysisRuns).set({ provider: enriched.meta.provider, latencyMs: enriched.meta.latency_ms, confidence: enriched.meta.confidence, result: enriched.result, errors: enriched.meta.errors, fallbackPath: enriched.meta.fallback_path }).where(eq(s.analysisRuns.id, analysisRunId)),
      db.update(s.incidents).set({ analysisSummary: enriched.result.summary, updatedAt: new Date() }).where(eq(s.incidents.id, incident.id)),
    ]);
    await emit("incident.analysis.updated", { incident_id: incident.id, analysis: enriched.result, provider: enriched.meta.provider }, { kind: "authority" });
  })().catch((error) => app.log.warn({ err: error, reportId }, "Background report analysis failed; deterministic analysis retained"));
  void Promise.allSettled(storedMedia.map(async (item, index) => {
    if (item.resourceType !== "audio") return;
    const transcript = await transcribeAudio(pendingMedia[index].buffer, item.mimeType, item.originalName);
    const [current] = await db.select({ media: s.reports.media }).from(s.reports).where(eq(s.reports.id, reportId)).limit(1);
    const nextMedia = Array.isArray(current?.media) ? [...current.media as any[]] : [];
    const mediaIndex = nextMedia.findIndex((entry: any) => entry.sha256 === item.sha256);
    if (mediaIndex < 0) return;
    nextMedia[mediaIndex] = { ...nextMedia[mediaIndex], transcript_original: transcript.transcript_original, detected_language: transcript.detected_language, translation_en: transcript.translation_en, transcription_provider: transcript.provider, transcription_available: transcript.available, transcription_errors: transcript.errors };
    await db.update(s.reports).set({ media: nextMedia }).where(eq(s.reports.id, reportId));
    await emit("report.audio.transcribed", { report_id: reportId, media_index: mediaIndex }, { kind: "authority" });
  })).catch((error) => app.log.warn({ err: error, reportId }, "Background audio transcription failed"));
  return { report_id: reportId, incident: snake(incident), media, analysis: analysis.result, analysis_meta: { provider: analysis.meta.provider, latency_ms: analysis.meta.latency_ms, fallback_path: analysis.meta.fallback_path, errors: analysis.meta.errors } };
});

app.post("/api/v1/sos", async (request: any, reply) => {
  await rateLimit(`sos:${request.ip}`, 5, 60);
  const body = parseBody(sosSchema, request.body, reply);
  if (!body) return;
  const [citizen] = await db.select({ id: s.citizens.id }).from(s.citizens).where(eq(s.citizens.id, body.citizen_id)).limit(1);
  if (!citizen) return safeError(reply, 404, "Citizen session not found");
  if (!(await requireCitizen(request, reply, body.citizen_id))) return;
  const [created] = await db.insert(s.sosRequests).values({ id: id("sos"), citizenId: body.citizen_id, latitude: body.latitude, longitude: body.longitude, note: body.note || "Emergency assistance requested", status: "New" }).returning();
  await pool.query("UPDATE sos_requests SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [created.id]);
  await audit(body.citizen_id, "sos_created", "sos", created.id);
  await emit("sos.created", created, { kind: "citizen", citizenId: created.citizenId });
  return snake(created);
});

app.get("/api/v1/sos/active", async (request, reply) => {
  const principal = await resolvePrincipal(request.headers.authorization?.replace("Bearer ", ""));
  if (!principal || principal.kind !== "citizen") return safeError(reply, 401, "Citizen session required");
  const [active] = await db.select().from(s.sosRequests).where(and(eq(s.sosRequests.citizenId, principal.id), inArray(s.sosRequests.status, ["New", "Acknowledged", "Assigned", "En route"]))).orderBy(desc(s.sosRequests.createdAt)).limit(1);
  if (!active) return { sos: null, assignment: null };
  const [assignment] = await db.select().from(s.assignments).where(eq(s.assignments.sosId, active.id)).orderBy(desc(s.assignments.createdAt)).limit(1);
  return snake({ sos: active, assignment: assignment || null });
});

app.patch("/api/v1/sos/:id/location", async (request: any, reply) => {
  const [existing] = await db.select().from(s.sosRequests).where(eq(s.sosRequests.id, request.params.id)).limit(1);
  if (!existing) return safeError(reply, 404, "SOS not found");
  if (!(await requireCitizen(request, reply, existing.citizenId))) return;
  if (["Cancelled", "Resolved", "Closed", "Rejected"].includes(existing.status)) return safeError(reply, 409, "SOS location sharing is no longer active");
  const location = parseBody(coordinateSchema, request.body, reply);
  if (!location) return;
  const [updated] = await db.update(s.sosRequests).set({ ...location, updatedAt: new Date() }).where(eq(s.sosRequests.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "SOS not found");
  await pool.query("UPDATE sos_requests SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [updated.id]);
  await emit("sos.location", updated, { kind: "citizen", citizenId: updated.citizenId }); return snake(updated);
});

app.post("/api/v1/sos/:id/cancel", async (request: any, reply) => {
  const [existing] = await db.select().from(s.sosRequests).where(eq(s.sosRequests.id, request.params.id)).limit(1);
  if (!existing) return safeError(reply, 404, "SOS not found");
  if (!(await requireCitizen(request, reply, existing.citizenId))) return;
  const [updated] = await db.update(s.sosRequests).set({ status: "Cancelled", updatedAt: new Date() }).where(eq(s.sosRequests.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "SOS not found");
  await audit(updated.citizenId, "sos_cancelled", "sos", updated.id); await emit("sos.updated", updated, { kind: "citizen", citizenId: updated.citizenId }); return snake(updated);
});

app.get("/api/v1/authority/queue", async (request, reply) => {
  if (!(await requireOfficial(request, reply))) return;
  const [incidentRows, sosRows, assignmentRows, alertRows, deliveryRows, communityRows] = await Promise.all([
    db.select().from(s.incidents).orderBy(sql`CASE lower(${s.incidents.severity}) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END`, sql`CASE ${s.incidents.trustState} WHEN 'Corroborated' THEN 0 WHEN 'Unverified' THEN 1 WHEN 'Verified' THEN 2 ELSE 3 END`, desc(s.incidents.createdAt)).limit(200),
    db.select().from(s.sosRequests).where(inArray(s.sosRequests.status, ["New", "Acknowledged", "Assigned", "En route"])).orderBy(sql`CASE ${s.sosRequests.status} WHEN 'New' THEN 0 WHEN 'Acknowledged' THEN 1 WHEN 'Assigned' THEN 2 ELSE 3 END`, desc(s.sosRequests.createdAt)).limit(200),
    db.select().from(s.assignments).orderBy(desc(s.assignments.createdAt)).limit(500), db.select().from(s.alerts).orderBy(desc(s.alerts.publishedAt)).limit(200), db.select().from(s.deliveryAttempts).orderBy(desc(s.deliveryAttempts.createdAt)).limit(100), db.select().from(s.communities).orderBy(desc(s.communities.createdAt)).limit(200),
  ]);
  const incidentIds = incidentRows.map((incident) => incident.id);
  const [reportRows, analysisRows] = incidentIds.length
    ? await Promise.all([
        db.select().from(s.reports).where(inArray(s.reports.incidentId, incidentIds)).orderBy(desc(s.reports.createdAt)),
        db.select().from(s.analysisRuns).where(inArray(s.analysisRuns.incidentId, incidentIds)).orderBy(desc(s.analysisRuns.createdAt)),
      ])
    : [[], []];
  const reportsByIncident = new Map<string, typeof reportRows>();
  const latestAnalysis = new Map<string, (typeof analysisRows)[number]>();
  for (const report of reportRows) {
    const existing = reportsByIncident.get(report.incidentId) || [];
    existing.push(report);
    reportsByIncident.set(report.incidentId, existing);
  }
  for (const analysis of analysisRows) {
    if (!latestAnalysis.has(analysis.incidentId)) latestAnalysis.set(analysis.incidentId, analysis);
  }
  const enriched = incidentRows.map((incident) => ({ ...incident, reports: reportsByIncident.get(incident.id) || [], analysis: latestAnalysis.get(incident.id) }));
  const smsRecipients = configuredSmsRecipients();
  const connectedCitizenDevices = new Set([...sockets.values()].filter((principal) => principal.kind === "citizen").map((principal) => principal.id)).size;
  return snake({
    incidents: enriched,
    sos: sosRows,
    assignments: assignmentRows,
    alerts: alertRows,
    delivery: deliveryRows,
    communities: communityRows,
    notifications: {
      provider: "Android notification bar via authenticated realtime",
      configured: true,
      connectedDeviceCount: connectedCitizenDevices,
      permissionManagedOnDevice: true,
      maxMessageChars: 500,
    },
    sms: {
      provider: "Textbelt (self-hosted)",
      channel: "sms/textbelt",
      configured: Boolean(config.textbelt.url && smsRecipients.length),
      smtpConfigured: Boolean(process.env.TEXTBELT_SMTP_HOST && process.env.TEXTBELT_SMTP_USER && process.env.TEXTBELT_SMTP_PASS),
      testRecipientCount: smsRecipients.length,
      maxMessageChars: 280,
    },
  });
});

app.post("/api/v1/authority/notifications", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin");
  if (!user || !("id" in user)) return;
  const title = String(request.body?.title || "BEACON safety update").trim().slice(0, 80);
  const message = String(request.body?.message || "").trim();
  if (title.length < 3) return safeError(reply, 400, "Notification title must contain at least 3 characters");
  if (message.length < 8 || message.length > 500) return safeError(reply, 400, "Notification message must contain 8 to 500 characters");
  const notificationId = id("ntf");
  const connectedCitizenDevices = new Set([...sockets.values()].filter((principal) => principal.kind === "citizen").map((principal) => principal.id)).size;
  const status = connectedCitizenDevices ? "accepted" : "not_connected";
  const detail = connectedCitizenDevices
    ? `Sent to ${connectedCitizenDevices} connected citizen device(s); Android controls notification-bar presentation`
    : "No citizen device is connected. Open the BEACON app on the phone and retry.";
  const payload = { id: notificationId, title, body: message, incident_id: request.body?.incident_id || null, created_at: new Date().toISOString(), official: true };
  await db.insert(s.deliveryAttempts).values({ id: id("del"), entityType: "authority_notification", entityId: notificationId, channel: "notification/realtime-local", status, detail });
  await audit(user.id, "notification_sent", "authority_notification", notificationId, undefined, { title, incident_id: payload.incident_id, connected_device_count: connectedCitizenDevices });
  await emit("authority.notification", payload, { kind: "authenticated" });
  return reply.code(connectedCitizenDevices ? 201 : 202).send(snake({ id: notificationId, status, detail, connectedDeviceCount: connectedCitizenDevices }));
});

app.post("/api/v1/authority/sms", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin");
  if (!user || !("id" in user)) return;
  const body = request.body as {
    title?: string;
    message?: string;
    recipients?: string[];
    incident_id?: string;
  };
  const title = String(body.title || "BEACON safety update").trim().slice(0, 80);
  const message = String(body.message || "").trim();
  if (message.length < 8 || message.length > 280)
    return safeError(reply, 400, "SMS message must contain 8 to 280 characters");

  const allowed = configuredSmsRecipients();
  const requested = Array.isArray(body.recipients)
    ? body.recipients
        .map((item) => String(item).replace(/\D/g, ""))
        .filter(Boolean)
    : [];
  if (requested.some((recipient) => !allowed.includes(recipient)))
    return safeError(reply, 403, "SMS recipients must be present in TEXTBELT_TEST_RECIPIENTS");
  const recipients = requested.length ? [...new Set(requested)].slice(0, 25) : allowed;
  const smsId = id("sms");
  const attempt = await dispatchAuthoritySms(smsId, title, message, recipients);
  await audit(
    user.id,
    ["accepted", "delivered"].includes(attempt.status) ? "sms_dispatched" : "sms_queued",
    "manual_sms",
    smsId,
    body.incident_id ? "Incident communication" : "Authority safety communication",
    { incident_id: body.incident_id || null, recipient_count: recipients.length, delivery_status: attempt.status },
  );
  const response = snake({
    id: smsId,
    channel: attempt.channel,
    status: attempt.status,
    detail: attempt.detail,
    recipientCount: recipients.length,
  });
  await emit("delivery.sms", response, { kind: "authority" });
  return reply.code(["accepted", "delivered"].includes(attempt.status) ? 201 : 202).send(response);
});

app.post("/api/v1/incidents/:id/source-check", async (request: any, reply) => {
  const user = await requireOfficial(request, reply); if (!user || !("id" in user)) return;
  const [report] = await db.select().from(s.reports).where(eq(s.reports.incidentId, request.params.id)).orderBy(desc(s.reports.createdAt)).limit(1);
  if (!report) return safeError(reply, 404, "Incident evidence not found");
  const [run] = await db.select().from(s.analysisRuns).where(eq(s.analysisRuns.incidentId, request.params.id)).orderBy(desc(s.analysisRuns.createdAt)).limit(1);
  if (!run) return safeError(reply, 404, "Incident analysis not found");
  const verification = await verifyClaim(report.translatedText || redactPII(report.originalText).text);
  const previous = (run.result || {}) as any;
  const result = { ...previous, verification, specialist_outputs: { ...(previous.specialist_outputs || {}), verifier: { status: "advisory-only", provenance: verification.providers.join(" + ") || "external-search-unavailable", output: `${verification.verdict}. ${verification.summary} Human verification required.` } } };
  await db.update(s.analysisRuns).set({ result }).where(eq(s.analysisRuns.id, run.id));
  await audit(user.id, "external_source_check_refreshed", "incident", request.params.id, undefined, { verdict: verification.verdict, source_count: verification.sources.length, providers: verification.providers });
  await emit("incident.verification", { incident_id: request.params.id, verification });
  return verification;
});

app.delete("/api/v1/reports/:id", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const reason = String(request.body?.reason || "").trim();
  if (reason.length < 5) return safeError(reply, 400, "A deletion reason of at least 5 characters is required");
  const [report] = await db.select().from(s.reports).where(eq(s.reports.id, request.params.id)).limit(1);
  if (!report) return safeError(reply, 404, "Report not found");
  await db.delete(s.reports).where(eq(s.reports.id, report.id));
  const remaining = await db.select({ id: s.reports.id }).from(s.reports).where(eq(s.reports.incidentId, report.incidentId));
  await db.update(s.incidents).set({ reportCount: remaining.length, status: remaining.length ? "New" : "No active reports", updatedAt: new Date() }).where(eq(s.incidents.id, report.incidentId));
  await audit(user.id, "report_deleted", "report", report.id, reason, { incident_id: report.incidentId, retained_incident: true, remaining_reports: remaining.length });
  await emit("report.deleted", { report_id: report.id, incident_id: report.incidentId }, { kind: "authenticated" });
  return { ok: true, report_id: report.id, incident_id: report.incidentId };
});

app.post("/api/v1/incidents/:id/decision", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const states: Record<string, any> = { verify: "Verified", corroborate: "Corroborated", misleading: "Misleading", outdated: "Outdated", request_evidence: "Unverified" };
  const state = states[request.body.action]; if (!state) return safeError(reply, 400, "Unknown decision");
  const outcome = await db.transaction(async (tx) => {
    const [updated] = await tx.update(s.incidents).set({ trustState: state, updatedAt: new Date() }).where(eq(s.incidents.id, request.params.id)).returning();
    if (!updated) return null;
    await tx.insert(s.auditEvents).values({ id: id("aud"), actorId: user.id, action: request.body.action, entityType: "incident", entityId: updated.id, reason: request.body.reason, detail: {} });
    const corrections: Array<{ correction: any; replacement: any; original: any }> = [];
    if (["Misleading", "Outdated"].includes(state)) {
      const active = await tx.select().from(s.alerts).where(and(eq(s.alerts.incidentId, updated.id), eq(s.alerts.status, "active")));
      for (const original of active) {
        const replacementId = id("alt"), correctionId = id("cor");
        const [replacement] = await tx.insert(s.alerts).values({ id: replacementId, incidentId: updated.id, title: `Correction: ${original.title}`, body: state === "Misleading" ? `This alert has been withdrawn after authority review. ${request.body.reason || "Earlier information could not be verified."}` : `This alert is no longer current. ${request.body.reason || "Conditions or guidance have changed."}`, severity: original.severity, status: state === "Misleading" ? "withdrawal" : "expired", expiresAt: new Date() }).returning();
        await tx.update(s.alerts).set({ status: "superseded", supersededBy: replacement.id }).where(eq(s.alerts.id, original.id));
        const correction = { id: correctionId, alertId: original.id, replacementAlertId: replacement.id, reason: request.body.reason || `Incident marked ${state}` };
        await tx.insert(s.corrections).values(correction);
        await tx.insert(s.auditEvents).values({ id: id("aud"), actorId: user.id, action: "alert_auto_corrected", entityType: "alert", entityId: original.id, reason: correction.reason, detail: { replacement_alert_id: replacement.id, incident_state: state } });
        corrections.push({ correction, replacement, original });
      }
    }
    return { updated, corrections };
  });
  if (!outcome) return safeError(reply, 404, "Incident not found");
  await emit("incident.updated", outcome.updated);
  for (const correction of outcome.corrections) { await deliveryLedger("correction", correction.correction.id, { title: correction.replacement.title, body: correction.replacement.body }); await emit("alert.corrected", correction, { kind: "authenticated" }); }
  return snake({ ...outcome.updated, invalidated_alerts: outcome.corrections.length });
});

app.post("/api/v1/incidents/:id/bypass", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  if (!request.body.confirmed || String(request.body.reason || "").length < 8) return safeError(reply, 400, "Explicit confirmation and operational reason are required");
  const [updated] = await db.update(s.incidents).set({ trustState: "Verified", updatedAt: new Date() }).where(eq(s.incidents.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "Incident not found"); await audit(user.id, "verification_bypassed", "incident", updated.id, request.body.reason, { demo_scope: "test-users-only", immutable: true }); await emit("incident.updated", updated); return snake(updated);
});

app.post("/api/v1/assignments", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const body = request.body as any; if (!body.sos_id && !body.incident_id) return safeError(reply, 400, "An SOS or incident is required");
  const [created] = await db.insert(s.assignments).values({ id: id("asn"), sosId: body.sos_id || null, incidentId: body.incident_id || null, responderId: body.responder_id || "official_responder", status: "Assigned", etaMinutes: body.eta_minutes || 12, operationalNote: body.note || "Proceed and corroborate conditions." }).returning();
  if (body.sos_id) await db.update(s.sosRequests).set({ status: "Assigned", updatedAt: new Date() }).where(eq(s.sosRequests.id, body.sos_id));
  await audit(user.id, "responder_assigned", "assignment", created.id, created.operationalNote);
  const [assignedSos] = created.sosId ? await db.select({ citizenId: s.sosRequests.citizenId }).from(s.sosRequests).where(eq(s.sosRequests.id, created.sosId)).limit(1) : [];
  await emit("dispatch.updated", created, assignedSos ? { kind: "citizen", citizenId: assignedSos.citizenId } : { kind: "authority" }); return snake(created);
});

app.patch("/api/v1/assignments/:id/:status", async (request: any, reply) => {
  const user = await requireOfficial(request, reply); if (!user || !("id" in user)) return;
  const allowed = ["Acknowledged", "En route", "Resolved", "Closed", "Rejected"]; if (!allowed.includes(request.params.status)) return safeError(reply, 400, "Unknown assignment status");
  const [existing] = await db.select().from(s.assignments).where(eq(s.assignments.id, request.params.id)).limit(1);
  if (!existing) return safeError(reply, 404, "Assignment not found");
  if (user.role === "responder" && existing.responderId !== user.id) return safeError(reply, 403, "Responder may update only their assignment");
  const [updated] = await db.update(s.assignments).set({ status: request.params.status, updatedAt: new Date() }).where(eq(s.assignments.id, request.params.id)).returning();
  if (updated.sosId) await db.update(s.sosRequests).set({ status: request.params.status, updatedAt: new Date() }).where(eq(s.sosRequests.id, updated.sosId));
  if (updated.incidentId) await db.update(s.incidents).set({ status: request.params.status, updatedAt: new Date() }).where(eq(s.incidents.id, updated.incidentId));
  await audit(user.id, "assignment_status", "assignment", updated.id, request.params.status);
  const [statusSos] = updated.sosId ? await db.select({ citizenId: s.sosRequests.citizenId }).from(s.sosRequests).where(eq(s.sosRequests.id, updated.sosId)).limit(1) : [];
  await emit("dispatch.updated", updated, statusSos ? { kind: "citizen", citizenId: statusSos.citizenId } : { kind: "authority" }); return snake(updated);
});

app.post("/api/v1/alerts", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return; const body = request.body as any;
  if (body.incident_id) { const [incident] = await db.select().from(s.incidents).where(eq(s.incidents.id, body.incident_id)).limit(1); if (!incident || incident.trustState !== "Verified") return safeError(reply, 409, "Only verified incidents may enter the official feed"); }
  const [created] = await db.insert(s.alerts).values({ id: id("alt"), incidentId: body.incident_id || null, title: body.title, body: body.body, severity: body.severity || "moderate", status: "active", expiresAt: new Date(Date.now() + (body.expires_minutes || 180) * 60_000) }).returning();
  await audit(user.id, "alert_published", "alert", created.id); await deliveryLedger("alert", created.id, { title: created.title, body: created.body }); await emit("alert.published", created, { kind: "authenticated" }); return snake(created);
});

app.post("/api/v1/alerts/:id/correct", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return; const body = request.body as any;
  const [old] = await db.select().from(s.alerts).where(eq(s.alerts.id, request.params.id)).limit(1); if (!old) return safeError(reply, 404, "Alert not found");
  const [replacement] = await db.insert(s.alerts).values({ id: id("alt"), incidentId: old.incidentId, title: body.title, body: body.body, severity: old.severity, status: "active", expiresAt: old.expiresAt }).returning();
  await db.update(s.alerts).set({ status: "superseded", supersededBy: replacement.id }).where(eq(s.alerts.id, old.id)); const correction = { id: id("cor"), alertId: old.id, replacementAlertId: replacement.id, reason: body.reason };
  await db.insert(s.corrections).values(correction); await audit(user.id, "alert_corrected", "alert", old.id, body.reason, { replacement_alert_id: replacement.id }); await deliveryLedger("correction", correction.id, { title: replacement.title, body: replacement.body }); await emit("alert.corrected", { correction, replacement }, { kind: "authenticated" }); return snake({ correction, replacement });
});

app.post("/api/v1/alerts/:id/expire", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const [updated] = await db.update(s.alerts).set({ status: "expired" }).where(eq(s.alerts.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "Alert not found");
  if (updated.incidentId) await db.update(s.incidents).set({ trustState: "Outdated", updatedAt: new Date() }).where(eq(s.incidents.id, updated.incidentId));
  await audit(user.id, "alert_expired", "alert", updated.id, request.body?.reason); await emit("alert.expired", updated, { kind: "authenticated" }); return snake(updated);
});

app.post("/api/v1/facilities", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const body = request.body as any;
  const [created] = await db.insert(s.facilities).values({ id: id("fac"), name: body.name, kind: body.kind, latitude: Number(body.latitude), longitude: Number(body.longitude), capacity: body.capacity == null ? null : Number(body.capacity), verified: body.verified ?? true }).returning();
  await pool.query("UPDATE facilities SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [created.id]);
  await audit(user.id, "facility_created", "facility", created.id); await emit("facility.updated", created, { kind: "authenticated" }); return snake(created);
});

app.patch("/api/v1/facilities/:id", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const body = request.body as any;
  const patch: any = { updatedAt: new Date() };
  for (const key of ["name", "kind", "capacity", "verified"] as const) if (body[key] !== undefined) patch[key] = body[key];
  if (body.latitude !== undefined) patch.latitude = Number(body.latitude); if (body.longitude !== undefined) patch.longitude = Number(body.longitude);
  const [updated] = await db.update(s.facilities).set(patch).where(eq(s.facilities.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "Facility not found");
  await pool.query("UPDATE facilities SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [updated.id]);
  await audit(user.id, "facility_updated", "facility", updated.id, body.reason); await emit("facility.updated", updated, { kind: "authenticated" }); return snake(updated);
});

app.get("/api/v1/communities", async (request: any) => {
  const principal = await resolvePrincipal(request.headers.authorization?.replace("Bearer ", ""));
  const authorityView = principal?.kind === "official";
  let targetLanguage = "en";
  if (principal?.kind === "citizen") {
    const [citizen] = await db.select({ language: s.citizens.language }).from(s.citizens).where(eq(s.citizens.id, principal.id)).limit(1);
    if (citizen && supportedLanguageCodes.has(citizen.language as any)) targetLanguage = citizen.language;
  }
  const result = authorityView
    ? await db.select().from(s.communities).orderBy(desc(s.communities.createdAt))
    : await db.select().from(s.communities).where(and(eq(s.communities.approved, true), eq(s.communities.status, "approved"))).orderBy(desc(s.communities.createdAt));
  const communityIds = result.map((community) => community.id);
  const allMessages = communityIds.length
    ? await (authorityView
        ? db.select().from(s.messages).where(inArray(s.messages.communityId, communityIds)).orderBy(s.messages.createdAt).limit(2_000)
        : db.select().from(s.messages).where(and(inArray(s.messages.communityId, communityIds), eq(s.messages.moderationStatus, "visible"))).orderBy(s.messages.createdAt).limit(2_000))
    : [];
  const messagesByCommunity = new Map<string, typeof allMessages>();
  for (const message of allMessages) {
    const grouped = messagesByCommunity.get(message.communityId) || [];
    grouped.push(message);
    messagesByCommunity.set(message.communityId, grouped);
  }
  return snake(await Promise.all(result.map(async (community) => {
    const messages = (messagesByCommunity.get(community.id) || []).slice(-100);
    return { ...community, messages: await Promise.all(messages.map((message) => localizeCommunityMessage(message, targetLanguage))) };
  })));
});

app.post("/api/v1/communities", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return; const body = request.body as any;
  const approved = body.approved ?? false;
  const [created] = await db.insert(s.communities).values({ id: id("com"), name: body.name, incidentId: body.incident_id || null, radiusKm: body.radius_km || 2, approved, status: approved ? "approved" : "proposed", memberCount: 0 }).returning();
  await audit(user.id, "community_created", "community", created.id); await emit("community.created", created, { kind: "authenticated" }); return snake(created);
});

app.patch("/api/v1/communities/:id/status", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const status = String(request.body.status || ""); if (!["approve", "reject", "archive"].includes(status)) return safeError(reply, 400, "Status must be approve, reject, or archive");
  const mapped = status === "approve" ? "approved" : status === "reject" ? "rejected" : "archived";
  const [updated] = await db.update(s.communities).set({ status: mapped, approved: mapped === "approved" }).where(eq(s.communities.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "Community not found");
  if (mapped === "approved" && updated.incidentId) {
    const [incident] = await db.select().from(s.incidents).where(eq(s.incidents.id, updated.incidentId)).limit(1);
    const [analysis] = await db.select().from(s.analysisRuns).where(eq(s.analysisRuns.incidentId, updated.incidentId)).orderBy(desc(s.analysisRuns.createdAt)).limit(1);
    if (incident) {
      const verification = (analysis?.result as any)?.verification;
      const sourceLinks = Array.isArray(verification?.sources)
        ? verification.sources.filter((source: any) => /^https?:\/\//.test(String(source?.url || ""))).slice(0, 3).map((source: any) => `${String(source.publisher || "Source")}: ${String(source.url)}`)
        : [];
      const mapUrl = `https://www.openstreetmap.org/?mlat=${incident.latitude}&mlon=${incident.longitude}#map=15/${incident.latitude}/${incident.longitude}`;
      const body = [`Official room opened for ${incident.approximateArea}.`, `Map: ${mapUrl}`, `AI advisory: ${incident.analysisSummary}`, ...sourceLinks.map((source: string) => `Related source: ${source}`), "Follow authority instructions; related coverage is context, not proof."].join("\n");
      const [welcome] = await db.insert(s.messages).values({ id: id("msg"), communityId: updated.id, senderId: user.id, senderName: user.name, senderRole: user.role, body, sourceLanguage: "en", official: true, moderationStatus: "visible" }).returning();
      await emit("community.message", welcome, { kind: "authenticated" });
    }
  }
  await audit(user.id, `community_${mapped}`, "community", updated.id, request.body.reason); await emit("community.updated", updated, { kind: "authenticated" }); return snake(updated);
});

app.post("/api/v1/communities/:id/messages", async (request: any, reply) => {
  const body = parseBody(communityMessageSchema, request.body, reply);
  if (!body) return;
  const principal = await resolvePrincipal(request.headers.authorization?.replace("Bearer ", ""));
  if (!principal) return safeError(reply, 401, "Authenticated session required");
  let senderName: string, role: string, sourceLanguage = body.source_language || "en";
  if (principal.kind === "official") {
    const [user] = await db.select({ name: s.officialUsers.name, role: s.officialUsers.role }).from(s.officialUsers).where(eq(s.officialUsers.id, principal.id)).limit(1);
    if (!user) return safeError(reply, 401, "Authority session required");
    senderName = user.name; role = user.role;
  } else {
    const [citizen] = await db.select({ name: s.citizens.name, language: s.citizens.language }).from(s.citizens).where(eq(s.citizens.id, principal.id)).limit(1);
    if (!citizen) return safeError(reply, 401, "Citizen session required");
    senderName = citizen.name; role = "citizen"; sourceLanguage = citizen.language;
    const [ban] = await db.select({ id: s.communityBans.id }).from(s.communityBans).where(and(eq(s.communityBans.communityId, request.params.id), eq(s.communityBans.citizenId, principal.id))).limit(1);
    if (ban) return safeError(reply, 403, "You have been removed from this community by an authority moderator");
  }
  const [community] = await db.select().from(s.communities).where(eq(s.communities.id, request.params.id)).limit(1);
  if (!community || !community.approved || community.status !== "approved") return safeError(reply, 409, "Community is not open for messages");
  const [created] = await db.insert(s.messages).values({ id: id("msg"), communityId: request.params.id, senderId: principal.id, senderName, senderRole: role, body: body.body, sourceLanguage, official: principal.kind === "official", moderationStatus: "visible" }).returning();
  await emit("community.message", created, { kind: "authenticated" }); return snake(created);
});

app.patch("/api/v1/communities/:id/messages/:messageId/moderate", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const status = String(request.body.status || ""); if (!["visible", "hidden", "flagged"].includes(status)) return safeError(reply, 400, "Moderation status must be visible, hidden, or flagged");
  const [updated] = await db.update(s.messages).set({ moderationStatus: status }).where(and(eq(s.messages.id, request.params.messageId), eq(s.messages.communityId, request.params.id))).returning();
  if (!updated) return safeError(reply, 404, "Community message not found");
  await audit(user.id, `message_${status}`, "message", updated.id, request.body.reason, { community_id: request.params.id }); await emit("community.message.moderated", { community_id: request.params.id, message_id: updated.id, status }, { kind: "authenticated" }); return snake(updated);
});

app.delete("/api/v1/communities/:id/messages/:messageId", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const reason = String(request.body?.reason || "").trim();
  if (reason.length < 5) return safeError(reply, 400, "A moderation reason is required");
  const [updated] = await db.update(s.messages).set({ moderationStatus: "deleted", body: "[Message deleted by authority]", translations: {} }).where(and(eq(s.messages.id, request.params.messageId), eq(s.messages.communityId, request.params.id))).returning();
  if (!updated) return safeError(reply, 404, "Community message not found");
  await audit(user.id, "message_deleted", "message", updated.id, reason, { community_id: request.params.id, sender_id: updated.senderId });
  await emit("community.message.deleted", { community_id: request.params.id, message_id: updated.id }, { kind: "authenticated" });
  return snake(updated);
});

app.delete("/api/v1/communities/:id/members/:citizenId", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const reason = String(request.body?.reason || "").trim();
  if (reason.length < 5) return safeError(reply, 400, "A removal reason is required");
  const [citizen] = await db.select({ id: s.citizens.id, name: s.citizens.name }).from(s.citizens).where(eq(s.citizens.id, request.params.citizenId)).limit(1);
  if (!citizen) return safeError(reply, 404, "Community member not found");
  await db.insert(s.communityBans).values({ id: id("ban"), communityId: request.params.id, citizenId: citizen.id, reason, actorId: user.id }).onConflictDoUpdate({ target: [s.communityBans.communityId, s.communityBans.citizenId], set: { reason, actorId: user.id } });
  await db.update(s.messages).set({ moderationStatus: "hidden" }).where(and(eq(s.messages.communityId, request.params.id), eq(s.messages.senderId, citizen.id), eq(s.messages.official, false)));
  await audit(user.id, "community_member_removed", "citizen", citizen.id, reason, { community_id: request.params.id, citizen_name: citizen.name });
  await emit("community.member.removed", { community_id: request.params.id, citizen_id: citizen.id }, { kind: "authenticated" });
  return { ok: true, citizen_id: citizen.id };
});

app.delete("/api/v1/communities/:id", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const reason = String(request.body?.reason || "").trim();
  if (reason.length < 5) return safeError(reply, 400, "A deletion reason is required");
  const [community] = await db.select().from(s.communities).where(eq(s.communities.id, request.params.id)).limit(1);
  if (!community) return safeError(reply, 404, "Community not found");
  await db.transaction(async (tx) => {
    await tx.delete(s.messages).where(eq(s.messages.communityId, community.id));
    await tx.delete(s.communityBans).where(eq(s.communityBans.communityId, community.id));
    await tx.delete(s.communities).where(eq(s.communities.id, community.id));
  });
  await audit(user.id, "community_deleted", "community", community.id, reason, { name: community.name, incident_id: community.incidentId });
  await emit("community.deleted", { community_id: community.id }, { kind: "authenticated" });
  return { ok: true, community_id: community.id };
});

app.get("/api/v1/audit", async (request, reply) => { if (!(await requireOfficial(request, reply, "admin"))) return; return snake(await db.select().from(s.auditEvents).orderBy(desc(s.auditEvents.createdAt)).limit(100)); });

app.post("/api/v1/demo/reset", async (request, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  // A demo reset clears operational data, not registered devices. Keeping citizen
  // sessions prevents a judge reset from silently breaking an already-open phone.
  await pool.query("TRUNCATE delivery_attempts, corrections, messages, communities, assignments, sos_requests, analysis_runs, reports, alerts, incidents, audit_events RESTART IDENTITY CASCADE");
  const cacheKeys = await Promise.all([redis.keys("weather:*").catch((): string[] => []), redis.keys("rate:*").catch((): string[] => [])]).then(([weatherKeys, rateKeys]) => weatherKeys.concat(rateKeys));
  if (cacheKeys.length) await redis.del(...cacheKeys).catch(() => undefined);
  await emit("demo.reset", { actor: user.id }); return { ok: true };
});

async function start() {
  await mkdir(config.uploadDir, { recursive: true });
  pool.on("error", (error) => app.log.error({ err: error }, "Idle PostgreSQL client error"));
  redis.on("error", (error) => app.log.warn({ err: error }, "Redis command connection error"));
  subscriber.on("error", (error) => app.log.warn({ err: error }, "Redis subscriber connection error"));
  subscriber.on("ready", () => subscriber.subscribe(EVENT_CHANNEL).catch((error) => app.log.warn({ err: error }, "Redis subscription failed")));
  subscriber.on("message", (_channel: string, message: string) => {
    let envelope: any;
    try { envelope = JSON.parse(message); } catch { return; }
    if (envelope.origin === INSTANCE_ID) return;
    broadcast(envelope);
  });
  await Promise.allSettled([redis.connect(), subscriber.connect()]);
  await ensureSchema(); await seed();
  await app.listen({ port: config.port, host: config.host });
}

const shutdown = async () => { await app.close(); await Promise.allSettled([redis.quit(), subscriber.quit(), pool.end()]); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
start().catch((error) => { app.log.error(error); process.exit(1); });
