# Security boundaries

PocketSRE is a single-user development prototype, not a hardened production control plane.

## Credentials and data

- Provider tokens stay in gateway environment variables. The phone's gateway credential uses Expo Secure Store, backed by Android Keystore; do not put secrets in `EXPO_PUBLIC_*` variables.
- The gateway requires bearer authentication when its server entry point binds outside loopback. The demo service is unauthenticated and must stay on loopback or an isolated container network.
- Use HTTPS or a secure tunnel for remote access. The gateway does not terminate TLS, implement user accounts/RBAC, or rate-limit authenticated requests.
- Evidence is sanitized before inference, caching, and sharing. Redaction covers common token/header/connection-string/email patterns, but cannot guarantee detection of every secret format. Review exports before sharing externally.
- Offline bundles use private app document storage, not application-level encryption. Ten snapshots are retained. Exported files are outside the cache lifecycle; delete those separately.
- Raw provider responses are not logged. Connector failures return generic messages and source availability, not credentials.

## AI and execution

- Evidence is untrusted data, never an instruction source. Model output must pass the shared schema, existing-evidence-ID validation, confidence rules, and action validation.
- A valid citation proves only that the referenced item exists, not that a model's interpretation is true. Human review remains necessary.
- Connectors issue read-only GETs with bounded responses, timeouts, no redirects, and schema validation.
- Only application-allowlisted actions reach execution. Arbitrary shell commands and model-generated code are never executed.
- Rollback is limited to the controlled demo. The server independently verifies incident ID, current version, target service, and evidence of a previously healthy release. Approvals expire after two minutes.
- The persistent ledger records accepted execution before dispatch and records the outcome afterward. Request IDs deduplicate retries; concurrent execution is refused. Rejected/malformed requests are not retained.
- In-flight entries surviving a restart are not automatically re-executed. Investigate uncertain outcomes before retrying with a new approval.
- The file ledger supports one process and is not a transactional distributed database. Protect its directory; production needs transactional storage, retention policies, access control, and provider-specific reconciliation.

## Laptop tools

The investigator reads bounded source files and `.env.example` key names. It does not execute repository code, read `.env`, run tests, or inspect production. Imported findings are untrusted evidence, not executable instructions. Investigation imports must match the current incident and cite existing evidence IDs.
