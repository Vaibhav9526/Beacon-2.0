import { boolean, doublePrecision, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const trustState = pgEnum("trust_state", ["Unverified", "Corroborated", "Verified", "Misleading", "Outdated"]);
export const officialRole = pgEnum("official_role", ["admin", "responder"]);

const stamps = { createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() };

export const citizens = pgTable("citizens", {
  id: text("id").primaryKey(), name: text("name").notNull(), phone: text("phone").notNull(), language: text("language").notNull().default("en"), deviceId: text("device_id").notNull(), ...stamps,
}, (table) => [uniqueIndex("citizen_phone_device").on(table.phone, table.deviceId)]);

export const officialUsers = pgTable("official_users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(), password: text("password").notNull(), role: officialRole("role").notNull(), organization: text("organization").notNull(), jurisdiction: text("jurisdiction").notNull(), mfaReady: boolean("mfa_ready").notNull().default(true),
});

export const citizenSessions = pgTable("citizen_sessions", {
  id: text("id").primaryKey(), citizenId: text("citizen_id").notNull().references(() => citizens.id, { onDelete: "cascade" }), deviceId: text("device_id").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), ...stamps,
});

export const officialSessions = pgTable("official_sessions", {
  id: text("id").primaryKey(), officialUserId: text("official_user_id").notNull().references(() => officialUsers.id, { onDelete: "cascade" }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), ...stamps,
});

export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(), title: text("title").notNull(), hazardType: text("hazard_type").notNull(), severity: text("severity").notNull(), trustState: trustState("trust_state").notNull().default("Unverified"), latitude: doublePrecision("latitude").notNull(), longitude: doublePrecision("longitude").notNull(), approximateArea: text("approximate_area").notNull(), reportCount: integer("report_count").notNull().default(1), status: text("status").notNull().default("New"), analysisSummary: text("analysis_summary").notNull(), ...stamps, updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: text("id").primaryKey(), citizenId: text("citizen_id").notNull().references(() => citizens.id), incidentId: text("incident_id").notNull().references(() => incidents.id), hazardType: text("hazard_type").notNull(), severity: text("severity").notNull(), originalText: text("original_text").notNull(), translatedText: text("translated_text").notNull(), requestedHelp: text("requested_help"), latitude: doublePrecision("latitude").notNull(), longitude: doublePrecision("longitude").notNull(), approximateArea: text("approximate_area").notNull(), trustState: trustState("trust_state").notNull().default("Unverified"), media: jsonb("media").notNull().default([]), ...stamps,
});

export const mediaEvidence = pgTable("media_evidence", {
  id: text("id").primaryKey(), reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }), provider: text("provider").notNull(), storageKey: text("storage_key").notNull(), url: text("url").notNull(), secureUrl: text("secure_url"), originalName: text("original_name").notNull(), mimeType: text("mime_type").notNull(), resourceType: text("resource_type").notNull(), bytes: integer("bytes").notNull(), sha256: text("sha256").notNull(), fallbackReason: text("fallback_reason"), ...stamps,
});

export const analysisRuns = pgTable("analysis_runs", {
  id: text("id").primaryKey(), incidentId: text("incident_id").notNull().references(() => incidents.id), provider: text("provider").notNull(), latencyMs: integer("latency_ms").notNull(), confidence: doublePrecision("confidence"), result: jsonb("result").notNull(), errors: jsonb("errors").notNull().default([]), fallbackPath: jsonb("fallback_path").notNull().default([]), ...stamps,
});

export const sosRequests = pgTable("sos_requests", {
  id: text("id").primaryKey(), citizenId: text("citizen_id").notNull().references(() => citizens.id), latitude: doublePrecision("latitude").notNull(), longitude: doublePrecision("longitude").notNull(), note: text("note").notNull(), status: text("status").notNull().default("New"), ...stamps, updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assignments = pgTable("assignments", {
  id: text("id").primaryKey(), sosId: text("sos_id").references(() => sosRequests.id), incidentId: text("incident_id").references(() => incidents.id), responderId: text("responder_id").notNull().references(() => officialUsers.id), status: text("status").notNull().default("Assigned"), etaMinutes: integer("eta_minutes").notNull(), operationalNote: text("operational_note").notNull(), ...stamps, updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const facilities = pgTable("facilities", {
  id: text("id").primaryKey(), name: text("name").notNull(), kind: text("kind").notNull(), latitude: doublePrecision("latitude").notNull(), longitude: doublePrecision("longitude").notNull(), capacity: integer("capacity"), verified: boolean("verified").notNull().default(true), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communities = pgTable("communities", {
  id: text("id").primaryKey(), name: text("name").notNull(), incidentId: text("incident_id").references(() => incidents.id), radiusKm: doublePrecision("radius_km").notNull().default(2), approved: boolean("approved").notNull().default(false), status: text("status").notNull().default("proposed"), memberCount: integer("member_count").notNull().default(0), ...stamps,
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(), communityId: text("community_id").notNull().references(() => communities.id), senderName: text("sender_name").notNull(), senderRole: text("sender_role").notNull(), body: text("body").notNull(), official: boolean("official").notNull().default(false), moderationStatus: text("moderation_status").notNull().default("visible"), ...stamps,
});

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(), incidentId: text("incident_id").references(() => incidents.id), title: text("title").notNull(), body: text("body").notNull(), severity: text("severity").notNull(), status: text("status").notNull().default("active"), supersededBy: text("superseded_by"), publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const corrections = pgTable("corrections", { id: text("id").primaryKey(), alertId: text("alert_id").notNull().references(() => alerts.id), replacementAlertId: text("replacement_alert_id").notNull(), reason: text("reason").notNull(), ...stamps });
export const auditEvents = pgTable("audit_events", { id: text("id").primaryKey(), actorId: text("actor_id").notNull(), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), reason: text("reason"), detail: jsonb("detail").notNull().default({}), ...stamps });
export const deliveryAttempts = pgTable("delivery_attempts", { id: text("id").primaryKey(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), channel: text("channel").notNull(), status: text("status").notNull(), detail: text("detail").notNull(), ...stamps });
