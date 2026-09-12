# Android build and release

PocketSRE uses Expo Continuous Native Generation (CNG). The source of truth is
`apps/mobile/app.json`, `app.config.js`, and `plugins/withAndroidBuild.cjs`.
The ignored `apps/mobile/android/` directory is regenerated with a **clean** prebuild
on every native build. Put native changes in a config plugin, not in generated files.
The scripts pin `expo-template-bare-minimum@57.0.24` instead of following Expo's moving
`sdk-57` template tag, and do not update React dependencies during prebuild.

## What each command proves

Run commands from the repository root.

| Command                 | Result                                      | Validation boundary                                                                        |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm build`            | Shared packages, gateway, demo service, CLI | TypeScript compilation; no mobile export or APK                                            |
| `pnpm export:android`   | `apps/mobile/dist/`                         | Metro JavaScript/assets export only; no Gradle, JNI, signing, installation, or device test |
| `pnpm android:prebuild` | Generated Android project                   | Config plugin/template generation only                                                     |
| `pnpm android:debug`    | `artifacts/android/pocketsre-debug.apk`     | Native development client, debug signed; requires Metro for app JavaScript                 |
| `pnpm android:internal` | `artifacts/android/pocketsre-internal.apk`  | Native release-mode APK with bundled JavaScript; disposable debug signing; no Metro needed |
| `pnpm android:release`  | `artifacts/android/pocketsre-release.aab`   | Production bundle with external upload-key signing; not directly installable               |

Each native build compiles the shared workspaces first, verifies/restores the pinned
`llama.rn` platform libraries, runs the generated Gradle wrapper, and copies the
artifact only after Gradle succeeds. A `.sha256` sidecar identifies the binary.
Successful compilation is distinct from installation, startup, and functional device
validation. Old artifacts can survive a failed subsequent build; use the exit status,
file timestamp, commit, and checksum together.

## Clean setup

Use Node.js 22 and **pnpm 11.24.0** (the root `packageManager` pin). Install JDK 17
(the CI baseline), Android SDK Platform 36, Build Tools 36.0.0, NDK 27.1.12297006,
CMake 3.22.1, Platform Tools, and Android SDK command-line tools. JDK 21 is also
compatible with the generated Gradle 9.3.1 wrapper; record the JDK actually used.
Set `JAVA_HOME` and `ANDROID_HOME`, and put Java and Platform Tools on `PATH`.
The Android SDK Manager in Android Studio can install the same components.
Native CI uses Ubuntu 24.04 and command-line tools 20.0 (build 14742923).

```bash
node --version
pnpm --version
java -version
adb version
sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
sdkmanager --licenses
pnpm install --frozen-lockfile --prefer-offline --network-concurrency=1 --child-concurrency=1
pnpm --filter @pocketsre/mobile exec expo install --check
pnpm typecheck
pnpm test
pnpm export:android
```

The online `expo install --check` compares against today's SDK recommendations and
can report newer patches than this lockfile. Record those recommendations separately
from a compile failure; update only with a demonstrated compatibility need and a
reviewed lockfile diff. With `EXPO_OFFLINE=1`, the same check uses the installed Expo
package's bundled version map (and warns that online validation is unavailable).

Start from a fresh checkout for a clean install. Keep the shared pnpm store: hardlinks
reuse cached packages while workspace links still resolve this checkout's own code.
Do not copy linked `node_modules` from a different worktree. Do not delete the
lockfile or switch package managers to work around slow installation.

`llama.rn@0.12.9` downloads checksum-verified native platform archives during its
postinstall (including an iOS framework even for this Android-only app). These are
runtime libraries, **not models**. The workspace explicitly allows its install script
and esbuild's. For a JavaScript-only setup, `RNLLAMA_SKIP_POSTINSTALL=1` can skip those
archives; the native build commands restore/check them explicitly before Gradle runs.
An initial install/prebuild/native build needs network access to npm, GitHub releases,
Gradle distributions, and Google/Maven repositories. Frozen pnpm resolution does not
make a cold Android build offline.

### Memory and Windows

Install and build one worktree at a time on constrained hosts. The scripts run Gradle
with one worker, no parallel projects, no persistent daemon, a 1536 MB heap and 512 MB
metaspace; Kotlin runs in-process, and Metro concurrency is one. All Android projects
receive a single CMake/Ninja compile-and-link job pool, including `llama.rn`'s JNI
wrapper (Gradle's worker setting alone does not constrain Ninja). Root tests run
one workspace and one Vitest worker at a time. Lowering worker counts does not remove
the need for several GB of available **commit memory** for Java, Node and the compiler.
Free physical RAM alone does not establish enough capacity on Windows.

The native pool is applied through Android's finalized DSL. CMake staging lives
under the generated `apps/mobile/android/.cxx/pocketsre/` directory, with a separate
subdirectory per Gradle project. This keeps generated prefab and Ninja files out of
pnpm's deeply nested dependency paths. See Android's [DSL lifecycle](https://developer.android.com/build/extend-agp)
and [CMake staging configuration](https://developer.android.com/reference/tools/gradle-api/8.0/com/android/build/api/dsl/Cmake).

For the pinned pnpm 11.24.0, also set `$env:PNPM_WORKERS = '1000'` in PowerShell
(or `export PNPM_WORKERS=1000` in Bash) before installation. pnpm interprets this as
CPUs to reserve, which reduces its separate package-import pool to one worker; a
value of `1` does not mean one worker. This implementation-specific workaround should
be rechecked when upgrading pnpm. It is independent of download/script concurrency.

Prettier preserves each file's existing line endings (`endOfLine: auto`), so Windows
Git checkouts using CRLF pass the same formatting check without a repository-wide
line-ending rewrite. Generated Android files are excluded from formatting checks.

For a single test-device ABI and a smaller diagnostic attempt in PowerShell:

```powershell
$env:POCKETSRE_ANDROID_ARCHS = 'arm64-v8a' # x86_64 for an Intel/AMD emulator
$env:POCKETSRE_GRADLE_JVMARGS = '-Xmx768m -XX:MaxMetaspaceSize=256m'
pnpm android:debug
Remove-Item Env:POCKETSRE_ANDROID_ARCHS, Env:POCKETSRE_GRADLE_JVMARGS
```

The smaller heap may be insufficient for a full build. Distinguish heap exhaustion,
Windows commit/allocation failures, SDK/license errors, and native compiler errors
from application incompatibility. Do not change machine memory settings as part of
this workflow. Windows builds use `gradlew.bat`; Linux/macOS use `./gradlew`.
If CMake reports excessive path lengths, use a short fresh checkout path and reinstall
there; do not share another checkout's linked dependencies.

## Development and internal testing

The app IDs are `dev.pocketsre.mobile.dev`, `dev.pocketsre.mobile.internal`, and
`dev.pocketsre.mobile` for development, internal and production respectively. Their
names and URL schemes differ so builds can coexist with separate credentials/cache.
Only test profiles permit cleartext HTTP for the local demo gateway. Production uses
HTTPS. `llama.rn` requires the New Architecture, and its binaries support `arm64-v8a`
and `x86_64`; 32-bit devices are outside this build's supported ABIs. API 26 is the
configured minimum. CPU is the baseline; GPU/NPU manifest libraries are optional.

```bash
pnpm android:debug
adb devices -l
adb install -r artifacts/android/pocketsre-debug.apk
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4100 tcp:4100
pnpm dev:mobile
```

Open **PocketSRE development** and select the Metro server. Start `pnpm dev:backend`
in a second terminal, then set **Connections** to `http://127.0.0.1:4100`. When more
than one device is attached, add `-s SERIAL` to every ADB command.

