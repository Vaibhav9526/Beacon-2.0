# BEACON — Complete Project Solution

## 1. Problem Statement

**PS 70: Multilingual Emergency Communication and Misinformation Filter**

During disasters, incorrect information spreads rapidly through social media, messaging groups, videos, calls, and local news. This can create panic, send people toward unsafe locations, overload emergency services, and prevent authorities from understanding what is actually happening.

The required solution must:

- aggregate emergency alerts and citizen reports;
- identify potentially misleading, outdated, or duplicate emergency claims;
- prioritize authoritative information;
- support multiple Indian languages; and
- clearly separate verified information from unverified content.

## 2. Our Solution in One Sentence

**BEACON is a multilingual, human-governed crisis-intelligence platform that converts citizen evidence into reviewed incidents, responder assignments, verified alerts, and visible corrections in real time.**

BEACON is not only a reporting application or fact-checking chatbot. It connects the complete emergency-information cycle:

`Citizen evidence → language processing → duplicate and misinformation analysis → authority verification → responder action → official public alert → correction when facts change`

## 3. Why BEACON Is Needed

Disaster information currently reaches authorities through disconnected channels. The same event may be reported through phone calls, WhatsApp messages, social-media posts, Telegram, videos, or people physically approaching an office. This produces four major problems:

1. **Information fragmentation:** Authorities cannot see all evidence in one operational system.
2. **Duplicate overload:** Hundreds of people may report the same event using different words or languages.
3. **Misinformation:** Old images, false claims, edited screenshots, and rumours may look like current emergency information.
4. **Language barriers:** Citizens may be unable to report clearly in English or another official language during a stressful event.

BEACON creates one traceable route from a citizen’s original report to an official decision. It preserves the evidence, shows the analysis, keeps unverified claims separate, and records which authorized person made the final decision.

## 4. Users of the System

### Citizens

Citizens use the Android application, browser citizen interface, Telegram bot, or BEACON Lens Chrome extension. They can:

- view official nearby warnings;
- submit reports in Indian languages;
- attach text, voice, photo, video, and location evidence;
- request help;
- send an SOS;
- track the status of their report or SOS;
- receive alerts, responder updates, and corrections; and
- inspect or translate online information through the browser extension.

### Authority administrators

Authorized command-centre operators can:

- see incoming reports and SOS requests in real time;
- inspect original and translated evidence;
- review duplicate and misinformation indicators;
- inspect related published sources;
- assign responders;
- change an incident’s trust state;
- publish official alerts;
- publish corrections that supersede old alerts; and
- review the audit trail.

### Field responders

Responders receive assignments and can update their availability, acceptance, status, location, and estimated arrival information. These updates return to the authority and the relevant citizen.

## 5. Main Parts We Are Building

### 5.1 Citizen Android application

The Expo/React Native application is the primary citizen interface. It is map-first because disaster information is spatial: people need to know what is near them, whether it is official, and where nearby help is located.

The application contains:

- registration using name, phone, device identity, and preferred language;
- a map showing official alerts, facilities, and optional clearly labelled unverified reports;
- current weather and local safety context;
- a structured report form;
- photo, video, audio, voice, and location evidence capture;
- an offline report outbox;
- a press-and-hold SOS control with a cancellation countdown;
- report and SOS tracking;
- official alerts and corrections;
- nearby facilities such as hospitals and shelters;
- localized incident communities; and
- a nearby relay option using Android’s intentional system share flow.

### 5.2 Browser citizen application

The Next.js project includes a browser version of the citizen flow. It is useful during judging because the citizen and authority experiences can be demonstrated on the same local network even if an Android device or permission becomes unavailable.

### 5.3 Telegram bot

The Telegram bot provides another low-friction citizen channel. It supports commands for:

- conditions and alerts;
- nearby facilities;
- reports;
- SOS creation and cancellation;
- status tracking;
- community messages;
- language selection; and
- help.

Telegram reports can include text, photo, video, audio, voice, and shared location. They enter the same backend, trust, analysis, and authority workflow as reports from the Android application.

### 5.4 Authority command centre

The Next.js dashboard is the operational control surface for authorities. It includes:

