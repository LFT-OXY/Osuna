// OMP 命名配置的列法与名字规则移植自 magpie（https://github.com/yetone/magpie，internal/agent/omp.go 的 ompProfileName、
// ompReserved、ompProfileOK、ompRoot 与 ompProfiles，internal/dirent/dirent.go 的 IsFolder）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { isErrnoException } from "../../utils/errno.js";
import { resolveOmpSessionPaths } from "../agent/providers/omp/provider-config.js";

/*
 * OMP 的命名配置（OMP profile，`omp --profile <名字>`）：每套是 OMP 根目录下 profiles/<名字>/agent 里自己的一份
 * config.yml 与 models.yml。「使用第三方接口」按套各存一份设置，键是 `omp#<名字>`（照 magpie 的 Agent id）：
 * 提供方 id 只有小写字母、数字与横杠（PROVIDER_ID_PATTERN），不会和它撞名。
 */

export type OmpProfileKey = `omp#${string}`;

const OMP_PROFILE_KEY_PREFIX = "omp#";

// OMP 收的配置名（pi-utils dirs.ts 的 normalizeProfileName）。
const OMP_PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Windows 的保留设备名，OMP 在哪个平台都不收：CON、PRN、AUX、NUL、COM0–9、LPT0–9，及其后跟点的。
const OMP_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

/** OMP 收的配置名：default 不算（它就是默认那套），点结尾的与 Windows 保留名不收。 */
export function isOmpProfileName(name: string): boolean {
  return (
    name !== "default" &&
    OMP_PROFILE_NAME.test(name) &&
    !name.endsWith(".") &&
    !OMP_RESERVED_NAME.test(name)
  );
}

export function ompProfileKey(name: string): OmpProfileKey {
  return `${OMP_PROFILE_KEY_PREFIX}${name}`;
}

export function isOmpProfileKey(key: string): key is OmpProfileKey {
  return (
    key.startsWith(OMP_PROFILE_KEY_PREFIX) &&
    isOmpProfileName(key.slice(OMP_PROFILE_KEY_PREFIX.length))
  );
}

export function ompProfileNameOf(key: OmpProfileKey): string {
  return key.slice(OMP_PROFILE_KEY_PREFIX.length);
}

/** 读 OMP 目录用的环境与家目录（daemon 的）。 */
export interface OmpDirsInput {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

/** OMP 根目录：~/.omp，PI_CONFIG_DIR 改了名字时是 ~/<它>。 */
function ompRoot(input: OmpDirsInput): string {
  return path.join(input.homeDir, input.env.PI_CONFIG_DIR || ".omp");
}

export interface OmpProfileDirInput extends OmpDirsInput {
  name: string;
}

/** 一套命名配置的 agent 目录。 */
export function ompProfileAgentDir(input: OmpProfileDirInput): string {
  return path.join(ompRoot(input), "profiles", input.name, "agent");
}

/**
 * 电脑上的命名配置，按名字排：OMP 根目录下 profiles 里名字合 OMP 规则的文件夹。daemon 环境里 OMP_PROFILE / PI_PROFILE
 * 已经指向的那套由默认那块管，不另列；没有 profiles 文件夹就是没有，agent 文件夹里还没有 config.yml 的照样列出。
 */
export function listOmpProfiles(input: OmpDirsInput): string[] {
  const profilesDir = path.join(ompRoot(input), "profiles");
  let entries: string[];
  try {
    entries = readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => isFolder({ dir: profilesDir, entry }))
      .map((entry) => entry.name);
  } catch (error) {
    if (isErrnoException(error)) return [];
    throw error;
  }
  const { agentDir: defaultDir } = resolveOmpSessionPaths({
    env: input.env,
    homeDir: input.homeDir,
  });
  return entries
    .filter((name) => isOmpProfileName(name))
    .filter((name) => ompProfileAgentDir({ ...input, name }) !== defaultDir)
    .sort();
}

interface ListedEntry {
  dir: string;
  entry: Dirent;
}

/** 文件夹，或指向文件夹的链接（magpie dirent.IsFolder）；指向文件的、断了的链接不算。 */
function isFolder(input: ListedEntry): boolean {
  const { dir, entry } = input;
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(path.join(dir, entry.name)).isDirectory();
  } catch (error) {
    if (isErrnoException(error)) return false;
    throw error;
  }
}
