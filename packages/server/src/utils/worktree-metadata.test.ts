import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  getOsunaWorktreeMetadataPath,
  readOsunaWorktreeMetadata,
  requireOsunaWorktreeBaseRefName,
  writeOsunaWorktreeRuntimeMetadata,
} from "./worktree-metadata.js";

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
const LEGACY_METADATA_DIRECTORY = "paseo";

describe("worktree metadata written by 0.14.x", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function checkoutWithLegacyMetadata(metadata: object): string {
    const worktreeRoot = mkdtempSync(join(tmpdir(), "osuna-worktree-metadata-"));
    roots.push(worktreeRoot);
    const legacyDirectory = join(worktreeRoot, ".git", LEGACY_METADATA_DIRECTORY);
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(join(legacyDirectory, "worktree.json"), JSON.stringify(metadata));
    return worktreeRoot;
  }

  test("is still the base of a worktree created before the rename", () => {
    const worktreeRoot = checkoutWithLegacyMetadata({
      version: 1,
      baseRefName: "main",
      baseRef: "refs/remotes/origin/main",
    });

    expect(readOsunaWorktreeMetadata(worktreeRoot)).toEqual({
      version: 1,
      baseRefName: "main",
      baseRef: "refs/remotes/origin/main",
    });
    expect(requireOsunaWorktreeBaseRefName(worktreeRoot)).toBe("main");
  });

  test("is carried into the new location on the next write and left as it was", () => {
    const writtenByLegacyDaemon = { version: 1, baseRefName: "main" };
    const worktreeRoot = checkoutWithLegacyMetadata(writtenByLegacyDaemon);
    const legacyPath = join(worktreeRoot, ".git", LEGACY_METADATA_DIRECTORY, "worktree.json");

    writeOsunaWorktreeRuntimeMetadata(worktreeRoot, { worktreePort: 4310 });

    const stored = JSON.parse(readFileSync(getOsunaWorktreeMetadataPath(worktreeRoot), "utf8"));
    expect(stored).toEqual({ version: 2, baseRefName: "main", runtime: { worktreePort: 4310 } });
    expect(readOsunaWorktreeMetadata(worktreeRoot)).toEqual(stored);
    expect(JSON.parse(readFileSync(legacyPath, "utf8"))).toEqual(writtenByLegacyDaemon);
  });
});
