# PocketSRE

PocketSRE is a phone-first incident triage and recovery assistant. It collects a compact incident bundle from operational tools, analyzes it locally on the phone, cites the evidence behind its conclusions, and offers only allowlisted recovery actions that require human approval.

## Workspace

```text
apps/mobile                  Expo + React Native phone app
services/gateway             Normalized API boundary for the phone
services/demo-service        Deterministic break/diagnose/recover target
packages/contracts           Runtime-validated shared schemas and types
packages/incident-engine     Redaction, correlation, prompts, fallback triage
tools/investigator-cli       Office Kit deep-investigation CLI
docs                         Architecture, security, and demo runbooks
```

## Requirements

- Node.js 22+
- pnpm 11+
- Android Studio/JDK for a native Android development build
- An Android arm64 device for `llama.rn` hardware acceleration

## Quick start

```bash
pnpm install
pnpm dev:backend
```

In a second terminal:

```bash
cp apps/mobile/.env.example apps/mobile/.env
pnpm dev:mobile
```

Set `EXPO_PUBLIC_GATEWAY_URL` to the computer's LAN address when testing on a physical phone. The demo service starts healthy. Create a controlled failure through the app, or call:

```bash
curl -X POST http://localhost:4100/v1/demo/break
```

The mobile app runs with deterministic local triage until `EXPO_PUBLIC_MODEL_PATH` points to a GGUF file on the device. `llama.rn` requires a native development build; it cannot run inside Expo Go.

## Useful commands

```bash
pnpm dev                # start every long-running workspace task
pnpm dev:backend        # gateway + demo service
pnpm dev:mobile         # Expo development server
pnpm typecheck
pnpm test
pnpm build
pnpm format
```

## Local model setup

Models are deliberately excluded from Git. Place a compatible quantized GGUF model on the device, set its `file://` URI in `EXPO_PUBLIC_MODEL_PATH`, and create a native development build:

```bash
pnpm --filter @pocketsre/mobile android
```

The AI implementation lives behind `LocalTriageEngine`, allowing the hackathon-provided Snapdragon runtime to replace `llama.rn` without touching product or connector code.

## Office Kit flow

Use the app's **Share incident bundle** action to copy a sanitized JSON bundle to the laptop through Office Kit. Then run:

```bash
pnpm investigator incident.json --output investigation-result.json
```

Return the result to the phone as additional evidence. See `docs/hackathon-runbook.md` for the complete demo sequence.
