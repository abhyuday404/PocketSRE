# Projects, deployment logs, agent, and alerts

The app opens on **Projects**. Imported GitHub repositories appear in a horizontal carousel, with an **Add project** card at the end. Disconnected accounts see **Connect GitHub** with a bundled GitHub logo. A gateway without GitHub device-flow configuration explains the missing setup and links to connection settings.

Choose **Add project**, search the repositories available to your GitHub account, and select **Import**. Importing opens that project's workspace immediately. Tap any existing project card to return to its settings:

- **Health:** configure its endpoint and refresh incident evidence.
- **Deployment:** connect Vercel and link this project's deployment and environment. The Vercel account connection is shared; deployment links are per project.
- **Alerts:** configure background monitoring and this phone's notifications.
- **Source files:** choose repository paths available for agent analysis.

**Analyze with project agent** opens the agent with that repository and its saved source selection. **Back to projects** returns to the carousel. The original incident demo is available through **Explore the demo workspace**. **Settings** keeps local model and device-storage controls first, with a collapsed **Server connection** editor at the bottom. See [wireless setup](wireless.md) for using the PC without USB.

Project cards show configuration state, not a claim of live health. Refresh the project's health or monitoring status to obtain an observation. Saved projects remain accessible when GitHub is disconnected; repository operations still require valid GitHub access.

## Gateway and GitHub setup

The gateway also loads optional private configuration from `~/.pocketsre/gateway.env`. Keep gateway and provider credentials there, outside the checkout, with file permissions restricted to the owner. Existing process or service `.env` values take precedence.

The gateway belongs to one owner. Its access token grants access to all connected accounts and projects; multi-user authorization is not implemented.

1. Register a GitHub App with **Device flow** enabled. Grant **Metadata: read**, plus **Contents: write** for confirmed PR merges and **Pull requests: read**, **Checks: read**, and **Commit statuses: read** for review. Contents read alone supports source browsing but cannot merge. Install it on the intended repositories. Supply `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_SLUG` to the gateway; these are public values. No client secret is needed.
2. Set a strong `GATEWAY_ACCESS_TOKEN` in a private process environment, and save it in the phone's Connections screen. Use HTTPS outside trusted local development.
3. Set `PROJECT_HEALTH_ORIGINS` to exact trusted deployment origins, comma-separated, such as `https://checkout.example,https://api.example`. The phone supplies the endpoint path. Redirects and URLs containing credentials or query parameters are refused.
4. Run `pnpm --filter @pocketsre/gateway dev`. The isolated reviewer-demo gateway does not enable these connections.

Alternatively, supply `GITHUB_PROJECTS_TOKEN` through a private environment outside the repository. Use a fine-grained token restricted to the intended repositories with the permissions above. Discovery and source collection remain GET-only; confirmed PR merging uses the explicit action endpoint. For approved draft PR publication, configure a separate `GITHUB_PROJECT_FIX_TOKEN` with **Contents: write** and **Pull requests: write**, limited to the intended repositories. Without that credential, source reading and drafting remain available and publication is disabled.

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

The Agent tab opens a chat interface with the project name at the top. Tap that header to switch among imported projects or open a temporary chat. Each project restores its latest saved conversation, including after an app restart. Changing models keeps the conversation. Tap the clock/history strip beneath the project header to search this project’s chats by title or message text, browse by date, and reopen an older conversation. The plus button starts a separate chat. Transcripts, unsent messages and selected file paths are saved in verified alternating files in the phone’s private app storage, keyed by imported project ID and repository name; changing the tunnel URL does not detach history. Earlier versions kept messages only in memory, so conversations lost before this update cannot be recovered. Temporary chats remain unsaved. Reopened history never restores executable drafts or approvals; preparing a new patch reads fresh source. Type `@` in the bottom composer to search the selected repository’s file list and select attachments. Attachment chips can be removed before sending. Up to three regular files and 12 KB of total source can accompany a request; the picker excludes oversized files, symlinks and disallowed paths. The file list is bounded and labels partial results. Attaching a new path adds it to the project’s configured source selection (up to 20 paths). Ask questions, request a small feature, inspect the cited evidence, and review a patch before explicitly approving a draft PR. Source snapshots, approvals, and audit ledgers are isolated per project. Changing source selection discards earlier snapshots and approvals. Publication checks the repository head to reject stale edits.

