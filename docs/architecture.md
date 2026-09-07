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
2. The phone redacts and ranks evidence before local inference.
3. Model output is untrusted and must pass schema, evidence, and action validation.
4. Read and write connector interfaces remain separate.
5. A write operation requires an `ApprovedActionRequest` created after user confirmation.

## Local AI modes

- **Llama mode:** `llama.rn` loads a GGUF model and requests schema-shaped JSON.
- **Organizer runtime (planned):** an adapter can replace GGUF inference once the organizer's runtime is available; this integration is not implemented.
- **Deterministic mode:** the shared incident engine supplies an evidence-backed fallback for development, automated tests, and live-demo resilience.

Deterministic mode is clearly labelled in the UI and must not be presented as model inference.
