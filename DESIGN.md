# BEACON design system

<!-- impeccable:design-schema 1 -->

## Direction

BEACON is a contemporary Indian public-infrastructure field console. It takes its discipline from transit wayfinding, survey maps, field notebooks, and control-room switchboards: clear bands, direct labels, strong alignment, and visible operating state. It must look designed by a civic product team, not generated from a dashboard template.

The citizen path is `locate → understand → report or request help → track`. The authority path is `scan → inspect → verify → communicate → respond`. Maps are stable work surfaces, not hero decoration. Forms are sequential field records, not a cloud of chips and cards.

The approved product mark is `ui-app/logo.png`: a white lighthouse, broadcast arcs and India silhouette on a black field. Use this exact raster for dashboard, citizen app, launcher, splash and browser identity.

## Color roles

- Control charcoal `#111820`: navigation, primary controls, strong information bands and analysis provenance.
- Signal cyan `#007F8B`: live connectivity, selected navigation, verified information and active location.
- Mineral white `#FFFFFF` and field ground `#F1F3F1`: reading and working surfaces.
- Structural gray `#C8D0CF`: dividers, fields and inactive controls.
- Safety yellow `#F0C34B` / text-safe amber `#A87500`: attention, queued work and report creation.
- Emergency red `#C93138`: active SOS and critical danger only.
- Ink `#111820` and secondary ink `#53616B`: primary and supporting copy.

No gradients, decorative glass, colored glow, random pastel cards, or color without a text/icon status cue.

## Typography

- Manrope Variable is the web operational face. Native uses the Android system face for platform familiarity and performance.
- Titles are direct, compact and sans-serif; the old editorial serif voice is retired.
- Tabular operational values use lining numerals.
- Uppercase is limited to short field labels and state annotations.

## Structure

- Web uses a charcoal navigation rail, white top work bar, dark live-status band, stable map/case workspace and narrow incident rail.
- Mobile uses a 47% map workspace, a hard boundary into scrolling safety content, and one charcoal bottom command strip.
- Panels use 8–12px radii and either a divider or shadow, never both.
- Desktop rhythm is 4/8/10/14/18/24px. Mobile rhythm is 4/8/12/16/20/24px with 48dp minimum targets.
- Repeated content uses rows, ledgers and indexed lists rather than equal card grids.

## Core components

- Trust badge: dot plus one of `Unverified`, `Corroborated`, `Verified`, `Misleading`, `Outdated`.
- Incident workbench: persistent incident index beside the selected case file; selection never routes back to Overview.
- Case file: location map and coordinates, source report, translation, uploaded evidence, five-stage verification, linked external sources, assignment and authority actions.
- SMS console: title, 280-character safety message, explicit provider/readiness state, configured test-recipient count and realtime delivery ledger.
- Delivery ledger: in-app, push, SMS and store-and-forward attempts with channel, outcome, detail and time.
- Mobile report record: three numbered sections—describe incident, set urgency/help, add evidence/location.
- Nearby relay: exports a PII-safe cached safety pack through Android Quick Share, which can use Bluetooth or Wi‑Fi Direct.
- SOS: dedicated hold control, numeric cancellation window, live location and responder state. It is never visually merged with ordinary report creation.

## Responsive and accessibility

- At 1180px web navigation collapses to icons. At 880px it becomes bottom navigation and operational regions stack. At 620px case file, source correspondence and actions become single-column.
- Native supports portrait phones, font scaling, dark/light system themes and safe-area insets.
- Controls meet 48dp touch targets on native and visible keyboard focus on web.
- Loading, offline, queued, error, empty, disabled and success states remain textual.
- Reduced motion removes the repeating SOS scale effect without removing hold progress.

## Connectivity truth

- Wi‑Fi/local network: authenticated WebSocket realtime plus REST retry/outbox synchronization.
- Bluetooth/Wi‑Fi Direct in Expo Go: user-confirmed Android Quick Share handoff of an offline safety pack.
- Automatic encrypted peer discovery belongs to a custom Android development build using Nearby Connections; UI must not claim that capability when the native adapter is absent.
- SMS uses the audited MSG91 adapter and only configured test recipients. Missing credentials produce an honest queued/store-and-forward state.

