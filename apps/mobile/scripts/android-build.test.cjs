const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  buildPlan,
  buildEnvironment,
  getProfile,
  validateSigning,
} = require('./android-build-config.cjs');
const { configureGradle, configureNativeWorkers } = require('../plugins/withAndroidBuild.cjs');
const configureApp = require('../app.config.js');
const baseConfig = require('../app.json').expo;

test('debug, internal, and production select real Gradle tasks and supported ABIs', () => {
  assert.equal(buildPlan('debug', {}).task, ':app:assembleDebug');
  assert.equal(buildPlan('internal', {}).task, ':app:assembleRelease');
  assert.equal(buildPlan('internal', {}).profile, 'internal');
  assert.equal(buildPlan('release', {}).task, ':app:bundleRelease');
  assert.equal(buildPlan('release', {}).output, 'bundle/release/app-release.aab');
  assert.equal(buildPlan('debug', { POCKETSRE_ANDROID_ARCHS: 'x86_64' }).architectures, 'x86_64');
  for (const architectures of [
    'armeabi-v7a',
    'x86',
    'arm64-v8a,arm64-v8a',
    'x86_64 & echo unsafe',
  ]) {
    assert.throws(() => buildPlan('debug', { POCKETSRE_ANDROID_ARCHS: architectures }));
  }
  assert.throws(() => buildPlan('release', { POCKETSRE_ANDROID_ARCHS: 'x86_64' }));
  assert.throws(() => buildPlan('export', {}));
  assert.throws(() => buildPlan('constructor', {}));
  assert.throws(() => getProfile('prodution'));
});

test('reproducible native artifacts exclude developer model settings and restore native libraries', () => {
  for (const command of ['debug', 'internal', 'release']) {
    const env = buildEnvironment(buildPlan(command, {}), {
      EXPO_PUBLIC_MODEL_PATH: 'file:///developer-only/model.gguf',
      EXPO_PUBLIC_ACCELERATOR: 'gpu',
      EXPO_NO_DOTENV: '0',
      RNLLAMA_SKIP_POSTINSTALL: '1',
      NODE_ENV: 'development',
    });
    assert.equal(env.EXPO_PUBLIC_MODEL_PATH, '');
    assert.equal(env.EXPO_PUBLIC_ACCELERATOR, 'cpu');
    assert.equal(env.EXPO_NO_DOTENV, '1');
    assert.equal(env.RNLLAMA_SKIP_POSTINSTALL, '0');
    assert.equal(env.NODE_ENV, command === 'debug' ? 'development' : 'production');
  }
});

test('production signing fails before compilation without an external non-debug key', (context) => {
  const temporary = mkdtempSync(join(tmpdir(), 'pocketsre-signing-test-'));
  // This exact freshly-created directory is the only recursive cleanup target.
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repository = join(temporary, 'repository');
  mkdirSync(repository);
  const outsideKey = join(temporary, 'external-keystore');
  const insideKey = join(repository, 'in-repo-keystore');
  // Path-validation fixtures only, not real signing credentials or key material.
  writeFileSync(outsideKey, 'fixture');
  writeFileSync(insideKey, 'fixture');
  const env = {
    POCKETSRE_ANDROID_KEYSTORE: outsideKey,
    POCKETSRE_ANDROID_STORE_PASSWORD: 'test-placeholder',
    POCKETSRE_ANDROID_KEY_ALIAS: 'upload',
    POCKETSRE_ANDROID_KEY_PASSWORD: 'test-placeholder',
  };
  assert.doesNotThrow(() => validateSigning(env, repository));
  assert.throws(() => validateSigning({}, repository), /Missing release signing environment/);
  assert.throws(
    () => validateSigning({ ...env, POCKETSRE_ANDROID_KEYSTORE: 'relative' }, repository),
    /absolute/,
  );
  assert.throws(
    () => validateSigning({ ...env, POCKETSRE_ANDROID_KEYSTORE: insideKey }, repository),
    /outside/,
  );
  assert.throws(
    () => validateSigning({ ...env, POCKETSRE_ANDROID_KEY_ALIAS: 'androiddebugkey' }, repository),
    /androiddebugkey/,
  );
});

test('prebuild profiles isolate install IDs and permit local HTTP only in test builds', (context) => {
  const oldProfile = process.env.POCKETSRE_ANDROID_PROFILE;
  context.after(() => {
    if (oldProfile === undefined) delete process.env.POCKETSRE_ANDROID_PROFILE;
    else process.env.POCKETSRE_ANDROID_PROFILE = oldProfile;
  });
  const expectedIds = {
    development: 'dev.pocketsre.mobile.dev',
    internal: 'dev.pocketsre.mobile.internal',
    production: 'dev.pocketsre.mobile',
  };
  for (const [profile, applicationId] of Object.entries(expectedIds)) {
    process.env.POCKETSRE_ANDROID_PROFILE = profile;
    const config = configureApp({ config: baseConfig });
    assert.equal(config.android.package, applicationId);
    assert.equal(
      config.scheme,
      profile === 'production'
        ? 'pocketsre'
        : profile === 'internal'
          ? 'pocketsre-internal'
          : 'pocketsre-dev',
    );
    assert.equal(config.slug, 'pocketsre');
    assert.equal(config.extra.eas.projectId, baseConfig.extra.eas.projectId);
    assert.equal(config.newArchEnabled, true);
    const properties = config.plugins.find((plugin) => plugin[0] === 'expo-build-properties')[1]
      .android;
    assert.equal(properties.usesCleartextTraffic, profile !== 'production');
    assert.deepEqual(properties.buildArchs, ['arm64-v8a', 'x86_64']);
    assert.match(properties.extraProguardRules, /com\.rnllama/);
  }
});

test('clean regeneration overrides template debug signing and remains idempotent', () => {
  const template = 'android { buildTypes { release { signingConfig signingConfigs.debug } } }\n';
  const production = configureGradle(template, 'production');
  assert.match(production, /buildTypes.release.signingConfig = signingConfigs.pocketsreRelease/);
  assert.match(production, /Missing PocketSRE release signing environment/);
  assert.match(production, /System.getenv\(it\)/);
  assert.equal(configureGradle(production, 'production'), production);
  assert.match(configureGradle(template, 'development'), /signingConfigs.pocketsreRelease/);
  const internal = configureGradle(production, 'internal');
  assert.match(internal, /android.buildTypes.release.signingConfig = android.signingConfigs.debug/);
  assert.doesNotMatch(internal, /pocketsreHasSigning/);
  assert.equal(configureGradle(internal, 'production'), production);
});

test('native compiler and linker share a bounded pool across app and library projects', () => {
  const generated = configureNativeWorkers('apply plugin: "expo-root-project"\n');
  assert.match(generated, /com.android.application/);
  assert.match(generated, /com.android.library/);
  assert.match(generated, /androidComponents.*finalizeDsl/);
  assert.match(generated, /buildStagingDirectory =\s+rootProject.file\('\.cxx\/pocketsre\//);
  assert.ok(generated.indexOf('subprojects {') < generated.indexOf('apply plugin:'));
  assert.match(generated, /CMAKE_JOB_POOLS=pocketsre_native=1/);
  assert.match(generated, /CMAKE_JOB_POOL_COMPILE=pocketsre_native/);
  assert.match(generated, /CMAKE_JOB_POOL_LINK=pocketsre_native/);
  assert.equal(configureNativeWorkers(generated), generated);
});
