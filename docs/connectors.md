# Connecting a real project

Copy `services/gateway/.env.example` to `services/gateway/.env`. Set `POCKETSRE_MODE=live`, then provide `HEALTH_URL` for the service you own. The gateway fetches this endpoint; it must return the normalized health contract:

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

Use `HEALTH_TOKEN` if that endpoint needs bearer authentication. URLs are configured only on the server. Fetches have an eight-second timeout, reject redirects, validate responses, and cap response size at 2 MB.

For GitHub, set `GITHUB_REPOSITORY=owner/repo` and optionally `GITHUB_TOKEN`. The adapter reads up to five recent commits, their metadata, and up to ten patches per commit. Private repositories require a token with Contents: read permission. No repository write calls are implemented. See [GitHub's commits API](https://docs.github.com/en/rest/commits/commits).

For Sentry, set `SENTRY_ORGANIZATION`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` with project issue read access. The adapter retrieves up to ten unresolved issue summaries seen during the incident window. It does not currently retrieve full stack traces or release metadata. See [Sentry's project issues API](https://docs.sentry.io/api/events/list-a-projects-issues/).

Collection failures appear in the incident bundle and phone UI. Missing provider data never becomes fabricated evidence. The first implementation retrieves a bounded recent window; it does not paginate historical incidents or operate a monitoring daemon.

Live mode only permits health checks. Rollback remains limited to the local demo service until provider-specific deployment actions and their authorization are implemented.

## LAN connection

Set `GATEWAY_HOST=0.0.0.0` and a strong `GATEWAY_ACCESS_TOKEN` in the gateway environment, then enter the gateway URL and token in the phone's Connections panel. The token is stored through Android Secure Store. Use HTTPS or an SSH/ADB tunnel outside a trusted development network; this development gateway does not terminate TLS.

The gateway keeps a single-process action ledger in `.pocketsre-data/actions.json`. The ledger survives restarts, including in-flight actions, which are never automatically re-executed. Keep a single gateway process per ledger file. Authentication uses a shared token; users, roles, per-service authorization, and production deployment are future work.