- authenticated authority access;
- a map-based incident workspace;
- a priority queue with SOS requests shown first;
- incident records containing every original report;
- original and translated text;
- uploaded evidence and media metadata;
- duplicate and nearby-report signals;
- AI analysis and provider provenance;
- external fact-check and related-news links;
- five explicit trust states;
- responder assignment and status tracking;
- alert publication;
- correction publication;
- SMS/delivery controls; and
- an audit ledger.

### 5.5 BEACON Lens Chrome extension

The Chrome extension extends BEACON to information citizens encounter while browsing.

It has two main tools:

#### YouTube transcript and translation

1. The user opens a YouTube video.
2. The extension reads an accessible YouTube caption track.
3. It extracts caption and word timing information.
4. The transcript is displayed line by line with clickable timestamps.
5. The currently spoken word is highlighted during playback.
6. The user selects an Indian language.
7. The transcript is sent to the BEACON backend.
8. The backend uses Claude first and Gemini as a fallback for translation.
9. Caption boundary markers are preserved so translated lines remain synchronized.
10. If both providers fail, the original captions remain visible instead of being discarded.

API keys are never placed inside the extension. Claude and Gemini credentials remain in the backend’s ignored root `.env` file.

#### Screenshot fact check

1. The user opens an online news article, image, headline, or social-media post.
2. The user clicks **Select area on this page**.
3. A page overlay allows the user to drag over the relevant claim or image.
4. Chrome captures and crops only the selected visible region.
5. The screenshot is sent to the BEACON backend.
6. Claude reads and extracts the main checkable claim; Gemini is used if Claude fails.
7. The backend creates a search query for external verification.
8. Published fact-check reviews and related news coverage are retrieved when available.
9. The result is classified as Supported, Contradicted, or Unverified based on external evidence—not model confidence.
10. The extension shows the claim, explanation, provider, source links, and a human-review warning.

Screenshot jobs are stored in Chrome session storage so processing can continue even when the extension popup closes during area selection.

### 5.6 BEACON API and intelligence gateway

The active backend is a Fastify TypeScript API. It owns:

- authentication and authorization;
- report and evidence ingestion;
- translation and AI-provider fallback;
- personal-information redaction;
- duplicate detection;
- external verification;
- incident and trust-state management;
- SOS processing;
- assignments;
- alerts and corrections;
- delivery attempts;
- realtime events; and
- audit records.

The AI gateway records the provider, latency, validated output, errors, fallback path, and redaction categories. If all AI providers fail, the evidence remains stored as **Unverified** and is sent for human review.

## 6. Complete Step-by-Step Workflow

### Step 1: Citizen registration

The citizen enters their name, phone number, preferred language, and device information. The prototype creates an expiring device-bound session. OTP is intentionally not required for the local judge prototype so the workflow remains demonstrable without an SMS dependency.

### Step 2: Local safety context

The application requests the citizen’s location or accepts a manually selected map point. It loads:

- nearby official alerts;
- nearby hospitals and shelters;
- current Open-Meteo weather data; and
- OpenStreetMap geographic context.

Public views receive approximate incident areas. Exact citizen locations remain restricted to authorized operational workflows.

### Step 3: Creating a report

The report form is divided into clear stages:

1. describe the incident;
2. select hazard type and severity;
3. state the help required;
4. attach photo, video, audio, or voice evidence; and
5. confirm GPS coordinates or a manual location.

The original-language content is always retained.

### Step 4: Evidence validation and storage

The API validates the report, file type, number of files, and upload size. Every media file receives a SHA-256 hash. This hash helps protect integrity and identify reused or duplicate evidence.

Evidence is stored using the configured cloud media provider when available. If that provider fails, BEACON falls back to durable local storage and records the fallback reason.

### Step 5: Privacy protection

Before text is sent to a cloud AI provider, BEACON redacts:

- known citizen names;
- phone numbers;
- email addresses; and
- exact coordinate patterns.

The system records which types of personal data were removed without recording the removed value in the AI audit metadata.

### Step 6: Multilingual processing

The original text is preserved alongside a working translation. Claude and Gemini can be used through the backend AI gateway. Failure does not block the report; BEACON keeps and displays the original language for the authority.

### Step 7: Duplicate detection

BEACON checks whether the report belongs to an existing incident. It evaluates:

- hazard type;
- geographic distance using PostGIS `ST_DWithin`;
- configurable time window;
- normalized text similarity; and
- matching media hashes.

Location alone never causes an automatic merge. Related evidence may be grouped under one incident, but every original report remains preserved for authority inspection.

