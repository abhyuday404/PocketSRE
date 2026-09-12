import {
  ActionResultSchema,
  IncidentBundleSchema,
  type ApprovedActionRequest,
  type IncidentBundle,
  AuditEntrySchema,
  FixConfigSchema,
  FixContextSchema,
  FixDraftSchema,
  type FixProposal,
  type AgentTask,
  GitHubConnectionSchema,
  GitHubDeviceSchema,
  GitHubPollSchema,
  RepositoryPageSchema,
  TrackedProjectSchema,
  DeploymentPageSchema,
  DeploymentConnectionSchema,
  MonitorStatusSchema,
} from '@pocketsre/contracts';
import type { ConnectionSettings } from '../settings/connection';

let gatewayUrl = (process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:4100').replace(
  /\/$/,
  '',
);
let gatewayToken = '';
export function configureGateway(settings: ConnectionSettings): void {
  gatewayUrl = settings.url;
  gatewayToken = settings.token;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${gatewayUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body != null ? { 'content-type': 'application/json' } : {}),
        ...(gatewayToken ? { authorization: `Bearer ${gatewayToken}` } : {}),
        ...init?.headers,
      },
    });

    const payload: unknown = await response.json();
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload
          ? String(payload.message)
          : `Gateway request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCurrentIncident(): Promise<IncidentBundle> {
  return IncidentBundleSchema.parse(await request('/v1/incidents/current'));
}

export async function fetchGitHubConnection() {
  return GitHubConnectionSchema.parse(await request('/v1/github/connection'));
}
export async function startGitHubSignIn() {
  return GitHubDeviceSchema.parse(
    await request('/v1/github/device', { method: 'POST', body: '{}' }),
  );
}
export async function pollGitHubSignIn(id: string) {
  return GitHubPollSchema.parse(
    await request('/v1/github/device/poll', { method: 'POST', body: JSON.stringify({ id }) }),
  );
}
export async function disconnectGitHub() {
  await request('/v1/github/connection', { method: 'DELETE' });
}
export async function fetchGitHubRepositories(page = 1) {
  return RepositoryPageSchema.parse(await request(`/v1/github/repositories?page=${page}`));
}
export async function fetchProjects() {
  const value = (await request('/v1/projects')) as { projects: unknown };
  return TrackedProjectSchema.array().parse(value.projects);
}
export async function trackProject(repository: string) {
  return TrackedProjectSchema.parse(
    await request('/v1/projects', { method: 'POST', body: JSON.stringify({ repository }) }),
  );
}
export async function saveProjectHealth(id: string, healthUrl: string | null) {
  return TrackedProjectSchema.parse(
    await request(`/v1/projects/${encodeURIComponent(id)}/health`, {
      method: 'PUT',
      body: JSON.stringify({ healthUrl }),
    }),
  );
}
export async function removeProject(id: string) {
  await request(`/v1/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function fetchProjectIncident(id: string) {
  return IncidentBundleSchema.parse(
    await request(`/v1/projects/${encodeURIComponent(id)}/incident`),
  );
}

export async function injectDemoRegression(): Promise<void> {
  await request('/v1/demo/break', { method: 'POST', body: '{}' });
}

export async function resetDemo(): Promise<void> {
  await request('/v1/demo/reset', { method: 'POST', body: '{}' });
}

export async function executeApprovedAction(action: ApprovedActionRequest) {
  return ActionResultSchema.parse(
    await request('/v1/actions/execute', { method: 'POST', body: JSON.stringify(action) }),
  );
}

export function getGatewayUrl(): string {
  return gatewayUrl;
}

export async function fetchAudit() {
  const payload = (await request('/v1/actions/audit')) as { entries: unknown };
  return AuditEntrySchema.array().parse(payload.entries);
}
export async function fetchGatewayMode(): Promise<'demo' | 'live'> {
  const payload = (await request('/v1/config')) as { mode: unknown };
  if (payload.mode !== 'demo' && payload.mode !== 'live') throw new Error('Unknown gateway mode.');
  return payload.mode;
}

const fixPath = (operation: string, projectId?: string) =>
  projectId
    ? `/v1/projects/${encodeURIComponent(projectId)}/fixes/${operation}`
    : `/v1/fixes/${operation}`;
export async function fetchFixConfig(projectId?: string) {
  return FixConfigSchema.parse(await request(fixPath('config', projectId)));
}
export async function fetchFixContext(
  incidentId: string,
  paths: string[],
  task?: AgentTask,
  projectId?: string,
) {
  return FixContextSchema.parse(
    await request(fixPath('context', projectId), {
      method: 'POST',
      body: JSON.stringify({ incidentId, paths, task }),
    }),
  );
}
export async function prepareFix(contextId: string, proposal: FixProposal, projectId?: string) {
  return FixDraftSchema.parse(
    await request(fixPath('prepare', projectId), {
      method: 'POST',
      body: JSON.stringify({ contextId, proposal }),
    }),
  );
}
export async function publishFix(
  approval: {
    draftId: string;
    requestId: string;
    approvedAt: string;
  },
  projectId?: string,
) {
  return ActionResultSchema.parse(
    await request(fixPath('execute', projectId), {
      method: 'POST',
      body: JSON.stringify(approval),
    }),
  );
}
export async function fetchVercelConnection() {
  return DeploymentConnectionSchema.parse(await request('/v1/providers/vercel'));
}
export async function connectVercel(token: string, teamId: string) {
  return DeploymentConnectionSchema.parse(
    await request('/v1/providers/vercel', {
      method: 'PUT',
      body: JSON.stringify({ token, teamId }),
    }),
  );
}
export async function disconnectVercel() {
  return DeploymentConnectionSchema.parse(
    await request('/v1/providers/vercel', { method: 'DELETE' }),
  );
}
export async function fetchDeploymentProjects(id: string, cursor?: string) {
  return DeploymentPageSchema.parse(
    await request(
      `/v1/projects/${id}/deployments/available${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  );
}
export async function bindDeployment(
  id: string,
  projectId: string | null,
  target: 'production' | 'preview',
) {
  return TrackedProjectSchema.parse(
    await request(`/v1/projects/${id}/deployment`, {
      method: 'PUT',
      body: JSON.stringify({ projectId, target }),
    }),
  );
}
export async function saveProjectSource(id: string, paths: string[]) {
  return TrackedProjectSchema.parse(
    await request(`/v1/projects/${id}/source`, { method: 'PUT', body: JSON.stringify({ paths }) }),
  );
}
export async function setProjectMonitoring(id: string, enabled: boolean) {
  return TrackedProjectSchema.parse(
    await request(`/v1/projects/${id}/monitor`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  );
}
export async function fetchMonitorStatus(id: string) {
  return MonitorStatusSchema.parse(await request(`/v1/projects/${id}/monitor`));
}
export async function subscribeProjectNotifications(
  id: string,
  deviceId: string,
  token: string | null,
) {
  return (await request(`/v1/projects/${id}/notifications`, {
    method: 'PUT',
    body: JSON.stringify({ deviceId, token }),
  })) as { gatewayId: string; enabled: boolean };
}
