# Paired surface compositions

These three paired compositions were used to define and cross-check the implemented visual system.

## 1. Quiet watch

- Citizen: current-location map, calm-area statement, live weather strip, Report and hold-to-SOS, then verified facilities. No incident content is seeded.
- Authority: empty operational map with facilities, live provider state, and a priority-queue empty state that points to the citizen test flow.

## 2. Evidence arrives

- Citizen: an unverified claim appears only on the optional amber map layer; the submission receipt explains that review is underway.
- Authority: one incident is selected in the priority rail. Original evidence, local-analysis provider, privacy handling, trust state, and authority actions are visible together.

## 3. Response in motion

- Citizen: an official alert is visually separated from map claims; active SOS shows responder status and cancellation.
- Authority: SOS leads the queue, the incident is verified or bypassed with a reason, responder assignment is active, and Publish alert becomes available.

The implemented `/citizen` and `/` routes are the high-fidelity executable comps; the Expo app carries the citizen composition onto Android.