### Step 8: AI-assisted misinformation analysis

The AI gateway examines the redacted report and available signals. It can:

- summarize the evidence;
- identify risk or hazard terms;
- identify possible contradictions;
- flag suspicious or reused evidence;
- describe duplicate likelihood;
- compare available external verification; and
- recommend an initial trust state.

AI never directly publishes an alert and is never represented as a truth authority. Model confidence is operational metadata, not a public “truth percentage.”

### Step 9: External evidence search

BEACON searches for published ClaimReview fact checks when the Google Fact Check adapter is configured. It also searches GDELT for related recent news coverage.

The system distinguishes between different kinds of evidence:

- a published fact-check rating may support or contradict a claim;
- multiple news reports may provide corroborating coverage; and
- coverage volume by itself is not proof.

All retrieved sources remain clickable so an operator can inspect the publisher directly.

### Step 10: Incident creation or clustering

The new report either creates a fresh incident or becomes related evidence under an existing incident. Its initial public trust state is **Unverified**.

The incident is stored in PostgreSQL/PostGIS with its evidence, analysis, approximate public area, and exact restricted coordinates.

### Step 11: Realtime command-centre delivery

The API publishes an audience-scoped domain event through Redis Pub/Sub. Authenticated authority dashboards receive the new incident over WebSocket without refreshing the page.

Citizens receive only public information and updates belonging to their own report, SOS, or assignment. They cannot subscribe to another citizen’s precise location.

### Step 12: Human authority review

The authority opens the incident case file and reviews:

- the original report;
- the translation;
- media evidence;
- time and location;
- nearby reports;
- duplicate indicators;
- AI recommendation and provenance;
- external fact-check links;
- related news; and
- requested help.

The authority then selects an explicit trust action.

### Step 13: Trust-state decision

BEACON uses five trust states:

- **Unverified:** not yet confirmed;
- **Corroborated:** supported by related evidence but not officially approved;
- **Verified:** reviewed and approved by an authority;
- **Misleading:** contradicted, deceptive, or materially miscontextualized; and
- **Outdated:** previously relevant information that should no longer guide current action.

Only an authorized human can make an official verification or publication decision.

### Step 14: Responder assignment

If operational assistance is required, the authority assigns the incident to a responder. The assignment includes status, priority, relevant location, and response details. Responder acceptance and ETA updates are synchronized back to the authority and affected citizen.

### Step 15: Official alert publication

After verification, an authority can publish an official alert containing approved safety guidance. Official alerts use a separate data path and unmistakable visual treatment. Unverified reports never silently enter the official feed.

Delivery follows a fallback order:

1. authenticated in-app realtime;
2. configured push notification;
3. configured test-recipient SMS; and
4. queued store-and-forward retry.

Every delivery attempt is recorded in a ledger.

### Step 16: Correction and supersession

If the situation changes or an earlier alert becomes incorrect, the authority publishes a correction. BEACON does not silently edit the old alert. It marks it as superseded, links the correction, publishes the replacement, and redistributes the update through the same delivery channels.

This preserves public clarity and an accountable history.

## 7. SOS Workflow

SOS is intentionally separate from an ordinary report.

1. The citizen presses and holds the SOS control.
2. Hold progress reduces accidental activation.
3. A short cancellation countdown provides another safeguard.
4. The confirmed SOS immediately enters the authority priority queue.
5. The citizen’s permitted location can continue updating.
6. An operator assigns a responder.
7. Assignment, responder status, and ETA return to the citizen.
8. The SOS is closed only through an explicit cancellation or resolution action.

AI can assist an operator, but it can never reject, delete, or downgrade an SOS. Emergency assistance must not depend on model confidence.

## 8. Offline and Weak-Connectivity Behaviour

BEACON is designed to degrade honestly rather than pretend every service is available.

- The mobile application caches the latest safety context with a timestamp.
- Failed reports enter a local outbox and retry when connectivity returns.
- Original-language evidence remains available if AI translation fails.
- Evidence falls back to local durable storage if cloud upload fails.
- Alerts use a multi-channel delivery fallback.
- A PII-safe safety packet can be intentionally shared using Android’s system share sheet.

The current prototype does not claim automatic Bluetooth mesh networking. Automatic peer discovery and background device-to-device routing would require a signed native Android adapter and are future work.

