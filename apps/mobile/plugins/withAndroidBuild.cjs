const {
  withAppBuildGradle,
  withProjectBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');
const { getProfile } = require('../scripts/android-build-config.cjs');

const start = '// @generated begin pocketsre-android-build';
const end = '// @generated end pocketsre-android-build';

function configureNativeWorkers(contents) {
  const marker = '// @generated begin pocketsre-native-workers';
  const terminator = '// @generated end pocketsre-native-workers';
  const previous = new RegExp(`${marker}[\\s\\S]*?${terminator}\\n?`, 'g');
  return `${contents.replace(previous, '').trimEnd()}\n\n${marker}
// Gradle workers do not cap Ninja's separate compiler pool. Apply one shared
// compile/link pool to the app and native libraries, including llama.rn's JNI.
subprojects { nativeProject ->
    ['com.android.application', 'com.android.library'].each { pluginId ->
        nativeProject.plugins.withId(pluginId) {
            nativeProject.extensions.getByName('android').defaultConfig.externalNativeBuild.cmake.arguments(
                '-DCMAKE_JOB_POOLS=pocketsre_native=1',
                '-DCMAKE_JOB_POOL_COMPILE=pocketsre_native',
                '-DCMAKE_JOB_POOL_LINK=pocketsre_native'
            )
        }
    }
}
${terminator}\n`;
}

function configureGradle(contents, profile) {
  getProfile(profile);
  const previous = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
  const signing =
    profile === 'internal'
      ? `
// Explicitly disposable, self-contained APK under the .internal application ID.
android.buildTypes.release.signingConfig = android.signingConfigs.debug
`
      : `
def pocketsreSigningKeys = [
    'POCKETSRE_ANDROID_KEYSTORE', 'POCKETSRE_ANDROID_STORE_PASSWORD',
    'POCKETSRE_ANDROID_KEY_ALIAS', 'POCKETSRE_ANDROID_KEY_PASSWORD'
]
def pocketsreSigning = pocketsreSigningKeys.collectEntries { [(it): System.getenv(it)] }
def pocketsreHasSigning = pocketsreSigning.values().every { it != null && !it.trim().isEmpty() }
android {
    signingConfigs {
        pocketsreRelease {
            if (pocketsreHasSigning) {
                storeFile new File(pocketsreSigning.POCKETSRE_ANDROID_KEYSTORE)
                storePassword pocketsreSigning.POCKETSRE_ANDROID_STORE_PASSWORD
                keyAlias pocketsreSigning.POCKETSRE_ANDROID_KEY_ALIAS
                keyPassword pocketsreSigning.POCKETSRE_ANDROID_KEY_PASSWORD
            }
        }
    }
    // Override Expo's template: a production release must never use its debug key.
    buildTypes.release.signingConfig = signingConfigs.pocketsreRelease
}
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }) {
        if (!pocketsreHasSigning) {
            throw new GradleException('Missing PocketSRE release signing environment. See docs/android.md.')
        }
        def key = new File(pocketsreSigning.POCKETSRE_ANDROID_KEYSTORE)
        def repository = rootDir.toPath().toAbsolutePath().resolve('../../..').normalize().toRealPath()
        if (!key.isAbsolute() || !key.isFile() || key.toPath().toRealPath().startsWith(repository)) {
            throw new GradleException('PocketSRE release keystore must be an absolute file outside the repository.')
        }
        if (pocketsreSigning.POCKETSRE_ANDROID_KEY_ALIAS.equalsIgnoreCase('androiddebugkey')) {
            throw new GradleException('PocketSRE production builds cannot use androiddebugkey.')
        }
    }
}
`;
  return `${contents.replace(previous, '').trimEnd()}\n\n${start}\nreact { extraPackagerArgs = ["--max-workers", "1"] }\n${signing}${end}\n`;
}

module.exports = function withAndroidBuild(config, { profile = 'development' } = {}) {
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy')
      throw new Error('PocketSRE expects an Expo Groovy Android template.');
    mod.modResults.contents = configureNativeWorkers(mod.modResults.contents);
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy')
      throw new Error('PocketSRE expects an Expo Groovy Android template.');
    mod.modResults.contents = configureGradle(mod.modResults.contents, profile);
    return mod;
  });
  return withGradleProperties(config, (mod) => {
    const properties = {
      'org.gradle.jvmargs': '-Xmx1536m -XX:MaxMetaspaceSize=512m',
      'org.gradle.workers.max': '1',
      'org.gradle.parallel': 'false',
      'kotlin.compiler.execution.strategy': 'in-process',
    };
    mod.modResults = mod.modResults.filter(
      (entry) => !(entry.type === 'property' && entry.key in properties),
    );
    for (const [key, value] of Object.entries(properties))
      mod.modResults.push({ type: 'property', key, value });
    return mod;
  });
};
module.exports.configureGradle = configureGradle;
module.exports.configureNativeWorkers = configureNativeWorkers;