## Mobile citizen application — current

**Creative north star: “The Civic Field Brief.”** The current citizen path is `understand → report or request help → track → inspect affected areas`. Home is a calm, map-free data dashboard for conditions, connection state, report delivery, SOS, official alerts, affected-area count, emergency actions, verification progress, and nearby facilities. Maps are task-specific work surfaces, not hero decoration.

### Mobile palette and type

- Midnight Command `#07133F`: brand, weather band, high-emphasis information.
- Royal Action `#2439C9`: primary actions, active navigation, verified operating state.
- Periwinkle Signal `#728EED` and Pale Safety Blue `#A6C9EE`: dark-theme actions and supporting emphasis.
- Field Ground `#F6F8FC`, Mineral White `#FFFFFF`, and Structural Blue Gray `#D6DFED`: backgrounds, working surfaces, and dividers.
- Emergency Red `#C52E42` is reserved for SOS/critical danger; Attention Amber `#9A6700` marks warning or queued work.
- Dark mode uses `#050A1F` background, `#0B1538` surfaces, and `#121F49` secondary surfaces.

Native type uses Arial on iOS/web and Android sans-serif as a reliable Arial-compatible fallback. The scale is display 32/37; headlines 25/30 and 21/26; titles 18/23 and 15/20; body 15/22, 13/19, and 11/16; labels 13/18, 11/15, and 10/14. Use tabular numerals for operating counts and uppercase only for short eyebrows.

### Mobile hierarchy

1. Home: identity, live state, language, safety headline, weather, citizen metrics, report/SOS, verification journey, facilities.
2. Alerts: authoritative guidance with a clearly separated unverified-claims summary.
3. Community: searchable approved-room inbox and WhatsApp-like room with official labels, translated display text, and original-language toggle.
4. Profile: language, device readiness, outbox, privacy, and nearby relay.
5. Quick actions: Report, Heatmap, News, and SOS.
6. Heatmap: authority-only affected-area map, legend, approximate-location label, and indexed briefing sheet.
7. News: official alert and correction briefs.
8. Report: one scrollable record divided into `01 Describe`, `02 Urgency`, and `03 Evidence and location`.

### Navigation and motion

A 58dp floating pill contains Home, Alerts, Community, and Profile; only the active destination reveals its label. A separate 58dp plus opens a 2×2 action panel. The panel animates opacity `0→1`, translation `18→0`, and scale `.94→1`; the plus rotates `0→45°`. Reanimated uses damping `17`, stiffness `190`, and mass `.8`. Reduced-motion mode changes state immediately.

### Mobile component rules

- Report hazards use exact disaster-category SVG exports. Selection combines border, background, label, and checkmark, never color alone.
- Community aligns the current citizen’s messages right and other messages left. Authority messages always carry `OFFICIAL`; translations name the display language and preserve the original.
- Only authority-verified areas appear in the principal heatmap. Exact citizen coordinates remain private.
- Ordinary content stays flat; elevation is reserved for floating navigation, action panel, map labels, modal sheets, and transient notices.

### Disaster icon provenance

Disaster SVGs are exact exports from the Figma community file [Disaster Management UI Icon Pack — DMUIP](https://www.figma.com/design/nRQDrGO7sNG5RDkDdjEgSE/Disaster--Management-UI-Icon-Pack---DMUIP--Community-?node-id=2-77), frame `2:77`, retrieved through the Figma MCP. They live in `apps/mobile/assets/disaster/`; preserve their aspect ratios and internal status colors.

### Mobile accessibility guardrails

- Maintain 48dp interactions; smaller visible controls require sufficient hit slop.
- Preserve all four primary navigation icons under font scaling; hide the active label before clipping an icon.
- Validate at 130% font scale without fixed-height clipping.
- Provide roles, labels, selected/expanded state, and non-color status descriptions.
- SOS remains press-and-hold with textual state and visible progress.