## 9. Technical Architecture

```text
Android App / Citizen Web / Telegram Bot / Chrome Extension
                         |
                         v
                  Fastify REST API
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
 PostgreSQL/PostGIS   Redis Pub/Sub   AI Gateway
 incidents, users,   realtime, rate   Claude → Gemini
 spatial queries,    limits, queues   → safe fallback
 audit and delivery       |                |
        |                 v                v
        |          WebSocket clients   External verification
        |                            Google ClaimReview + GDELT
        v
 Local/Cloud media storage
```

### Active technology stack

- **Citizen mobile:** Expo and React Native
- **Authority dashboard:** Next.js and Tailwind/CSS
- **Browser extension:** Chrome Manifest V3, JavaScript, and service workers
- **API:** Fastify with TypeScript
- **Database:** PostgreSQL
- **Spatial processing:** PostGIS
- **Schema and queries:** Drizzle ORM
- **Realtime and shared counters:** Redis Pub/Sub
- **Maps:** OpenStreetMap
- **Weather:** Open-Meteo
- **AI providers:** Claude with Gemini fallback for extension workflows; additional provider/local fallback support exists in the main analysis gateway
- **External verification:** Google Fact Check Tools and GDELT
- **Media:** Cloud provider adapter with durable local fallback
- **Runtime:** Docker Compose

## 10. Data and Trust Separation

The most important product rule is that official truth is structurally separate from citizen claims.

BEACON stores different concepts separately:

- a **Report** is one citizen’s original evidence;
- an **Incident** groups operationally related reports;
- an **AnalysisRun** stores AI output and provider provenance;
- a **Verification decision** records an authority’s trust action;
- an **Assignment** connects an incident or SOS to a responder;
- an **Alert** is approved public guidance;
- a **Correction** supersedes an earlier alert;
- a **Delivery attempt** records where a message was sent; and
- an **Audit event** records consequential actions.

This prevents the system from treating a citizen submission, an AI suggestion, and an official alert as the same kind of information.

## 11. Security and Privacy

The prototype includes:

- expiring device-bound citizen sessions;
- expiring authority sessions;
- salted scrypt password hashes;
- bearer-token checks on protected actions;
- server-derived identity and ownership checks;
- authenticated and audience-scoped WebSockets;
- Redis rate limits;
- upload count, type, and size limits;
- SHA-256 evidence hashes;
- approximate public locations;
- restricted exact coordinates;
- personal-information redaction before cloud AI;
- secret and authorization-header log redaction; and
- API credentials stored only in an ignored root `.env` file.

The Chrome extension never contains Claude or Gemini keys. It communicates only with the BEACON backend.

## 12. Auditability and Human Control

Consequential actions record:

- actor;
- role;
- action;
- affected entity;
- timestamp;
- reason; and
- relevant structured details.

This includes verification decisions, emergency bypasses, alert publication, corrections, assignments, moderation, and delivery activity.

A privileged emergency bypass may be used when waiting for normal verification would create greater harm. It requires an explicit reason and remains visible in the audit trail.

## 13. What Makes the Solution Innovative

BEACON’s innovation is not a single AI model. It is the complete accountable workflow around uncertain information.

Key differentiators are:

- one system connecting reporting, verification, response, and public communication;
- explicit five-state trust instead of a simplistic true/false score;
- strict separation of unverified claims and official alerts;
- original-language preservation;
- multimodal citizen evidence;
- spatial, textual, temporal, and media-hash duplicate detection;
- AI-provider provenance and fallback history;
- human authority over official decisions;
- SOS that cannot be blocked by AI;
- visible corrections rather than silent edits;
- offline outbox and delivery fallback;
- audience-scoped realtime updates;
- browser-level YouTube translation and screenshot verification; and
- practical degradation when optional providers are unavailable.

## 14. How We Are Preparing the Prototype

### Phase 1: Core infrastructure

- Define PostgreSQL and PostGIS schemas.
- Create the Fastify API and Drizzle queries.
- Add Redis Pub/Sub and rate limiting.
- Containerize the API, dashboard, database, Redis, and Telegram bot.
- Seed only local authority accounts and facilities, not fake disasters.

### Phase 2: Citizen reporting

- Build citizen registration and device sessions.
- Build map and safety context.
- Add structured multilingual reporting.
- Add media and location evidence.
- Add offline queuing and retry.
- Add SOS safeguards and tracking.

