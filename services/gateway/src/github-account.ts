import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  RepositoryNameSchema,
  type GitHubDevice,
  type GitHubRepository,
} from '@pocketsre/contracts';

export class ProjectRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}
const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: RepositoryNameSchema,
  private: z.boolean(),
  default_branch: z.string().min(1).max(255),
});
const repository = (value: unknown): GitHubRepository => {
  const repo = repositorySchema.parse(value);
  return {
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
  };
};

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProjectRequestError('GitHub returned an empty response.', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) throw new ProjectRequestError('GitHub returned too much data.', 502);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Single-owner gateway connection. Device credentials never leave process memory. */
export class GitHubAccount {
  private token?: string;
  private expires = Infinity;
  private account: string | null = null;
  private generation = 0;
  private pending?: { view: GitHubDevice; code: string; nextPoll: number };
  private busy = false;
  constructor(
    private options: {
      clientId?: string;
      appSlug?: string;
      token?: string;
      fetcher?: typeof fetch;
      now?: () => number;
    } = {},
  ) {
    if (options.appSlug && !/^[a-z0-9-]{1,100}$/.test(options.appSlug))
      throw new Error('Invalid GitHub App slug.');
    this.token = options.token;
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private credential() {
    if (!this.token || this.now() >= this.expires) {
      this.token = undefined;
      this.account = null;
      throw new ProjectRequestError('Connect GitHub again to read your repositories.', 401);
    }
    return this.token;
  }
  private async json(url: string, init: RequestInit) {
    const response = await (this.options.fetcher ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ProjectRequestError(
        response.status === 401
          ? 'GitHub access expired. Reconnect GitHub.'
          : response.status === 403 || response.status === 429
            ? 'GitHub denied access or rate-limited this request. Check repository access and try later.'
            : response.status === 404
              ? 'This repository is unavailable to the connected GitHub account.'
              : 'GitHub could not complete the request.',
        response.status === 401 ? 401 : 502,
      );
    }
    return boundedJson(response);
  }
  async api(path: string) {
    const credential = this.credential();
    try {
      return await this.json(`https://api.github.com${path}`, {
        headers: {
          authorization: `Bearer ${credential}`,
          accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'user-agent': 'PocketSRE/0.1',
        },
      });
    } catch (error) {
      if (
        error instanceof ProjectRequestError &&
        error.statusCode === 401 &&
        this.token === credential
      ) {
        this.token = undefined;
        this.account = null;
      }
      throw error;
    }
  }
  async readRepositoryResponse(
    repository: string,
    input: string | URL | Request,
    init?: RequestInit,
  ) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const prefix = `/repos/${RepositoryNameSchema.parse(repository)}`;
    if (
      url.origin !== 'https://api.github.com' ||
      !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) ||
      (init?.method && init.method !== 'GET')
    )
      throw new ProjectRequestError(
        'Only source reads from the selected repository are permitted.',
        403,
      );
    return (this.options.fetcher ?? fetch)(url.href, {
      ...init,
      method: 'GET',
      redirect: 'error',
      signal: init?.signal ?? AbortSignal.timeout(12000),
      headers: {
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        authorization: `Bearer ${this.credential()}`,
      },
    });
  }
  async status() {
    if (this.now() >= this.expires) {
      this.token = undefined;
      this.account = null;
    }
    if (this.token && !this.account) {
      const generation = this.generation;
      try {
        const value = z.object({ login: z.string() }).parse(await this.api('/user'));
        if (generation === this.generation) this.account = value.login;
      } catch (error) {
        if (!(error instanceof ProjectRequestError && error.statusCode === 401)) throw error;
      }
    }
    return {
      enabled: !!(this.options.clientId || this.options.token),
      connected: !!this.token,
      canSignIn: !!this.options.clientId,
      installationUrl: this.options.appSlug
        ? `https://github.com/apps/${this.options.appSlug}/installations/new`
        : null,
      account: this.account,
      expiresAt:
        this.token && Number.isFinite(this.expires) ? new Date(this.expires).toISOString() : null,
    };
  }
  disconnect() {
    this.generation++;
    this.token = undefined;
    this.account = null;
    this.pending = undefined;
  }
  private oauth(path: string, values: Record<string, string>) {
    return this.json(`https://github.com/login/${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ client_id: this.options.clientId!, ...values }).toString(),
    });
  }
  async start() {
    if (!this.options.clientId)
      throw new ProjectRequestError('GitHub sign-in is not configured on this gateway.', 409);
    if (this.busy)
      throw new ProjectRequestError('A GitHub authorization request is already in progress.', 409);
    if (this.pending && this.now() < Date.parse(this.pending.view.expiresAt))
      return this.pending.view;
    this.busy = true;
    const generation = this.generation;
    try {
      const value = z
        .object({
          device_code: z.string().min(1),
          user_code: z.string().min(1).max(32),
          verification_uri: z.literal('https://github.com/login/device'),
          expires_in: z.number().int().positive().max(3600),
          interval: z.number().int().min(1).max(300).default(5),
        })
        .parse(await this.oauth('device/code', {}));
      if (generation !== this.generation)
        throw new ProjectRequestError('GitHub sign-in was cancelled.', 409);
      const view: GitHubDevice = {
        id: randomUUID(),
        userCode: value.user_code,
        verificationUrl: value.verification_uri,
        expiresAt: new Date(this.now() + value.expires_in * 1000).toISOString(),
        interval: value.interval,
      };
      this.pending = {
        view,
        code: value.device_code,
        nextPoll: this.now() + value.interval * 1000,
      };
      return view;
    } finally {
      this.busy = false;
    }
  }
  async poll(id: string) {
    const pending = this.pending;
    if (!pending || pending.view.id !== id || this.now() >= Date.parse(pending.view.expiresAt))
      return { status: 'expired' as const, interval: 5 };
    if (this.busy || this.now() < pending.nextPoll)
      return { status: 'pending' as const, interval: pending.view.interval };
    this.busy = true;
    pending.nextPoll = this.now() + pending.view.interval * 1000;
    try {
      const value = z
        .object({
          error: z.string().optional(),
          access_token: z.string().min(1).optional(),
          expires_in: z.number().int().positive().optional(),
        })
        .parse(
          await this.oauth('oauth/access_token', {
            device_code: pending.code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        );
      if (this.pending !== pending) return { status: 'expired' as const, interval: 5 };
      if (value.error === 'authorization_pending')
        return { status: 'pending' as const, interval: pending.view.interval };
      if (value.error === 'slow_down') {
        pending.view.interval += 5;
        pending.nextPoll = this.now() + pending.view.interval * 1000;
        return { status: 'pending' as const, interval: pending.view.interval };
      }
      this.pending = undefined;
      if (value.error || !value.access_token)
        return {
          status: value.error === 'access_denied' ? ('denied' as const) : ('expired' as const),
          interval: 5,
        };
      this.generation++;
      this.token = value.access_token;
      this.expires = value.expires_in ? this.now() + value.expires_in * 1000 : Infinity;
      this.account = null;
      return { status: 'connected' as const, interval: 5 };
    } finally {
      this.busy = false;
    }
  }
  async repositories(page: number) {
    const values = z
      .array(repositorySchema)
      .max(50)
      .parse(await this.api(`/user/repos?per_page=50&page=${page}&sort=updated&direction=desc`));
    return {
      repositories: values.map(repository),
      nextPage: values.length === 50 ? page + 1 : null,
    };
  }
  async repository(name: string) {
    return repository(await this.api(`/repos/${RepositoryNameSchema.parse(name)}`));
  }
}
