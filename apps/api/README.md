# BEACON API

Fastify API backed by Drizzle ORM, PostgreSQL/PostGIS, and Redis. Docker Compose is the canonical runtime.

## Provider configuration

Copy the repository `.env.example` to `.env` and set only the providers available for the demo. Never commit `.env`.

- AI order is Gemini, Groq, then validated deterministic local analysis.
- Cloud AI receives redacted report text only; citizen name, phone, email, and exact coordinate patterns are removed. Coordinates are never added to the cloud prompt.
- Every analysis run stores provider, latency, validation/fallback path, sanitized errors, confidence for authority review, and specialist provenance.
- First-aid content always comes from `src/protocols.ts`; models may select a protocol ID but cannot author treatment.
- Cloudinary requires `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Missing or failed Cloudinary configuration automatically writes evidence to the durable `beacon_uploads` volume. `/api/v1/health` reports the active provider and missing variable names without exposing values.
- Outbound alert delivery attempts authenticated WebSocket first, then configured FCM and MSG91 adapters, then durable store-and-forward. Provider delivery is disabled unless `FCM_TEST_TOKENS` or `MSG91_TEST_RECIPIENTS` is explicitly populated, so judge runs cannot contact arbitrary recipients. Each provider response becomes a delivery-ledger row without logging credentials, device tokens, or phone numbers.

## Verification

```powershell
npm test --workspace apps/api
npm run build --workspace apps/api
docker compose up --build -d api
npm run smoke --workspace apps/api
```

The smoke test resets only the isolated BEACON demo tenant, then verifies PostGIS/Redis health, citizen registration, accepted/rejected media, duplicate clustering, AI provenance, audited bypass authorization, official map separation, alert/correction delivery, SOS cancellation and assignment lifecycle, community moderation, and WebSocket events. It resets demo data again on success.

API documentation is available at `http://localhost:8000/docs`; operational readiness is at `http://localhost:8000/api/v1/health`.

Citizen registration returns `{ citizen, token, expires_at }`. Send the opaque token as `Authorization: Bearer <token>` for reports, SOS, live-location updates, cancellation, and community messages. Restore an interrupted emergency view with `GET /api/v1/sos/active`; it returns `{ sos, assignment }`, with each value either a snake-case record or `null`.

Realtime is authenticated through `ws://<host>:8000/api/v1/ws?token=<url-encoded-token>`. Anonymous sockets close with policy code `1008`. Authority sessions receive operational events; citizen sessions receive authenticated broadcasts plus only their own SOS/dispatch events. Event envelopes delivered to clients remain `{ event, payload, at }` and never include the internal audience selector.

`ALLOW_DEMO_AUTH=true` retains the judge dashboard's seeded `official_admin` token. Disable it outside the isolated prototype; bare citizen requests and seeded authority-ID tokens will then be rejected.
