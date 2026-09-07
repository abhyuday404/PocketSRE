# Security model

- Provider tokens belong in Android Secure Store/Keystore or service environment variables.
- Never include authorization headers, tokens, cookies, connection strings, or credentials in an incident bundle.
- Redact evidence before persistence, inference, export, or logging.
- Request the smallest possible provider scopes.
- Keep connectors read-only by default.
- Restrict actions to an application-owned allowlist.
- Show the target, reason, evidence, reversibility, and risk before confirmation.
- Record an audit event for each requested and completed action.
- Validate all model output as hostile input.
- Do not execute model-generated shell commands.

The demo service is intentionally unauthenticated for local hackathon development. Do not expose it to a public network.
