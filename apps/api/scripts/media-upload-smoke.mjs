import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiRoot = process.env.BEACON_API_URL || "http://127.0.0.1:8000/api/v1";
const fixtureRoot = resolve(process.cwd(), "artifacts", "media-smoke");

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${apiRoot}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${response.status} ${body.detail || "failed"}`);
  return body;
};

const login = await requestJson("/authority/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@beacon.local", password: "BeaconDemo!26" }),
});
const authorityHeaders = { Authorization: `Bearer ${login.token}` };
const session = await requestJson("/citizens/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Media Upload Smoke Test",
    phone: `8${String(Date.now()).slice(-9)}`,
    language: "en",
    device_id: `media-smoke-${Date.now()}`,
  }),
});

const fixtures = [
  ["photo.png", "image/png"],
  ["audio.wav", "audio/wav"],
  ["video.mp4", "video/mp4"],
];
const form = new FormData();
Object.entries({
  citizen_id: session.citizen.id,
  hazard_type: "other",
  severity: "low",
  text: "Automated media transport verification",
  requested_help: "None - test report",
  latitude: "21.2514",
  longitude: "81.6296",
  evidence_count: String(fixtures.length),
}).forEach(([key, value]) => form.set(key, value));

for (const [name, mimeType] of fixtures) {
  const bytes = await readFile(resolve(fixtureRoot, name));
  if (!bytes.length) throw new Error(`${name} fixture is empty`);
  form.append("media", new Blob([bytes], { type: mimeType }), name);
}

const report = await requestJson("/reports", {
  method: "POST",
  headers: { Authorization: `Bearer ${session.token}` },
  body: form,
});
if (report.media?.length !== fixtures.length) throw new Error(`Expected ${fixtures.length} stored files, received ${report.media?.length || 0}`);

const received = [];
for (const item of report.media) {
  if (!item.bytes || item.bytes <= 0) throw new Error(`${item.original_name} has invalid stored byte count`);
  const mediaUrl = /^https?:\/\//.test(item.url) ? item.url : `${apiRoot.replace(/\/api\/v1$/, "")}${item.url}`;
  const response = await fetch(mediaUrl, { headers: item.provider === "local" ? authorityHeaders : undefined });
  if (!response.ok) throw new Error(`Stored ${item.resource_type} could not be downloaded: ${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (!downloaded.length) throw new Error(`Stored ${item.resource_type} downloaded as an empty file`);
  received.push({ type: item.resource_type, mime: item.content_type, bytes: downloaded.length, provider: item.provider, fallback: item.fallback_reason || null });
}

await requestJson(`/reports/${report.report_id}`, {
  method: "DELETE",
  headers: { ...authorityHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "Completed automated media transport verification" }),
});

console.log(JSON.stringify({ ok: true, report_id: report.report_id, received }, null, 2));
