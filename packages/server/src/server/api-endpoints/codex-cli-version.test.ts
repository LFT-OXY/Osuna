// 用例取自 magpie（https://github.com/yetone/magpie，internal/proc/version.go 的 Version、npmVersion、versionsFailed）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { InstalledCodexVersion } from "./codex-cli-version.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-codex-cli-version-"));
  roots.push(root);
  return root;
}

/** 一个假的 codex 可执行文件与数着跑了几次的 `--version`（绝不跑真的 codex）。 */
function fakeCodex(input: { file: string; answers: string[] }) {
  const runs = { count: 0 };
  const reader = new InstalledCodexVersion({
    locate: async () => input.file,
    runVersion: async () => {
      const answer = input.answers[runs.count] ?? "";
      runs.count += 1;
      return answer;
    },
  });
  return { reader, runs };
}

describe("installed Codex CLI version", () => {
  test("reads the npm package's version without running the binary", async () => {
    const root = tempRoot();
    const packageDir = path.join(root, "node_modules", "@openai", "codex");
    mkdirSync(path.join(packageDir, "bin"), { recursive: true });
    writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "0.172.0" }));
    const file = path.join(packageDir, "bin", "codex.js");
    writeFileSync(file, "#!/usr/bin/env node\n");
    const { reader, runs } = fakeCodex({ file, answers: [] });

    expect(await reader.read()).toBe("0.172.0");
    expect(runs.count).toBe(0);
  });

  test("a run that says no version is not run again until the binary changes", async () => {
    const file = path.join(tempRoot(), "codex");
    writeFileSync(file, "binary v1");
    const { reader, runs } = fakeCodex({
      file,
      answers: ["error: killed by the system", "codex-cli 0.173.1"],
    });

    expect(await reader.read()).toBeNull();
    expect(await reader.read()).toBeNull();
    expect(runs.count).toBe(1);

    // 换了个可执行文件（更新后大小与修改时间都变了）：再跑一次。
    writeFileSync(file, "binary v2, a little longer");
    utimesSync(file, new Date(), new Date(Date.now() + 60_000));
    expect(await reader.read()).toBe("0.173.1");
    expect(runs.count).toBe(2);
  });

  test("lookups at the same time share one run", async () => {
    const file = path.join(tempRoot(), "codex");
    writeFileSync(file, "binary");
    const { reader, runs } = fakeCodex({ file, answers: ["codex-cli 0.174.0"] });

    const answers = await Promise.all([reader.read(), reader.read(), reader.read()]);

    expect(answers).toEqual(["0.174.0", "0.174.0", "0.174.0"]);
    expect(runs.count).toBe(1);
  });

  test("no Codex installed asks nothing", async () => {
    let ran = false;
    const reader = new InstalledCodexVersion({
      locate: async () => null,
      runVersion: async () => {
        ran = true;
        return "";
      },
    });
    expect(await reader.read()).toBeNull();
    expect(ran).toBe(false);
  });
});
