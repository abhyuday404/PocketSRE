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
        'content-type': 'application/json',
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

export async function fetchFixConfig() {
  return FixConfigSchema.parse(await request('/v1/fixes/config'));
}
export async function fetchFixContext(incidentId: string, paths: string[], task?: AgentTask) {
  return FixContextSchema.parse(
    await request('/v1/fixes/context', {
      method: 'POST',
      body: JSON.stringify({ incidentId, paths, task }),
    }),
  );
}
export async function prepareFix(contextId: string, proposal: FixProposal) {
  return FixDraftSchema.parse(
    await request('/v1/fixes/prepare', {
      method: 'POST',
      body: JSON.stringify({ contextId, proposal }),
    }),
  );
}
export async function publishFix(approval: {
  draftId: string;
  requestId: string;
  approvedAt: string;
}) {
  return ActionResultSchema.parse(
    await request('/v1/fixes/execute', { method: 'POST', body: JSON.stringify(approval) }),
  );
}
