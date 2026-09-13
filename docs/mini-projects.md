# Mini-project operations guide

Four private GitHub repositories run on this PC and are imported into PocketSRE with source access, background monitoring, phone alert subscriptions and real deployment/runtime logs. No real customer data, payments, bookings or messages are used.

| Project                                                                         | File              | Healthy value          | Change to cause HTTP 503 |
| ------------------------------------------------------------------------------- | ----------------- | ---------------------- | ------------------------ |
| [Cartline](https://github.com/abhyuday404/cartline)          | `src/service.mjs` | `TAX_RATE = 0.08`      | `TAX_RATE = 8`           |
| [Stockroom](https://github.com/abhyuday404/stockroom)        | `src/service.mjs` | `AVAILABLE_STOCK = 12` | `AVAILABLE_STOCK = -1`   |
| [Slotbook](https://github.com/abhyuday404/slotbook)           | `src/service.mjs` | `SLOT_MINUTES = 30`    | `SLOT_MINUTES = 0`       |
| [Dispatch API](https://github.com/abhyuday404/dispatch-api) | `src/service.mjs` | `PROVIDER = 'sandbox'` | `PROVIDER = 'sandb0x'`   |

## Try an outage

1. Choose one repository and edit the constant on line 2 of `src/service.mjs`. Commit and push to **main**. Use the values in the table above.
2. The PC deployer fetches main about every 20 seconds. It runs syntax checks and starts the service; the deliberately invalid business configuration makes `/health` return 503. CI will fail while the configuration is broken, which is expected for this exercise.
3. Background monitoring opens an alert after two failed observations. Usually allow 60–90 seconds including deployment; slow network and push delivery can take longer. Open the project workspace and refresh health to see current status and deployment/runtime evidence under **Activity → Evidence**. Use **Monitoring and alerts** to inspect the current alert state.
4. In **Agent**, choose the same project, attach `@src/service.mjs`, and ask: “The service is down. Use the runtime error and source evidence to restore the valid configuration with the smallest patch.” The table above provides the correct value if the model needs guidance.
5. Review the patch, then approve **Create draft pull request**. In **GitHub → project → Pull requests**, review that PR, choose **Mark ready for review**, wait for CI checks, refresh merge status and confirm the merge.
6. The PC redeploys the merged main commit automatically. Two healthy observations close the alert and trigger recovery notification delivery. Deployment evidence records the deployed commit.

The app's Agent generates the proposal using your selected model, so inspect its change before approving. The intended repair is always restoring the healthy constant above. Repository CI tests the health invariant. The agent never has to disable validation or change the health endpoint.

Local editable checkouts are in `/home/abhi/Projects/mini-projects/`. Before a new exercise after an app merge, run `git pull --ff-only` in that project's checkout. Then edit the file and run:

```sh
git add src/service.mjs
git commit -m "Practice: break service configuration"
git push origin main
```

## Running the services

Keep this PC awake and online. The phone uses the existing PocketSRE tunnel; no USB forwarding is required. The services themselves bind only to localhost. The `pocketsre-demo-lab` user service reads `~/.pocketsre/demo-lab/config.json` and manages disposable deployment checkouts separately from your editable copies. Only the four listed repositories are deployed. `pnpm wireless` also starts these services when its config exists, including after a reboot. Its interval begins after each fetch/deploy cycle completes.

The app links local deployment logs through an authenticated endpoint that resolves the selected repository against the PC's deployment manifest. Logs are bounded, redacted and included as cited deployment evidence. They are real PC deployment events, not Vercel logs. The deployer does not receive commands from the phone. Its service subprocesses receive only a minimal runtime environment with no GitHub, gateway or model credentials.

PR publication and ready-for-review actions use the existing authenticated GitHub CLI credential stored privately in the backend environment. The backend restricts that publication credential to these four repositories through `GITHUB_PROJECT_FIX_REPOSITORIES`. Ordinary repository reads and confirmed merging continue through the connected GitHub App. Draft readiness is an explicit, audited action; merging remains separately confirmed with current checks and a pinned PR head SHA.

Monitoring observes HTTP availability, not arbitrary business JSON. Each service actively checks its business invariant and returns 503 on failure. If a process cannot start, the local deployment supervisor returns 503 and preserves its build/runtime error evidence. Successful merge does not immediately mean recovery: redeployment and healthy monitoring observations must follow.

## Setup verification

On September 13, 2026, all four one-line failures were pushed to main and deployed. Each produced HTTP 503, a confirmed PocketSRE outage and runtime error evidence. Repair proposals using those real evidence IDs were submitted through the same authenticated context/prepare/execute endpoints used by the app. Each created PR #1, was marked ready through the audited action, passed CI and merged through PocketSRE's pinned-SHA merge endpoint. The deployer picked up every repaired main commit, all four monitors returned to healthy with closed alerts, and Expo push receipts confirmed all four outage and four recovery deliveries to the platform.

The repair proposals in this setup test were supplied deterministically to exercise the action pipeline; they were not generated by the phone model. Your model's proposed edits still require review. All four editable local checkouts were fast-forwarded to the repaired main commits and left clean.
