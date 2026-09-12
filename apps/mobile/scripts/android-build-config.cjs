const { isAbsolute, relative, sep } = require('node:path');
const { realpathSync, statSync } = require('node:fs');

const signingKeys = [
  'POCKETSRE_ANDROID_KEYSTORE',
  'POCKETSRE_ANDROID_STORE_PASSWORD',
  'POCKETSRE_ANDROID_KEY_ALIAS',
  'POCKETSRE_ANDROID_KEY_PASSWORD',
];

function getProfile(value = 'development') {
  if (!['development', 'internal', 'production'].includes(value)) {
    throw new Error('POCKETSRE_ANDROID_PROFILE must be development, internal, or production.');
  }
  return value;
}

function isInside(directory, filename) {
  const path = relative(directory, filename);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function validateSigning(env, repositoryRoot) {
  const missing = signingKeys.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing release signing environment: ${missing.join(', ')}`);
  if (!isAbsolute(env.POCKETSRE_ANDROID_KEYSTORE)) {
    throw new Error('POCKETSRE_ANDROID_KEYSTORE must be an absolute path outside the repository.');
  }
  const keystore = realpathSync(env.POCKETSRE_ANDROID_KEYSTORE);
  if (isInside(realpathSync(repositoryRoot), keystore) || !statSync(keystore).isFile()) {
    throw new Error('Release keystore must be a file outside the repository.');
  }
  if (env.POCKETSRE_ANDROID_KEY_ALIAS.toLowerCase() === 'androiddebugkey') {
    throw new Error('Production builds require an upload/release key, not androiddebugkey.');
  }
}

function buildPlan(command, env) {
  if (!['prebuild', 'debug', 'internal', 'release'].includes(command)) {
    throw new Error('Usage: android-build.cjs prebuild|debug|internal|release');
  }
  const profile = {
    prebuild: 'development',
    debug: 'development',
    internal: 'internal',
    release: 'production',
  }[command];
  const architectures = env.POCKETSRE_ANDROID_ARCHS || 'arm64-v8a,x86_64';
  if (
    !/^(arm64-v8a|x86_64)(,(arm64-v8a|x86_64))?$/.test(architectures) ||
    new Set(architectures.split(',')).size !== architectures.split(',').length
  ) {
    throw new Error('POCKETSRE_ANDROID_ARCHS must be arm64-v8a, x86_64, or arm64-v8a,x86_64.');
  }
  if (command === 'release' && architectures !== 'arm64-v8a,x86_64') {
    throw new Error(
      'Production builds must include both supported 64-bit ABIs. Unset POCKETSRE_ANDROID_ARCHS.',
    );
  }
  return {
    profile,
    architectures,
    task:
      command === 'release'
        ? ':app:bundleRelease'
        : command === 'internal'
          ? ':app:assembleRelease'
          : ':app:assembleDebug',
    output:
      command === 'release'
        ? 'bundle/release/app-release.aab'
        : command === 'internal'
          ? 'apk/release/app-release.apk'
          : 'apk/debug/app-debug.apk',
  };
}

function buildEnvironment(plan, env) {
  return {
    ...env,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_MODEL_PATH: '',
    EXPO_PUBLIC_ACCELERATOR: 'cpu',
    POCKETSRE_ANDROID_PROFILE: plan.profile,
    NODE_ENV: plan.profile === 'development' ? 'development' : 'production',
    CMAKE_BUILD_PARALLEL_LEVEL: '1',
    RNLLAMA_SKIP_POSTINSTALL: '0',
  };
}

module.exports = {
  signingKeys,
  getProfile,
  isInside,
  validateSigning,
  buildPlan,
  buildEnvironment,
};
