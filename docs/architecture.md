# Architecture

PocketSRE uses a strict evidence and action boundary.

```text
Operational APIs -> gateway -> sanitized incident bundle -> phone
                                                        |
                                           correlation + local LLM
                                                        |
                                      validated diagnosis with evidence IDs
                                                        |
                                   allowlisted proposal -> human approval
                                                        |
                                      gateway action -> health verification
```

## Trust boundaries

1. The gateway normalizes provider APIs but does not diagnose incidents.
2. The phone redacts and ranks evidence before inference. Local inference is the default; an explicit Settings choice can send context directly to a user-configured API provider.
3. Model output is untrusted and must pass schema, evidence, and action validation.
4. Read and write connector interfaces remain separate.
5. A write operation requires an `ApprovedActionRequest` created after user confirmation.

## Live incident state

The gateway collects health and configured providers independently, then commits a sanitized bundle to a single-service JSON store before returning it. Serialized refreshes merge bounded evidence and preserve the current incident ID/start time through outage, unknown health, restart and recovery. Only observed healthy data resolves an incident; a later outage opens a new one. The existing controlled demo continues to own its synthetic state. See [collection semantics and retention](connectors.md#incident-continuity-and-retention).

## Local AI modes

Optional cloud inference implements the same analysis, patch proposal, and chat interface through provider-specific adapters on the phone. The gateway has no AI API keys or cloud inference route. Cloud results retain the shared validation and action boundary; see [API model setup](api-models.md).

- **Llama mode:** `llama.rn` loads a GGUF model and requests schema-shaped JSON.
- **Organizer runtime (planned):** an adapter can replace GGUF inference once the organizer's runtime is available; this integration is not implemented.
- **Deterministic mode:** the shared incident engine supplies an evidence-backed fallback for development, automated tests, and live-demo resilience.

Deterministic mode is clearly labelled in the UI and must not be presented as model inference.
