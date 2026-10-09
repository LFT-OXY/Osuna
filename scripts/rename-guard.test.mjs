import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { findRenameViolations } from "./rename-guard.mjs";

const guardScript = join(import.meta.dirname, "rename-guard.mjs");

async function makeTree(t, files) {
  const root = await mkdtemp(join(tmpdir(), "rename-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return root;
}

function summarize(violations) {
  return violations.map(({ file, line }) => (line ? `${file}:${line}` : file)).sort();
}

test("reports the file and line of every old spelling, in any letter case", async (t) => {
  const root = await makeTree(t, {
    "packages/server/src/home.ts": [
      'const home = ".osuna";',
      'const legacy = ".paseo";',
      "process.env.PASEO_HOME;",
      "// Paseo daemon",
    ].join("\n"),
    "packages/server/src/clean.ts": 'export const name = "osuna";\n',
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), [
    "packages/server/src/home.ts:2",
    "packages/server/src/home.ts:3",
    "packages/server/src/home.ts:4",
  ]);
});

test("lets the exception list keep the old spelling, in content and in paths", async (t) => {
  const upstream = "Derived from Paseo, https://github.com/getpaseo/paseo\n";
  const root = await makeTree(t, {
    LICENSE: upstream,
    NOTICE: upstream,
    "CHANGELOG.md": upstream,
    "README.md": upstream,
    "README.zh-CN.md": upstream,
    "README.ja.md": upstream,
    "README.ko.md": upstream,
    "docs/glossary.md": upstream,
    "docs/adr/0002-rename-stops-at-app-identity.md": upstream,
    "docs/adr/0006-osuna-full-detach-from-paseo.md": upstream,
    ".atw/tasks/archive/2026-09/task/prd.md": upstream,
    ".atw/workspace/oxy/journal-1.md": upstream,
    "packages/desktop/e2e/fixtures/legacy-paseo/Paseo/desktop-settings.json": upstream,
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), []);
});

test("does not extend an exception to a file that only shares its name", async (t) => {
  const root = await makeTree(t, {
    "packages/app/LICENSE": "Paseo\n",
    "packages/app/README.md": "Paseo\n",
    "docs/adr.md": "Paseo\n",
    "docs/release.md": "Paseo\n",
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), [
    "docs/adr.md:1",
    "docs/release.md:1",
    "packages/app/LICENSE:1",
    "packages/app/README.md:1",
  ]);
});

test("scans hidden directories and skips node_modules, dist and lockfiles", async (t) => {
  const root = await makeTree(t, {
    ".github/workflows/ci.yml": "run: paseo daemon start\n",
    ".atw/spec/server/index.md": "Read `paseo-home.ts`.\n",
    ".agents/skills/release/SKILL.md": "Cut a Paseo release.\n",
    "node_modules/@getpaseo/cli/package.json": '{ "name": "@getpaseo/cli" }\n',
    "packages/app/node_modules/pkg/index.js": "paseo\n",
    "packages/server/dist/index.js": "paseo\n",
    "package-lock.json": '{ "name": "paseo" }\n',
    "flake.lock": "paseo\n",
    "packages/app/ios/Podfile.lock": "paseo\n",
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), [
    ".agents/skills/release/SKILL.md:1",
    ".atw/spec/server/index.md:1",
    ".github/workflows/ci.yml:1",
  ]);
});

test("reports a path that carries the old spelling even when the content is clean", async (t) => {
  const root = await makeTree(t, {
    "packages/server/src/paseo-home.ts": "export const home = 1;\n",
    "skills/Paseo-loop/SKILL.md": "A loop.\n",
    "packages/server/src/osuna-home.ts": "export const home = 1;\n",
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), [
    "packages/server/src/paseo-home.ts",
    "skills/Paseo-loop/SKILL.md",
  ]);
});

test("checks where a symlink points instead of reading through it", async (t) => {
  const root = await makeTree(t, {
    "skills/osuna-loop/SKILL.md": "A loop.\n",
    "docs/glossary.md": "Paseo is the upstream project.\n",
  });
  await mkdir(join(root, ".claude/skills"), { recursive: true });
  await symlink("../../skills/osuna-loop", join(root, ".claude/skills/loop"));
  await symlink("../../skills/paseo-loop", join(root, ".claude/skills/stale"));
  await symlink("docs/glossary.md", join(root, "GLOSSARY.md"));

  assert.deepEqual(summarize(await findRenameViolations(root)), [".claude/skills/stale:1"]);
});

const COMPAT_COMMENT =
  "// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first";

test("lets migration code tagged COMPAT(paseoDataMigration) read the old layout", async (t) => {
  const root = await makeTree(t, {
    "packages/server/src/home.ts": [
      'import { homedir } from "node:os";',
      "",
      COMPAT_COMMENT,
      'const LEGACY_HOME = ".paseo";',
      'const LEGACY_ENV_PREFIX = "PASEO_";',
      "",
      'const untagged = ".paseo";',
      "",
      `const inline = "paseo://app"; ${COMPAT_COMMENT}`,
      "",
      'const next = "paseo://app";',
    ].join("\n"),
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), [
    "packages/server/src/home.ts:11",
    "packages/server/src/home.ts:7",
  ]);
});

test("lets a file that opens with the tag keep the old spelling throughout, path included", async (t) => {
  const root = await makeTree(t, {
    "packages/server/src/legacy-paseo-home.test.ts": [
      COMPAT_COMMENT,
      'import { expect, it } from "vitest";',
      "",
      'it("moves ~/.paseo to ~/.osuna", () => {});',
    ].join("\n"),
    "scripts/migrate.sh": [
      "#!/bin/sh",
      `# ${COMPAT_COMMENT.slice(3)}`,
      "",
      "mv ~/.paseo ~/.osuna",
    ].join("\n"),
    "packages/server/src/paseo-other.ts": [
      "export {};",
      "",
      COMPAT_COMMENT,
      "export const a = 1;",
    ].join("\n"),
  });

  assert.deepEqual(summarize(await findRenameViolations(root)), [
    "packages/server/src/paseo-other.ts",
  ]);
});

function runGuardCli(root) {
  return spawnSync(process.execPath, [guardScript, "--root", root], { encoding: "utf8" });
}

test("the command exits non-zero and prints each violation as file:line", async (t) => {
  const root = await makeTree(t, {
    "packages/server/src/paseo-home.ts": 'export const home = ".paseo";\n',
    LICENSE: "Paseo\n",
  });

  const result = runGuardCli(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/server\/src\/paseo-home\.ts: path$/m);
  assert.match(result.stderr, /^packages\/server\/src\/paseo-home\.ts:1: export const home/m);
  assert.doesNotMatch(result.stderr, /LICENSE/);
});

test("the command exits zero on a tree with no violations", async (t) => {
  const root = await makeTree(t, {
    "packages/server/src/osuna-home.ts": 'export const home = ".osuna";\n',
    LICENSE: "Paseo\n",
  });

  const result = runGuardCli(root);

  assert.equal(result.status, 0, result.stderr);
});