For a self-contained demo that can cold-start without Metro:

```bash
pnpm android:internal
adb install -r artifacts/android/pocketsre-internal.apk
adb shell am start -n dev.pocketsre.mobile.internal/.MainActivity
```

Internal uses the `release` Gradle variant with bundled JavaScript but an explicitly
disposable debug key and a separate app ID. It is not a production-signed release.
The build scripts disable dotenv loading, force an empty `EXPO_PUBLIC_MODEL_PATH`
and select CPU so a developer's local model setting cannot enter these artifacts.
No first-launch model provisioning is necessary. `EXPO_PUBLIC_*` values are public
bundle content; enter access tokens through **Connections**, never build-time env.
`pnpm dev:mobile` still supports the optional local model settings documented in the
README for later development, separate from the no-model build/smoke baseline.

## Production signing and versioning

No Expo/EAS account, cloud build, or store upload is required for this local path.
Release credentials are read by Gradle from the process environment, never written
into generated Gradle files. Production fails before prebuild if credentials are
missing, the keystore is inside the repository, or the default debug alias is used.
The generated Gradle project also guards direct release invocations so Expo's
template debug signing cannot silently become production signing.

Provision an upload key outside the checkout using your organization's signing
process or Android Studio. For a new key, run `keytool` interactively (passwords are
prompted, not written into shell history):