The conversation appears above the fixed composer, with user messages and assistant replies. Import GGUF models in Settings, then choose among imported models with the model selector below the project name. Unrestricted terminal execution and new-file creation are not implemented. Local and API models and project-specific saved chat history are available. The existing deterministic triage and separate offline Temp chat remain available. PR publication does not merge, deploy, or update a PC checkout; repository CI and the normal merge/deployment process remain necessary.

## Background monitoring and phone alerts

Enable background monitoring per project and keep the gateway running. It checks projects sequentially, then waits 30 seconds after the completed cycle. Slow endpoints and push retries extend the interval. Manual refresh also collects provider logs; background monitoring only probes availability.

Availability currently means HTTP status: 2xx is healthy, 5xx is down, and other responses or network failures are unknown. It does not infer business health from arbitrary JSON. Use a dedicated endpoint that returns a failure status when its checks fail. Two consecutive down observations open an alert; two healthy observations recover it. Unknown/degraded results break the consecutive streak without falsely recovering an open alert. Sustained outages do not generate a new notification on every check. A newly subscribed device receives future transitions, not a replay of existing outages.

Device subscriptions, debounce state, and the delivery outbox persist outside the source repository in `~/.pocketsre/monitor-<gateway-port>.json`. Protect this private file with the owner's OS account permissions; it contains push device tokens and is not encrypted at rest. Run one gateway process per ledger. Pausing monitoring or changing endpoints cancels queued alerts on the next cycle; already submitted notifications cannot be recalled. Delivery retries are bounded, jobs expire after 24 hours, and invalid device tokens are removed. A lost response can cause duplicate delivery. Expo acceptance is followed by receipt checks; receipts confirm handoff to the platform, not that a user read the notification.

### Enable actual Android push delivery

1. Configure an Expo EAS project in `app.json` under `extra.eas.projectId`. `EXPO_PUBLIC_EAS_PROJECT_ID` can override it for another environment. The native build workflow intentionally ignores dotenv files; overrides must be exported in the build shell.
2. Configure Firebase/FCM for the Android application ID of that build variant. Set `POCKETSRE_GOOGLE_SERVICES_FILE` to the absolute path of its private `google-services.json` **outside this repository**. Configure the matching FCM v1 service-account credential in EAS; never commit either file.
3. Rebuild the native app (`pnpm android:debug` or your intended build variant) and install it. The previous APK lacks the notifications native module; a JavaScript reload alone is insufficient. The build must include the configured public EAS project ID.
4. Enable background monitoring, then **Enable alerts on this phone** and grant Android notification permission. If Expo push access-token security is enabled, set `EXPO_PUSH_ACCESS_TOKEN` on the gateway privately.
5. Validate an actual outage and recovery on a physical device, with the app foregrounded, backgrounded, and closed. A notification tap opens the project only when its saved gateway identity matches the current connection.

Follow Expo's [push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) and [tickets/receipts guidance](https://docs.expo.dev/push-notifications/sending-notifications/). Provider and push automated tests use fixtures; passing them does not verify real-device delivery.

### Configured development environment (September 13, 2026)

