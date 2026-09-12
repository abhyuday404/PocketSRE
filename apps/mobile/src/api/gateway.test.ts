import { afterEach, expect, it, vi } from 'vitest';
import { configureGateway, removeProject, saveProjectHealth } from './gateway';

afterEach(() => {
  vi.unstubAllGlobals();
  configureGateway({ url: 'http://127.0.0.1:4100', token: '' });
});

it('sends authenticated removal without declaring an empty JSON body', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ removed: true }));
  vi.stubGlobal('fetch', fetcher);
  configureGateway({ url: 'http://localhost:4100', token: 'test-gateway' });
  await removeProject('project-id');
  const [url, request] = fetcher.mock.calls[0]!;
  expect(url).toBe('http://localhost:4100/v1/projects/project-id');
  expect(request.method).toBe('DELETE');
  expect(request.body).toBeUndefined();
  expect(request.headers.authorization).toBe('Bearer test-gateway');
  expect(request.headers['content-type']).toBeUndefined();
});

it('retains JSON encoding for project settings with a payload', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ message: 'fixture rejection' }, { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(saveProjectHealth('project-id', 'https://example.com/health')).rejects.toThrow(
    'fixture rejection',
  );
  const [, request] = fetcher.mock.calls[0]!;
  expect(request.headers['content-type']).toBe('application/json');
  expect(JSON.parse(request.body)).toEqual({ healthUrl: 'https://example.com/health' });
});
