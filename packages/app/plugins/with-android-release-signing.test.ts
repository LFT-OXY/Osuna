import { afterEach, describe, expect, it, vi } from "vitest";

const withAndroidReleaseSigning = require("./with-android-release-signing");

// Expo SDK 54 模板 `android/app/build.gradle` 中与签名有关的原文片段。
const TEMPLATE_BUILD_GRADLE = `android {
    namespace "com.chinhae.osuna"
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

const RELEASE_SIGNED_BUILD_GRADLE = `android {
    namespace "com.chinhae.osuna"
    signingConfigs {
        release {
            storeFile file(System.getenv("OSUNA_ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("OSUNA_ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("OSUNA_ANDROID_KEY_ALIAS")
            keyPassword System.getenv("OSUNA_ANDROID_KEY_PASSWORD")
        }
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.release
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

const SIGNING_ENV = {
  OSUNA_ANDROID_KEYSTORE_PATH: "/tmp/runner/osuna-release.keystore",
  OSUNA_ANDROID_KEYSTORE_PASSWORD: "store-secret",
  OSUNA_ANDROID_KEY_ALIAS: "osuna-release",
  OSUNA_ANDROID_KEY_PASSWORD: "key-secret",
};

function stubSigningEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
}

// 走 Expo 的 mod 链跑一遍插件，返回 prebuild 会写回磁盘的 app/build.gradle 文本。
async function prebuildAppBuildGradle(contents: string): Promise<string> {
  const config = withAndroidReleaseSigning({ name: "Osuna", slug: "osuna" });
  const appBuildGradleMod = config.mods?.android?.appBuildGradle;
  if (!appBuildGradleMod) {
    return contents;
  }
  const result = await appBuildGradleMod({
    ...config,
    modRequest: {},
    modResults: { language: "groovy", contents },
  });
  return result.modResults.contents;
}

describe("withAndroidReleaseSigning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs the release build type with the keystore named by the environment", async () => {
    stubSigningEnv(SIGNING_ENV);

    expect(await prebuildAppBuildGradle(TEMPLATE_BUILD_GRADLE)).toBe(RELEASE_SIGNED_BUILD_GRADLE);
  });

  it.each(Object.keys(SIGNING_ENV))(
    "leaves the debug-signed template alone when %s is not set",
    async (missingKey) => {
      stubSigningEnv({ ...SIGNING_ENV, [missingKey]: undefined });

      expect(await prebuildAppBuildGradle(TEMPLATE_BUILD_GRADLE)).toBe(TEMPLATE_BUILD_GRADLE);
    },
  );

  // 不带 --clean 的 prebuild 会在已生成的 android/ 上重跑所有 mod。
  it("keeps an already release-signed build.gradle unchanged on a repeated prebuild", async () => {
    stubSigningEnv(SIGNING_ENV);

    expect(await prebuildAppBuildGradle(RELEASE_SIGNED_BUILD_GRADLE)).toBe(
      RELEASE_SIGNED_BUILD_GRADLE,
    );
  });

  // 模板形状变了却静默跳过，CI 会发出一个 debug 签名的 release 包。
  it("refuses to prebuild when the template has no release signing line to repoint", async () => {
    stubSigningEnv(SIGNING_ENV);
    const withoutReleaseSigningLine = TEMPLATE_BUILD_GRADLE.replace(
      "            signingConfig signingConfigs.debug\n            minifyEnabled",
      "            minifyEnabled",
    );

    await expect(prebuildAppBuildGradle(withoutReleaseSigningLine)).rejects.toThrow(
      "Could not point the Android release build type at the release signing config",
    );
  });

  it("refuses to prebuild when the template has no signingConfigs block", async () => {
    stubSigningEnv(SIGNING_ENV);
    const withoutSigningConfigs = TEMPLATE_BUILD_GRADLE.replace("    signingConfigs {", "    {");

    await expect(prebuildAppBuildGradle(withoutSigningConfigs)).rejects.toThrow(
      "Could not find the Android signingConfigs block",
    );
  });

  // GitHub Actions 把不存在的 Secret 展开成空字符串，而不是不设变量。
  it.each(Object.keys(SIGNING_ENV))(
    "leaves the debug-signed template alone when %s is blank",
    async (blankKey) => {
      stubSigningEnv({ ...SIGNING_ENV, [blankKey]: "  " });

      expect(await prebuildAppBuildGradle(TEMPLATE_BUILD_GRADLE)).toBe(TEMPLATE_BUILD_GRADLE);
    },
  );
});
