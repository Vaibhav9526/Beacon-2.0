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
};

export function mediaResourceType(mime: string): StoredMedia["resourceType"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "audio";
}

function assertMedia(buffer: Buffer, mime: string) {
  if (!allowedMime.has(mime)) throw Object.assign(new Error(`Unsupported evidence format: ${mime}`), { statusCode: 415 });
  if (buffer.length > config.uploads.maxFileBytes) throw Object.assign(new Error("Evidence file exceeds the configured upload limit"), { statusCode: 413 });
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
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Cloudinary upload HTTP ${response.status}`);
  const json = await response.json() as any;
  if (!json.secure_url || !json.public_id) throw new Error("Cloudinary response missing media URL");
  return { provider: "cloudinary", storageKey: json.public_id, url: json.secure_url, secureUrl: json.secure_url, originalName, mimeType: mime, bytes: buffer.length, sha256, resourceType: mediaResourceType(mime) };
}

export async function storeMedia(buffer: Buffer, originalName: string, mime: string): Promise<StoredMedia> {
  assertMedia(buffer, mime);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret) {
    try { return await cloudinaryStore(buffer, originalName, mime, sha256); }
    catch (error) { return localStore(buffer, originalName, mime, sha256, error instanceof Error ? error.message.slice(0, 180) : "Cloudinary upload failed"); }
  }
  return localStore(buffer, originalName, mime, sha256, "Cloudinary is not fully configured");
}

export async function readLocalMedia(storageKey: string) {
  if (!/^[a-f0-9]{20}-[a-zA-Z0-9._-]+$/.test(storageKey)) throw Object.assign(new Error("Invalid media key"), { statusCode: 400 });
  return readFile(join(config.uploadDir, storageKey));
}
