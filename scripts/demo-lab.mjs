/** Private PC project deployer. Only repositories explicitly listed in its external config run. */
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const directory = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
const states = new Map();
await mkdir(join(directory, 'state'), { recursive: true, mode: 0o700 });
await mkdir(join(directory, 'checkouts'), { recursive: true, mode: 0o700 });
for (const project of config.projects) {
  if (
    !/^[a-z0-9-]+$/.test(project.name) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.repository) ||
    !Number.isInteger(project.port)
  )
    throw Error('Invalid project configuration');
  let previous;
  try {
    previous = JSON.parse(await readFile(join(directory, 'state', `${project.name}.json`), 'utf8'));
  } catch {}
  states.set(project.name, {
    project,
    sha: null,
    process: null,
    events: previous?.repository === project.repository ? previous.events.slice(-100) : [],
    writes: Promise.resolve(),
  });
}
function log(state, kind, level, message) {
  state.events.push({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    kind,
    level,
    message: message.slice(0, 2000),
    sha: state.sha,
  });
  state.events = state.events.slice(-150);
  const value = JSON.stringify({
    repository: state.project.repository,
    name: state.project.name,
    sha: state.sha,
    events: state.events,
  });
  const path = join(directory, 'state', `${state.project.name}.json`);
  state.writes = state.writes
    .then(async () => {
      await writeFile(`${path}.tmp`, value, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    })
    .catch(() => console.error('Could not save deployment logs'));
}
async function stop(state) {
  const child = state.process;
  state.process = null;
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
async function deploy(state) {
  const project = state.project,
    checkout = join(directory, 'checkouts', project.name);
  const git = (args) =>
    exec('git', ['-C', checkout, ...args], {
      timeout: 20000,
      maxBuffer: 100000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  try {
    try {
      await readFile(join(checkout, '.git', 'config'));
    } catch {
      await exec(
        'git',
        ['clone', '--quiet', `https://github.com/${project.repository}.git`, checkout],
        { timeout: 30000, maxBuffer: 100000 },
      );
    }
    await git(['fetch', '--quiet', 'origin', 'main']);
    const sha = (await git(['rev-parse', 'origin/main'])).stdout.trim();
    if (sha === state.sha) return;
    await stop(state);
    state.sha = sha;
    log(state, 'build', 'info', `Deploying ${project.repository}@${sha} from main`);
    await git(['reset', '--hard', sha]);
    await exec(process.execPath, ['--check', 'src/service.mjs'], { cwd: checkout, timeout: 5000 });
    await exec(process.execPath, ['--check', 'server.mjs'], { cwd: checkout, timeout: 5000 });
    log(
      state,
      'build',
      'info',
      'Syntax checks passed. Starting service; semantic health is evaluated at runtime.',
    );
    // Repository code receives no GitHub, gateway, cloud-model or deployment credentials.
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: checkout,
      env: { PORT: String(project.port), NODE_ENV: 'production', PATH: '/usr/bin:/bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    state.process = child;
    for (const [stream, level] of [
      [child.stdout, 'info'],
      [child.stderr, 'error'],
    ])
      stream.on('data', (chunk) => {
        for (const line of String(chunk).slice(0, 8000).split('\n').filter(Boolean))
          log(state, 'runtime', level, line);
      });
    child.on('error', () => log(state, 'runtime', 'error', 'Could not start the service process'));
    child.on('exit', (code, signal) => {
      if (state.process === child) {
        state.process = null;
        log(state, 'runtime', 'error', `Service exited (${code ?? signal})`);
      }
    });
    log(
      state,
      'build',
      'info',
      `Deployment launched at commit ${sha}; health monitor will verify availability.`,
    );
  } catch (error) {
    log(state, 'build', 'error', `Deployment failed: ${String(error.message).slice(0, 1000)}`);
  }
}
const server = createServer(async (req, res) => {
  const match = /^\/([a-z0-9-]+)\/(health|api)$/.exec(req.url ?? '');
  const state = match && states.get(match[1]);
  res.setHeader('content-type', 'application/json');
  if (!state) {
    res.writeHead(404);
    res.end('{"error":"Unknown project"}');
    return;
  }
  try {
    if (!state.process) throw Error('Service is not running');
    const response = await fetch(`http://127.0.0.1:${state.project.port}/${match[2]}`, {
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    });
    res.writeHead(response.status);
    res.end((await response.text()).slice(0, 8000));
  } catch {
    res.writeHead(503);
    res.end(
      JSON.stringify({
        status: 'down',
        error: 'Deployment unavailable; inspect deployment logs',
        commit: state.sha,
      }),
    );
  }
});
server.listen(4300, '127.0.0.1');
let closing = false;
async function cycle() {
  for (const state of states.values()) {
    if (closing) return;
    await deploy(state);
  }
  if (!closing) setTimeout(() => void cycle(), 20000);
}
void cycle();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    closing = true;
    server.close();
    await Promise.all([...states.values()].map(stop));
    await Promise.all([...states.values()].map((state) => state.writes));
    process.exit(0);
  });