```bash
keytool -genkeypair -v -storetype JKS -keystore /absolute/private/pocketsre-upload.jks -alias pocketsre-upload -keyalg RSA -keysize 2048 -validity 10000
```

Have your local secret manager or private CI secret environment provide:

| Variable                           | Value                                               |
| ---------------------------------- | --------------------------------------------------- |
| `POCKETSRE_ANDROID_KEYSTORE`       | Absolute path to the keystore outside this checkout |
| `POCKETSRE_ANDROID_STORE_PASSWORD` | Keystore password                                   |
| `POCKETSRE_ANDROID_KEY_ALIAS`      | Upload-key alias                                    |
| `POCKETSRE_ANDROID_KEY_PASSWORD`   | Private-key password                                |

Do not use `EXPO_PUBLIC_*`, checked-in files, command arguments, or build logs for
these values. Back up the key securely. `credentials.json`, keystores, APKs, AABs and
model files are ignored; do not force-add them. CI only builds disposable test APKs
and does not contain a production credential job.

Before production, review the stable package ID and increment `android.versionCode`
in `apps/mobile/app.json` for each new release; set the user-facing `expo.version`.
Unset the single-ABI override, inject signing env, then run:

```bash
pnpm android:release
jarsigner -verify -verbose -certs artifacts/android/pocketsre-release.aab
```

Compare the certificate fingerprint with the intended upload certificate. Never
interpret signing alone as device validation. AAB installation requires Android's
`bundletool` to generate/sign APKs or a separate release APK from the generated
production project (`app:assembleRelease` with the same signing environment and
no model path). Verify the release APK with `apksigner verify --verbose --print-certs`
and repeat the smoke checklist against an HTTPS gateway before distribution. This
task does not upload, publish, or spend on an external build service.

## Device smoke checklist

Record commit, APK SHA-256, app ID/profile, signing certificate, device/ABI/API, JDK,
and results. Start with the self-contained internal APK; use a separate installation
or explicitly clear only its test app data when a fresh first launch is required.

1. **Cold startup:** stop Metro, disconnect the gateway, force-stop/reopen the app.
   The sample incident must load without a crash, model prompt, or download. Analyze
   and confirm deterministic mode and evidence citations referring to displayed cards.
2. **Connection:** run the backend, use ADB reverse for port 4100, save the loopback
   URL in Connections, refresh, and confirm DEMO. Exercise a bad URL/token, then fix
   it. Never mistake SAMPLE, CACHED or IMPORTED for a live connection.
3. **Offline analysis:** collect a live bundle, stop the gateway/remove forwarding,
   and reopen the internal app with Metro still stopped. Analyze the cached bundle,
   confirm deterministic mode and valid evidence IDs, and confirm recovery cannot
   execute for cached/sample/imported evidence.
4. **Approval:** reconnect to the controlled demo, inject regression, analyze, and
   open the proposed action. Cancel first; health must remain failing and no recovery
   should occur. Review target/risk, then approve once. Confirm recovery, action
   history, and healthy checkout. Repeat tapping while pending must not duplicate
   execution; stale approvals and offline actions must be rejected.
5. **Native/release checks:** capture `adb logcat` for crashes, `UnsatisfiedLinkError`,
   or missing TurboModules; verify supported ABI. Repeat startup/connection/offline/
   approvals on a production-signed APK using HTTPS before production distribution.
   Optional inference and GPU/NPU performance need their own exact-device/model test.

## Validation record for this change

