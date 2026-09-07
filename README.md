# PocketSRE

Your incident-response desk, in your pocket. **SRE** stands for **Site Reliability Engineering**.

PocketSRE is a phone-first prototype that collects operational evidence, analyzes it locally, and proposes evidence-backed recovery with human approval. The demo is functional end to end; this is not a production operations platform yet.

## Implemented

- Android app with health, chronological evidence, cited diagnosis, approval dialogs, and action history.
- On-device GGUF inference adapter with validation and an automatic, clearly labelled deterministic fallback.
- Sanitized offline history, Secure Store connection credentials, JSON file sharing and investigation import.
- Authenticated gateway, stable incidents, approval freshness/version checks, idempotent actions, and a persistent action ledger.
- Controlled checkout regression: successful requests → HTTP 500s → approved rollback → verified healthy requests.
- Read-only GitHub commits/patches and Sentry issues alongside a normalized service-health endpoint.
- Laptop CLI for bundle checks and bounded repository environment-contract inspection.

## Workspace

```text
apps/mobile                  Expo + React Native Android app
services/gateway             Connectors and explicit action boundary
services/demo-service        Controlled break/diagnose/recover target
packages/contracts           Shared Zod schemas and TypeScript types
packages/incident-engine     Portable redaction, correlation, triage and validation
tools/investigator-cli       Laptop-side static investigation
docs                         Architecture, security, connections and demo runbook
```

## Run locally

Requires Node.js 22+, pnpm 11, and a JDK/Android SDK for native Android builds.

```bash
pnpm install
pnpm dev:backend
```

The gateway listens on `127.0.0.1:4100`; the isolated demo service uses port `4200`. Service commands load their own optional `.env` files, not the root example.

For a USB-connected Android device, use ADB forwarding:

```bash
adb reverse tcp:4100 tcp:4100
adb reverse tcp:8081 tcp:8081
cp apps/mobile/.env.example apps/mobile/.env
```

Set the phone's gateway URL to `http://127.0.0.1:4100` in **Connections**, then build and start the native app:

```bash
pnpm --filter @pocketsre/contracts build
pnpm --filter @pocketsre/incident-engine build
pnpm --filter @pocketsre/mobile android
```

For later JavaScript-only development, use `pnpm dev:mobile`. This project includes `llama.rn`, so use a native development build, **not Expo Go**. Android JavaScript export is automated; native APK compilation, device UI, and inference performance still need device verification.

For Wi-Fi, follow [LAN connection setup](docs/connectors.md#lan-connection): enable gateway LAN binding and configure a strong shared token. Do not expose the unauthenticated demo service. Use HTTPS or a secure tunnel outside trusted local development.

## Local AI

Without a model path, triage is deterministic and requires no download. To enable inference, provision a compatible quantized GGUF file on the device and set its local `file://` URI in `apps/mobile/.env` as `EXPO_PUBLIC_MODEL_PATH`. No model files belong in Git.

CPU inference is the default. `EXPO_PUBLIC_ACCELERATOR=gpu` or `npu` opts into experimental hardware paths; compatibility depends on the model, native runtime, and device. NPU acceleration and hackathon-organizer runtime integration are not verified. Load failures or invalid conclusions trigger the labelled fallback.

## Laptop investigation

Share a bundle from the phone, transfer it through Office Kit or another file-transfer app, then run:

```bash
pnpm investigator /path/to/incident.json --repo /path/to/service --output /path/to/result.json
```

Return the result file and use **Import incident or investigation file**. See [investigation scope and safety](docs/investigator.md).

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build          # shared/backend builds + Android JS export, not an APK
pnpm format:check
```

GitHub Actions is configured to run these checks on pushes and pull requests. [The demo runbook](docs/hackathon-runbook.md) covers the presentation flow.

## Optional Docker backend

Set a strong `GATEWAY_ACCESS_TOKEN` in your shell or an untracked root `.env`, then run `docker compose up --build`. Only the gateway is published, on loopback by default. `GATEWAY_BIND_ADDRESS` can explicitly enable LAN access. The action ledger uses a persistent named volume. This is a development image; Docker execution has not been verified on the development machine.

## Current limits

Live mode monitors one configured service and permits health checks only. GitHub/Sentry adapters are tested with mocked APIs, not real account credentials. Deployment-platform writes, database administration, background monitoring/push notifications, multi-user authorization, remote coding agents, and automatic fixes are not implemented. Demo evidence is deliberately synthetic; rollback changes the controlled service's state, not a real deployment.

See [architecture](docs/architecture.md), [live connectors](docs/connectors.md), and [security boundaries](docs/security.md).
