import { z } from 'zod';

const text = z.string();
export const GitPullSchema = z.object({
  number: z.number().int().positive(),
  title: text,
  body: text.nullable(),
  state: text,
  draft: z.boolean().default(false),
  updated_at: text,
  user: z.object({ login: text }).nullable(),
  head: z.object({ ref: text, sha: text }),
  base: z.object({ ref: text, sha: text }),
});
export const GitCommitSchema = z.object({
  sha: text,
  commit: z.object({ message: text, author: z.object({ name: text, date: text }).nullable() }),
});
export const GitBranchSchema = z.object({
  name: text,
  protected: z.boolean(),
  commit: z.object({ sha: text }),
});
export const GitFileSchema = z.object({
  filename: text,
  previous_filename: text.optional(),
  status: text,
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
  patch: text.nullable(),
  patchTruncated: z.boolean(),
});
export const GitPullPageSchema = z.object({
  items: z.array(GitPullSchema),
  nextPage: z.number().nullable(),
});
export const GitCommitPageSchema = z.object({
  items: z.array(GitCommitSchema),
  nextPage: z.number().nullable(),
});
export const GitBranchPageSchema = z.object({
  items: z.array(GitBranchSchema),
  nextPage: z.number().nullable(),
});
export const GitDiffSchema = z.object({
  files: z.array(GitFileSchema),
  nextPage: z.number().nullable(),
  limited: z.boolean(),
  summary: text,
});
export type GitPull = z.infer<typeof GitPullSchema>;
export type GitCommit = z.infer<typeof GitCommitSchema>;
export type GitBranch = z.infer<typeof GitBranchSchema>;
export type GitFile = z.infer<typeof GitFileSchema>;
export type GitDiff = z.infer<typeof GitDiffSchema>;

export const GitCodeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  kind: z.enum(['directory', 'file', 'symlink', 'submodule']),
  size: z.number().nullable(),
});
export const GitCodeSchema = z.object({
  path: z.string(),
  ref: z.string(),
  kind: z.enum(['directory', 'file', 'symlink', 'submodule']),
  entries: z.array(GitCodeEntrySchema),
  truncated: z.boolean(),
  content: z.string().nullable(),
  reason: z.string().nullable(),
  size: z.number().nullable(),
});
export type GitCode = z.infer<typeof GitCodeSchema>;
