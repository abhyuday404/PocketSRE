import {
  ActionResultSchema,
  IncidentBundleSchema,
  type ApprovedActionRequest,
  type IncidentBundle,
} from '@pocketsre/contracts';

const gatewayUrl = (process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:4100').replace(
  /\/$/,
  '',
);

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Gateway request failed (${response.status}).`);
  return payload;
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
