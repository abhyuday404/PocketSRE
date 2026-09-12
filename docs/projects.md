# Projects, deployment logs, agent, and alerts

Open **Overview → Your projects** or **Settings → Manage GitHub projects**. Connect GitHub, select repositories, and save a health endpoint for each. Open a project to link deployment logs, enable monitoring, or choose **Chat with this project's agent**.

## Gateway and GitHub setup

The gateway belongs to one owner. Its access token grants access to all connected accounts and projects; multi-user authorization is not implemented.

1. Register a GitHub App with **Device flow** enabled. Grant **Metadata: read**, plus **Contents: read** for agent source snapshots. Install it on the intended repositories. Supply `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_SLUG` to the gateway; these are public values. No client secret is needed.
2. Set a strong `GATEWAY_ACCESS_TOKEN` in a private process environment, and save it in the phone's Connections screen. Use HTTPS outside trusted local development.
3. Set `PROJECT_HEALTH_ORIGINS` to exact trusted deployment origins, comma-separated, such as `https://checkout.example,https://api.example`. The phone supplies the endpoint path. Redirects and URLs containing credentials or query parameters are refused.
4. Run `pnpm --filter @pocketsre/gateway dev`. The isolated reviewer-demo gateway does not enable these connections.

Alternatively, supply `GITHUB_PROJECTS_TOKEN` through a private environment outside the repository. Use a fine-grained token restricted to the intended repositories with the read permissions above. Discovery and source reads use this read-only connection. For approved draft PR publication, configure a separate `GITHUB_PROJECT_FIX_TOKEN` with **Contents: write** and **Pull requests: write**, limited to the intended repositories. Without that credential, source reading and drafting remain available and publication is disabled.

GitHub access and device tokens stay in gateway memory. Sign in again after restart or expiry; refresh-token persistence is not implemented. Disconnect cancels authorization and clears the session; it does not revoke the GitHub App installation. Environment credentials return after process restart. Repository metadata and source selections persist under `PROJECTS_PATH`; incident histories and action ledgers are separate per project.

See GitHub's [device authorization flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) and [repository discovery API](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).

## Vercel deployment discovery and logs

Vercel is the first supported project deployment provider. In a project's **Deployment and logs** section:

1. Enter a Vercel access token and optional team ID. Use the narrowest available scope for the intended projects/team. The token stays in gateway memory and is cleared from the phone form after submission. An administrator can instead supply `VERCEL_TOKEN` and `VERCEL_TEAM_ID` through a private environment.
2. Choose **Find Vercel projects**. Repository matches are labelled suggested; confirm the project and production/preview environment before linking. Other candidates can be selected explicitly when the provider lacks repository metadata.
3. Refresh project health to collect a bounded snapshot of build and runtime logs from the latest deployment in that environment. The agent also collects project evidence when preparing a request.

All provider calls are read-only. Log text is redacted before entering incident evidence. Missing permissions, unavailable logs, or collection errors become source-unavailable evidence; they do not imply that the project is healthy. Runtime streaming is sampled for up to five seconds with response/record limits. Log access and retention depend on provider permissions and plan. This implementation does not fetch an unlimited history or deploy to Vercel.

Endpoints follow Vercel's [project discovery](https://vercel.com/docs/rest-api/projects/retrieve-a-list-of-projects), [deployment listing](https://vercel.com/docs/rest-api/deployments/list-deployments), [build events](https://vercel.com/docs/rest-api/deployments/get-deployment-events), and [runtime logs](https://vercel.com/docs/rest-api/logs/get-logs-for-a-deployment) documentation. Other providers still need adapters; there is no universal automatic deployment-provider connection.

## Project agent and model selection

Open the agent from a tracked project. Configure up to 20 existing repository paths, then select up to three files per request. Ask questions, request a small feature, inspect the cited evidence, and review a patch before explicitly approving a draft PR. Source snapshots, approvals, and audit ledgers are isolated per project. Changing source selection discards earlier snapshots and approvals. Publication checks the repository head to reject stale edits.

The conversation appears above the composer. Import GGUF models in Settings, then select among imported models in the agent. Switching the model resets its current draft/conversation. Cloud models, unrestricted terminal execution, new-file creation, and durable conversation history are not implemented. The existing deterministic triage and separate offline Temp chat remain available. PR publication does not merge, deploy, or update a PC checkout; repository CI and the normal merge/deployment process remain necessary.

## Background monitoring and phone alerts

Enable background monitoring per project and keep the gateway running. It checks projects sequentially, then waits 30 seconds after the completed cycle. Slow endpoints and push retries extend the interval. Manual refresh also collects provider logs; background monitoring only probes availability.

Availability currently means HTTP status: 2xx is healthy, 5xx is down, and other responses or network failures are unknown. It does not infer business health from arbitrary JSON. Use a dedicated endpoint that returns a failure status when its checks fail. Two consecutive down observations open an alert; two healthy observations recover it. Unknown/degraded results break the consecutive streak without falsely recovering an open alert. Sustained outages do not generate a new notification on every check. A newly subscribed device receives future transitions, not a replay of existing outages.

Device subscriptions, debounce state, and the delivery outbox persist outside the source repository in `~/.pocketsre/monitor-<gateway-port>.json`. Protect this private file with the owner's OS account permissions; it contains push device tokens and is not encrypted at rest. Run one gateway process per ledger. Pausing monitoring or changing endpoints cancels queued alerts on the next cycle; already submitted notifications cannot be recalled. Delivery retries are bounded, jobs expire after 24 hours, and invalid device tokens are removed. A lost response can cause duplicate delivery. Expo acceptance is followed by receipt checks; receipts confirm handoff to the platform, not that a user read the notification.

### Enable actual Android push delivery

1. Configure an Expo EAS project and set its public UUID in `EXPO_PUBLIC_EAS_PROJECT_ID` in the build shell's environment. The native build workflow intentionally ignores dotenv files; setting only the mobile `.env` is insufficient for a bundled build.
2. Configure Firebase/FCM for the Android application ID of that build variant. Set `POCKETSRE_GOOGLE_SERVICES_FILE` to the absolute path of its private `google-services.json` **outside this repository**. Configure the matching FCM v1 service-account credential in EAS; never commit either file.
3. Rebuild the native app (`pnpm android:debug` or your intended build variant) and install it. The previous APK lacks the notifications native module; a JavaScript reload alone is insufficient. The build must include the configured public EAS project ID.
4. Enable background monitoring, then **Enable alerts on this phone** and grant Android notification permission. If Expo push access-token security is enabled, set `EXPO_PUSH_ACCESS_TOKEN` on the gateway privately.
5. Validate an actual outage and recovery on a physical device, with the app foregrounded, backgrounded, and closed. A notification tap opens the project only when its saved gateway identity matches the current connection.

Follow Expo's [push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) and [tickets/receipts guidance](https://docs.expo.dev/push-notifications/sending-notifications/). EAS/FCM credentials and real-device delivery were not configured or verified during this implementation; provider and push automated tests use fixtures.

## Remaining production work

Encrypted durable account credentials and renewal, per-user authorization, more provider adapters, scalable monitoring/delivery workers, notification delivery visibility in the app, durable chat history, and physical-device/account validation remain. Monitor errors and missing provider data must be investigated rather than interpreted as successful checks.
