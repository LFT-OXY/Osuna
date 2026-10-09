const pkg = require("./package.json");
const withAndroidAsyncStorageSize = require("./plugins/with-android-async-storage-size");
const withAndroidProfileable = require("./plugins/with-android-profileable");
const withAndroidReleaseSigning = require("./plugins/with-android-release-signing");
const withPasteInput = require("./plugins/with-paste-input");
const { getNativeReleaseVersion } = require("./native-release-version");
const appVariant = process.env.APP_VARIANT ?? "production";
const isProfileBuild = process.env.OSUNA_PROFILE_BUILD === "1";

const variants = {
  production: {
    name: "Osuna",
    packageId: "com.chinhae.osuna",
  },
  development: {
    name: "Osuna Debug",
    packageId: "com.chinhae.osuna.debug",
  },
};

const variant = variants[appVariant] ?? variants.production;
const nativeReleaseVersion = getNativeReleaseVersion(pkg.version);

export default {
  expo: {
    name: variant.name,
    slug: "osuna",
    version: nativeReleaseVersion.appVersion,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "osuna",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription: "This app needs access to the microphone for voice commands.",
        ITSAppUsesNonExemptEncryption: false,
      },
      bundleIdentifier: variant.packageId,
      buildNumber: nativeReleaseVersion.iosBuildNumber,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#000000",
        foregroundImage: "./assets/images/android-icon-foreground.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      softwareKeyboardLayoutMode: "resize",
      // Allow HTTP connections for local network hosts (required for release builds)
      usesCleartextTraffic: true,
      permissions: [
        "RECORD_AUDIO",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "CAMERA",
        "android.permission.CAMERA",
      ],
      package: variant.packageId,
      versionCode: nativeReleaseVersion.androidVersionCode,
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
    },
    plugins: [
      "expo-router",
      withPasteInput,
      [withAndroidAsyncStorageSize, 64],
      [
        "expo-camera",
        {
          cameraPermission: "Allow $(PRODUCT_NAME) to access your camera to scan pairing QR codes.",
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      "expo-audio",
      [
        "expo-gradle-jvmargs",
        {
          xmx: "4096m",
          maxMetaspace: "1024m",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 29,
            kotlinVersion: "2.1.20",
            // Allow HTTP connections for local network hosts in release builds
            usesCleartextTraffic: true,
          },
        },
      ],
      ...(isProfileBuild ? [withAndroidProfileable] : []),
      withAndroidReleaseSigning,
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
      autolinkingModuleResolution: true,
    },
    extra: {
      profileBuild: isProfileBuild,
      router: {},
    },
  },
};
