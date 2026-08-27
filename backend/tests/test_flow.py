import os
from pathlib import Path

TEST_DB = Path(__file__).parent / "test_beacon.db"
os.environ["BEACON_DB"] = str(TEST_DB)

from fastapi.testclient import TestClient
from backend.app.main import app


def test_complete_judge_flow():
    if TEST_DB.exists():
        TEST_DB.unlink()
    with TestClient(app) as client:
        admin_login = client.post("/api/v1/authority/login", json={"email": "admin@beacon.local", "password": "BeaconDemo!26"})
        assert admin_login.status_code == 200
        auth = {"Authorization": "Bearer official_admin"}
        citizen = client.post("/api/v1/citizens/session", json={"name": "Judge Test", "phone": "9999999999", "language": "en", "device_id": "pytest-device"}).json()["citizen"]
        report = client.post("/api/v1/reports", data={"citizen_id": citizen["id"], "hazard_type": "flood", "severity": "high", "text": "Water rising near the underpass, one person needs help", "requested_help": "rescue", "latitude": 21.2514, "longitude": 81.6296})
        assert report.status_code == 200
        incident = report.json()["incident"]
        assert incident["trust_state"] == "Unverified"
        bypass = client.post(f"/api/v1/incidents/{incident['id']}/bypass", headers=auth, json={"reason": "Judge demonstration: visible field evidence and immediate public risk", "confirmed": True})
        assert bypass.status_code == 200
        alert = client.post("/api/v1/alerts", headers=auth, json={"incident_id": incident["id"], "title": "Avoid the low underpass", "body": "Use the marked alternate route while teams assess standing water.", "severity": "high"})
        assert alert.status_code == 200
        sos = client.post("/api/v1/sos", json={"citizen_id": citizen["id"], "latitude": 21.2514, "longitude": 81.6296, "note": "Mobility assistance needed"})
        assert sos.status_code == 200
        assignment = client.post("/api/v1/assignments", headers=auth, json={"sos_id": sos.json()["id"], "responder_id": "official_responder", "eta_minutes": 8})
        assert assignment.status_code == 200
        audit = client.get("/api/v1/audit", headers=auth).json()
        assert any(event["action"] == "verification_bypassed" for event in audit)
        assert any(event["action"] == "responder_assigned" for event in audit)


def test_rejects_unverified_publication():
    if TEST_DB.exists():
        TEST_DB.unlink()
    with TestClient(app) as client:
        auth = {"Authorization": "Bearer official_admin"}
        citizen = client.post("/api/v1/citizens/session", json={"name": "A Test", "phone": "9888888888", "language": "hi", "device_id": "pytest-device-2"}).json()["citizen"]
        incident = client.post("/api/v1/reports", data={"citizen_id": citizen["id"], "hazard_type": "fire", "severity": "moderate", "text": "Smoke visible", "latitude": 21.25, "longitude": 81.63}).json()["incident"]
        response = client.post("/api/v1/alerts", headers=auth, json={"incident_id": incident["id"], "title": "Not yet official", "body": "Should not publish", "severity": "moderate"})
        assert response.status_code == 409

