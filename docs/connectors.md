# Connecting a real project

Copy `services/gateway/.env.example` to `services/gateway/.env`. Set `POCKETSRE_MODE=live`, `HEALTH_URL`, `HEALTH_SERVICE_ID` and `HEALTH_SERVICE_NAME` for the service you own. The configured identity is required even when the endpoint is unavailable on the first request. Its `serviceId` must match `HEALTH_SERVICE_ID`; the configured name is the display name. A normal response uses this health contract:

```json
{
  "serviceId": "my-api",
  "serviceName": "My API",
  "status": "degraded",
  "version": "commit-or-release-id",
  "checkedAt": "2026-09-07T10:00:00.000Z",
  "checks": { "database": "failed", "api": "degraded" }
}
```

For this example, set `HEALTH_SERVICE_ID=my-api` and `HEALTH_SERVICE_NAME=My API`. Use `HEALTH_TOKEN` if that endpoint needs bearer authentication. URLs are configured only on the server and cannot contain credentials, query parameters or fragments. Fetches have an eight-second timeout, reject redirects, validate responses, and cap response size at 2 MB.

## Health and collection availability

Health, GitHub and Sentry start independently. A failed health probe does not discard successful provider evidence or prevent the gateway from returning a fresh incident bundle. Every probe creates timestamped health evidence; failed provider collections create `collection_failed` evidence from source `gateway`. Collection entries describe the latest attempt and include `checkedAt`; failure entries cite their evidence IDs. Provider exception text and raw response bodies are never included.

| Observation                                                                                                                  | Current health                                      | Release and checks                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| Fresh, valid normalized response for the configured service                                                                  | Reported `healthy`, `degraded` or `down`            | Observed fields; no inferred release                                   |
| HTTP 5xx with fresh, valid unhealthy details                                                                                 | Reported `degraded` or `down`                       | Observed fields                                                        |
| HTTP 5xx without usable normalized details, including an unreadable body                                                     | `down`, meaning an observed health endpoint failure | `version: null`, empty checks; internal component health is unverified |
| Timeout, network/redirect failure, non-5xx HTTP error, malformed successful response, wrong service or stale/future response | `unknown`                                           | `version: null`, empty checks                                          |

`HEALTH_MAX_AGE_MS` defaults to 60000. Timestamps over five seconds in the future are also rejected. A 5xx body claiming healthy cannot resolve an incident. A stale response cannot supply current component checks or a current release. For unavailable probes, `serviceHealth.checkedAt` is the attempt time; for accepted normalized responses, it remains the endpoint's observation time. Evidence timestamps always record the collection observation, with the endpoint timestamp retained as `metadata.healthCheckedAt` when accepted.

The bundle still uses `schemaVersion: 1` and accepts existing v1 bundles. Its wire vocabulary has expanded: health adds `unknown` and nullable `version`; evidence adds `health_check_unavailable`, `collection_failed`, and source `gateway`; collection entries add optional timestamps and evidence IDs. Upgrade the gateway and mobile client together: older binaries may reject these new values. `expectedVersion: null` is valid only for read-only health checks. Mutating requests still require a known current release and fresh verified health. An inconclusive health check is recorded as a failed action, not a recovery.

## Provider evidence

For GitHub, set `GITHUB_REPOSITORY=owner/repo` and optionally `GITHUB_TOKEN`. The adapter reads up to five recent commits, their metadata, and up to ten patches per commit. Private repositories require a token with Contents: read permission. No repository write calls are implemented. See [GitHub's commits API](https://docs.github.com/en/rest/commits/commits).

For Sentry, set `SENTRY_ORGANIZATION`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` with project issue read access. The adapter retrieves up to ten unresolved issue summaries seen during the incident window. It does not currently retrieve full stack traces or release metadata. See [Sentry's project issues API](https://docs.sentry.io/api/events/list-a-projects-issues/).

Missing provider data never becomes fabricated evidence. Refreshes merge evidence by ID. GitHub commits/patches are deduplicated; Sentry observations include `lastSeen` in their ID so a later occurrence does not erase an earlier observation. The implementation retrieves a bounded recent window (incident start minus one hour, limited to seven days); it does not paginate provider history or operate a monitoring daemon.

Live mode only permits health checks. Rollback remains limited to the local demo service until provider-specific deployment actions and their authorization are implemented.

## Incident continuity and retention

Live mode stores the current bundle and recent completed incidents in `INCIDENT_PATH`, defaulting to `.pocketsre-data/incidents.json` relative to the gateway working directory. Use a persistent path across restarts. The Docker image defaults to `/data/incidents.json` on the same mounted volume as the action ledger. The library loader is in-memory only when no path is supplied, for isolated tests or explicit embedding.

- An outage or loss of health visibility opens an incident. Unknown health has warning severity; an already confirmed outage retains critical severity while health is unknown. The same ID and `startedAt` survive refreshes, restarts, changes of release, continued failure and observed recovery.
- Only a fresh healthy result resolves the incident. A later observed failure or unknown condition after resolution starts a new ID. A healthy startup creates a resolved baseline. There is no claim about when the service failed before the gateway first observed it, or about unobserved outages/recoveries while the gateway was stopped.
- Evidence is sanitized before storage and merged across refreshes. Each bundle retains at most 500 events from the last seven days. Up to 20 previous bundles are retained for 30 days after their last update. Retention runs on successful refresh, so an idle file is not pruned in the background. The current incident's identity/start time is retained even during a longer outage; older evidence can expire. Prior bundles are retained in the file, without a history API in this implementation.
- Writes use a synced temporary file and atomic replacement. Refreshes are serialized so concurrent readers/actions cannot race incident transitions or overwrite one another's evidence. Run **one gateway process per incident file**; there is no cross-process lock. This protects normal process restarts, not every filesystem or sudden-power-loss failure.
- Invalid, truncated, inconsistent or oversized state is renamed to `incidents.json.corrupt-<time>-<id>`. Collection continues with a new identity and an explicit continuity-loss event and availability warning. The warning stays visible for that process; its evidence persists subject to retention. Quarantined files are not read back or automatically deleted; inspect/remove them yourself and protect them like operational data. They are outside normal retention. Permission/I/O errors, another service's file and future storage versions fail closed instead of silently replacing state. Files are capped at 32 MB.

The first upgrade from the previous in-memory loader cannot recover its lost identity. Choose a new incident file when intentionally changing the configured service. Do not place credentials or raw responses in the store. Keep the ignored data directory private and back it up if its history matters.

## LAN connection

Set `GATEWAY_HOST=0.0.0.0` and a strong `GATEWAY_ACCESS_TOKEN` in the gateway environment, then enter the gateway URL and token in the phone's Connections panel. The token is stored through Android Secure Store. Use HTTPS or an SSH/ADB tunnel outside a trusted development network; this development gateway does not terminate TLS.

The gateway keeps a single-process action ledger in `.pocketsre-data/actions.json`. The ledger survives restarts, including in-flight actions, which are never automatically re-executed. Keep a single gateway process per ledger file. Authentication uses a shared token; users, roles, per-service authorization, and production deployment are future work.
