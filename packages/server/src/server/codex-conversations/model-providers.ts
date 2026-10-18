import path from "node:path";
import type { CodexSessionModelProvider } from "@getpaseo/protocol/codex-session/rpc-schemas";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { CODEX_API_ENDPOINT_PROVIDER_ID } from "../api-endpoints/codex-config-patch.js";
import { CODEX_MODEL_PROVIDER_ID_PATTERN } from "./move-to-model-provider.js";

/*
 * 能把 Codex 对话挪去的 Codex 服务商（PRD 第 22 条）：内置 openai、Osuna 自己的服务商，
 * 再加 config.toml 里 [model_providers.<id>] 的每张表（按文件里的顺序）。
 * 另附状态库所在目录：magpie codexStateDBs 的规则，CODEX_SQLITE_HOME 优先，其次 config.toml 的 sqlite_home。
 */

const BOM = "﻿";
const OSUNA_PROVIDER_NAME = "Osuna";

export class CodexConfigUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexConfigUnreadableError";
  }
}

export interface CodexConversationSettings {
  modelProviders: CodexSessionModelProvider[];
  stateDirectory: string;
}

/** `configText` 为 null 表示没有 config.toml。读不懂的 config.toml 抛 CodexConfigUnreadableError。 */
export function readCodexConversationSettings(input: {
  configText: string | null;
  codexHome: string;
  env: NodeJS.ProcessEnv;
}): CodexConversationSettings {
  const config = parseConfig(input.configText);
  const tables = isRecord(config.model_providers) ? config.model_providers : {};
  const fixed: CodexSessionModelProvider[] = [
    { id: "openai", source: "builtin" },
    { id: CODEX_API_ENDPOINT_PROVIDER_ID, source: "osuna", name: OSUNA_PROVIDER_NAME },
  ];
  const fixedIds = new Set(fixed.map((provider) => provider.id));
  const fromConfig = Object.entries(tables).flatMap(([id, table]): CodexSessionModelProvider[] => {
    const isListable = CODEX_MODEL_PROVIDER_ID_PATTERN.test(id) && !fixedIds.has(id);
    if (!isListable) return [];
    const name = isRecord(table) && typeof table.name === "string" ? table.name : null;
    return [name ? { id, source: "config", name } : { id, source: "config" }];
  });
  return {
    modelProviders: [...fixed, ...fromConfig],
    stateDirectory: resolveStateDirectory({ config, codexHome: input.codexHome, env: input.env }),
  };
}

function resolveStateDirectory(input: {
  config: Record<string, unknown>;
  codexHome: string;
  env: NodeJS.ProcessEnv;
}): string {
  const fromEnv = input.env.CODEX_SQLITE_HOME?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const fromConfig = input.config.sqlite_home;
  if (typeof fromConfig === "string" && fromConfig.trim()) {
    return path.resolve(input.codexHome, fromConfig.trim());
  }
  return input.codexHome;
}

function parseConfig(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  let value: unknown;
  try {
    value = getStaticTOMLValue(parseTOML(body, { tomlVersion: "1.0" }));
  } catch (error) {
    throw new CodexConfigUnreadableError(
      `Codex's config.toml can't be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value)) throw new CodexConfigUnreadableError("Codex's config.toml is not a table");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
