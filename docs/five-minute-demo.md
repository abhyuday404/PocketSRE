# Five-minute phone demo: break checkout, review a patch, deploy and verify

This is a running **local demo deployment** on the laptop, controlled from the phone over USB. It does not deploy a public cloud service or modify the GitHub fixture. The code fix is drafted by the imported phone model; the gateway tests and applies the approved patch to the running checkout service. Only this isolated one-operator calculation is supported by the demo deployment adapter.

## Setup and exact edit

Start from the PocketSRE repository:

```powershell
pnpm demo:reviewers
```

The service creates this editable file on first start and preserves it on later starts:

`F:\PersonalRepos\PocketSRE\.pocketsre-data\reviewer-demo\checkout.mjs`

Healthy contents:

```js
export function lineTotal(unitPrice, quantity) {
  return unitPrice * quantity;
}
```

**The only edit for the presentation:** on line 2, change `*` to `+` and save:

```diff
-  return unitPrice * quantity;
+  return unitPrice + quantity;
```

No build, restart, commit, or push is needed. The demo reads the current file for every request and identifies the running source by its content hash. The endpoint now calculates `10 + 3 = 13` while independent checkout tests require `10 × 3 = 30`, so `/health` reports down with a failed checkout check. The app detects this on **refresh**; there is no background alerting.

Connect the phone once:

```powershell
adb reverse tcp:4101 tcp:4101
adb reverse tcp:8081 tcp:8081 # Development build / Metro only.
```

In phone **Settings**, set the gateway URL to `http://127.0.0.1:4101` and save with no token for this loopback-only demo gateway. Import the local GGUF model beforehand, use CPU inference, and keep Metro running for a development build. The demo service itself listens at `http://127.0.0.1:4310`.

Before reviewers arrive, verify the file contains `*`, refresh **Overview**, and confirm **Live**, **Reviewer Checkout**, and healthy checks. “Live” here means a current connection to the actual local demo service. Do not use a saved/imported snapshot as the opening state.

## Presenter clock

| Time      | Do                                                                                                                                                                           | Say                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | Show healthy **Overview**, service identity, and checkout health.                                                                                                            | “This checkout service is running correctly. PocketSRE lets me inspect and repair it from my phone.”                               |
| 0:30–1:00 | In the laptop editor, replace the single `*` with `+` and save.                                                                                                              | “I’ve introduced a real calculation regression: three items at ten each now total thirteen.”                                       |
| 1:00–1:20 | Pull to refresh **Overview**. Show the red checkout check; briefly open **Activity → Evidence**.                                                                             | “The process is alive, but its business check fails. These source and health observations are collected from the running service.” |
| 1:20–3:40 | Open **Fixes**, select `checkout.mjs`, tap **Draft fix on this phone**.                                                                                                      | “The model on this phone reads the evidence and current source to draft a repair. It has not changed the service yet.”             |
| 3:40–4:15 | Review the exact replacement. It must restore multiplication. Tap **Deploy demo fix**, then **Test and deploy** in the confirmation.                                         | “I’m approving this exact change to the isolated local deployment. The gateway tests it before applying it.”                       |
| 4:15–5:00 | Wait for **Tests and live probes passed**. Return to **Overview** and refresh; show healthy health and the resolved incident. Show **Activity → Actions → Demo deployment**. | “The running endpoint passed the original checkout checks again. This is verified recovery, not just generated code.”              |

Skip the separate **Analyze incident** model call in this five-minute version: **Fixes** already performs on-device inference using the evidence and source. Running both can double the inference wait. The slots above are a target, not a promise of model latency; rehearse on the actual phone. A rejected model response must be retried or honestly reported, never replaced with a claim of success.

Rehearsed on the connected iQOO phone on September 12, 2026: the imported model produced the correct multiplication patch in approximately 1 minute 48 seconds, with citations to the collected source and health evidence. The phone approval deployed it successfully; independent tests and actual HTTP probes passed, `/checkout?unitPrice=10&quantity=3` returned `30`, and health returned `healthy`. The source was left at `*` for the next presentation. Keep the USB connection, Metro, and demo gateway running throughout the demo.

## What deployment does

The phone shows a review and a second explicit approval. The gateway then:

1. Rechecks the incident/release, cited evidence, source revision, exact replacement, and approval age.
2. Accepts only the tiny advertised `lineTotal` function with a `+` or `*` operator. It never runs arbitrary model-generated code on the laptop.
3. Tests `10 × 3 = 30`, `5 × 0 = 0`, and `7 × 4 = 28` using assertions the model cannot edit.
4. Atomically replaces the demo's `checkout.mjs` file.
5. Probes the actual HTTP health and checkout endpoints, including the new content hash. If verification fails, it attempts to restore the prior source without overwriting a newer external edit.
6. Records the action result. Repeating the same approval retrieves its result rather than applying the patch again.

This is an opt-in adapter started by `pnpm demo:reviewers`; the normal GitHub flow still creates draft PRs and does not automatically merge or deploy them. There are no new cloud permissions.

## Independent proof and reset

Optional laptop probes before/after:

```powershell
curl.exe -i http://127.0.0.1:4310/health
Invoke-RestMethod 'http://127.0.0.1:4310/checkout?unitPrice=10&quantity=3'
```

Healthy: HTTP 200, total 30. Broken: health HTTP 503, total 13. The API process stays up in both cases.

To reset after rehearsal, restore `*` in the same file and refresh the app. Do not clear imported models or app data. Keep the source at `*` for the next presentation. If you edit source after generating a draft, discard that draft and generate another against the current source.

If inference fails, the healthy reset is a presenter recovery procedure, not a model-generated repair. If the deployment message is inconclusive, inspect the file and live probes before generating another fix.

After **Test and deploy**, wait for **Tests and live probes passed**: pressing the confirmation alone does not mean the deployment succeeded. The actual PC file above must now contain `*`. If your editor still displays `+`, reload the file from disk and check for an unsaved buffer before saving again. A failed deployment now distinguishes an unsupported patch, failed regression tests, a PC file replacement problem, or failed live verification with rollback. Discard a failed draft and generate a new one after correcting the reported problem.
