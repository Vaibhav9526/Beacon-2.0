import WebSocket from "ws";

const api = process.env.BEACON_API_URL || "http://127.0.0.1:8000/api/v1";
const wsUrl = api.replace(/^http/, "ws") + "/ws";
const marker = Date.now();

const sessionResponse = await fetch(`${api}/citizens/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Realtime Smoke", phone: `900${String(marker).slice(-7)}`, language: "en", device_id: `smoke-${marker}` }),
});
if (!sessionResponse.ok) throw new Error(`Session failed: ${sessionResponse.status} ${await sessionResponse.text()}`);
const session = await sessionResponse.json();

const eventPromise = new Promise((resolve, reject) => {
  const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent("official_admin")}`);
  const timeout = setTimeout(() => { socket.close(); reject(new Error("Timed out waiting for incident.created")); }, 25_000);
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (["incident.created", "incident.updated"].includes(message.event)) {
      clearTimeout(timeout);
      socket.close();
      resolve(message);
    }
  });
  socket.on("error", reject);
});

await new Promise((resolve) => setTimeout(resolve, 250));
const form = new FormData();
Object.entries({
  citizen_id: session.citizen.id,
  hazard_type: "flood",
  severity: "high",
  text: `Realtime smoke report ${marker}`,
  latitude: "21.2514",
  longitude: "81.6296",
  requested_help: "evacuation",
}).forEach(([key, value]) => form.set(key, value));
const reportResponse = await fetch(`${api}/reports`, { method: "POST", headers: { authorization: `Bearer ${session.token}` }, body: form });
if (!reportResponse.ok) throw new Error(`Report failed: ${reportResponse.status} ${await reportResponse.text()}`);
const report = await reportResponse.json();
const event = await eventPromise;

const loginResponse = await fetch(`${api}/authority/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@beacon.local", password: "BeaconDemo!26" }),
});
if (!loginResponse.ok) throw new Error(`Login failed: ${loginResponse.status}`);
const login = await loginResponse.json();
const queueResponse = await fetch(`${api}/authority/queue`, { headers: { authorization: `Bearer ${login.token}` } });
if (!queueResponse.ok) throw new Error(`Queue failed: ${queueResponse.status}`);
const queue = await queueResponse.json();
if (!queue.incidents.some((incident) => incident.id === report.incident.id)) throw new Error("Report did not persist into authority queue");

console.log(JSON.stringify({ ok: true, websocket_event: event.event, report_id: report.report_id, incident_id: report.incident.id, queue_incidents: queue.incidents.length }, null, 2));
