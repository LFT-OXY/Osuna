# Android

## App variants

Controlled by `APP_VARIANT` in `packages/app/app.config.js` (vanilla Expo, no custom Gradle plugin):

| Variant       | App name    | Package ID                |
| ------------- | ----------- | ------------------------- |
| `production`  | Osuna       | `com.chinhae.osuna`       |
| `development` | Osuna Debug | `com.chinhae.osuna.debug` |

`development` uses Android `debug`.

## Version codes

`packages/app/native-release-version.js` is the single definition of native version-code math. Do not re-derive these numbers anywhere else.

The base version code comes from the package version:

```text
major * 1_000_000 + minor * 1_000 + patch
```

Prerelease metadata is ignored, so `0.1.102-beta.1` and `0.1.102` both produce `1102`. Rebuilding a tag reproduces the same `versionCode`.

The formula reserves three digits each for minor and patch. If either reaches `1000`, change the formula before cutting that release.

## Prerequisites (local dev)

Local Android builds run on macOS (or Linux) and need the Android toolchain, pinned in `.tool-versions` (`java 21`, `android-sdk 21.0`) and wired up by `.mise.toml` (which derives `ANDROID_HOME` and the command-line tool paths from the `android-sdk` entry). With [mise](https://mise.jdx.dev):

```bash
mise install        # java 21 + android-sdk 21.0 command-line tools
```

> **Pin a real `android-sdk` version, not `latest`.** The mise `android-sdk` plugin's `latest` resolved to the ancient `1.0` bundle, whose `sdkmanager` (3.6.0) predates the `emulator` package and fails with `Failed to find package emulator`. `21.0` ships a current `sdkmanager`. If you bump it, update only the version in `.tool-versions`; `.mise.toml` derives its paths from that tool entry.

`mise install` only lays down the command-line tools. Install the rest and create an emulator. On Apple Silicon:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;arm64-v8a"
avdmanager create avd -n osuna -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7
emulator @osuna     # start it; leave running
```

On an Intel Mac, use the `x86_64` system image:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n osuna -k "system-images;android-35;google_apis;x86_64" -d pixel_7
emulator @osuna     # start it; leave running
```

Gradle auto-fetches the platform/build-tools it needs once licenses are accepted, so adjust `android-35` only if it asks for a different level.

## Local build + install

From repo root:

```bash
npm run android:development    # Debug build
npm run android:production     # Release build
npm run android:clear          # Remove generated Android project
```

For a production-ID release APK that local Android profiling tools can attach to:

```bash
OSUNA_PROFILE_BUILD=1 npm run android:production
```

This keeps the `com.chinhae.osuna` package id, release Hermes bundle, and release optimizations. It adds
`<profileable android:shell="true" />` and enables local Android trace markers for workspace mounts
and daemon WebSocket traffic. The markers contain message types and sizes, never payload contents,
and emit only while a system trace records the `com.chinhae.osuna` app (`perfetto -a com.chinhae.osuna ...`).

`packages/app/app.config.js` always applies `expo-gradle-jvmargs` with `-Xmx4096m` and `-XX:MaxMetaspaceSize=1024m` so local Expo prebuilds have enough Gradle heap.

Or from `packages/app`:

```bash
# Debug
npx cross-env APP_VARIANT=development expo prebuild --platform android --clean --non-interactive
npx cross-env APP_VARIANT=development expo run:android --variant=debug

# Release
npx cross-env APP_VARIANT=production expo prebuild --platform android --clean --non-interactive
npx cross-env APP_VARIANT=production expo run:android --variant=release

# Clear generated Android project
rm -rf android
```

## Running on an emulator against a worktree daemon

`npm run android` builds and installs the dev client, but two connections have to reach your Mac from inside the emulator — Metro (the JS bundle) and the Osuna daemon — and **the emulator does not share the host's loopback**: `localhost` inside the emulator is the emulator itself. Reach the host at `10.0.2.2` (the standard AVD's host alias) for both:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 \
  EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:$OSUNA_SERVICE_DAEMON_PORT \
  npm run android
