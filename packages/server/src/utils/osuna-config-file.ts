import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OsunaConfigRawSchema,
  type OsunaConfigRaw,
  type OsunaConfigRevision,
  type ProjectConfigRpcError,
} from "@osuna/protocol/osuna-config-schema";
export {
  OsunaConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type OsunaConfigRevision,
  type ProjectConfigRpcError,
} from "@osuna/protocol/osuna-config-schema";

export const OSUNA_CONFIG_FILE_NAME = "osuna.json";

export type ReadOsunaConfigForEditResult =
  | { ok: true; config: OsunaConfigRaw | null; revision: OsunaConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteOsunaConfigForEditResult =
  | { ok: true; config: OsunaConfigRaw; revision: OsunaConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteOsunaConfigForEditInput {
  repoRoot: string;
  config: OsunaConfigRaw;
  expectedRevision: OsunaConfigRevision | null;
}

export function resolveOsunaConfigPath(repoRoot: string): string {
  return join(repoRoot, OSUNA_CONFIG_FILE_NAME);
}

export function statOsunaConfigPath(repoRoot: string): OsunaConfigRevision | null {
  const configPath = resolveOsunaConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readOsunaConfigJson(repoRoot: string): unknown {
  const configPath = resolveOsunaConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readOsunaConfigForEdit(repoRoot: string): ReadOsunaConfigForEditResult {
  try {
    const json = readOsunaConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: OsunaConfigRawSchema.parse(json),
      revision: statOsunaConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeOsunaConfigForEdit(
  input: WriteOsunaConfigForEditInput,
): WriteOsunaConfigForEditResult {
  const parsed = OsunaConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveOsunaConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${OSUNA_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statOsunaConfigPath(input.repoRoot);
    if (!osunaConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempOsunaConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statOsunaConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempOsunaConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function osunaConfigRevisionsEqual(
  left: OsunaConfigRevision | null,
  right: OsunaConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempOsunaConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
