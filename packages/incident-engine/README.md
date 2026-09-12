# Diagnosis evidence and validation

`createDeterministicDiagnosis` and mobile model output both pass through
`validateDiagnosis`. The public `Diagnosis` schema is unchanged. Successful
validation now also returns `validation.references: 'validated'` and
`validation.causality: 'not-verified'`. A valid citation identifies an observation;
it does **not** establish that a hypothesis is true. Consumers should present
causes as hypotheses and must not label structural validation as causal proof.

The deterministic engine recognizes one causal hypothesis: an explicit change
to `DB_URL` or `DATABASE_URL` matched to an exception reporting that **same**
setting missing. It checks service, release, commit associations when present,
and ordering before naming that hypothesis. Confidence is at most medium.
Database check failures alone are reported as observations, without claiming
either a configuration mismatch or an independent outage as the cause. Generic
configuration, authentication, cache and application failures do not activate
the database rule. Derived investigator results do not substitute for direct
failure observations or increase confidence through source counts.

Rules inspect the entire bundle before ranking. Ranking uses event type,
structured release identity and recency, with slots for changes, failures,
recovery and counterevidence. It has no database or checkout keyword bonus.
The prompt keeps citations supporting the rule assessment within its ten-event
budget. Rule output is context for the model, not a required wording template.

Time checks use `generatedAt`, never the wall clock: an archived bundle produces
the same result. Changes must fall within the incident window (starting one hour
before onset); a matched change must precede its exception by at most one hour.
Current observations and health must be no more than fifteen minutes old;
observations may precede recorded onset by up to five minutes. Five seconds of
future clock skew is tolerated for snapshot assembly. Older events, other
services/releases, conflicting health, and inconsistent deployment/onset timing
cannot justify an active causal hypothesis. These are conservative operational
defaults, not universal service-specific timing guarantees.

Model paraphrases and new hypotheses are allowed with current direct failure
citations and low confidence. Medium confidence additionally requires citations
to a matched rule's evidence; high confidence is rejected. Each alternative has
its own citation and confidence checks. Summaries require citations; the explicit
no-cause abstention is allowed without citations. Unknown or duplicate IDs are
rejected. Optional service/release metadata improves correlation; missing metadata
does not establish those associations, and rollback always requires an explicit
current release. Mechanical checks catch known freshness, health, release and timing
conflicts, but **do not verify arbitrary prose**, determine whether a new
hypothesis logically follows from an error, or prove that a proposed remedy will
work. A future claim schema or semantic evaluation could strengthen that limit.

Only health checks and verified rollbacks are accepted action proposals. Every
action needs its own existing incident citations. Rollback citations must include
the current deployment and a current-release failure after it; the target must
match its `previousHealthy=true` / `previousRelease` metadata. Unknown health or
release, unavailable health collection, resolved/recovered incidents,
pre-existing failures and conflicting promotions block eligibility. The
deterministic recommendation further requires the matched configuration change
to link to that deployment by release or commit. Actual mutation still requires
the gateway's existing explicit approval, target and version boundary. Diagnostic
text is not executable permission.

`sanitizeDiagnosis` redacts persisted prose and action parameter values while
preserving citation IDs. Validate before and after sanitization against the same
sanitized bundle. `sanitizeBundle` also redacts collection messages and source
labels while preserving their other fields.

`src/diagnosis.evaluation.test.ts` covers the controlled demo, unrelated failures,
independent database failure, insufficient/stale/contradictory/healthy evidence,
reference attacks, action boundaries, model paraphrases, new hypotheses, ranking
and sanitization. Mobile resilience tests exercise failed/invalid model output
and empty-bundle fallback without loading or downloading a model. Run the suite
with bounded workers, followed by workspace `pnpm typecheck` and `pnpm test`.

Validation on the Windows task worktree (2026-09-12):

- `pnpm typecheck --concurrency=1`: all six workspaces passed.
- `pnpm test --concurrency=1 --continue=always -- --maxWorkers=1 --no-file-parallelism`:
  82 tests passed, including 65 engine tests, 7 mobile tests and the gateway's
  approved rollback integration. One pre-existing investigator repository test
  failed while creating a file symlink (`EPERM`); its assertion body did not run.
- Changed files were formatted and `git diff --check` passed. No model was loaded
  or downloaded. Dependency installation succeeded using the cached packages and
  one worker after initial host memory failures.
