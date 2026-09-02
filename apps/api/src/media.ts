import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";

const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a", "audio/ogg", "video/mp4", "video/quicktime", "video/webm"]);

export type StoredMedia = {
  provider: "cloudinary" | "local";
  storageKey: string;
  url: string;
  secureUrl: string | null;
  originalName: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  resourceType: "image" | "video" | "audio";
  fallbackReason?: string;
  transcriptOriginal?: string;
  detectedLanguage?: string;
  translationEn?: string;
  transcriptionProvider?: string;
  transcriptionAvailable?: boolean;
  transcriptionErrors?: string[];
};

export function mediaResourceType(mime: string): StoredMedia["resourceType"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "audio";
}

function assertMedia(buffer: Buffer, mime: string) {
  if (!allowedMime.has(mime)) throw Object.assign(new Error(`Unsupported evidence format: ${mime}`), { statusCode: 415 });
  if (buffer.length < 16) throw Object.assign(new Error("Evidence file is empty or incomplete"), { statusCode: 422 });
  if (buffer.length > config.uploads.maxFileBytes) throw Object.assign(new Error("Evidence file exceeds the configured upload limit"), { statusCode: 413 });
  const ascii = buffer.subarray(0, 16).toString("ascii");
  const valid =
    (mime === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (mime === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mime === "image/webp" && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") ||
    (["video/mp4", "video/quicktime", "audio/mp4", "audio/x-m4a"].includes(mime) && ascii.slice(4, 8) === "ftyp") ||
    (mime === "video/webm" && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) ||
    (mime === "audio/wav" && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") ||
    (mime === "audio/ogg" && ascii.startsWith("OggS")) ||
    (mime === "audio/mpeg" && (ascii.startsWith("ID3") || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)));
  if (!valid) throw Object.assign(new Error(`Evidence bytes do not match declared format ${mime}`), { statusCode: 422 });
}

export function normalizeMediaMime(buffer: Buffer, originalName: string, declaredMime: string) {
  const mime = declaredMime.toLowerCase().split(";", 1)[0].trim();
  const extension = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const isIsoMedia = buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";

  // Expo File on Android can report an AAC-in-M4A recording as audio/mpeg.
  // Only normalize when both the trusted byte signature and audio extension agree.
  if (isIsoMedia && ["m4a", "aac", "mp4"].includes(extension) && ["audio/mpeg", "audio/x-m4a", "application/octet-stream"].includes(mime)) {
    return "audio/mp4";
  }
  return mime;
}

async function localStore(buffer: Buffer, originalName: string, mime: string, sha256: string, fallbackReason?: string): Promise<StoredMedia> {
  await mkdir(config.uploadDir, { recursive: true });
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${sha256.slice(0, 20)}-${safeName || "evidence"}`;
  await writeFile(join(config.uploadDir, storageKey), buffer, { flag: "wx" }).catch((error: any) => { if (error?.code !== "EEXIST") throw error; });
  return { provider: "local", storageKey, url: `/api/v1/media/local/${storageKey}`, secureUrl: null, originalName, mimeType: mime, bytes: buffer.length, sha256, resourceType: mediaResourceType(mime), fallbackReason };
}

async function cloudinaryStore(buffer: Buffer, originalName: string, mime: string, sha256: string): Promise<StoredMedia> {
  const { cloudName, apiKey, apiSecret, folder } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary configuration incomplete");
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = sha256.slice(0, 24);
  const signature = createHash("sha1").update(`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest("hex");
  const form = new FormData();
  form.set("file", new Blob([Uint8Array.from(buffer)], { type: mime }), originalName);
  form.set("api_key", apiKey); form.set("timestamp", String(timestamp)); form.set("signature", signature); form.set("folder", folder); form.set("public_id", publicId);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
  const json = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const providerMessage = String(json?.error?.message || "provider rejected the upload")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 120);
    throw new Error(`Cloudinary upload HTTP ${response.status}: ${providerMessage}`);
  }
  if (!json.secure_url || !json.public_id || !Number.isFinite(json.bytes) || json.bytes <= 0) throw new Error("Cloudinary response missing valid media metadata");
  return { provider: "cloudinary", storageKey: json.public_id, url: json.secure_url, secureUrl: json.secure_url, originalName, mimeType: mime, bytes: json.bytes, sha256, resourceType: mediaResourceType(mime) };
}

export async function storeMedia(buffer: Buffer, originalName: string, mime: string): Promise<StoredMedia> {
  const normalizedMime = normalizeMediaMime(buffer, originalName, mime);
  assertMedia(buffer, normalizedMime);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret) {
    try { return await cloudinaryStore(buffer, originalName, normalizedMime, sha256); }
    catch (error) { return localStore(buffer, originalName, normalizedMime, sha256, error instanceof Error ? error.message.slice(0, 180) : "Cloudinary upload failed"); }
  }
  return localStore(buffer, originalName, normalizedMime, sha256, "Cloudinary is not fully configured");
}

export async function readLocalMedia(storageKey: string) {
  if (!/^[a-f0-9]{20}-[a-zA-Z0-9._-]+$/.test(storageKey)) throw Object.assign(new Error("Invalid media key"), { statusCode: 400 });
  return readFile(join(config.uploadDir, storageKey));
}