```

- **`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`** — without it, Expo bakes your Mac's LAN IP into the dev client's Metro URL, which the emulator can't route to, and the app dies with `Failed to connect to /<lan-ip>:8081` before any JS loads.
- **`EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:<port>`** — the client's daemon endpoint (`packages/app/src/runtime/host-runtime.ts`); when unset it defaults to `localhost:6767`, the production daemon. Use `$OSUNA_SERVICE_DAEMON_PORT` for a worktree daemon running as a Osuna service, or `6768` for a standalone `npm run dev:server`. It is inlined into the JS bundle at Metro bundle time, so set it on the build command and clear the Metro cache (`npx expo start -c`) if a change doesn't take.

**Alternative — `adb reverse` + `localhost`** (if `10.0.2.2` misbehaves):

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:$OSUNA_SERVICE_DAEMON_PORT tcp:$OSUNA_SERVICE_DAEMON_PORT
REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
  EXPO_PUBLIC_LOCAL_DAEMON=localhost:$OSUNA_SERVICE_DAEMON_PORT \
  npm run android
```

This is the Android counterpart of the iOS local-simulator flow in [development.md](development.md): on iOS the simulator shares the Mac's loopback so `localhost:<port>` works directly; on Android you need `10.0.2.2` or `adb reverse`.

## React version lockstep

Keep `react` and `react-dom` pinned to the React version embedded by the current `react-native` release. React Native `0.81.x` embeds `react-native-renderer` `19.1.0`, so `packages/app` must use React `19.1.0`. Bumping React to a newer patch can build successfully but crash at JS startup on Android with `Incompatible React versions`, leaving the app on the native splash screen.

## Screenshots

```bash
adb exec-out screencap -p > screenshot.png
```

## Release APK (GitHub Actions)

`.github/workflows/android-apk-release.yml` builds the signed APK on a standard `ubuntu-latest` runner and attaches `osuna-<tag>-android.apk` to that tag's GitHub Release, creating a draft release when the tag has none. It runs `expo prebuild` and Gradle `assembleRelease` directly; there is no Expo account, EAS project, or store submission.

The workflow only runs on `workflow_dispatch` with an existing tag. Pushing a tag does not start it.

```bash
gh workflow run "Android APK Release" -f tag=v1.0.0
```

The APK has no push notifications, like every Osuna client. Desktop notifications and in-app attention are unaffected. See [glossary.md](glossary.md) for the three terms.

### Signing

`packages/app/plugins/with-android-release-signing.js` points the `release` build type at a `signingConfigs.release` that reads four environment variables. The workflow fills them from repository secrets:

| Environment variable              | Secret                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| `OSUNA_ANDROID_KEYSTORE_PATH`     | `ANDROID_KEYSTORE_BASE64`, decoded to a file in `$RUNNER_TEMP` |
| `OSUNA_ANDROID_KEYSTORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD`                                    |
| `OSUNA_ANDROID_KEY_ALIAS`         | `ANDROID_KEY_ALIAS`                                            |
| `OSUNA_ANDROID_KEY_PASSWORD`      | `ANDROID_KEY_PASSWORD`                                         |

The plugin decides at prebuild time. If any of the four is unset or blank, it leaves the Expo template untouched and `release` stays signed with the debug keystore, which is what `npm run android:production` produces on a machine without the keystore. Set all four before prebuild and again for Gradle: the generated `build.gradle` holds the variable names, and Gradle reads the values when it runs.

A GitHub secret that does not exist expands to an empty string, which would produce a debug-signed release APK. The workflow guards against that twice: it stops after prebuild when `build.gradle` has no release signing, and it stops before upload when `apksigner` reports a certificate other than the one recorded under "安卓签名 keystore" in [release.md](release.md). That section also covers where the keystore lives and how users check a downloaded APK.

### Runner constraints

- **Build the JS inputs before prebuild.** Metro bundles `@osuna/expo-two-way-audio` and the other workspace packages from their build output. The workflow runs `npm run build:app-deps` first; without it Metro cannot resolve those entry points when Gradle bundles the JS. It also regenerates the terminal WebView HTML with `build:terminal-webview`.
- **Memory.** The runner has 4 vCPU and 16 GB. Release builds compile the native ABIs and run Hermes bundling in the same Gradle invocation, and Hermes can be killed with exit code 137 even when Gradle's own heap is correctly sized. The workflow passes `--no-daemon --max-workers=2`; drop to `--max-workers=1` if 137 shows up.
- **Disk.** The runner guarantees 14 GB free, so the job deletes preinstalled toolchains it does not use before installing dependencies.
- **NDK.** React Native pins an NDK version the runner image may not ship. The Android Gradle Plugin downloads it during the build.
- **Timeout.** `timeout-minutes: 90` is an untested first value. Tighten it once a run has recorded the real duration.
