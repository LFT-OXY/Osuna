# Android

## App variants

Controlled by `APP_VARIANT` in `packages/app/app.config.js` (vanilla Expo, no custom Gradle plugin):

| Variant       | App name    | Package ID                |
| ------------- | ----------- | ------------------------- |
| `production`  | Osuna       | `com.chinhae.osuna`       |
| `development` | Osuna Debug | `com.chinhae.osuna.debug` |

EAS profiles: `development`, `production`, and `production-apk` in `packages/app/eas.json`.

`development` uses Android `debug`.

## Version codes

`packages/app/native-release-version.js` is the single definition of native and F-Droid version-code math. Do not re-derive these numbers anywhere else — a drifted copy produces changelog files that match no published APK, and nothing fails loudly.

The base version code comes from the package version:

```text
major * 1_000_000 + minor * 1_000 + patch
```

Prerelease metadata is ignored, so `0.1.102-beta.1` and `0.1.102` both produce `1102`. The same value is used as the iOS `buildNumber` because `packages/app/eas.json` uses EAS's local app version source. Do not re-enable EAS remote version counters or Android `autoIncrement`; F-Droid and other source-based builders need the native build number to be visible in the repo.

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
- **`EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:<port>`** — the client's daemon endpoint (`packages/app/src/runtime/host-runtime.ts`); when unset it defaults to `localhost:6777`, the production daemon. Use `$OSUNA_SERVICE_DAEMON_PORT` for a worktree daemon running as an Osuna service, or `6778` for a standalone `npm run dev:server`. It is inlined into the JS bundle at Metro bundle time, so set it on the build command and clear the Metro cache (`npx expo start -c`) if a change doesn't take.

**Alternative — `adb reverse` + `localhost`** (if `10.0.2.2` misbehaves):

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:$OSUNA_SERVICE_DAEMON_PORT tcp:$OSUNA_SERVICE_DAEMON_PORT
REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
  EXPO_PUBLIC_LOCAL_DAEMON=localhost:$OSUNA_SERVICE_DAEMON_PORT \
  npm run android
```

This is the Android counterpart of the iOS local-simulator flow in [development.md](development.md): on iOS the simulator shares the Mac's loopback so `localhost:<port>` works directly; on Android you need `10.0.2.2` or `adb reverse`.

## F-Droid / source-only Android builds

F-Droid builds should set `OSUNA_FDROID_BUILD=1` when running Expo prebuild:

```bash
cd packages/app
OSUNA_FDROID_BUILD=1 APP_VARIANT=production npx expo prebuild --platform android --clean --non-interactive
cd android
OSUNA_FDROID_BUILD=1 ./gradlew assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

The flag must be present for both prebuild and Gradle because Gradle starts Metro for the release bundle. Keep the source build serial and daemon-free as shown above: compiling every Expo module can exhaust memory when Gradle workers run in parallel. The profile enables source-built Expo modules, excludes the proprietary camera, Firebase notification, and Expo development-client native modules, disables Gradle dependency metadata, and substitutes JavaScript stubs for camera and notifications. The resulting app supports direct and pasted-link pairing but not QR scanning or push notifications.

For a single-ABI APK, pass React Native's architecture property to Gradle:

```bash
OSUNA_FDROID_BUILD=1 ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

Supported values are `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`. The F-Droid profile filters native libraries to that ABI and changes the APK version code to `baseVersionCode * 10 + abiSuffix`, where the suffixes are ordered `1` through `4` in that same sequence. F-Droid metadata should use four build blocks with `VercodeOperation` entries `10 * %c + 1` through `10 * %c + 4` and pass the matching `reactNativeArchitectures` value in each build command. Builds without a single architecture keep the base version code.

Keep the excluded npm packages installed. Normal builds use them, while the F-Droid profile removes only their Android native modules and config plugins. Osuna always applies `expo-gradle-jvmargs` with `-Xmx4096m` and `-XX:MaxMetaspaceSize=1024m` so local Expo prebuilds have enough Gradle heap whether they use precompiled AARs or source-built Expo modules.

The EAS `production-apk` profile uses the large Android resource class. Release builds compile the native ABIs and run Hermes bundling in the same Gradle invocation; the default worker can exhaust its remaining memory and kill Hermes with exit code 137 even when Gradle's own heap is correctly sized.

### F-Droid store metadata

There is none. `fastlane/metadata/` and the `fdroid:changelogs` generator were removed with
the rebrand, and nothing in the npm `version` lifecycle regenerates them any more. The build
profile above still works and is what a source-only builder would use; submitting to F-Droid
means writing the store listing and the per-ABI changelog generator again, and that is a
future task. See [release.md](release.md#mobile-builds).

### React version lockstep

Keep `react` and `react-dom` pinned to the React version embedded by the current `react-native` release. React Native `0.81.x` embeds `react-native-renderer` `19.1.0`, so `packages/app` must use React `19.1.0`. Bumping React to a newer patch can build successfully but crash at JS startup on Android with `Incompatible React versions`, leaving the app on the native splash screen.

## Screenshots

```bash
adb exec-out screencap -p > screenshot.png
```

## Tag-triggered Android builds

`v*` and `android-v*` tag pushes trigger `.github/workflows/android-apk-release.yml`, which
attaches an APK to the GitHub Release. That is the only Android release path this fork has —
see [release.md](release.md#mobile-builds). `android-v*` ships an APK without cutting a full
release, and the workflow takes a `workflow_dispatch` `tag` input so you can rebuild one
without a new tag. Beta tags like `v0.1.1-beta.1` attach the APK to a GitHub prerelease.

`packages/app/eas.json` no longer describes a runnable build. The rebrand removed `owner` and
`extra.eas.projectId` with no replacement, so `eas build` errors out until someone configures a
project, and the `.eas/workflows/` files the EAS GitHub app would have read on a `v*` tag are
deleted. The remaining profiles are a starting point for store releases, not something that
runs today.

### Watching a tagged APK build

```bash
gh run list --workflow android-apk-release.yml --limit 5
gh run watch <run-id>
```

The GitHub Release assets are the final confirmation: the APK is attached only after the
build job succeeds. See [docs/release.md](release.md#mobile-builds) for where this sits in
the release flow.
