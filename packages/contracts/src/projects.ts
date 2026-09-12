import { z } from 'zod';

export const RepositoryNameSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
export const GitHubRepositorySchema = z.object({
  id: z.number().int().positive(),
  fullName: RepositoryNameSchema,
  private: z.boolean(),
  defaultBranch: z.string().min(1).max(255),
});
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;
export const RepositoryPageSchema = z.object({
  repositories: z.array(GitHubRepositorySchema),
  nextPage: z.number().int().positive().nullable(),
});
export const GitHubConnectionSchema = z.object({
  enabled: z.boolean(),
  connected: z.boolean(),
  canSignIn: z.boolean(),
  account: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  installationUrl: z
    .string()
    .regex(/^https:\/\/github\.com\/apps\/[a-z0-9-]+\/installations\/new$/)
    .nullable()
    .default(null),
});
export const GitHubDeviceSchema = z.object({
  id: z.string().uuid(),
  userCode: z.string().min(1).max(32),
  verificationUrl: z.literal('https://github.com/login/device'),
  expiresAt: z.string().datetime(),
  interval: z.number().int().positive(),
});
export type GitHubDevice = z.infer<typeof GitHubDeviceSchema>;
export const GitHubPollSchema = z.object({
  status: z.enum(['pending', 'connected', 'expired', 'denied']),
  interval: z.number().int().positive(),
});
export const ProjectHealthUrlSchema = z
  .string()
  .max(2048)
  .url()
  .regex(
    /^https?:\/\/[^/?#@\\\s]+(?:\/[^?#\\\s]*)?$/,
    'Use an HTTP(S) health URL without credentials, query parameters, or a fragment.',
  );
export const TrackedProjectSchema = z.object({
  id: z.string().uuid(),
  repository: GitHubRepositorySchema,
  healthUrl: ProjectHealthUrlSchema.nullable(),
  createdAt: z.string().datetime(),
  monitoring: z.boolean().default(false),
  deployment: z
    .object({
      provider: z.literal('vercel'),
      projectId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
      name: z.string().max(200),
      target: z.enum(['production', 'preview']),
    })
    .nullable()
    .default(null),
  sourcePaths: z.array(z.string().min(1).max(200)).max(20).default([]),
});
export type TrackedProject = z.infer<typeof TrackedProjectSchema>;
export const DeploymentProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  repository: z.string().nullable(),
  suggested: z.boolean(),
});
export const DeploymentPageSchema = z.object({
  projects: z.array(DeploymentProjectSchema),
  next: z.string().nullable(),
});
export const DeploymentConnectionSchema = z.object({
  connected: z.boolean(),
  teamId: z.string().nullable(),
});
export const MonitorStatusSchema = z.object({
  enabled: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  status: z.enum(['healthy', 'degraded', 'down', 'unknown']).nullable(),
  alertOpen: z.boolean(),
  failures: z.number(),
  error: z.string().nullable(),
});
export const PushTokenSchema = z
  .string()
  .max(300)
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/);
