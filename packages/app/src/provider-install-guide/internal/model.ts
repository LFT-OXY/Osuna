import { BUILTIN_PROVIDER_IDS } from "@osuna/protocol/provider-manifest";
import {
  PROVIDER_INSTALL_GUIDES,
  type GuidedProvider,
  type InstallPlatform,
  type ProviderInstallGuideData,
  type ProviderInstallMethod,
} from "./commands";

export interface ProviderInstallGuide extends ProviderInstallGuideData {
  // 区块所属的内置提供方；自定义提供方是它继承的那个。
  provider: GuidedProvider;
  // 自定义提供方沿用所继承 CLI 的区块时为 true，标题要点出是哪个 CLI。
  isInherited: boolean;
  // 官方顺序里第一个适用于主机系统的安装方式；主机系统未知时是第一个。
  defaultMethod: ProviderInstallMethod;
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

function selectDefaultMethod(
  methods: ProviderInstallGuideData["methods"],
  platform: InstallPlatform | null,
): ProviderInstallMethod {
  const [first] = methods;
  if (!platform) return first;
  return methods.find((method) => method.platforms.includes(platform)) ?? first;
}

export function resolveProviderInstallGuide(
  input: ProviderInstallGuideTarget & { hostPlatform: string | undefined },
): ProviderInstallGuide | null {
  const provider = resolveGuidedProvider(input);
  if (!provider) return null;
  const data = PROVIDER_INSTALL_GUIDES[provider];
  const platform = toInstallPlatform(input.hostPlatform);
  const defaultMethod = selectDefaultMethod(data.methods, platform);
  const isInherited = provider !== input.provider;
  return { ...data, provider, isInherited, defaultMethod };
}
