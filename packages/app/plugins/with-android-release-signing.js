const { withAppBuildGradle } = require("expo/config-plugins");

const KEYSTORE_PATH_ENV = "OSUNA_ANDROID_KEYSTORE_PATH";
const KEYSTORE_PASSWORD_ENV = "OSUNA_ANDROID_KEYSTORE_PASSWORD";
const KEY_ALIAS_ENV = "OSUNA_ANDROID_KEY_ALIAS";
const KEY_PASSWORD_ENV = "OSUNA_ANDROID_KEY_PASSWORD";
const RELEASE_SIGNING_ENV_KEYS = [
  KEYSTORE_PATH_ENV,
  KEYSTORE_PASSWORD_ENV,
  KEY_ALIAS_ENV,
  KEY_PASSWORD_ENV,
];

const SIGNING_CONFIGS_BLOCK = /^([ \t]*)signingConfigs[ \t]*\{[ \t]*$/m;
const RELEASE_BUILD_TYPE_SIGNING =
  /(\bbuildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?\bsigningConfig\s+)signingConfigs\.debug\b/;
const RELEASE_SIGNING_APPLIED = "signingConfig signingConfigs.release";

function hasReleaseSigningEnv(env) {
  return RELEASE_SIGNING_ENV_KEYS.every((key) => (env[key] ?? "").trim().length > 0);
}

// 口令只以环境变量名写进 build.gradle，由 gradle 在构建时读取，不落盘。
function releaseSigningConfig(indent) {
  const inner = `${indent}    `;
  return [
    `${inner}release {`,
    `${inner}    storeFile file(System.getenv("${KEYSTORE_PATH_ENV}"))`,
    `${inner}    storePassword System.getenv("${KEYSTORE_PASSWORD_ENV}")`,
    `${inner}    keyAlias System.getenv("${KEY_ALIAS_ENV}")`,
    `${inner}    keyPassword System.getenv("${KEY_PASSWORD_ENV}")`,
    `${inner}}`,
  ].join("\n");
}

function configureAndroidReleaseSigning(contents) {
  if (contents.includes(RELEASE_SIGNING_APPLIED)) {
    return contents;
  }
  if (!SIGNING_CONFIGS_BLOCK.test(contents)) {
    throw new Error("Could not find the Android signingConfigs block in app/build.gradle");
  }
  if (!RELEASE_BUILD_TYPE_SIGNING.test(contents)) {
    throw new Error(
      "Could not point the Android release build type at the release signing config in app/build.gradle",
    );
  }

  return contents
    .replace(SIGNING_CONFIGS_BLOCK, (opening, indent) => {
      return `${opening}\n${releaseSigningConfig(indent)}`;
    })
    .replace(RELEASE_BUILD_TYPE_SIGNING, "$1signingConfigs.release");
}

function withAndroidReleaseSigning(config) {
  // 四个变量缺任何一个都不碰 gradle：本地 debug 与未配置签名的 release 流程保持模板原样。
  if (!hasReleaseSigningEnv(process.env)) {
    return config;
  }

  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = configureAndroidReleaseSigning(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidReleaseSigning;
