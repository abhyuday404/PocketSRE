import { execFile } from 'node:child_process';

/** Local development transport: gh owns authentication; credentials never leave its store. */
export function createGitHubCliFetch(repository: string): typeof fetch {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Invalid GitHub repository.');
  return async (input, init) => {
    const url = new URL(String(input));
    const prefix = `/repos/${repository}`;
    const method = init?.method ?? 'GET';
    if (
      url.origin !== 'https://api.github.com' ||
      url.username ||
      url.password ||
      !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) ||
      !['GET', 'POST'].includes(method)
    )
      throw new Error('GitHub CLI request is outside the configured repository.');
    const args = [
      'api',
      '--hostname',
      'github.com',
      `${url.pathname}${url.search}`,
      '--method',
      method,
      '--header',
      'X-GitHub-Api-Version: 2026-03-10',
    ];
    if (init?.body !== undefined) args.push('--input', '-');
    return new Promise<Response>((resolve) => {
      const child = execFile(
        'gh',
        args,
        {
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 2_000_000,
          encoding: 'utf8',
          ...(init?.signal ? { signal: init.signal } : {}),
        },
        (error, stdout) => {
          resolve(
            error
              ? Response.json({ error: 'github_cli_request_failed' }, { status: 502 })
              : new Response(stdout, { headers: { 'content-type': 'application/json' } }),
          );
        },
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(init?.body === undefined ? undefined : String(init.body));
    });
  };
}
