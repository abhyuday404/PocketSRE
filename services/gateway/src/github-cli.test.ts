import { describe, expect, it, vi } from 'vitest';
const execution = vi.hoisted(() => ({ run: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execution.run }));
import { createGitHubCliFetch } from './github-cli.js';

describe('local GitHub CLI transport', () => {
  it('rejects other hosts, repositories and destructive methods before invoking gh', async () => {
    execution.run.mockClear();
    const request = createGitHubCliFetch('owner/service');
    for (const url of [
      'https://example.com/repos/owner/service',
      'https://api.github.com/repos/owner/other',
      'https://api.github.com/repos/owner/service-other',
      'https://api.github.com/repos/owner/service/../../other',
    ])
      await expect(request(url)).rejects.toThrow(/outside/);
    await expect(
      request('https://api.github.com/repos/owner/service', { method: 'DELETE' }),
    ).rejects.toThrow(/outside/);
    expect(execution.run).not.toHaveBeenCalled();
  });
  it('uses fixed arguments and standard input without extracting credentials or launching a shell', async () => {
    execution.run.mockImplementation((_program, _args, _options, callback) => {
      callback(null, '{"number":1}');
      return { stdin: { end: execution.end, on: execution.on } };
    });
    const body = JSON.stringify({ title: 'Literal $(command) `data`' });
    const response = await createGitHubCliFetch('owner/service')(
      'https://api.github.com/repos/owner/service/pulls',
      { method: 'POST', body },
    );
    expect(await response.json()).toEqual({ number: 1 });
    const [program, args, options] = execution.run.mock.calls.at(-1)!;
    expect(program).toBe('gh');
    expect(args).toContain('/repos/owner/service/pulls');
    expect(args).toContain('--hostname');
    expect(args).not.toContain('auth');
    expect(options.shell).toBeUndefined();
    expect(execution.end).toHaveBeenLastCalledWith(body);
  });
  it('returns a generic failure without exposing command errors or provider output', async () => {
    execution.run.mockImplementation((_program, _args, _options, callback) => {
      callback(new Error('private details'), 'private response');
      return { stdin: { end: execution.end, on: execution.on } };
    });
    const response = await createGitHubCliFetch('owner/service')(
      'https://api.github.com/repos/owner/service',
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private');
  });
});
