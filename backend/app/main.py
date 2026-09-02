from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("BEACON_DB", ROOT / "beacon.db"))
UPLOADS = ROOT / "uploads"
UPLOADS.mkdir(exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS citizens (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, language TEXT NOT NULL, device_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS official_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, organization TEXT NOT NULL, jurisdiction TEXT NOT NULL, mfa_ready INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, citizen_id TEXT NOT NULL, incident_id TEXT NOT NULL, hazard_type TEXT NOT NULL, severity TEXT NOT NULL, original_text TEXT NOT NULL, translated_text TEXT NOT NULL, requested_help TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL, approximate_area TEXT NOT NULL, trust_state TEXT NOT NULL, media_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL, hazard_type TEXT NOT NULL, severity TEXT NOT NULL, trust_state TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, approximate_area TEXT NOT NULL, report_count INTEGER NOT NULL, status TEXT NOT NULL, analysis_summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_runs (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, provider TEXT NOT NULL, latency_ms INTEGER NOT NULL, confidence REAL, result_json TEXT NOT NULL, errors_json TEXT NOT NULL, fallback_path TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sos_requests (id TEXT PRIMARY KEY, citizen_id TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, sos_id TEXT, incident_id TEXT, responder_id TEXT NOT NULL, status TEXT NOT NULL, eta_minutes INTEGER NOT NULL, operational_note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS facilities (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, capacity INTEGER, verified INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS communities (id TEXT PRIMARY KEY, name TEXT NOT NULL, incident_id TEXT, radius_km REAL NOT NULL, approved INTEGER NOT NULL, member_count INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, sender_name TEXT NOT NULL, sender_role TEXT NOT NULL, body TEXT NOT NULL, official INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, incident_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, superseded_by TEXT, published_at TEXT NOT NULL, expires_at TEXT);
CREATE TABLE IF NOT EXISTS corrections (id TEXT PRIMARY KEY, alert_id TEXT NOT NULL, replacement_alert_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, reason TEXT, detail_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_attempts (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    connection = db()
    try:
        return [dict(row) for row in connection.execute(sql, params).fetchall()]
    finally:
        connection.close()


def row(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    result = rows(sql, params)
    return result[0] if result else None


def execute(sql: str, params: tuple = ()) -> None:
    connection = db()
    try:
        connection.execute(sql, params)
        connection.commit()
    finally:
        connection.close()


def seed() -> None:
    connection = db()
    try:
        connection.executescript(SCHEMA)
        officials = [
            ("official_admin", "Vaibhav Sharma", "admin@beacon.local", "BeaconDemo!26", "admin", "Raipur District Control", "Raipur", 1),
            ("official_responder", "Ravi Sahu", "responder@beacon.local", "ResponderDemo!26", "responder", "NDRF Demo Unit", "Raipur", 1),
        ]
        connection.executemany("INSERT OR IGNORE INTO official_users VALUES (?,?,?,?,?,?,?,?)", officials)
        stamp = now()
        facilities = [
            ("fac_aiims", "AIIMS Raipur", "hospital", 21.2589, 81.5783, None, 1, stamp),
            ("fac_dks", "Dr. B. R. Ambedkar Hospital", "hospital", 21.2521, 81.6318, None, 1, stamp),
            ("fac_shelter", "Shankar Nagar Civic Shelter", "shelter", 21.2528, 81.6572, 120, 1, stamp),
        ]
        connection.executemany("INSERT OR IGNORE INTO facilities VALUES (?,?,?,?,?,?,?,?)", facilities)
        connection.commit()
    finally:
        connection.close()


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, event: str, payload: dict[str, Any]) -> int:
        dead = []
        delivered = 0
        for ws in self.clients:
            try:
                await ws.send_json({"event": event, "payload": payload})
                delivered += 1
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
        return delivered


hub = Hub()


@asynccontextmanager
async def lifespan(_: FastAPI):
    seed()
    yield


app = FastAPI(title="BEACON Crisis Intelligence API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class CitizenCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=8, max_length=18)
    language: Literal["en", "hi", "hne"] = "en"
    device_id: str = Field(min_length=4, max_length=100)


class Login(BaseModel):
    email: str
    password: str


class SOSCreate(BaseModel):
    citizen_id: str
    latitude: float
    longitude: float
    note: str = "Emergency assistance requested"


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float


class Decision(BaseModel):
    action: Literal["verify", "corroborate", "misleading", "outdated", "request_evidence"]
    reason: str = Field(min_length=3)


class Bypass(BaseModel):
    reason: str = Field(min_length=8)
    confirmed: bool


class AssignmentCreate(BaseModel):
    responder_id: str = "official_responder"
    sos_id: str | None = None
    incident_id: str | None = None
    eta_minutes: int = Field(default=12, ge=1, le=240)
    note: str = "Proceed and corroborate conditions on arrival."


class AlertCreate(BaseModel):
    incident_id: str | None = None
    title: str
    body: str
    severity: Literal["low", "moderate", "high", "critical"] = "moderate"
    expires_minutes: int = 180


class CorrectionCreate(BaseModel):
    reason: str
    title: str
    body: str


class CommunityCreate(BaseModel):
    name: str
    incident_id: str | None = None
    radius_km: float = 2.0
    approved: bool = True


class MessageCreate(BaseModel):
    sender_name: str
    sender_role: str = "citizen"
    body: str


def audit(actor: str, action: str, entity_type: str, entity_id: str, reason: str | None = None, detail: dict | None = None) -> None:
    execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)", (uid("aud"), actor, action, entity_type, entity_id, reason, json.dumps(detail or {}), now()))


def delivery_ledger(entity_type: str, entity_id: str, websocket_recipients: int) -> None:
    stamp = now()
    attempts = [
        ("in-app/websocket", "delivered" if websocket_recipients else "queued", f"{websocket_recipients} live recipient(s)"),
        ("push/fcm", "not_configured", "Set FCM_SERVER_KEY to enable the production adapter"),
        ("sms/msg91", "not_configured", "Set MSG91_AUTH_KEY to enable the production adapter"),
        ("store-and-forward", "not_needed" if websocket_recipients else "queued", "Retained for reconnect delivery"),
    ]
    for channel, status, detail in attempts:
        execute("INSERT INTO delivery_attempts VALUES (?,?,?,?,?,?,?)", (uid("del"), entity_type, entity_id, channel, status, detail, stamp))


def official(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authority session required")
    user_id = authorization.removeprefix("Bearer ")
    user = row("SELECT * FROM official_users WHERE id=?", (user_id,))
    if not user:
        raise HTTPException(401, "Unknown authority session")
    return user


def admin(user: dict = Depends(official)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Admin role required")
    return user


def redact(text: str) -> str:
    text = re.sub(r"\b(?:\+?91[- ]?)?[6-9]\d{9}\b", "[phone removed]", text)
    return re.sub(r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\b", "[name removed]", text)


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.sqrt(((a[0] - b[0]) * 111) ** 2 + ((a[1] - b[1]) * 102) ** 2)


async def analyze(text: str, hazard: str, severity: str) -> tuple[dict, dict]:
    started = time.perf_counter()
    clean = redact(text.lower())
    prompt = (
        "Analyze this redacted citizen crisis report. Return JSON only with keys summary (string), "
        "signals (string array), duplicate_likelihood (string), recommended_state (must be Unverified), "
        f"and analysis_available (boolean). Hazard: {hazard}. Severity: {severity}. Report: {clean[:1200]}"
    )
    errors: list[str] = []
    fallback: list[str] = []

    async def validate(content: str) -> dict[str, Any]:
        parsed = json.loads(content.replace("```json", "").replace("```", "").strip())
        if not isinstance(parsed.get("summary"), str) or not isinstance(parsed.get("signals"), list):
            raise ValueError("invalid output shape")
        parsed["recommended_state"] = "Unverified"
        parsed["analysis_available"] = True
        parsed["cloud_payload_preview"] = clean[:160]
        return parsed

    anthropic_token = os.getenv("ANTHROPIC_AUTH_TOKEN")
    anthropic_base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
    anthropic_model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest")
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    async with httpx.AsyncClient(timeout=8) as client:
        if anthropic_token:
            try:
                response = await client.post(
                    f"{anthropic_base_url}/v1/messages",
                    headers={"x-api-key": anthropic_token, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": anthropic_model, "max_tokens": 1200, "temperature": 0.1, "system": "Return only valid JSON for disaster evidence and fact-check synthesis. Do not invent sources or claim live retrieval.", "messages": [{"role": "user", "content": prompt}]},
                )
                response.raise_for_status()
                text_content = next(part["text"] for part in response.json().get("content", []) if part.get("type") == "text")
                result = await validate(text_content)
                return result, {"provider": f"claude/{anthropic_model}", "latency_ms": int((time.perf_counter()-started)*1000), "confidence": None, "errors": errors, "fallback_path": fallback + ["claude:success"]}
            except Exception as exc:
                errors.append(f"claude:{type(exc).__name__}")
                fallback.append("claude:failed")
        else:
            fallback.append("claude:not-configured")
        if gemini_key:
            try:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}",
                    json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"}},
                )
                response.raise_for_status()
                result = await validate(response.json()["candidates"][0]["content"]["parts"][0]["text"])
                return result, {"provider": "gemini", "latency_ms": int((time.perf_counter()-started)*1000), "confidence": None, "errors": errors, "fallback_path": fallback + ["gemini:success"]}
            except Exception as exc:
                errors.append(f"gemini:{type(exc).__name__}")
                fallback.append("gemini:failed")
        else:
            fallback.append("gemini:not-configured")
        if groq_key:
            try:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}"},
                    json={"model": "llama-3.3-70b-versatile", "messages": [{"role": "user", "content": prompt}], "response_format": {"type": "json_object"}},
                )
                response.raise_for_status()
                result = await validate(response.json()["choices"][0]["message"]["content"])
                return result, {"provider": "groq", "latency_ms": int((time.perf_counter()-started)*1000), "confidence": None, "errors": errors, "fallback_path": fallback + ["groq:success"]}
            except Exception as exc:
                errors.append(f"groq:{type(exc).__name__}")
                fallback.append("groq:failed")
        else:
            fallback.append("groq:not-configured")

    provider = "local-deterministic"
    fallback.append("local:success")
    indicators = [term for term in ["water", "flood", "smoke", "fire", "collapsed", "injured", "help", "बाढ़", "आग"] if term in clean]
    confidence = min(0.86, 0.45 + len(indicators) * 0.08 + (0.08 if severity in {"high", "critical"} else 0))
    result = {
        "summary": f"{hazard.title()} report; {len(indicators)} corroborating language signals detected.",
        "signals": indicators,
        "duplicate_likelihood": "evaluated with time, distance, text and media hash",
        "recommended_state": "Unverified",
        "analysis_available": True,
        "cloud_payload_preview": clean[:160],
    }
    meta = {"provider": provider, "latency_ms": max(1, int((time.perf_counter() - started) * 1000)), "confidence": confidence, "errors": errors, "fallback_path": fallback}
    return result, meta


@app.get("/api/v1/health")
def health():
    return {"status": "ready", "database": "sqlite", "ai": "local fallback ready", "time": now()}


@app.post("/api/v1/citizens/session")
def create_citizen(data: CitizenCreate):
    existing = row("SELECT * FROM citizens WHERE phone=? AND device_id=?", (data.phone, data.device_id))
    if existing:
        return {"citizen": existing, "token": existing["id"]}
    citizen_id = uid("cit")
    execute("INSERT INTO citizens VALUES (?,?,?,?,?,?)", (citizen_id, data.name, data.phone, data.language, data.device_id, now()))
    return {"citizen": row("SELECT * FROM citizens WHERE id=?", (citizen_id,)), "token": citizen_id}


@app.post("/api/v1/authority/login")
def login(data: Login):
    user = row("SELECT * FROM official_users WHERE email=? AND password=?", (data.email, data.password))
    if not user:
        raise HTTPException(401, "Invalid local demo credentials")
    safe = {k: v for k, v in user.items() if k != "password"}
    return {"user": safe, "token": user["id"]}


@app.get("/api/v1/context")
async def context(lat: float = 21.2514, lon: float = 81.6296):
    weather = {"temperature": 30, "wind_speed": 7, "precipitation": 0, "risk": "Low", "source": "cached fallback", "observed_at": now()}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get("https://api.open-meteo.com/v1/forecast", params={"latitude": lat, "longitude": lon, "current": "temperature_2m,precipitation,wind_speed_10m", "timezone": "auto"})
            response.raise_for_status()
            current = response.json()["current"]
            precip = current.get("precipitation", 0)
            weather = {"temperature": current.get("temperature_2m"), "wind_speed": current.get("wind_speed_10m"), "precipitation": precip, "risk": "Elevated" if precip >= 10 else "Low", "source": "Open-Meteo", "observed_at": current.get("time")}
    except Exception:
        pass
    return {"weather": weather, "facilities": rows("SELECT * FROM facilities"), "alerts": rows("SELECT * FROM alerts WHERE status='active' ORDER BY published_at DESC"), "unverified": rows("SELECT id,title,hazard_type,severity,trust_state,approximate_area,latitude,longitude,report_count,created_at FROM incidents WHERE trust_state IN ('Unverified','Corroborated') ORDER BY created_at DESC")}


@app.post("/api/v1/reports")
async def create_report(
    citizen_id: str = Form(...), hazard_type: str = Form(...), severity: str = Form(...), text: str = Form(...), requested_help: str = Form(""), latitude: float = Form(...), longitude: float = Form(...), media: list[UploadFile] = File(default=[])
):
    if not row("SELECT id FROM citizens WHERE id=?", (citizen_id,)):
        raise HTTPException(404, "Citizen session not found")
    created = now()
    hashes, stored = [], []
    for item in media[:4]:
        content = await item.read(10_000_001)
        if len(content) > 10_000_000:
            raise HTTPException(413, "Each media file must be 10 MB or smaller")
        digest = hashlib.sha256(content).hexdigest()
        path = UPLOADS / f"{digest[:16]}-{Path(item.filename or 'evidence').name}"
        path.write_bytes(content)
        hashes.append(digest)
        stored.append({"name": item.filename, "content_type": item.content_type, "sha256": digest, "path": str(path.relative_to(ROOT))})
    candidates = rows("SELECT * FROM incidents WHERE hazard_type=? AND created_at>?", (hazard_type, (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()))
    match = next((candidate for candidate in candidates if distance_km((latitude, longitude), (candidate["latitude"], candidate["longitude"])) <= 2.5), None)
    analysis, meta = await analyze(text, hazard_type, severity)
    report_id = uid("rep")
    if match:
        incident_id = match["id"]
        new_count = match["report_count"] + 1
        trust = "Corroborated" if new_count >= 2 and match["trust_state"] == "Unverified" else match["trust_state"]
        execute("UPDATE incidents SET report_count=?, trust_state=?, updated_at=? WHERE id=?", (new_count, trust, created, incident_id))
    else:
        incident_id = uid("inc")
        area = f"Ward area near {latitude:.2f}, {longitude:.2f}"
        execute("INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (incident_id, f"{hazard_type.title()} reported", hazard_type, severity, "Unverified", latitude, longitude, area, 1, "New", analysis["summary"], created, created))
    area = f"Ward area near {latitude:.2f}, {longitude:.2f}"
    execute("INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (report_id, citizen_id, incident_id, hazard_type, severity, text, text, requested_help, latitude, longitude, area, "Unverified", json.dumps(stored), created))
    execute("INSERT INTO analysis_runs VALUES (?,?,?,?,?,?,?,?,?)", (uid("ana"), incident_id, meta["provider"], meta["latency_ms"], meta["confidence"], json.dumps(analysis), json.dumps(meta["errors"]), json.dumps(meta["fallback_path"]), created))
    incident = row("SELECT * FROM incidents WHERE id=?", (incident_id,))
    await hub.broadcast("incident.created", incident)
    public_meta = {"provider": meta["provider"], "latency_ms": meta["latency_ms"], "fallback_path": meta["fallback_path"], "errors": meta["errors"]}
    return {"report_id": report_id, "incident": incident, "analysis": analysis, "analysis_meta": public_meta}


@app.post("/api/v1/sos")
async def create_sos(data: SOSCreate):
    if not row("SELECT id FROM citizens WHERE id=?", (data.citizen_id,)):
        raise HTTPException(404, "Citizen session not found")
    sos_id, stamp = uid("sos"), now()
    execute("INSERT INTO sos_requests VALUES (?,?,?,?,?,?,?,?)", (sos_id, data.citizen_id, data.latitude, data.longitude, data.note, "New", stamp, stamp))
    payload = row("SELECT * FROM sos_requests WHERE id=?", (sos_id,))
    audit(data.citizen_id, "sos_created", "sos", sos_id)
    await hub.broadcast("sos.created", payload)
    return payload


@app.patch("/api/v1/sos/{sos_id}/location")
async def update_sos_location(sos_id: str, data: LocationUpdate):
    execute("UPDATE sos_requests SET latitude=?,longitude=?,updated_at=? WHERE id=?", (data.latitude, data.longitude, now(), sos_id))
    payload = row("SELECT * FROM sos_requests WHERE id=?", (sos_id,))
    if not payload:
        raise HTTPException(404, "SOS not found")
    await hub.broadcast("sos.location", payload)
    return payload


@app.post("/api/v1/sos/{sos_id}/cancel")
async def cancel_sos(sos_id: str):
    execute("UPDATE sos_requests SET status='Cancelled',updated_at=? WHERE id=?", (now(), sos_id))
    payload = row("SELECT * FROM sos_requests WHERE id=?", (sos_id,))
    if not payload:
        raise HTTPException(404, "SOS not found")
    audit(payload["citizen_id"], "sos_cancelled", "sos", sos_id)
    await hub.broadcast("sos.updated", payload)
    return payload


@app.get("/api/v1/authority/queue")
def queue(_: dict = Depends(official)):
    incidents = rows("SELECT * FROM incidents ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END, created_at DESC")
    for incident in incidents:
        incident["reports"] = rows("SELECT * FROM reports WHERE incident_id=? ORDER BY created_at DESC", (incident["id"],))
        incident["analysis"] = row("SELECT * FROM analysis_runs WHERE incident_id=? ORDER BY created_at DESC LIMIT 1", (incident["id"],))
    return {"incidents": incidents, "sos": rows("SELECT * FROM sos_requests WHERE status NOT IN ('Cancelled','Closed') ORDER BY created_at DESC"), "assignments": rows("SELECT * FROM assignments ORDER BY created_at DESC"), "alerts": rows("SELECT * FROM alerts ORDER BY published_at DESC"), "delivery": rows("SELECT * FROM delivery_attempts ORDER BY created_at DESC LIMIT 100")}


@app.post("/api/v1/incidents/{incident_id}/decision")
async def decide(incident_id: str, data: Decision, user: dict = Depends(admin)):
    mapping = {"verify": "Verified", "corroborate": "Corroborated", "misleading": "Misleading", "outdated": "Outdated", "request_evidence": "Unverified"}
    state = mapping[data.action]
    execute("UPDATE incidents SET trust_state=?,updated_at=? WHERE id=?", (state, now(), incident_id))
    audit(user["id"], data.action, "incident", incident_id, data.reason)
    payload = row("SELECT * FROM incidents WHERE id=?", (incident_id,))
    if not payload:
        raise HTTPException(404, "Incident not found")
    await hub.broadcast("incident.updated", payload)
    return payload


@app.post("/api/v1/incidents/{incident_id}/bypass")
async def bypass(incident_id: str, data: Bypass, user: dict = Depends(admin)):
    if not data.confirmed:
        raise HTTPException(400, "Explicit confirmation is required")
    execute("UPDATE incidents SET trust_state='Verified',updated_at=? WHERE id=?", (now(), incident_id))
    audit(user["id"], "verification_bypassed", "incident", incident_id, data.reason, {"demo_scope": "test-users-only", "immutable": True})
    payload = row("SELECT * FROM incidents WHERE id=?", (incident_id,))
    if not payload:
        raise HTTPException(404, "Incident not found")
    await hub.broadcast("incident.updated", payload)
    return payload


@app.post("/api/v1/assignments")
async def assign(data: AssignmentCreate, user: dict = Depends(admin)):
    if not data.sos_id and not data.incident_id:
        raise HTTPException(400, "An SOS or incident is required")
    assignment_id, stamp = uid("asn"), now()
    execute("INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?)", (assignment_id, data.sos_id, data.incident_id, data.responder_id, "Assigned", data.eta_minutes, data.note, stamp, stamp))
    if data.sos_id:
        execute("UPDATE sos_requests SET status='Assigned',updated_at=? WHERE id=?", (stamp, data.sos_id))
    audit(user["id"], "responder_assigned", "assignment", assignment_id, data.note)
    payload = row("SELECT * FROM assignments WHERE id=?", (assignment_id,))
    await hub.broadcast("dispatch.updated", payload)
    return payload


@app.patch("/api/v1/assignments/{assignment_id}/{status}")
async def assignment_status(assignment_id: str, status: Literal["Acknowledged", "En route", "Resolved", "Closed", "Rejected"], user: dict = Depends(official)):
    execute("UPDATE assignments SET status=?,updated_at=? WHERE id=?", (status, now(), assignment_id))
    payload = row("SELECT * FROM assignments WHERE id=?", (assignment_id,))
    if not payload:
        raise HTTPException(404, "Assignment not found")
    audit(user["id"], "assignment_status", "assignment", assignment_id, status)
    await hub.broadcast("dispatch.updated", payload)
    return payload


@app.post("/api/v1/alerts")
async def publish_alert(data: AlertCreate, user: dict = Depends(admin)):
    if data.incident_id:
        incident = row("SELECT * FROM incidents WHERE id=?", (data.incident_id,))
        if not incident or incident["trust_state"] != "Verified":
            raise HTTPException(409, "Only verified incidents may enter the official feed")
    alert_id, stamp = uid("alt"), now()
    expires = (datetime.now(timezone.utc) + timedelta(minutes=data.expires_minutes)).isoformat()
    execute("INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?)", (alert_id, data.incident_id, data.title, data.body, data.severity, "active", None, stamp, expires))
    audit(user["id"], "alert_published", "alert", alert_id)
    payload = row("SELECT * FROM alerts WHERE id=?", (alert_id,))
    delivered = await hub.broadcast("alert.published", payload)
    delivery_ledger("alert", alert_id, delivered)
    return payload


@app.post("/api/v1/alerts/{alert_id}/correct")
async def correct(alert_id: str, data: CorrectionCreate, user: dict = Depends(admin)):
    old = row("SELECT * FROM alerts WHERE id=?", (alert_id,))
    if not old:
        raise HTTPException(404, "Alert not found")
    replacement_id, stamp = uid("alt"), now()
    execute("INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?)", (replacement_id, old["incident_id"], data.title, data.body, old["severity"], "active", None, stamp, old["expires_at"]))
    execute("UPDATE alerts SET status='superseded',superseded_by=? WHERE id=?", (replacement_id, alert_id))
    correction_id = uid("cor")
    execute("INSERT INTO corrections VALUES (?,?,?,?,?)", (correction_id, alert_id, replacement_id, data.reason, stamp))
    audit(user["id"], "alert_corrected", "alert", alert_id, data.reason, {"replacement_alert_id": replacement_id})
    payload = {"correction": row("SELECT * FROM corrections WHERE id=?", (correction_id,)), "replacement": row("SELECT * FROM alerts WHERE id=?", (replacement_id,))}
    delivered = await hub.broadcast("alert.corrected", payload)
    delivery_ledger("correction", correction_id, delivered)
    return payload


@app.post("/api/v1/communities")
async def create_community(data: CommunityCreate, user: dict = Depends(admin)):
    community_id = uid("com")
    execute("INSERT INTO communities VALUES (?,?,?,?,?,?,?)", (community_id, data.name, data.incident_id, data.radius_km, int(data.approved), 0, now()))
    audit(user["id"], "community_created", "community", community_id)
    return row("SELECT * FROM communities WHERE id=?", (community_id,))


@app.get("/api/v1/communities")
def list_communities():
    result = rows("SELECT * FROM communities WHERE approved=1 ORDER BY created_at DESC")
    for community in result:
        community["messages"] = rows("SELECT * FROM messages WHERE community_id=? ORDER BY created_at", (community["id"],))
    return result


@app.post("/api/v1/communities/{community_id}/messages")
async def add_message(community_id: str, data: MessageCreate):
    message_id = uid("msg")
    official_flag = int(data.sender_role in {"admin", "responder"})
    execute("INSERT INTO messages VALUES (?,?,?,?,?,?,?)", (message_id, community_id, data.sender_name, data.sender_role, data.body, official_flag, now()))
    payload = row("SELECT * FROM messages WHERE id=?", (message_id,))
    await hub.broadcast("community.message", payload)
    return payload


@app.get("/api/v1/audit")
def audit_log(_: dict = Depends(admin)):
    return rows("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100")


@app.post("/api/v1/demo/reset")
async def reset_demo(user: dict = Depends(admin)):
    connection = db()
    try:
        for table in ["reports", "incidents", "analysis_runs", "sos_requests", "assignments", "communities", "messages", "alerts", "corrections", "audit_events", "delivery_attempts", "citizens"]:
            connection.execute(f"DELETE FROM {table}")
        connection.commit()
    finally:
        connection.close()
    await hub.broadcast("demo.reset", {"at": now(), "actor": user["id"]})
    return {"ok": True}


@app.websocket("/api/v1/ws")
async def websocket(ws: WebSocket):
    await hub.connect(ws)
    try:
        await ws.send_json({"event": "connected", "payload": {"at": now()}})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
