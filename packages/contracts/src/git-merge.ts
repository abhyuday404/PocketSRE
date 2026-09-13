import { z } from 'zod';
export const GitMergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);
export type GitMergeMethod = z.infer<typeof GitMergeMethodSchema>;
export const GitMergeRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    approvedAt: z.string().datetime(),
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/),
    baseRef: z.string().min(1).max(255),
    method: GitMergeMethodSchema,
  })
  .strict();
export type GitMergeRequest = z.infer<typeof GitMergeRequestSchema>;
export const GitMergePreviewSchema = z.object({
  number: z.number(),
  title: z.string(),
  repository: z.string(),
  headRef: z.string(),
  sha: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  merged: z.boolean(),
  draft: z.boolean().default(false),
  canMarkReady: z.boolean().default(false),
  ready: z.boolean(),
  reasons: z.array(z.string()),
  methods: z.array(GitMergeMethodSchema),
  checks: z.array(z.object({ name: z.string(), state: z.string() })),
});
export type GitMergePreview = z.infer<typeof GitMergePreviewSchema>;
/** Conservative eligibility: incomplete checks and any protection-related state require refresh. */
export function mergeBlockers(input: {
  open: boolean;
  draft: boolean;
  merged: boolean;
  push: boolean;
  mergeable: boolean | null;
  state: string;
  methods: GitMergeMethod[];
  complete: boolean;
  checks: { name: string; state: string }[];
}): string[] {
  const reasons: string[] = [];
  if (input.merged) return ['This pull request is already merged.'];
  if (!input.open) reasons.push('This pull request is closed.');
  if (input.draft) reasons.push('Mark this draft ready for review on GitHub first.');
  if (!input.push) reasons.push('Your GitHub account needs write access to this repository.');
  if (!input.methods.length)
    reasons.push('This repository does not allow a supported merge method.');
  if (input.mergeable === false) reasons.push('Resolve merge conflicts on GitHub first.');
  else if (input.mergeable === null || input.state === 'unknown')
    reasons.push('GitHub is still calculating mergeability. Refresh shortly.');
  else if (input.state !== 'clean')
    reasons.push(
      `GitHub merge status is ${input.state}. Resolve outstanding reviews, checks or branch requirements on GitHub, then refresh.`,
    );
  if (!input.complete) reasons.push('The check list is incomplete. Review this PR on GitHub.');
  if (input.checks.some((c) => !['success', 'neutral', 'skipped'].includes(c.state)))
    reasons.push('Wait for all checks to finish successfully before merging in the app.');
  return reasons;
}

export const GitReadyRequestSchema = GitMergeRequestSchema.pick({
  requestId: true,
  approvedAt: true,
  sha: true,
});
export type GitReadyRequest = z.infer<typeof GitReadyRequestSchema>;
