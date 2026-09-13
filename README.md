# PocketSRE

Your incident-response desk, in your pocket. **SRE** stands for **Site Reliability Engineering**.

PocketSRE is a phone-first prototype that collects operational evidence, analyzes it locally by default or through an optional user-configured API model, and proposes evidence-backed recovery with human approval. The demo is functional end to end; this is not a production operations platform yet.

## Implemented

- Android app with health, chronological evidence, cited diagnosis, approval dialogs, and action history.
- On-device GGUF inference adapter with validation and an automatic, clearly labelled deterministic fallback.
- Sanitized offline history, Secure Store connection credentials, JSON file sharing and investigation import.
- Authenticated gateway, durable live incidents and accumulated evidence, approval freshness/version checks, idempotent actions, and a persistent action ledger.
- Controlled checkout regression: successful requests → HTTP 500s → approved rollback → verified healthy requests.
- Read-only GitHub commits/patches and Sentry issues collected independently of health failures, with explicit unknown health and collection availability.
- Laptop CLI for bundle checks and bounded repository environment-contract inspection.
- On-device patch drafting with source review and an opt-in GitHub draft-PR action boundary. See [GitHub fixes](docs/github-fixes.md).
- GitHub App device sign-in, paginated repository selection, saved projects, and separate HTTP availability checks in **Your projects**. See [project setup and current boundaries](docs/projects.md).

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

Requires Node.js 22, pnpm 11.24.0, and a JDK/Android SDK for native Android builds.
See the [Android build and release guide](docs/android.md) for the pinned toolchain,
clean install, self-contained internal APK, signing setup, and device smoke checklist.

```bash
pnpm install --frozen-lockfile --prefer-offline --network-concurrency=1 --child-concurrency=1
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
pnpm android:debug
adb install -r artifacts/android/pocketsre-debug.apk
pnpm dev:mobile
```

Open **PocketSRE development** and select the Metro server. For later JavaScript-only development, use `pnpm dev:mobile`. This project includes `llama.rn`, so use a native development build, **not Expo Go**. `pnpm android:internal` creates a separate APK with bundled JavaScript for cold starts without Metro or a model download. Native CI is configured separately from JavaScript export; installation, device UI, production signing, and inference performance require their own validation records.

For Wi-Fi, follow [LAN connection setup](docs/connectors.md#lan-connection): enable gateway LAN binding and configure a strong shared token. Do not expose the unauthenticated demo service. Use HTTPS or a secure tunnel outside trusted local development.

## Local AI

**Settings → AI model** lets you keep an on-device model or opt into OpenAI, Anthropic, Gemini, OpenRouter, or an OpenAI-compatible API using your own key. The selection applies to analysis, code assistance, and chat. Keys stay in secure phone storage; cloud prompts and selected context go directly to the chosen provider. See [API model setup and data handling](docs/api-models.md).

For a short, hands-on presentation with a one-line regression and phone-approved local deployment, see the [five-minute demo](docs/five-minute-demo.md). Start its isolated services with `pnpm demo:reviewers`.

Without a model, triage is deterministic and requires no download. To enable inference, open **Settings → On-device model**, choose an option from the dropdown, and select **Use** after verification finishes. The catalog includes Qwen3 0.6B (397 MB), Qwen2.5-Coder 0.5B (491 MB), and Qwen3 1.7B (1.11 GB), Qwen2.5-Coder 1.5B (1.12 GB), and Qwen3 4B (2.50 GB). The same dropdown includes importing your own GGUF file and returning to local rules. See [on-device models](docs/on-device-models.md) for sources, storage, and recovery behavior. For development, a local `file://` URI in `EXPO_PUBLIC_MODEL_PATH` remains supported when no device model setting is saved. No model files belong in Git. The [GitHub fix flow](docs/github-fixes.md) uses the same local model for bounded patch drafting.

Use **Agent** for free-form repository requests: explain code, add a small feature, or improve a function in selected existing files. Follow up in the conversation, review proposed edits, and approve a draft PR. A live gateway with GitHub fixes configured is required for source reads and publication. See the [Agent workflow and current limits](docs/github-fixes.md#agent-tab-repository-requests).

For direct model testing, open **Agent → Temp chat** after importing a GGUF model. Chat works offline without a gateway or repository. It sends your conversation through the model's chat template with no app-added system prompt, evidence requirement, JSON schema, or tools. Replies stream as text; **Stop generating** cancels a reply and **Clear chat** erases the in-memory conversation. Chat is never saved to disk or sent to the gateway. Restarting the app or changing the model also clears it. The model's own behavior still applies; the 8K runtime context reserves room for replies of up to 2,048 tokens. Clear or shorten a conversation if it exceeds the input budget.

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
pnpm build          # shared/backend/CLI builds
pnpm export:android # Android JavaScript export only, not an APK
pnpm format:check
```

GitHub Actions is configured to run these checks on pushes and pull requests. A separate Android workflow compiles debug and internal APKs for relevant changes; it does not run device tests. [The demo runbook](docs/hackathon-runbook.md) covers the presentation flow.

On Windows, only the investigator's file-symlink regression is skipped if creating its fixture fails with a privilege error. Its ordinary environment-contract checks always run; Linux CI requires the symlink regression too.

## Optional Docker backend

Set a strong `GATEWAY_ACCESS_TOKEN` in your shell or an untracked root `.env`, then run `docker compose up --build`. Only the gateway is published, on loopback by default. `GATEWAY_BIND_ADDRESS` can explicitly enable LAN access. The action ledger and live incident store use a persistent named volume. This is a development image; Docker execution has not been verified on the development machine.

## Current limits

The [Projects workflow](docs/projects.md) supports GitHub repository selection, Vercel log discovery, project-scoped agent requests, background availability checks, and an outage/recovery push pipeline. Actual Android push needs EAS/FCM credentials and a native rebuild. Vercel access and phone delivery still require live account/device validation. The original live-service mode remains available.

Deployment-platform writes, database administration, multi-user authorization, remote coding agents, automatic merging, and automatic production deployment are not implemented. Approved agent edits create draft PRs; they do not change a PC checkout. Demo evidence is deliberately synthetic; rollback changes the controlled service's state. Model output and live provider permissions require device/account validation in addition to mocked connector tests.

See [architecture](docs/architecture.md), [live connectors](docs/connectors.md), and [security boundaries](docs/security.md).
