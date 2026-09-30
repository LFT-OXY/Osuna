import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";
import {
  PROVIDER_INSTALL_GUIDES,
  type GuidedProvider,
  type InstallPlatform,
  type ProviderInstallGuideData,
} from "./commands";

export interface ProviderInstallGuide extends ProviderInstallGuideData {
  // 指引所属的内置提供方；自定义提供方是它继承的那个，标题用它的名字。
  provider: GuidedProvider;
  // 主机系统未上报或不在三者之内时为 null，界面不默认选中任何标签。
  defaultPlatform: InstallPlatform | null;
}

export interface ProviderInstallGuideTarget {
  provider: string;
  // daemon 配置里该提供方的 extends 原值（配置 schema 为 passthrough，类型未收窄）。
  extendsProvider?: unknown;
}

const BUILTIN_PROVIDER_ID_SET = new Set<string>(BUILTIN_PROVIDER_IDS);

const HOST_PLATFORM_TO_INSTALL_PLATFORM: Readonly<Record<string, InstallPlatform>> = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
};

function isGuidedProvider(id: unknown): id is GuidedProvider {
  return typeof id === "string" && Object.hasOwn(PROVIDER_INSTALL_GUIDES, id);
}

function resolveGuidedProvider(target: ProviderInstallGuideTarget): GuidedProvider | null {
  // 自定义提供方装的是它继承的那个 CLI；内置提供方忽略 extends。
  const installedCli = BUILTIN_PROVIDER_ID_SET.has(target.provider)
    ? target.provider
    : target.extendsProvider;
  return isGuidedProvider(installedCli) ? installedCli : null;
}

function toInstallPlatform(hostPlatform: string | undefined): InstallPlatform | null {
  if (!hostPlatform || !Object.hasOwn(HOST_PLATFORM_TO_INSTALL_PLATFORM, hostPlatform)) {
    return null;
  }
  return HOST_PLATFORM_TO_INSTALL_PLATFORM[hostPlatform];
}

export function resolveProviderInstallGuide(
  input: ProviderInstallGuideTarget & { hostPlatform: string | undefined },
): ProviderInstallGuide | null {
  const provider = resolveGuidedProvider(input);
  if (!provider) return null;
  return {
    ...PROVIDER_INSTALL_GUIDES[provider],
    provider,
    defaultPlatform: toInstallPlatform(input.hostPlatform),
  };
}