The [PocketSRE Expo project](https://expo.dev/accounts/abhyuday404/projects/pocketsre) has an FCM V1 credential for `dev.pocketsre.mobile.dev`. The [PocketSRE Firebase project](https://console.firebase.google.com/project/pocketsre/settings/cloudmessaging) has FCM V1 enabled on the free Spark plan. Other Android package variants require their own Firebase app registration and corresponding Expo credentials.

On the development machine, `~/.pocketsre/mobile.env` contains the build environment and references `~/.pocketsre/google-services.json`. The service-account key is stored separately outside the repository and is uploaded to Expo, never bundled into the phone app. Load the environment before both building and starting Metro:

```sh
set -a
source ~/.pocketsre/mobile.env
set +a
pnpm android:debug
pnpm dev:mobile
```

On the connected iQOO I2501, Android permission and device registration succeeded. Test notifications sent through the gateway's `ExpoPushTransport` arrived foregrounded, backgrounded, and with the app process killed; Expo returned successful delivery receipts. Tapping a notification opened the correct project workspace, including a cold start in the installed standalone build without Metro or USB port forwarding. Alert registration was refreshed after switching to the wireless gateway connection. The phone remains subscribed to the tracked PocketSRE project. Registration is available while monitoring is paused.

The PocketSRE repository itself still has no health endpoint, so its monitor remains paused. Other projects, including the separately configured demo services, have their own endpoints, monitoring switches, and phone subscriptions. Force-stopped and long-idle delivery were not tested.

## Remaining production work

Encrypted durable account credentials and renewal, per-user authorization, more provider adapters, scalable monitoring/delivery workers, notification delivery visibility in the app, durable chat history, and physical-device/account validation remain. Monitor errors and missing provider data must be investigated rather than interpreted as successful checks.

## GitHub and project activity

The GitHub tab replaces the global Activity navigation item. All projects shows an open-PR inbox for imported repositories; select a repository to browse paginated open pull requests, commit history, and branches. PRs and commits open a changed-file list with expandable, horizontally scrollable unified patches, additions/deletions, and rename information. Branch comparison accepts branch names, tags, or commit SHAs and shows changes from the common ancestor to the head. Code browsing remains read-only; PR details also offer an explicitly confirmed merge. GitHub links open full details in the browser.

The GitHub App needs **Contents: Read and write**, **Metadata: Read-only**, **Pull requests: Read-only**, **Checks: Read-only**, and **Commit statuses: Read-only** for in-app merging. Existing installations must accept permission updates. Repository access remains controlled by the GitHub installation. Every endpoint resolves the repository from the selected imported project and requires backend authentication.

Lists load in pages. The all-project inbox previews up to five PR titles per repository; open the repository to load more. Diffs are bounded to 16,000 characters per file and 120,000 per response. Missing/binary patches and shortened previews are labelled. GitHub limits comparisons to 300 changed files; the UI points to GitHub when that limit is reached.

Each project workspace now has an **Activity** section with Evidence, Actions, and Saved views. Refresh collects that project's configured health/deployment signals and stores a sanitized snapshot on the phone. Action history comes from that project's own ledger. Saved evidence is filtered by server and repository identity, using the existing retention limits (five snapshots per incident, 30 per server). Demo/import activity remains reachable through the separate demo overview, outside the main navigation.

### Browse repository code

Select **GitHub → a project → Code** to browse the repository, including dotfiles and files outside the agent attachment allowlist. Folders are fetched individually, sorted before files, with breadcrumbs, parent navigation, a folder filter, and additional file rows loaded in batches. The branch picker also accepts tags and commit SHAs. Browsing is pinned to the first returned tree until you refresh or switch references, so folders and files stay consistent when a branch moves.

Text files open read-only with line numbers, horizontal scrolling and 200-line pages. UTF-8 files up to 500 KB can be read in full; binary, non-UTF-8, and larger files are labelled and can be opened on GitHub. Symlinks show their target text without following it; submodules link out to GitHub. File contents remain in screen memory and are not added to incident evidence or sent to an AI provider.

### Confirmed PR merging

Open GitHub → select an imported project → Pull requests → Review. The merge card shows current checks, blockers and repository-enabled squash, merge-commit or rebase methods. Confirm the repository, PR, branch and head commit before execution. All reported checks must succeed (neutral/skipped are accepted); GitHub must report a clean, mergeable, open non-draft PR. This intentionally blocks even optional failed checks, incomplete check listings, and unknown or protected merge states. Merge queues and stacked PR merging must be handled on GitHub.

`GET /v1/projects/:id/git/pulls/:number/merge` reads readiness. The authenticated `POST /v1/projects/:id/actions/pulls/:number/merge` accepts a unique request ID, approval timestamp (five-minute expiry), exact head SHA, base SHA/ref and allowed method. It re-reads readiness and branch references, then calls GitHub's synchronous merge endpoint with the pinned head SHA. GitHub enforces current repository rules; the app never requests bypass or changes protection settings. The base branch can still advance between the final read and GitHub's atomic merge.

Merge intent and outcomes persist in `<project-id>.merges.json` beside project state and appear in workspace Activity → Actions. Run one backend process per data directory. Request replay never repeats a GitHub write, including after restart. Network errors or uncertain responses retain an unconfirmed record and block further in-app attempts for that PR; inspect/finish it on GitHub. Explicit GitHub rejection is recorded as failed and permits a fresh review. Removing a project hides its activity but does not delete its audit file.

The [private PC demo lab](mini-projects.md) supplies four imported practice repositories with real PC deployments, log evidence and a push → outage → repair PR → merge → recovery workflow.
