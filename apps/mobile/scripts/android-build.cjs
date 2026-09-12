const { spawnSync } = require('node:child_process');
const {
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  copyFileSync,
  createReadStream,
  writeFileSync,
} = require('node:fs');
const { resolve, join } = require('node:path');
const { createHash } = require('node:crypto');
const {
  buildPlan,
  buildEnvironment,
  validateSigning,
  isInside,
} = require('./android-build-config.cjs');

const mobileRoot = resolve(__dirname, '..');
const repositoryRoot = resolve(mobileRoot, '../..');

async function main() {
  const command = process.argv[2];
  const plan = buildPlan(command, process.env);
  if (command === 'release') validateSigning(process.env, repositoryRoot);
  const nativeRoot = join(mobileRoot, 'android');
  // --clean deletes this generated directory. Never follow a redirected native directory.
  if (
    existsSync(nativeRoot) &&
    (lstatSync(nativeRoot).isSymbolicLink() ||
      !isInside(realpathSync(mobileRoot), realpathSync(nativeRoot)))
  ) {
    throw new Error('Refusing to clean a native Android directory outside apps/mobile.');
  }
  const env = buildEnvironment(plan, process.env);
  function run(executable, args, cwd = mobileRoot, options = {}) {
    const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${executable} failed (${result.signal || result.status}).`);
  }
  const pnpm = process.env.npm_execpath;
  if (!pnpm || !existsSync(pnpm))
    throw new Error(
      'Run this workflow through pnpm android:debug, android:internal, or android:release.',
    );
  for (const workspace of ['@pocketsre/contracts', '@pocketsre/incident-engine']) {
    run(process.execPath, [pnpm, '--filter', workspace, 'build'], repositoryRoot);
  }
  const expo = require.resolve('expo/bin/cli');
  run(process.execPath, [
    expo,
    'prebuild',
    '--platform',
    'android',
    '--clean',
    '--no-install',
    '--template',
    'expo-template-bare-minimum@57.0.24',
    '--skip-dependency-update',
    'react,react-native',
  ]);
  if (command === 'prebuild') return;
  // Also repairs native artifacts after a JS-only install skipped lifecycle downloads.
  run(process.execPath, [require.resolve('llama.rn/install/download-native-artifacts.js')]);
  const args = [
    plan.task,
    '--no-daemon',
    '--no-parallel',
    '--max-workers=1',
    '--console=plain',
    `-PreactNativeArchitectures=${plan.architectures}`,
    `-Dorg.gradle.jvmargs=${env.POCKETSRE_GRADLE_JVMARGS || '-Xmx1536m -XX:MaxMetaspaceSize=512m'}`,
  ];
  // Windows requires a command shell for Gradle's .bat wrapper. Only fixed/validated
  // task/ABI arguments go through it; signing values remain in the environment.
  if (
    process.platform === 'win32' &&
    env.POCKETSRE_GRADLE_JVMARGS &&
    !/^[-A-Za-z0-9=: +.]+$/.test(env.POCKETSRE_GRADLE_JVMARGS)
  ) {
    throw new Error('POCKETSRE_GRADLE_JVMARGS contains unsupported shell characters.');
  }
  run(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    process.platform === 'win32' ? args.map((arg) => `"${arg}"`) : args,
    nativeRoot,
    { shell: process.platform === 'win32' },
  );
  const source = join(nativeRoot, 'app/build/outputs', plan.output);
  if (!existsSync(source))
    throw new Error('Gradle returned success without the expected Android artifact.');
  const artifactRoot = join(repositoryRoot, 'artifacts/android');
  mkdirSync(artifactRoot, { recursive: true });
  const filename = `pocketsre-${command}.${command === 'release' ? 'aab' : 'apk'}`;
  const destination = join(artifactRoot, filename);
  copyFileSync(source, destination);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(destination)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  writeFileSync(`${destination}.sha256`, `${sha256}  ${filename}\n`);
  console.log(
    `Built ${destination}\nSHA-256 ${sha256}\nNative compilation is complete; installation and device smoke testing are separate checks.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
