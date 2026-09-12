# On-device fixes and GitHub pull requests

The Fixes tab reads source through the gateway, asks a local GGUF model for exact replacements, presents every replacement on the phone, and creates a draft GitHub PR after approval. It does not merge a PR, run repository code, or deploy. Existing repository automation may run when a branch or PR is created.

## Model

In Settings, use **Import GGUF model** to select a compatible local file. PocketSRE checks the GGUF header and copies the file into its private documents directory. The selected path is saved on the device. Files are never uploaded to GitHub. Importing a new file retains earlier imported models; **Use local rules** disables model use without deleting them. `EXPO_PUBLIC_MODEL_PATH` remains the development default when no device setting is saved.

Diagnosis retains its deterministic fallback when a model is absent, unavailable, or returns an invalid diagnosis. Code patches require a working model: there is no fabricated rule-based patch fallback. The runtime uses an 8192-token context, four CPU threads by default, and bounded output. Fix prompts exceeding the input budget are rejected with a request for fewer files. Hardware acceleration still follows `EXPO_PUBLIC_ACCELERATOR`; GPU/NPU compatibility must be verified on each device.

The sampling grammar restricts evidence references and file paths to the supplied snapshot. Large string limits are enforced after generation on the phone and gateway because the native grammar compiler rejects repetitions above 2,000. Hybrid-model state is cleared between requests. If an Expo development build reports an unknown module when loading `llama.rn`, restart Metro with `EXPO_NO_METRO_LAZY=1` and clear its cache (`pnpm --filter @pocketsre/mobile start --clear`). An ignored `apps/mobile/.env.local` can hold that development setting.

## Gateway configuration

Configure live health as described in [connectors](connectors.md). Set:

```dotenv
POCKETSRE_MODE=live
GITHUB_REPOSITORY=owner/repository
GITHUB_FIX_PATHS=src/server.ts,src/checkout.ts
```

Supply `GITHUB_FIX_TOKEN` through the gateway process environment or a private environment file outside the repository. Use a credential restricted to that repository, with **Contents: write** and **Pull requests: write**. Keep the existing read-only `GITHUB_TOKEN` separate where possible. Never put credentials in a tracked file or send provider tokens to the phone. The gateway must run in live mode; demo mode cannot publish GitHub fixes.

The source reader uses the repository's default branch. Configure at most 20 exact file paths, then select at most three per fix. Total source is limited to 12 KB. Only existing regular text files are supported; symlinks, submodules, model files, private keys, `.env` files, `.github` workflows, and paths outside the configured list are rejected. Known credential signatures in source and generated changes are rejected, but this check is not a comprehensive secret scanner. Configure ordinary source files that are appropriate to copy to the phone.

For local development, `GITHUB_USE_CLI=1` uses an already authenticated GitHub CLI session instead of extracting a token. The transport pins `github.com`, permits only GET/POST requests within the configured repository, and invokes `gh` without a shell. Setting `GITHUB_FIX_PATHS` opts into reviewed PR writes in this mode. The CLI's existing account permissions still apply; use a dedicated, restricted credential for a hosted gateway.

## Review and publish

1. Refresh a live incident and open **Fixes**.
2. Select the relevant source files and tap **Draft fix on this phone**.
3. Read each reason, evidence reference, and exact remove/insert block. The patch is an untested hypothesis; valid citations do not establish causality or correctness.
4. Tap **Create draft pull request** and approve the displayed repository, base commit, and files.
5. Review the PR and run repository CI. Merge and deployment happen through your normal workflow.

The gateway owns the immutable source snapshot and prepared draft. It validates evidence IDs against the incident bundle, exact unique source matches, allowed paths, and the current base-branch commit. Snapshots expire after 15 minutes. Changed incident identity, release, evidence, or branch head requires another draft. It preserves the base tree, parent commit, file modes, and unrelated files; it creates only a new `pocketsre/fix-<draft-id>` branch and a draft PR.

Publication uses the existing action ledger and shared action lock. An approval can be retried with the same request ID to retrieve its result. Once provider writes may have started, a second approval ID cannot republish the same draft. On an ambiguous failure, inspect the reported branch and PR in GitHub rather than blindly generating another fix. In-flight records survive gateway restarts; source snapshots and pending drafts are memory-only and are discarded on restart. Run one gateway process per ledger file.

## Verification boundaries

Tests cover exact replacements, invented evidence, stale branches and incidents, repeated approvals, ambiguous provider failures, authentication, disabled demo writes, immutable source reads, symlink rejection, and GitHub tree/commit/branch/PR request semantics. These checks do not establish model quality, real account permissions, hardware performance, or production recovery. Record device and live repository test outcomes separately.

### Device smoke test: 2026-09-12

An iQOO 15 (SM8850, Android 16, approximately 16 GB RAM) imported Qwen3.5-4B Q6_K (3,525,956,768 bytes; SHA-256 `fdedd781c9ce676ab66b018ca247ff78e8a33c98098a822c1e2d5075e7718f66`). With CPU inference, the app identified an intentional checkout arithmetic bug, proposed addition-to-multiplication, validated the exact edit and citations, and published a draft PR in a private fixture repository. The unchanged assertions passed when the exact proposed patch was tested separately, and the PR's GitHub Actions checkout self-test passed. No merge or deployment was performed.

Observed CPU runs generated approximately 7–9 tokens/second; one accepted response took about 46 seconds for prompt processing and 139 seconds for generation. It cited every supplied health event, so subsequent sampling limits citations to three per conclusion. These are smoke-test observations, not a representative model-quality benchmark.

An experimental run requesting GPU offload initialized but aborted in native graph computation with a destroyed-mutex error. Its cause was not isolated; CPU remains the verified configuration for this phone/model/runtime combination. Accelerator availability flags alone do not establish successful accelerated inference.

GitHub API references: [trees](https://docs.github.com/en/rest/git/trees), [references](https://docs.github.com/en/rest/git/refs), and [pull requests](https://docs.github.com/en/rest/pulls/pulls).