### Phase 3: Intelligence pipeline

- Add PII redaction.
- Add multilingual translation adapters.
- Add spatial and textual duplicate detection.
- Add media hashing.
- Add Claude/Gemini AI analysis with validated JSON output.
- Add deterministic failure behaviour.
- Add Google Fact Check and GDELT evidence adapters.

### Phase 4: Authority operations

- Build authenticated authority login.
- Build the map, queue, and incident workbench.
- Display original evidence, translation, analysis, and sources.
- Add trust-state decisions.
- Add responder assignment.
- Add alerts, corrections, delivery ledger, and audit history.

### Phase 5: Additional access channels

- Connect the Telegram bot to the same backend workflow.
- Build the browser citizen simulator.
- Build BEACON Lens for YouTube transcripts and screenshot fact checking.
- Keep all AI credentials on the backend.

### Phase 6: Verification and demonstration

- Run API unit tests.
- Run TypeScript and production builds.
- Test PostgreSQL/PostGIS and Redis integration.
- Test report-to-dashboard realtime delivery.
- Test media fallback.
- Test AI-provider failure behaviour.
- Test mobile and browser workflows on the same LAN.
- Reset operational demo data before judging.

## 15. Judge Demonstration Flow

1. Open the citizen application and register in an Indian language.
2. View real map and weather context.
3. Submit a new report with text, evidence, and location.
4. Show the report appearing instantly in the authority dashboard.
5. Open the case file and show original text, translation, duplicate signals, AI provenance, and external sources.
6. Mark the incident as corroborated or verified.
7. Assign a responder.
8. Publish an official alert.
9. Show the citizen receiving the update in real time.
10. Publish a correction and show that the earlier alert is visibly superseded.
11. Demonstrate SOS as a separate high-priority flow.
12. Open a YouTube video and show a synchronized Indian-language transcript in BEACON Lens.
13. Capture an online claim with the extension and show the evidence-backed verification result.

If an optional cloud provider fails, the demonstration continues using original evidence, local storage, queued delivery, provider fallback, or human review.

## 16. Expected Impact

BEACON can help authorities:

- reduce duplicate-report workload;
- see emerging incidents faster;
- preserve local-language evidence;
- identify potentially misleading claims;
- coordinate responders from the same incident record;
- publish clearer authoritative alerts;
- distribute corrections visibly; and
- retain an accountable decision history.

Citizens gain a clear distinction between what someone has reported and what an authority has verified.

## 17. Pilot Success Metrics

A controlled pilot would measure:

- report-to-acknowledgement time;
- incident verification time;
- duplicate reduction;
- SOS assignment time;
- alert delivery success;
- correction delivery success;
- offline outbox recovery;
- false incident merge and split rate;
- operator workload;
- multilingual comprehension; and
- citizen understanding of official versus unverified content.

We would not claim lives saved without a proper field study.

## 18. Deployment Plan

### Phase 1: Controlled pilot

Deploy with one district authority, trained operators, selected responders, and test communication recipients.

### Phase 2: Approved integrations

Connect approved SMS and push providers, government feeds, official map sources, routing services, and verified identity onboarding.

### Phase 3: Multi-jurisdiction deployment

Add multi-district tenancy, formal MFA, role and jurisdiction policies, disaster recovery, observability, retention controls, load testing, and audited production onboarding.

## 19. Current Prototype Boundaries

The project is a working judge prototype, not a production emergency service. It does not claim:

- direct 112 integration;
- automatic peer-to-peer mesh networking;
- live government emergency-feed contracts;
- formal production MFA;
- nationwide authority onboarding;
- facial recognition;
- unrestricted production SMS or push delivery;
- completed security certification; or
- proven real-world life-saving outcomes.

These limitations are stated openly so the demonstration represents real implemented behaviour.

## 20. Final Summary

BEACON solves PS 70 by building a multilingual emergency-information pipeline in which citizen evidence is collected, protected, translated, clustered, analyzed, verified by authorized humans, connected to response operations, and converted into official alerts or corrections.

The central principle is simple:

> **AI assists the investigation, evidence supports the decision, and an accountable human authority controls what becomes official.**

This makes BEACON more than a misinformation detector. It is a complete crisis-intelligence and emergency-communication system designed to turn noisy local information into trusted, locally actionable response.
