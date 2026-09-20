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

export type ReadPaseoConfigForEditResult =
  | { ok: true; config: OsunaConfigRaw | null; revision: OsunaConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WritePaseoConfigForEditResult =
  | { ok: true; config: OsunaConfigRaw; revision: OsunaConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WritePaseoConfigForEditInput {
  repoRoot: string;
  config: OsunaConfigRaw;
  expectedRevision: OsunaConfigRevision | null;
}

export function resolvePaseoConfigPath(repoRoot: string): string {
  return join(repoRoot, OSUNA_CONFIG_FILE_NAME);
}

export function statPaseoConfigPath(repoRoot: string): OsunaConfigRevision | null {
  const configPath = resolvePaseoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readPaseoConfigJson(repoRoot: string): unknown {
  const configPath = resolvePaseoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readPaseoConfigForEdit(repoRoot: string): ReadPaseoConfigForEditResult {
  try {
    const json = readPaseoConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: OsunaConfigRawSchema.parse(json),
      revision: statPaseoConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writePaseoConfigForEdit(
  input: WritePaseoConfigForEditInput,
): WritePaseoConfigForEditResult {
  const parsed = OsunaConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolvePaseoConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${OSUNA_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statPaseoConfigPath(input.repoRoot);
    if (!paseoConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempPaseoConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statPaseoConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempPaseoConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function paseoConfigRevisionsEqual(
  left: OsunaConfigRevision | null,
  right: OsunaConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempPaseoConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
