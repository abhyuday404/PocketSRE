# Hackathon demo runbook

## Before presenting

1. Start the demo service and gateway with `pnpm dev:backend`.
2. Confirm `GET /health` on ports 4100 and 4200.
3. Open the phone app and confirm it can reach the gateway.
4. Reset the service to the healthy `rel-2026.09.1` release.
5. Confirm the model mode shown in the app.
6. Prepare a sanitized cached incident as a network fallback.

## Three-minute story

1. Show the healthy checkout service.
2. Tap **Inject demo regression**.
3. Refresh and open the new critical incident.
4. Run on-device triage.
5. Show that each conclusion opens supporting evidence.
6. Ask for the safest recovery action.
7. Confirm rollback to the last healthy release.
8. Show the health check return to green.
9. Share the incident bundle through Office Kit and briefly explain the laptop deep-check loop.

## Failure fallback

- If the model cannot load, switch to the labelled deterministic engine and continue.
- If the network is unavailable, analyze the cached bundle and state that health may have changed.
- If rollback is slow, show its audit entry and poll the health endpoint manually.
- Keep a short screen recording as the final fallback, not the primary demo.
