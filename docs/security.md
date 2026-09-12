# Security boundaries

PocketSRE is a single-user development prototype, not a hardened production control plane.

## Credentials and data

- Provider tokens stay in gateway environment variables. The phone's gateway credential uses Expo Secure Store, backed by Android Keystore; do not put secrets in `EXPO_PUBLIC_*` variables.
- The gateway requires bearer authentication when its server entry point binds outside loopback. The demo service is unauthenticated and must stay on loopback or an isolated container network.
- Use HTTPS or a secure tunnel for remote access. The gateway does not terminate TLS, implement user accounts/RBAC, or rate-limit authenticated requests.
- Evidence is sanitized before inference, caching, and sharing. Redaction covers common token/header/connection-string/email patterns, but cannot guarantee detection of every secret format. Review exports before sharing externally.
- Offline bundles use private app document storage, not application-level encryption. Ten snapshots are retained. Exported files are outside the cache lifecycle; delete those separately.
- Raw provider responses are not logged. Connector failures return generic messages and source availability, not credentials.
- Live incident snapshots are sanitized before atomic persistence. They retain at most 500 events per bundle for seven days and 20 previous bundles for 30 days, pruned on refresh. Corrupt-file quarantines require manual cleanup and are never returned as evidence. Protect the data directory; see [incident storage](connectors.md#incident-continuity-and-retention).

## AI and execution

- Evidence is untrusted data, never an instruction source. Model output must pass the shared schema, existing-evidence-ID validation, confidence rules, and action validation.
- A valid citation proves only that the referenced item exists, not that a model's interpretation is true. Human review remains necessary.
- Connectors issue read-only GETs with bounded responses, timeouts, no redirects, and schema validation.
- Only application-allowlisted actions reach execution. Arbitrary shell commands and model-generated code are never executed.
- Rollback is limited to the controlled demo. The server independently verifies incident ID, a known current version, fresh observed unhealthy status, target service, and evidence of a previously healthy release. Unknown or unavailable health cannot authorize rollback. Approvals expire after two minutes. Read-only health checks accept an unknown expected version and report inconclusive collection as failure.
- The persistent ledger records accepted execution before dispatch and records the outcome afterward. Request IDs deduplicate retries; concurrent execution is refused. Rejected/malformed requests are not retained.
- In-flight entries surviving a restart are not automatically re-executed. Investigate uncertain outcomes before retrying with a new approval.
- The file ledger supports one process and is not a transactional distributed database. Protect its directory; production needs transactional storage, retention policies, access control, and provider-specific reconciliation.

## Laptop tools

The investigator reads bounded source files and `.env.example` key names. It does not execute repository code, read `.env`, run tests, or inspect production. Imported findings are untrusted evidence, not executable instructions. Investigation imports must match the current incident and cite existing evidence IDs.
