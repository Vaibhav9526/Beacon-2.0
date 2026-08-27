# BEACON design system

<!-- impeccable:design-schema 1 -->

## Direction

BEACON is a modern lighthouse watch desk with two expressions. The authority floor combines the supplied warm civic identity with the cleaner municipal workspace structure demonstrated by the RaipurOne dashboard reference: collapsible navigation, a white sticky work header, neutral status summaries, a header-above-map frame, functional map filters, and progressive AI detail. The citizen client follows the supplied peach/coral mobile reference with white cards and compact rounded rows. Maps carry spatial truth in both, while red remains exceptional for an active emergency.

The approved product mark is `ui-app/logo.png`: a white lighthouse, broadcast arcs and India silhouette on a black field. Use this exact raster for the dashboard, citizen app, launcher icon, splash identity and browser icon; do not redraw or substitute the lighthouse symbol.

## Color roles

- Watch-floor navy `#0B2B42`: navigation, analysis provenance, and primary action.
- Signal teal `#087F73`: live connection, verified information, location, and safe action.
- Citizen coral `#F26F4C`, peach `#F8B89E`, and soft peach `#FFF0E9`: native headers, selected controls, the report FAB, and friendly emphasis. Coral does not encode verification.
- Warm paper `#F6F5EF` and surface `#FFFEFA`: long-session working backgrounds.
- Amber `#C97817`: unverified or elevated risk only.
- Red `#BD3B34`: active SOS and critical danger only.
- Ink `#102B42`, muted `#63727B`, and line `#D8DDD8`: copy, supporting text, and separation.

Status must never rely on color alone. Every status pairs color with a word, icon, or both.

## Typography

- Manrope Variable is the operational face for controls, labels, body copy, and dense data.
- Newsreader Variable is the human voice for screen and panel titles.
- Tabular operational values use lining numerals. Labels use restrained uppercase tracking only when they behave like instrument annotations.

## Shape, depth, and spacing

- Working panels use 12–14px radii; compact status controls may be pills.
- Elevation is a soft navy-tinted shadow with a visible vertical offset. A panel uses either an outline or a shadow, not both.
- Compact desktop density uses 8/12/16/24px spacing; mobile uses 8/12/18/24px with 48dp minimum targets.
- The map remains visually dominant. Dashboard evidence and response controls are attached workspaces; the citizen experience uses a rounded safety sheet over the lower map edge.
- Authority utilities open as full working canvases beside the persistent navigation rail. Incidents, SOS, communities, broadcasts, audit, and delivery history use compact rows and tables rather than dashboard-card grids.

## Components

- Trust badges: `Unverified`, `Corroborated`, `Verified`, `Misleading`, and `Outdated`, each with a dot and text.
- Priority queue: SOS first, then severity, trust, and recency. Every item includes a plain-language reason for its position.
- Evidence workspace: original content, working translation, requested help, and source time occupy the warm evidence card. The adjacent blue analysis console is explicitly `Advisory only` and presents a five-stage review path: evidence received, language normalized, AI screening, external source check, and authority decision. A correspondence section separately reports Google Fact Check availability, related reporting, source links, last-check time, and the human decision owner. Trust, assignment, bypass, and publication remain human controls in a separate bottom bar.
- Protected bypass confirmation: verification bypass always interrupts with a focused modal, explains the consequence, requires an operational reason, and names the identity, reason, and timestamp that will enter the immutable audit trail. The red confirmation is reserved for the final consequential action; the safe exit remains visually quieter.
- Delivery ledger: treat each outbound alert or correction as an ordered series of channel attempts, not a single sent/not-sent flag. Show channel, outcome, detail, and time for in-app realtime, configured push, configured SMS, and queued store-and-forward; `queued` is a durable delivery state, not an error.
- Map runtime: dashboard and native maps use OpenStreetMap semantics. Native renders Leaflet tiles and markers inside a WebView, including the manual-pin editor, so the demo does not depend on Google Maps authorization. Preserve attribution and never imply offline tile availability.
- Dashboard map filters: `All`, `Verified`, `Under review`, and `SOS` are real layer controls with visible counts and pressed state. The map heading sits outside the tile canvas so controls never obscure spatial evidence.
- Trust layers: teal means official or verified, amber means citizen evidence under review, navy marks verified facilities, coral marks the citizen's private position, and red means SOS. Every layer also has a text label; official alert cards remain structurally separate from unverified map claims.
- Mobile safety sheet: peach/coral controls and white cards sit over the map; greeting, weather risk, official alerts, Report, SOS, the compact report-verification journey, and nearby help appear in that order. Map chrome is limited to one top control dock and one combined location/layer dock.
- Permission-off state: when precise location is denied, keep the map and cached safety context usable, omit the private-position marker, and say `Approx. area · location off`. Camera and microphone denial use plain-language system alerts and leave text/manual-pin reporting available.
- Report is the single FAB. SOS is a wide, dedicated hold control.
- Snackbar communicates transient success, failure, queued state, automatic retry, and reconnect outcomes. Native queued reports and SOS requests retry without asking the citizen to resubmit; realtime alert and dispatch changes update the current state in place.
- Active SOS banner: a persistent red response strip replaces transient feedback after activation. It shows request status, responder ETA or live-location sharing, and a textual five-second cancellation countdown before settling to a plain Cancel action.

## Responsive behavior

- Desktop: 224px navigation rail, a map/evidence column, and a 350px priority rail. The evidence workspace is a 235px incident header beside paired evidence/provenance cards and a full-width decision bar.
- At 1180px the authority rail collapses to icons while the analysis console moves below citizen evidence and remains available. At 880px navigation moves to the bottom and map, queue, and evidence stack vertically. At 620px evidence, verification correspondence, sources, and actions become single-column.
- Citizen native: portrait map occupies about 43% of the viewport and the safety sheet scrolls above persistent five-destination navigation with one central Report FAB. Safe-area insets, keyboard avoidance, and 48dp targets are mandatory.
- Citizen browser simulator remains capped at 460px and follows the same map/sheet hierarchy.

## Motion and accessibility

- The only repeating authored motion is the hold-to-SOS pulse. All other state changes use native or immediate transitions.
- `prefers-reduced-motion` removes the SOS scale animation without removing the hold requirement or textual progress.
- Focus rings use amber with 3px width; contrast meets WCAG AA for body copy; keyboard and screen-reader names are required for icon controls.
- Every native interactive target is at least 48×48dp, including language choices, map controls, navigation destinations, evidence tools, SOS cancellation, and modal dismissal; use padding to enlarge the hit area without forcing every icon to appear oversized.
- SOS must expose both phases without relying on motion: hold progress before activation, then the numeric cancellation countdown after activation. Realtime and retry state changes must also remain explicit in text for screen readers and weak-connectivity use.
- Native light and dark themes use semantic surface, text, outline, coral, teal, amber, and error roles rather than an inverted screenshot. Map labels, floating controls, sheets, fields, and status messages must remain legible in both themes.
- All 12 supported language choices use horizontally scrollable or wrapping controls, and translated content must tolerate increased font scale without fixed-height text containers.
- The analysis workspace separates model output from external-source verification. Every source exposes publisher, evidence type, rating when available, a safe outbound link, check time, and an explicit human-decision warning.
