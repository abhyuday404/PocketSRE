# Hackathon demo runbook

For the full real-repository → on-device fix → reviewed PR → live deployment story, use the [reviewer demo runbook](reviewer-demo.md). The short flow below uses the built-in synthetic demo service and is not a live deployment demonstration.

## Before presenting

1. Start the services with `pnpm dev:backend`.
2. Confirm `GET /health` on ports 4100 and 4200. `POST http://127.0.0.1:4200/checkout` should return 200.
3. Install an [internal Android APK](android.md#development-and-internal-testing) for a demo that starts without Metro or a model download. A development APK needs Metro. Complete the [device smoke checklist](android.md#device-smoke-checklist), then use USB/ADB forwarding or configure the LAN token as described in the README.
4. Verify **Connections**, refresh successfully, and confirm the **DEMO** badge. SAMPLE, CACHED, and IMPORTED are not live connections.
5. Reset the demo if needed, then analyze once. Confirm whether the UI reports deterministic rules or actual on-device inference; do not describe rules as an LLM.
6. If demonstrating GGUF inference, load and benchmark the exact model on the presentation device beforehand. The [recorded iQOO 15 smoke test](github-fixes.md#device-smoke-test-2026-09-12) verified CPU inference with Qwen3.5-4B Q6_K. GPU/NPU inference is not verified for this demo.

## Three-minute story

1. Show the healthy checkout API.
2. Tap **Simulate failure**. The controlled service returns HTTP 500 from `/checkout`; the incident collects synthetic commit, deployment, exception, database, and health evidence.
3. Tap **Analyze incident**. Explain the likely environment-variable mismatch and point to highlighted cited evidence cards.
4. Review the proposed rollback, its risk, target release, and confirmation dialog.
5. Approve once. Show verified green health and the action-history entry. `/checkout` returns 200 again.
6. Explain that this is a demo action, not a deployment-provider integration. Live connectors remain read-only.
7. Share a bundle as JSON, inspect it on a laptop, and import the investigation result. Capture the bundle before recovery if showing the failing configuration.

## Offline and failure cases

- Disable network access, refresh, and show that the cached bundle can still be analyzed. Recovery remains disabled for snapshots.
- Model load or validation failure automatically uses labelled deterministic triage.
- If an action times out, inspect history and refresh health before another approval. A missing response does not mean nothing happened.
- History retains five distinct snapshots per incident and up to thirty per gateway, import, or sample collection. Reopening a saved snapshot restores its matching analysis. Clearing saved data removes all local history and recovery copies across gateways; exported files remain separate.
- Keep a short device recording as a presentation fallback.

No background alerting, vendor-specific Office Kit integration, or production deployment rollback is claimed by this demo.
