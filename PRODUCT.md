# BEACON

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Expo/React Native for the Android citizen app, Next.js with Tailwind for the authority dashboard, and a Fastify API using Drizzle ORM, PostgreSQL/PostGIS, and Redis. Docker Compose is the canonical local runtime. The earlier FastAPI/SQLite implementation remains only as a legacy fallback reference.

## Users

- Citizens in and around an emerging crisis who need trusted local guidance, a low-friction way to report evidence, and an emergency channel that continues to work through weak connectivity.
- Authority administrators who verify evidence, cluster incidents, coordinate responders, publish corrections, and retain an audit trail.
- Field responders who receive assignments, share status and location, and corroborate reports.

## Product Purpose

BEACON turns multilingual citizen evidence into human-governed, locally actionable crisis intelligence. Success means a new live report or SOS can move from a citizen's phone to the command centre, through review or audited emergency bypass, to assignment and an official alert or correction without confusing unverified claims with verified guidance.

## Positioning

BEACON combines multilingual reporting, duplicate and misinformation analysis, explicit five-state trust, human authority control, community coordination, and delivery fallback in one traceable incident workflow.

## Operating Context

The judge demonstration runs on an Android phone and desktop connected to the same local network. It creates a fresh report in an isolated demo tenant using current weather and map context. Connectivity, permissions, and optional AI or messaging credentials may fail during the demo.

## Capabilities and Constraints

- Citizen registration uses name and phone without OTP for the prototype, with a device session and abuse controls.
- English, Hindi, Chhattisgarhi, Bengali, Marathi, Gujarati, Punjabi, Tamil, Telugu, Kannada, Malayalam, and Odia are available across the citizen app and Telegram. BHASHINI translates report content when configured; original-language content is always retained if translation is unavailable.
- Reports may include text, voice, photo, video, GPS or a manual pin, hazard type, severity, and requested help.
- Trust states are `Unverified`, `Corroborated`, `Verified`, `Misleading`, and `Outdated`; only official content appears in the authoritative feed.
- SOS uses press-and-hold plus a cancellation countdown and is never rejected or discarded by AI.
- Cloud AI calls remove names, phone numbers, and precise coordinates; Gemini falls back to Groq and then deterministic local analysis.
- Delivery order is in-app realtime, configured push, configured MSG91 SMS, then queued store-and-forward.
- Direct 112 integration, peer-to-peer mesh, nationwide onboarding, government feed contracts, formal MFA, facial recognition, and a volunteer marketplace are deferred.
- This is a judge prototype, not a publicly deployable emergency service. Outbound communication is restricted to test recipients.

## Brand Commitments

The product name is BEACON. The interface must feel like a calm civic command system: navy and teal foundations, neutral surfaces, amber and red reserved for severity, unmistakable trust badges, and native Android behavior. Supplied visual references are evidence at `ui-app/overall.png`, `ui-app/SOS.png`, `ui-dashboard/dashboard base.png`, and `ui-dashboard/db2.png`; `ui-app/logo.png` is the supplied lighthouse-and-shield mark.

## Evidence on Hand

- Crisis-intelligence architecture diagram at `idea/architecture1.png`.
- Supplied mobile and dashboard references listed above.
- No live government feed, production credentials, testimonials, performance claims, or pre-seeded disaster data are available and none may be fabricated.

## Product Principles

- Official truth stays visually and structurally separate from unverified claims.
- AI assists analysis; authorized humans control official decisions. External verification links Google Fact Check results when configured and related GDELT news coverage without presenting coverage volume or model confidence as proof.
- Emergency action remains usable when providers or connectivity fail.
- Precise location is protected and shared only where operationally required.
- Every consequential authority action is explainable and auditable.

## Accessibility & Inclusion

Use 48dp touch targets, scalable type, screen-reader labels, keyboard support on the dashboard, reduced-motion behavior, non-color status cues, and plain-language safety guidance in all supported languages.
