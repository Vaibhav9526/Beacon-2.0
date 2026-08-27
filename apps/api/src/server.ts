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
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as s from "./schema.js";
import { analyzeReport, redactPII } from "./ai.js";
import { config, serviceReadiness } from "./config.js";
import { readLocalMedia, storeMedia } from "./media.js";
import { INDIAN_LANGUAGES, translateText } from "./translation.js";
import { verifyClaim } from "./verification.js";

const EVENT_CHANNEL = "beacon:events";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pool = new Pool({ connectionString: config.databaseUrl, max: 12, idleTimeoutMillis: 30_000 });
const db = drizzle(pool, { schema: s });
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info", redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.api_secret"] }, bodyLimit: Math.max(12 * 1024 * 1024, config.uploads.maxFileBytes * config.uploads.maxFiles + 1_000_000) });
type Principal = { kind: "official"; id: string; role: "admin" | "responder" } | { kind: "citizen"; id: string };
type Audience = { kind: "authority" } | { kind: "authenticated" } | { kind: "citizen"; citizenId: string };
const sockets = new Map<any, Principal>();

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const publicArea = (lat: number, lon: number) => `Ward area near ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
const snake = (value: any): any => {
  if (Array.isArray(value)) return value.map(snake);
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), snake(item)]));
  return value;
};
const safeError = (reply: FastifyReply, code: number, detail: string) => reply.code(code).send({ detail });
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
    { id: "official_admin", name: "Aditi Verma", email: "admin@beacon.local", password: "BeaconDemo!26", role: "admin" as const, organization: "Raipur District Control", jurisdiction: "Raipur", mfaReady: true },
    { id: "official_responder", name: "Ravi Sahu", email: "responder@beacon.local", password: "ResponderDemo!26", role: "responder" as const, organization: "NDRF Demo Unit", jurisdiction: "Raipur", mfaReady: true },
  ];
  await db.insert(s.officialUsers).values(demoOfficials.map((user) => ({ ...user, password: hashPassword(user.password) }))).onConflictDoNothing();
  for (const demo of demoOfficials) {
    const [stored] = await db.select({ password: s.officialUsers.password }).from(s.officialUsers).where(eq(s.officialUsers.id, demo.id)).limit(1);
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
  const count = await redis.incr(`rate:${key}`);
  if (count === 1) await redis.expire(`rate:${key}`, seconds);
  if (count > limit) throw Object.assign(new Error("Too many requests. Please wait and try again."), { statusCode: 429 });
}

async function emit(event: string, payload: any, audience: Audience = { kind: "authority" }) {
  await redis.publish(EVENT_CHANNEL, JSON.stringify({ event, payload: snake(payload), audience, at: new Date().toISOString() }));
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
  const connected = sockets.size;
  const attempts: typeof s.deliveryAttempts.$inferInsert[] = [{ id: id("del"), entityType, entityId, channel: "in-app/websocket", status: connected ? "delivered" : "queued", detail: `${connected} authenticated live recipient(s)` }];
  let externalDelivered = false;
  const fcmTokens = String(process.env.FCM_TEST_TOKENS || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 100);
  if (process.env.FCM_SERVER_KEY && fcmTokens.length) {
    try {
      const response = await fetch("https://fcm.googleapis.com/fcm/send", { method: "POST", signal: AbortSignal.timeout(6_000), headers: { Authorization: `key=${process.env.FCM_SERVER_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ registration_ids: fcmTokens, notification: { title: notification.title || "BEACON official update", body: notification.body || "Open BEACON for verified guidance." }, data: { entity_type: entityType, entity_id: entityId } }) });
      externalDelivered ||= response.ok;
      attempts.push({ id: id("del"), entityType, entityId, channel: "push/fcm", status: response.ok ? "delivered" : "failed", detail: response.ok ? `Accepted for ${fcmTokens.length} configured test device(s)` : `FCM returned HTTP ${response.status}` });
    } catch { attempts.push({ id: id("del"), entityType, entityId, channel: "push/fcm", status: "failed", detail: "FCM request failed; no credential or token detail logged" }); }
  } else attempts.push({ id: id("del"), entityType, entityId, channel: "push/fcm", status: "not_configured", detail: process.env.FCM_SERVER_KEY ? "FCM_TEST_TOKENS is empty; outbound delivery restricted to test devices" : "FCM_SERVER_KEY is not set" });
  const smsRecipients = String(process.env.MSG91_TEST_RECIPIENTS || "").split(",").map((item) => item.replace(/\D/g, "")).filter((item) => /^\d{10,15}$/.test(item)).slice(0, 25);
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID && smsRecipients.length) {
    const variable = process.env.MSG91_MESSAGE_VARIABLE || "BEACON_MESSAGE";
    try {
      const response = await fetch("https://control.msg91.com/api/v5/flow/", { method: "POST", signal: AbortSignal.timeout(6_000), headers: { authkey: process.env.MSG91_AUTH_KEY, "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify({ template_id: process.env.MSG91_TEMPLATE_ID, short_url: "0", recipients: smsRecipients.map((mobiles) => ({ mobiles, [variable]: `${notification.title || "BEACON update"}: ${notification.body || "Open BEACON for details."}`.slice(0, 320) })) }) });
      externalDelivered ||= response.ok;
      attempts.push({ id: id("del"), entityType, entityId, channel: "sms/msg91", status: response.ok ? "delivered" : "failed", detail: response.ok ? `Accepted for ${smsRecipients.length} configured test recipient(s)` : `MSG91 returned HTTP ${response.status}` });
    } catch { attempts.push({ id: id("del"), entityType, entityId, channel: "sms/msg91", status: "failed", detail: "MSG91 request failed; no credential or recipient detail logged" }); }
  } else attempts.push({ id: id("del"), entityType, entityId, channel: "sms/msg91", status: "not_configured", detail: process.env.MSG91_AUTH_KEY ? "MSG91 template/test recipients are incomplete; outbound delivery restricted to test recipients" : "MSG91_AUTH_KEY is not set" });
  attempts.push({ id: id("del"), entityType, entityId, channel: "store-and-forward", status: connected || externalDelivered ? "not_needed" : "queued", detail: connected || externalDelivered ? "At least one delivery path accepted the update" : "Retained for authenticated reconnect delivery" });
  await db.insert(s.deliveryAttempts).values(attempts);
}

await app.register(cors, { origin: true, methods: ["GET", "POST", "PATCH", "DELETE"] });
await app.register(multipart, { limits: { files: config.uploads.maxFiles, fileSize: config.uploads.maxFileBytes, fields: 16, parts: config.uploads.maxFiles + 16 } });
await app.register(websocket);
await app.register(swagger, { openapi: { info: { title: "BEACON Crisis Intelligence API", version: "2.0.0" } } });
await app.register(swaggerUi, { routePrefix: "/docs" });

app.setErrorHandler((error: any, _request, reply) => {
  app.log.error(error);
  reply.code(error.statusCode || 500).send({ detail: error.statusCode ? error.message : "BEACON service error", request_id: id("err") });
});

app.get("/api/v1/health", async () => {
  const pg = await pool.query("SELECT PostGIS_Version() AS postgis");
  const redisPing = await redis.ping();
  return { status: "ready", database: "postgresql/postgis", postgis: pg.rows[0].postgis, redis: redisPing, realtime_clients: sockets.size, services: serviceReadiness(), time: new Date().toISOString() };
});

app.get("/api/v1/ws", { websocket: true }, async (socket: any, request: any) => {
  const principal = await resolvePrincipal(String(request.query?.token || ""));
  if (!principal) { socket.send(JSON.stringify({ event: "error", payload: { detail: "Authenticated realtime session required" } })); socket.close(1008, "Unauthorized"); return; }
  sockets.set(socket, principal);
  socket.send(JSON.stringify({ event: "connected", payload: { at: new Date().toISOString(), transport: "redis-websocket", audience: principal.kind } }));
  socket.on("message", (raw: Buffer) => { if (raw.toString() === "ping") socket.send(JSON.stringify({ event: "pong", payload: { at: new Date().toISOString() } })); });
  socket.on("close", () => sockets.delete(socket));
});

app.post("/api/v1/citizens/session", async (request: any) => {
  await rateLimit(`session:${request.ip}`, 12, 60);
  const body = request.body as { name: string; phone: string; language?: string; device_id: string };
  const [existing] = await db.select().from(s.citizens).where(and(eq(s.citizens.phone, body.phone), eq(s.citizens.deviceId, body.device_id))).limit(1);
  const citizen = existing || { id: id("cit"), name: body.name, phone: body.phone, language: body.language || "en", deviceId: body.device_id };
  if (!existing) await db.insert(s.citizens).values(citizen);
  else await db.update(s.citizens).set({ name: body.name, language: body.language || existing.language }).where(eq(s.citizens.id, existing.id));
  const token = id("cses"), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await db.insert(s.citizenSessions).values({ id: token, citizenId: citizen.id, deviceId: body.device_id, expiresAt });
  return { citizen: snake(citizen), token, expires_at: expiresAt.toISOString() };
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
  const lat = Number(request.query?.lat || 21.2514), lon = Number(request.query?.lon || 81.6296);
  const key = `weather:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  let weather = JSON.parse((await redis.get(key)) || "null");
  if (!weather) {
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&timezone=auto`, { signal: AbortSignal.timeout(3500) });
      const current = (await response.json() as any).current;
      weather = { temperature: current.temperature_2m, wind_speed: current.wind_speed_10m, precipitation: current.precipitation, risk: current.precipitation >= 10 ? "Elevated" : "Low", source: "Open-Meteo", observed_at: current.time };
      await redis.set(key, JSON.stringify(weather), "EX", 300);
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

app.post("/api/v1/reports", async (request: any, reply) => {
  await rateLimit(`report:${request.ip}`, 8, 60);
  const fields: Record<string, string> = {}, pendingMedia: Array<{ buffer: Buffer; name: string; mime: string }> = [];
  for await (const part of request.parts()) {
    if (part.type === "file") {
      const content = await part.toBuffer();
      pendingMedia.push({ buffer: content, name: String(part.filename || "evidence"), mime: part.mimetype });
    } else fields[part.fieldname] = String(part.value);
  }
  const citizenId = fields.citizen_id, hazardType = fields.hazard_type, severity = fields.severity, text = fields.text;
  const latitude = Number(fields.latitude), longitude = Number(fields.longitude);
  if (!citizenId || !hazardType || !severity || !text || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return safeError(reply, 400, "Complete report fields and a valid location are required");
  if (!(await requireCitizen(request, reply, citizenId))) return;
  const [citizen] = await db.select({ id: s.citizens.id, name: s.citizens.name, language: s.citizens.language }).from(s.citizens).where(eq(s.citizens.id, citizenId)).limit(1);
  if (!citizen) return safeError(reply, 404, "Citizen session not found");
  const storedMedia = await Promise.all(pendingMedia.map((item) => storeMedia(item.buffer, item.name, item.mime)));
  const nearby = await pool.query(`SELECT * FROM incidents WHERE hazard_type=$1 AND created_at > now()-($4::text || ' hours')::interval AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $5) ORDER BY created_at DESC LIMIT 8`, [hazardType, longitude, latitude, config.clustering.windowHours, config.clustering.distanceMeters]);
  let best: { row: any; similarity: number; mediaHashMatch: boolean } | undefined;
  for (const row of nearby.rows) {
    const related = await db.select({ originalText: s.reports.originalText, media: s.reports.media }).from(s.reports).where(eq(s.reports.incidentId, row.id));
    const similarity = Math.max(0, ...related.map((report) => textSimilarity(text, report.originalText)));
    const previousHashes = new Set(related.flatMap((report) => Array.isArray(report.media) ? (report.media as any[]).map((item) => item.sha256) : []));
    const mediaHashMatch = storedMedia.some((item) => previousHashes.has(item.sha256));
    if (!best || similarity > best.similarity || (mediaHashMatch && !best.mediaHashMatch)) best = { row, similarity, mediaHashMatch };
  }
  const match = best && (best.mediaHashMatch || best.similarity >= config.clustering.textSimilarity) ? best : undefined;
  const reportLanguage = fields.language || citizen.language;
  const redactedForProviders = redactPII(text, [citizen.name]).text;
  const translation = await translateText(redactedForProviders, reportLanguage, "en");
  const verification = await verifyClaim(translation.text);
  const analysis = await analyzeReport({ text, hazardType, severity, language: reportLanguage, citizenName: citizen.name, translation, verification, duplicate: { nearbyCount: nearby.rowCount || 0, textSimilarity: best?.similarity || 0, mediaHashMatch: best?.mediaHashMatch || false } });
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
  const media = storedMedia.map((item) => ({ name: item.originalName, content_type: item.mimeType, sha256: item.sha256, provider: item.provider, url: item.url, resource_type: item.resourceType, bytes: item.bytes }));
  await db.insert(s.reports).values({ id: reportId, citizenId, incidentId: incident.id, hazardType, severity, originalText: text, translatedText: analysis.result.translation_en, requestedHelp: fields.requested_help || null, latitude, longitude, approximateArea: publicArea(latitude, longitude), trustState: "Unverified", media });
  if (storedMedia.length) await db.insert(s.mediaEvidence).values(storedMedia.map((item) => ({ id: id("med"), reportId, provider: item.provider, storageKey: item.storageKey, url: item.url, secureUrl: item.secureUrl, originalName: item.originalName, mimeType: item.mimeType, resourceType: item.resourceType, bytes: item.bytes, sha256: item.sha256, fallbackReason: item.fallbackReason })));
  await pool.query("UPDATE reports SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1", [reportId]);
  await db.insert(s.analysisRuns).values({ id: id("ana"), incidentId: incident.id, provider: analysis.meta.provider, latencyMs: analysis.meta.latency_ms, confidence: analysis.meta.confidence, result: analysis.result, errors: analysis.meta.errors, fallbackPath: analysis.meta.fallback_path });
  await audit(citizenId, "report_created", "report", reportId, undefined, { incident_id: incident.id, media_count: storedMedia.length, ai_provider: analysis.meta.provider, ai_redactions: analysis.meta.redactions });
  await emit(match ? "incident.updated" : "incident.created", incident);
  return { report_id: reportId, incident: snake(incident), media, analysis: analysis.result, analysis_meta: { provider: analysis.meta.provider, latency_ms: analysis.meta.latency_ms, fallback_path: analysis.meta.fallback_path, errors: analysis.meta.errors } };
});

app.post("/api/v1/sos", async (request: any, reply) => {
  await rateLimit(`sos:${request.ip}`, 5, 60);
  const body = request.body as any;
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
  const [updated] = await db.update(s.sosRequests).set({ latitude: request.body.latitude, longitude: request.body.longitude, updatedAt: new Date() }).where(eq(s.sosRequests.id, request.params.id)).returning();
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
    db.select().from(s.incidents).orderBy(sql`CASE lower(${s.incidents.severity}) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END`, sql`CASE ${s.incidents.trustState} WHEN 'Corroborated' THEN 0 WHEN 'Unverified' THEN 1 WHEN 'Verified' THEN 2 ELSE 3 END`, desc(s.incidents.createdAt)),
    db.select().from(s.sosRequests).where(inArray(s.sosRequests.status, ["New", "Acknowledged", "Assigned", "En route"])).orderBy(sql`CASE ${s.sosRequests.status} WHEN 'New' THEN 0 WHEN 'Acknowledged' THEN 1 WHEN 'Assigned' THEN 2 ELSE 3 END`, desc(s.sosRequests.createdAt)),
    db.select().from(s.assignments).orderBy(desc(s.assignments.createdAt)), db.select().from(s.alerts).orderBy(desc(s.alerts.publishedAt)), db.select().from(s.deliveryAttempts).orderBy(desc(s.deliveryAttempts.createdAt)).limit(100), db.select().from(s.communities).orderBy(desc(s.communities.createdAt)),
  ]);
  const enriched = await Promise.all(incidentRows.map(async (incident) => ({ ...incident, reports: await db.select().from(s.reports).where(eq(s.reports.incidentId, incident.id)).orderBy(desc(s.reports.createdAt)), analysis: (await db.select().from(s.analysisRuns).where(eq(s.analysisRuns.incidentId, incident.id)).orderBy(desc(s.analysisRuns.createdAt)).limit(1))[0] })));
  return snake({ incidents: enriched, sos: sosRows, assignments: assignmentRows, alerts: alertRows, delivery: deliveryRows, communities: communityRows });
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

app.get("/api/v1/communities", async () => {
  const result = await db.select().from(s.communities).where(and(eq(s.communities.approved, true), eq(s.communities.status, "approved"))).orderBy(desc(s.communities.createdAt));
  return snake(await Promise.all(result.map(async (community) => ({ ...community, messages: await db.select().from(s.messages).where(and(eq(s.messages.communityId, community.id), eq(s.messages.moderationStatus, "visible"))).orderBy(s.messages.createdAt) }))));
});

app.post("/api/v1/communities", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return; const body = request.body as any;
  const approved = body.approved ?? true;
  const [created] = await db.insert(s.communities).values({ id: id("com"), name: body.name, incidentId: body.incident_id || null, radiusKm: body.radius_km || 2, approved, status: approved ? "approved" : "proposed", memberCount: 0 }).returning();
  await audit(user.id, "community_created", "community", created.id); await emit("community.created", created, { kind: "authenticated" }); return snake(created);
});

app.patch("/api/v1/communities/:id/status", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const status = String(request.body.status || ""); if (!["approve", "reject", "archive"].includes(status)) return safeError(reply, 400, "Status must be approve, reject, or archive");
  const mapped = status === "approve" ? "approved" : status === "reject" ? "rejected" : "archived";
  const [updated] = await db.update(s.communities).set({ status: mapped, approved: mapped === "approved" }).where(eq(s.communities.id, request.params.id)).returning();
  if (!updated) return safeError(reply, 404, "Community not found");
  await audit(user.id, `community_${mapped}`, "community", updated.id, request.body.reason); await emit("community.updated", updated, { kind: "authenticated" }); return snake(updated);
});

app.post("/api/v1/communities/:id/messages", async (request: any, reply) => {
  const body = request.body as any;
  const principal = await resolvePrincipal(request.headers.authorization?.replace("Bearer ", ""));
  if (!principal) return safeError(reply, 401, "Authenticated session required");
  let senderName: string, role: string;
  if (principal.kind === "official") {
    const [user] = await db.select({ name: s.officialUsers.name, role: s.officialUsers.role }).from(s.officialUsers).where(eq(s.officialUsers.id, principal.id)).limit(1);
    if (!user) return safeError(reply, 401, "Authority session required");
    senderName = user.name; role = user.role;
  } else {
    const [citizen] = await db.select({ name: s.citizens.name }).from(s.citizens).where(eq(s.citizens.id, principal.id)).limit(1);
    if (!citizen) return safeError(reply, 401, "Citizen session required");
    senderName = citizen.name; role = "citizen";
  }
  const [community] = await db.select().from(s.communities).where(eq(s.communities.id, request.params.id)).limit(1);
  if (!community || !community.approved || community.status !== "approved") return safeError(reply, 409, "Community is not open for messages");
  const [created] = await db.insert(s.messages).values({ id: id("msg"), communityId: request.params.id, senderName, senderRole: role, body: body.body, official: principal.kind === "official", moderationStatus: "visible" }).returning();
  await emit("community.message", created, { kind: "authenticated" }); return snake(created);
});

app.patch("/api/v1/communities/:id/messages/:messageId/moderate", async (request: any, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  const status = String(request.body.status || ""); if (!["visible", "hidden", "flagged"].includes(status)) return safeError(reply, 400, "Moderation status must be visible, hidden, or flagged");
  const [updated] = await db.update(s.messages).set({ moderationStatus: status }).where(and(eq(s.messages.id, request.params.messageId), eq(s.messages.communityId, request.params.id))).returning();
  if (!updated) return safeError(reply, 404, "Community message not found");
  await audit(user.id, `message_${status}`, "message", updated.id, request.body.reason, { community_id: request.params.id }); await emit("community.message.moderated", { community_id: request.params.id, message_id: updated.id, status }, { kind: "authenticated" }); return snake(updated);
});

app.get("/api/v1/audit", async (request, reply) => { if (!(await requireOfficial(request, reply, "admin"))) return; return snake(await db.select().from(s.auditEvents).orderBy(desc(s.auditEvents.createdAt)).limit(100)); });

app.post("/api/v1/demo/reset", async (request, reply) => {
  const user = await requireOfficial(request, reply, "admin"); if (!user || !("id" in user)) return;
  await pool.query("TRUNCATE delivery_attempts, corrections, messages, communities, assignments, sos_requests, analysis_runs, reports, alerts, incidents, audit_events, citizens RESTART IDENTITY CASCADE");
  const cacheKeys = (await redis.keys("weather:*")).concat(await redis.keys("rate:*"));
  if (cacheKeys.length) await redis.del(...cacheKeys);
  await emit("demo.reset", { actor: user.id }); return { ok: true };
});

async function start() {
  await mkdir(config.uploadDir, { recursive: true });
  await redis.connect(); await subscriber.connect(); await ensureSchema(); await seed();
  await subscriber.subscribe(EVENT_CHANNEL);
  subscriber.on("message", (_channel: string, message: string) => {
    let envelope: any;
    try { envelope = JSON.parse(message); } catch { return; }
    const audience = envelope.audience as Audience | undefined;
    const outbound = JSON.stringify({ event: envelope.event, payload: envelope.payload, at: envelope.at });
    for (const [socket, principal] of sockets) {
      const allowed = (!audience && principal.kind === "official") || audience?.kind === "authenticated" || (audience?.kind === "authority" && principal.kind === "official") || (audience?.kind === "citizen" && (principal.kind === "official" || principal.id === audience.citizenId));
      if (allowed && socket.readyState === 1) socket.send(outbound);
    }
  });
  await app.listen({ port: config.port, host: config.host });
}

const shutdown = async () => { await app.close(); await Promise.allSettled([redis.quit(), subscriber.quit(), pool.end()]); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
start().catch((error) => { app.log.error(error); process.exit(1); });
