import { join } from "node:path";

const asBoolean = (value: string | undefined, fallback = false) => value === undefined ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());
const asNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: asNumber(process.env.PORT, 8000),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || "postgres://beacon:beacon@localhost:5432/beacon",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  uploadDir: process.env.UPLOAD_DIR || join(process.cwd(), "apps", "api", "uploads"),
  publicApiUrl: process.env.PUBLIC_API_URL || "http://localhost:8000",
  demoAuth: asBoolean(process.env.ALLOW_DEMO_AUTH, process.env.NODE_ENV !== "production"),
  ai: {
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    groqKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    timeoutMs: asNumber(process.env.AI_TIMEOUT_MS, 8_000),
    disableLocal: asBoolean(process.env.AI_DISABLE_LOCAL),
  },
  bhashini: {
    computeUrl: process.env.BHASHINI_COMPUTE_URL,
    authName: process.env.BHASHINI_COMPUTE_AUTH_NAME,
    authValue: process.env.BHASHINI_COMPUTE_AUTH_VALUE,
    nmtServiceId: process.env.BHASHINI_NMT_SERVICE_ID,
  },
  verification: {
    googleFactCheckKey: process.env.GOOGLE_FACT_CHECK_API_KEY,
    timeoutMs: asNumber(process.env.VERIFICATION_TIMEOUT_MS, 5_000),
    maxSources: asNumber(process.env.VERIFICATION_MAX_SOURCES, 8),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER || "beacon/evidence",
  },
  clustering: {
    distanceMeters: asNumber(process.env.CLUSTER_DISTANCE_METERS, 2_500),
    windowHours: asNumber(process.env.CLUSTER_WINDOW_HOURS, 2),
    textSimilarity: asNumber(process.env.CLUSTER_TEXT_SIMILARITY, 0.38),
  },
  uploads: {
    maxFiles: asNumber(process.env.UPLOAD_MAX_FILES, 4),
    maxFileBytes: asNumber(process.env.UPLOAD_MAX_FILE_BYTES, 10_000_000),
  },
};

export function serviceReadiness() {
  const cloudinaryMissing = [
    !config.cloudinary.cloudName && "CLOUDINARY_CLOUD_NAME",
    !config.cloudinary.apiKey && "CLOUDINARY_API_KEY",
    !config.cloudinary.apiSecret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);
  return {
    ai: {
      gemini: Boolean(config.ai.geminiKey),
      groq: Boolean(config.ai.groqKey),
      local_fallback: !config.ai.disableLocal,
    },
    language: {
      provider: "BHASHINI",
      configured: Boolean(config.bhashini.computeUrl && config.bhashini.authName && config.bhashini.authValue && config.bhashini.nmtServiceId),
      fallback: "original-language-retained",
    },
    verification: {
      google_fact_check: Boolean(config.verification.googleFactCheckKey),
      gdelt_news_search: true,
      human_decision_required: true,
    },
    media: {
      provider: cloudinaryMissing.length ? "local-durable-fallback" : "cloudinary",
      cloudinary_configured: cloudinaryMissing.length === 0,
      missing: cloudinaryMissing,
    },
    delivery: {
      fcm_test_adapter: Boolean(process.env.FCM_SERVER_KEY && process.env.FCM_TEST_TOKENS),
      msg91_test_adapter: Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID && process.env.MSG91_TEST_RECIPIENTS),
      outbound_scope: "configured-test-recipients-only",
    },
    demo_auth: config.demoAuth,
  };
}