Latest project-integration validation on 2026-09-12: the ARM64 development APK
compiled successfully after fixing hook registration before React Native's eager
app evaluation, applying the pool through finalized DSL, and shortening CMake
staging paths. The app and native-library Ninja files were inspected for the
one-job pool. The final `:app:assembleDebug` run passed in 2m47s, with 350 tasks
(10 executed, 340 up-to-date), using a 768 MB Gradle heap and 384 MB metaspace.
The APK and SHA-256 checksum are in `artifacts/android/`. This is compilation
validation; the new APK was not installed or smoke-tested on a phone, and real
push delivery still needs EAS/FCM configuration. Earlier attempts are recorded below.

On 2026-09-12, the Windows worktree used Node 22.14.0, pnpm 11.24.0, Temurin
21.0.7, SDK 36/Build Tools 36.0.0, and NDK 27.1.12297006. Frozen dependency installation
succeeded in 4m44s (138 reused, 409 downloaded; lockfile unchanged). Config/signing
regressions passed, and a clean development prebuild generated Gradle 9.3.1 and the
expected manifest/properties. The online Expo check suggested eight newer patches;
the installed Expo bundled-map check reported dependencies up to date.

`pnpm android:debug` was attempted with `arm64-v8a`, one worker, `-Xmx768m` and
256 MB metaspace. The Gradle JVM exited before producing an APK. Its crash report
stated that native `malloc` failed to allocate **1,630,128 bytes**. Windows available
commit memory fell to a few hundred MB despite several GB of free physical RAM.
This is an observed host memory failure, not a successful native compatibility test.
No dependency update was justified by this failure. Prebuild also emitted the existing
`userInterfaceStyle`/`expo-system-ui` advisory; no device appearance result is claimed.

No ADB device was attached. APK installation, startup, native module loading, the
smoke checklist, internal APK compilation, and production signing/AAB compilation
remain unverified. No release credentials or model were provisioned. The new GitHub
workflow is configured to compile both APKs and inspect signatures, packaged JNI
libraries, and the internal JavaScript bundle; it has not been run by this task and
does not execute device smoke tests.

Final local checks:

| Check                                               | Observed result                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                    | Passed all six workspaces                                                                                                                                                                |
| `pnpm build`                                        | Passed shared/backend/CLI compilation; no mobile export or native build invoked                                                                                                          |
| `pnpm export:android`                               | Passed; 742 modules exported as Android JavaScript/Hermes bytecode, no APK                                                                                                               |
| `pnpm android:prebuild`                             | Passed again after the final plugin edits; generated ABI, compiler-pool, HTTP and scheme settings inspected                                                                              |
| `pnpm android:release` without signing env          | Rejected before prebuild, as required                                                                                                                                                    |
| Build configuration regressions                     | Six passed: task/ABI validation, model-setting exclusion, signing paths, profiles, regeneration and native-worker configuration                                                          |
| `pnpm test`                                         | Stopped at the pre-existing investigator CLI symlink fixture with Windows `EPERM`; six build regressions, seven engine tests, one demo test and two CLI tests passed before that failure |
| Interrupted suites run individually with one worker | All seven mobile tests and all seven gateway tests passed                                                                                                                                |

The native compatibility, production signing and device limitations above remain
open regardless of the JavaScript test results.

## Official references

- [Expo local development builds and clean prebuild](https://docs.expo.dev/guides/local-app-development/).
- [Expo local release builds](https://docs.expo.dev/guides/local-app-production/).
- [Expo monorepos and pnpm isolated installs](https://docs.expo.dev/guides/monorepos/).
- [Expo Android build properties](https://docs.expo.dev/versions/latest/sdk/build-properties/).
- [Expo SDK 57 Android template](https://github.com/expo/expo/tree/sdk-57/templates/expo-template-bare-minimum/android).
- [React Native 0.86.3 Android dependency versions](https://github.com/facebook/react-native/blob/v0.86.3/packages/react-native/gradle/libs.versions.toml).
- [llama.rn 0.12.9 Android Gradle configuration](https://github.com/mybigday/llama.rn/blob/v0.12.9/android/build.gradle) and [native artifact downloader](https://github.com/mybigday/llama.rn/blob/v0.12.9/install/download-native-artifacts.js).
- [Android command-line building, signing and APK installation](https://developer.android.com/build/building-cmdline).
- [CMake/Ninja job pools](https://cmake.org/cmake/help/v3.22/variable/CMAKE_JOB_POOLS.html).
