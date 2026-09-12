# Reviewer demo: bad release → phone diagnosis → reviewed PR → live recovery

For the ready-to-run local version with a one-line edit and phone-approved deployment, use the [five-minute demo](five-minute-demo.md). The plan below describes the longer hosted/GitHub delivery version and its separate prerequisites.

Use **abhyuday404/pocketsre-harness-test** on an isolated, hosted demo service. The story is a checkout regression: three items priced at 10 should total 30, but a bad release returns 13. PocketSRE collects live evidence, the phone proposes a source fix, a human approves its draft PR, and the normal delivery pipeline deploys the reviewed change.

Allow **15–20 minutes** for the full live sequence, including inference, CI, and deployment. The recorded Qwen3.5-4B Q6_K CPU smoke test took roughly three minutes for one patch response. Diagnosis and patch drafting are separate model calls; rehearse both and reserve time accordingly. Do not promise a three-minute end-to-end deployment.

This is a presentation plan, not a record of an executed deployment. No defect, merge, or deployment was performed while preparing it. The deployment provider and demo URL have not been selected.

## What exists and what must be ready

Inspected on 2026-09-12:

- The [private fixture](https://github.com/abhyuday404/pocketsre-harness-test) already has the deliberate `unitPrice + quantity` defect in `service.mjs`, assertions for `10 × 3 = 30` and `5 × 0 = 0`, and a normalized `/health` endpoint.
- [Fixture PR #1](https://github.com/abhyuday404/pocketsre-harness-test/pull/1) is an existing on-device fix rehearsal with a passing `checkout-test` check. It is still open. Review its diff before using it to establish the healthy baseline; do not present that old PR as newly generated during the demo.
- The current fixture listens only on `127.0.0.1:4300`, exposes no customer-facing checkout route, and reports `version: 'fixture-v1'`. Its workflow tests PRs; it does not deploy. No deployments were returned by the repository's GitHub deployments API. That alone does not rule out an external host.
- PocketSRE's live mode supports health/GitHub collection and approved draft PR creation. It does not run project tests, merge PRs, or deploy fixes. Its built-in **Simulate failure** and rollback belong to the separate local demo service.

Complete these preparations in the fixture before presenting:

1. **Choose a disposable live environment.** Record the URL, repository, deployed branch, operator, and exact deployment procedure. Use synthetic data; this checkout must never charge a customer. The service must be reachable from the laptop gateway.
2. **Make the service hostable.** Read `PORT` and `HOST` from the environment, bind to the host's required interface, and start with `node service.mjs --serve`. Supply the actual deployed Git SHA as `APP_VERSION` and report it in `/health`. Return fresh `checkedAt` and prevent response caching. These changes are not implemented in the fixture yet.
3. **Expose a visible business probe.** Add a read-only `GET /checkout?unitPrice=10&quantity=3` that calls `lineTotal` and returns `{ "total": 30 }` when correct. Validate numeric inputs. It is a synthetic calculation, not an order or payment. This route is also a preparation task, not an existing endpoint.
4. **Keep verification independent.** Preserve the existing assertions and add an external regression test for positive, zero, and multiple quantities. Keep that test outside the model's allowed edit paths. CI must execute it on the actual PR revision. A fix must change the implementation, not the expected total or health-check logic.
5. **Configure delivery.** A reviewed merge to fixture `main` must trigger your host's deployment, or the operator must have a rehearsed manual deployment of an exact SHA. A PR preview URL is not the final demo deployment. Rehearse a return to the known-good release using the host's rollback/redeploy control.
6. **Establish a healthy baseline.** Review/merge the existing fix or make an equivalent reviewed correction, deploy it, and prove health 200 plus checkout total 30. Record this commit as `GOOD_SHA`. Finish all infrastructure/configuration commits now.
7. **Plan the intentional faulty release.** Use the isolated fixture's agreed fault-injection process to put the one-line regression on its default branch and deploy that exact revision. Do not weaken tests or change a real project's branch protections to introduce the fault. If required checks prevent this deliberate release, use a separate disposable fixture configured for fault-injection exercises.

Before going live, fill in this card:

| Item                           | Value                                    |
| ------------------------------ | ---------------------------------------- |
| Fixture repository             | `abhyuday404/pocketsre-harness-test`     |
| Demo URL                       | **Required: selected host URL**          |
| Default/deployed branch        | `main`                                   |
| Healthy baseline SHA           | **Required: `GOOD_SHA`**                 |
| Exact deploy control/command   | **Required: host-specific procedure**    |
| Exact rollback control/command | **Required: host-specific procedure**    |
| Independent CI check           | **Required: regression test check name** |
| Model / accelerator            | Imported Qwen3.5-4B Q6_K / CPU           |

The live-deployment portion is not presentation-ready until these fields are filled and rehearsed. A local process restart can be a useful rehearsal, but should be described as a local deployment.

## Presenter setup

Use three visible surfaces: the phone, a terminal showing the business probe, and a browser with GitHub plus the deployment dashboard. Keep credentials and unrelated terminal output off the projected screen.

Configure a single gateway process using its process environment or ignored private environment file. Substitute the real demo host below:

```dotenv
POCKETSRE_MODE=live
HEALTH_URL=https://YOUR-DEMO-HOST/health
HEALTH_SERVICE_ID=harness-checkout
HEALTH_SERVICE_NAME=Harness Checkout
GITHUB_REPOSITORY=abhyuday404/pocketsre-harness-test
GITHUB_USE_CLI=1
GITHUB_FIX_PATHS=service.mjs
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=4100
```

`GITHUB_USE_CLI=1` uses the laptop's existing authenticated GitHub CLI session. Check `gh auth status` privately before presenting. A hosted gateway should use restricted credentials as described in [GitHub fixes](github-fixes.md), rather than copying personal CLI authentication. Keep the incident and action storage paths stable through the demo.

From the PocketSRE repository, start the gateway after stopping any previous process serving that same port/storage:

```powershell
pnpm --filter @pocketsre/gateway dev
```

In a separate terminal, connect the phone over USB:

```powershell
adb devices
adb reverse tcp:4100 tcp:4100
# Development APK only: Metro must also be running for this repo.
adb reverse tcp:8081 tcp:8081
```

In **Settings**, connect to `http://127.0.0.1:4100`; retain the configured gateway access token if authentication is enabled. Import the model ahead of time and keep CPU inference selected. Open **Overview** and refresh. Require a **Live** connection, the expected service name, and the real deployed SHA. **Saved**, **Sample**, and **Imported** are not live observations.

The app refreshes on demand; it does not monitor continuously or send background incident alerts. **Agent → Temp chat** is a separate, ungrounded model playground and is not the incident-remediation path for this demo.

## The live sequence and what to say

### 1. Introduce the product and show a healthy service — 1 minute

Say:

> “PocketSRE helps an on-call engineer move from a failing service to a reviewable fix using a model running on their phone. The gateway collects evidence and mediates approved GitHub writes. Our existing CI and deployment system still verify and deliver the change.”

Show the live URL, service name, healthy version, and checkout total 30. Establish the business invariant before introducing the bug.

In PowerShell, after the preparation route exists:

```powershell
$demoUrl = 'https://YOUR-DEMO-HOST'
curl.exe -i "$demoUrl/health"
Invoke-RestMethod "$demoUrl/checkout?unitPrice=10&quantity=3"
```

Expected: health HTTP 200, `status: healthy`, `checks.checkout: healthy`, version `GOOD_SHA`, and `{ "total": 30 }`.

### 2. Introduce and deploy one controlled flaw — 1–3 minutes plus deployment

On the fixture only, change:

```diff
 export function lineTotal(unitPrice, quantity) {
-  return unitPrice * quantity;
+  return unitPrice + quantity;
 }
```

Show the one-line diff. Run the unchanged tests to demonstrate that this is an intentional bad release. Commit it through the prearranged fault-injection process on fixture `main`, record `BAD_SHA`, and deploy that exact commit to the isolated demo environment. Leave tests intact. Freeze further changes to `main` until the proposed fix is reviewed.

Say:

> “I’m deliberately introducing a checkout calculation regression in our isolated demo service. Three items at ten each now total thirteen.”

Repeat the same probes. Require total **13**, health HTTP **503**, `status: down`, `checks.api: healthy`, `checks.checkout: failed`, and version **BAD_SHA**. A Git commit or green deployment dashboard by itself does not prove that the faulty code is serving traffic.

### 3. Collect the real incident on the phone — 1 minute

Refresh **Overview**, then open **Activity → Evidence**. Show the failed checkout health check and the real GitHub regression commit/patch. Note the observation timestamps and version.

Say:

> “The API process is alive, but the business check is failing. These are fresh observations from the service and repository. PocketSRE gives each evidence item an ID that the diagnosis must reference.”

Do not claim that a nearby Git commit is proven deployed merely because it appears in the timeline. The health version matching `BAD_SHA` supplies that link. Do not describe absent Sentry data or database evidence as collected.

### 4. Diagnose on-device — allow measured inference time

Tap **Analyze incident**. While it runs, explain the phone/gateway boundary and show that inference is local. When it finishes, show the mode badge, conclusion, confidence, cited evidence, and suggested next check.

Say:

> “The model proposes an explanation tied to this evidence. We still need source review and a passing regression test to establish the fix.”

If the UI reports local rules or model fallback, say so. A conservative or inconclusive diagnosis is acceptable; it is not permission to narrate a more certain model result. Do not approve a demo rollback in place of the live source-fix sequence.

### 5. Draft the source fix on the phone — allow measured inference time

Open **Fixes**, select only `service.mjs`, and tap **Draft fix on this phone**. Read the exact replacements. The expected implementation repair is addition back to multiplication. Check that the model has not altered `verifyCheckout`, test expectations, health status reporting, or unrelated code.

Say:

> “This patch was drafted on the phone against a specific repository commit. PocketSRE checks that the cited evidence exists and the replacement matches the source. The patch is still untested.”

If a more explicit task is needed, use **Agent → Repository agent** and enter:

> “Fix the checkout calculation in service.mjs. Three items at unit price 10 must total 30; quantity zero must total zero. Change the calculation only. Preserve the assertions, health checks, and unrelated behavior. Prepare a small patch for review.”

Explain that Agent is following an explicit user request using source evidence. It is a different path from autonomous incident diagnosis. A correct-looking answer without edits is not a prepared patch.

### 6. Approve a draft PR, then inspect it on GitHub — 1–2 minutes

Tap **Create draft pull request**, inspect repository, branch, base SHA, and changed files, then approve once. Open the newly created PR using **Open pull request**. Show its exact diff, evidence references, and the **Tests not run** qualification in the generated description.

Say:

> “The phone has created a draft PR after my approval. Nothing has been merged or deployed by PocketSRE.”

Use the new PR number. Do not substitute the old rehearsal PR while describing it as newly generated. Avoid unrelated commits or a second operator moving `main`: the prepared snapshot expires after 15 minutes and stale repository heads require a fresh draft.

### 7. Verify and merge through the normal workflow — 1–3 minutes

In the GitHub browser, review the exact diff and independent CI result. Confirm the tested PR head is still the one being merged. Mark the PR ready and merge only after the intended regression tests pass with unchanged assertions.

Optional presenter commands after reviewing the diff:

```powershell
$demoRepo = 'abhyuday404/pocketsre-harness-test'
$prNumber = 123 # Replace with the newly created PR number.
$reviewedHead = gh pr view $prNumber --repo $demoRepo --json headRefOid --jq '.headRefOid'
if ($LASTEXITCODE -ne 0) { throw 'Could not read the PR revision.' }
gh pr diff $prNumber --repo $demoRepo
if ($LASTEXITCODE -ne 0) { throw 'Could not read the PR diff.' }
# Inspect and approve this exact diff before continuing.
gh pr checks $prNumber --repo $demoRepo --watch
if ($LASTEXITCODE -ne 0) { throw 'PR checks did not pass.' }
$currentHead = gh pr view $prNumber --repo $demoRepo --json headRefOid --jq '.headRefOid'
if ($LASTEXITCODE -ne 0 -or $currentHead -ne $reviewedHead) { throw 'The PR changed. Review and check it again.' }
gh pr ready $prNumber --repo $demoRepo
if ($LASTEXITCODE -ne 0) { throw 'Could not mark the PR ready.' }
gh pr merge $prNumber --repo $demoRepo --squash --match-head-commit $reviewedHead
if ($LASTEXITCODE -ne 0) { throw 'PR merge did not complete.' }
```

These are deliberate reviewer/operator actions outside PocketSRE. Do not run the whole block blindly after failed checks. Record the resulting merge commit as `FIX_SHA`; squash-merge SHA can differ from the tested PR head. Ensure the delivery pipeline verifies the exact merged revision too.

### 8. Deploy the reviewed fix — host-specific duration

Use the preconfigured deployment-on-merge flow, or manually deploy **FIX_SHA** using the recorded host procedure. Show the deployment log, target environment, exact revision, and completion result.

Say:

> “Our delivery system is now deploying the reviewed fix to the same live demo service. A merged PR alone is not recovery.”

The host-specific deploy command is intentionally not invented here. Fill it in before rehearsal. If the platform keeps the last healthy release when a revision fails readiness, verify which revision is actually serving before continuing.

### 9. Prove business recovery and close the incident — 1 minute

Repeat the original checkout request against the **same URL**, including a second quantity and the zero case. Verify the live release identity independently:

```powershell
$fixSha = 'REPLACE-WITH-ACTUAL-MERGE-SHA'
$health = Invoke-RestMethod "$demoUrl/health"
if ($health.status -ne 'healthy' -or $health.version -ne $fixSha) {
  throw 'The intended fix is not yet verified live.'
}
foreach ($case in @(@{ price=10; quantity=3; expected=30 }, @{ price=5; quantity=0; expected=0 }, @{ price=7; quantity=4; expected=28 })) {
  $answer = Invoke-RestMethod "$demoUrl/checkout?unitPrice=$($case.price)&quantity=$($case.quantity)"
  if ($answer.total -ne $case.expected) { throw 'Live checkout regression check failed.' }
}
```

Now refresh PocketSRE. Show fresh healthy health, `FIX_SHA`, and a resolved incident. Reanalyze if displaying a new conclusion: a saved diagnosis remains associated with its earlier evidence snapshot. **Activity → Actions** proves PR publication; it is not a deployment audit. Use GitHub/host records for merge and deployment proof.

Close with:

> “We introduced a real regression in a live demo service, investigated it from the phone, reviewed an on-device patch, deployed it through CI, and verified the original business operation recovered. The phone shortened the investigation-to-PR loop; human review and delivery controls stayed in place.”

## Evidence to retain and contingencies

Keep `GOOD_SHA`, `BAD_SHA`, the failing probe response, incident/evidence IDs, the new PR URL, tested PR head, `FIX_SHA`, deployment record, and the final live probe response. Export the incident bundle while the defect is still live if you want to show before/after evidence later. Keep exports private and free of credentials.

| If this happens                          | Presenter response                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model takes longer than rehearsed        | Explain architecture while it runs. Use a clearly labelled rehearsal recording if time expires; do not represent it as current inference.             |
| Model load fails / diagnosis falls back  | Show the actual mode. Rules can diagnose offline; code patches still require the working model.                                                       |
| Model changes tests or unrelated code    | Reject the draft and narrow the request. Do not publish it for the sake of completing the story.                                                      |
| Source/head changed or snapshot expired  | Refresh source and regenerate; do not bypass the stale-source check.                                                                                  |
| PR publication response is ambiguous     | Check **Activity → Actions** and GitHub for the reported branch/PR before retrying. Use the existing publication-result check, not a second approval. |
| CI fails                                 | Show the failure and stop before merge. A plausible patch is not a verified fix.                                                                      |
| Deployment fails or live probes stay red | Use the rehearsed host rollback to `GOOD_SHA`; verify health and checkout afterward. Describe this as operator rollback, not app-driven recovery.     |
| Internet is unavailable                  | Demonstrate saved-evidence analysis and temporary local chat. Live GitHub publication and deployment cannot complete offline.                         |

For a 5–7 minute slot, rehearse with the faulty release already deployed and show its introduction commit plus failing probe at the start. Use a labelled recording for one long model call if necessary. Keep at least the final live probe unambiguous; if CI/deployment do not finish during the slot, state that deployment is pending instead of claiming recovery.
