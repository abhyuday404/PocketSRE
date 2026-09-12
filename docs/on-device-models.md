# On-device model downloads

In **Settings → On-device model**, open the dropdown and choose a model, then
press **Download**. The same dropdown includes saved models, **Use local rules**,
and **Import GGUF model**. Only the chosen model's details are shown. The app
shows transfer progress, verifies the file, and then offers **Use**. Selection is
explicit: finishing a download never swaps the runtime during an active request.
After selection, chat, incident analysis, and patch drafting use the existing
`llama.rn` runtime. Model switching is disabled while a request is running.

| Model                               | Download                       | Suggested phone RAM | Intended use                                        | Publisher and license                                                                 |
| ----------------------------------- | ------------------------------ | ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Qwen3 0.6B, Q4_K_M                  | 396,705,472 bytes (~397 MB)    | 4 GB+               | Default starting point; short chat and explanations | [Unsloth GGUF](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF), Apache 2.0            |
| Qwen2.5-Coder 0.5B Instruct, Q4_K_M | 491,400,064 bytes (~491 MB)    | 4 GB+               | Short code questions and simple drafts              | [Qwen GGUF](https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF), Apache 2.0 |
| Qwen3 1.7B, Q4_K_M                  | 1,107,409,472 bytes (~1.11 GB) | 6 GB+               | Larger model for more detailed answers              | [Unsloth GGUF](https://huggingface.co/unsloth/Qwen3-1.7B-GGUF), Apache 2.0            |

Additional choices are Qwen2.5-Coder 1.5B (1,117,320,768 bytes, ~1.12 GB, suggested
6 GB+ phone RAM) and Qwen3 4B (2,497,281,312 bytes, ~2.50 GB, suggested 8 GB+ RAM).
Both use Q4_K_M and Apache 2.0: [Qwen2.5-Coder source](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF)
and [Qwen3 4B source](https://huggingface.co/unsloth/Qwen3-4B-GGUF).
“Qwen2.5” identifies the family; its catalog variants have 0.5B and 1.5B parameters.

RAM figures are conservative starting guidance, not measured device guarantees.
Available memory, context size, thermal limits, and other apps affect inference.
Small models can produce weak answers. Incident conclusions still go through
evidence-ID validation; failed or unverified analysis falls back to local rules.

## Download and storage behavior

- No Hugging Face account, token, gateway, or model download is needed to browse
  the bundled catalog. Downloads start only after the user presses Download.
- Files come directly from public HTTPS URLs pinned to immutable repository
  revisions. The catalog records publisher sizes and LFS SHA-256 digests.
- The app requires the file size plus 128 MiB of free storage before starting.
  A later disk-full or network failure leaves the selected model unchanged.
- One download runs at a time. Switching tabs retains progress. Keep the app open;
  OS suspension can interrupt a transfer. There is no promise of background or
  cross-restart resumption. Retry starts a fresh download.
- Cancel works during transfer and verification. A connection without progress
  for 90 seconds is cancelled with a retry message. Native completion is awaited
  before removing partial files or allowing another attempt.
- Size, GGUF magic/version, and SHA-256 must all pass before promotion from `.part`
  to `.gguf`. Hashing reads at most 256 KiB at a time and yields between chunks.
  It never loads the whole model into JavaScript memory.
- Files live under the app document directory in `pocketsre-models/`. An app
  restart discovers completed files even if saving the library entry was
  interrupted, and clears unfinished catalog downloads. Completed files can be
  selected offline without downloading again.
- **Remove** deletes an unused catalog model. Select local rules or another model
  before removing the selected one. Imported models remain available through the
  existing model picker; downloading does not remove them.
- **Use local rules** retains downloaded files and restores deterministic triage.
  GitHub operations still require a connection and the explicit action boundary.

The catalog is in `apps/mobile/src/models/catalog.ts`. To change a model, verify
its public GGUF URL, license, llama.cpp architecture/chat-template compatibility,
exact size, and SHA-256 through the publisher's metadata. Pin a commit revision;
do not use a moving `main` download URL or place weights in the repository.

## Verification

Physical-device smoke test on 2026-09-13 (vivo I2501, Android development build):

- The real Qwen2.5-Coder 0.5B transfer displayed download percentage, bytes, and
  the progress bar, then switched to verification progress (observed through 67%).
- Its 491,400,064-byte file matched the pinned SHA-256 independently on Android.
  Reopening the development-client URL interrupted verification by reloading the
  app. Two subsequent direct phone downloads failed with network errors.
- To finish the inference test, the same pinned file was downloaded on the
  computer, SHA-256 checked, transferred into the phone's app model directory,
  and SHA-256 checked again. No weights were placed in the repository.
- A temporary harness called the actual `LlamaRnTriageEngine.chat` on that phone
  with: “Write a Python function add(a, b) that returns their sum. Reply with only
  the short function.” It streamed and returned `def add(a, b): return a + b`,
  with `limited: false`, in 1,843 ms including context initialization. The harness
  released the context afterward and was removed from the source.
- This proves the 0.5B file loads and generates through the app's native engine.
  It does not establish larger-model quality or an uninterrupted completion of
  the phone's download-and-verification flow on this connection.

Run `pnpm typecheck`, `pnpm test`, and `pnpm export:android`. Download-manager tests
cover cancellation, stalls, concurrency, storage exhaustion, checksum failure,
retries, restart recovery, and selection protection. Component tests cover catalog
actions, progress, busy states, selection persistence failures, local rules, and
import completion ordering. Hash tests include a digest computed independently
with Node crypto, corrupt data, truncation, and cancellation between chunks.

For native device validation, download Qwen3 0.6B, cancel during transfer, restart
the download, switch tabs and return, wait for checksum verification, select it,
and send a short temporary-chat message. Restart the app and confirm the file
remains selectable offline. Switch to local rules, remove the model, and confirm
the storage is reclaimed. Network-transfer and inference performance must be
checked on a phone; passing JavaScript tests alone does not establish them.
