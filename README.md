# BEACON judge prototype

BEACON is a locally networked crisis-intelligence prototype. The active stack is a Fastify API with Drizzle ORM, PostgreSQL/PostGIS, Redis pub/sub, a Next.js authority command centre (plus browser citizen simulator), an Expo Android citizen app, and a Telegram citizen bot. The original FastAPI implementation remains under `backend/` as a fallback/reference service.

## Quick start

```powershell
npm install
docker compose up --build -d
npm run dev:mobile -- --lan
```

Open `http://localhost:3000` for the authority command centre and `http://localhost:3000/citizen` for the judge-friendly citizen flow. The API health check is `http://localhost:8000/api/v1/health`. For a phone on the same Wi-Fi, set `EXPO_PUBLIC_API_URL=http://<computer-lan-ip>:8000/api/v1` in `apps/mobile/.env.local`; Expo also derives the LAN host from Metro when that setting is absent.

The Compose stack starts five health-checked services: `dashboard`, `api`, `postgis`, `redis`, and `telegram-bot`. Persistent database, Redis, and evidence-upload volumes survive restarts. Use `docker compose down` to stop the stack without deleting data.

## Telegram citizen bot

1. Open Telegram's official `@BotFather`, run `/newbot`, and copy the bot token.
2. Put `TELEGRAM_BOT_TOKEN=<token>` in the ignored root `.env` file. Never put it in Expo, client code, a commit, or a screenshot.
3. Run `docker compose up --build -d telegram-bot` and check `http://localhost:8082`.
4. Open the bot in a private Telegram chat and send `/start`.

The bot registers its command menu automatically and supports `/conditions`, `/alerts`, `/facilities`, `/report`, `/sos`, `/status`, `/cancel_sos`, `/community`, `/message`, `/language`, `/help`, and `/cancel`. The citizen app and bot offer English, Hindi, Chhattisgarhi, Bengali, Marathi, Gujarati, Punjabi, Tamil, Telugu, Kannada, Malayalam, and Odia. Reports accept Telegram photo, video, audio, voice, and location evidence and enter the exact same AI/trust/authority pipeline as Expo reports. BHASHINI translation is used when configured, while the original report is retained through missing credentials or provider failure. Alert, correction, dispatch, and SOS updates are routed from Redis to the correct Telegram chats. Long polling is used for the local demo, so no public HTTPS webhook is required. With no token, the service stays healthy in `waiting_for_token` state without affecting the other BEACON services.

The dashboard's Analysis brain now refreshes external evidence and shows clickable publisher links. A configured Google Fact Check API key adds ClaimReview ratings; GDELT provides no-key related-news discovery. These signals remain advisory: corroborating coverage is not proof, model confidence is not a truth score, and only an authorized official can publish a decision.

## Language and source adapters

Copy the relevant values from `.env.example` into the ignored root `.env` file. For BHASHINI, use the compute URL, authorization header name/value, and NMT service ID returned by its pipeline configuration flow. Without these values, BEACON stays usable and retains the original-language report. `GOOGLE_FACT_CHECK_API_KEY` is optional; GDELT source discovery needs no key. Restart `api` and `telegram-bot` after changing adapter credentials.

To verify the report-to-command-centre realtime path while the stack is running:

```powershell
npm run smoke:realtime
```

This creates a temporary citizen report, confirms the Redis-backed WebSocket event, and checks that the same incident is present in the authenticated authority queue. Reset judge data from the API before a presentation if the smoke test was run.

Demo authority credentials are `admin@beacon.local` / `BeaconDemo!26` and `responder@beacon.local` / `ResponderDemo!26`. They are local prototype credentials only.

## Demo journey

1. Open `/citizen`, register, and submit a fresh report or hold the SOS control.
2. Open `/`, select the incoming incident, review its analysis and evidence, then verify or use the audited bypass.
3. Assign the request to the seeded responder and publish an official alert.
4. The citizen view receives the update over WebSocket. Corrections visibly supersede the earlier alert.

No disaster is pre-seeded. `POST /api/v1/demo/reset` clears judge-created operational data while retaining local demo users and facilities.
