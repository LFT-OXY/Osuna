import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCheckoutDiff, type CheckoutDiffCompare } from "./checkout-git.js";
import { CheckoutDiffFileReuse, type CheckoutDiffReuseRun } from "./checkout-diff-file-reuse.js";
import type { ParsedDiffFile } from "../server/utils/diff-highlighter.js";
import { startGitCommandMetrics, stopGitCommandMetrics } from "./run-git-command.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function moduleSource(name: string, edit = ""): string {
  const lines = Array.from(
    { length: 40 },
    (_, index) => `export const ${name}${index} = ${index};`,
  );
  if (edit) lines[10] = `export const ${name}10 = "${edit}";`;
  return `${lines.join("\n")}\n`;
}

describe("per-file checkout diff reuse", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-diff-reuse-")));
    git(repoDir, "init", "-b", "main");
    git(repoDir, "config", "user.email", "test@test.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    for (const name of ["alpha", "beta", "gamma", "delta"]) {
      writeFileSync(join(repoDir, `${name}.ts`), moduleSource(name));
    }
    git(repoDir, "add", ".");
    git(repoDir, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  async function expectSameAsFresh(
    reuse: CheckoutDiffFileReuse,
    compare: CheckoutDiffCompare,
  ): Promise<void> {
    const reused = await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse });
    const fresh = await getCheckoutDiff(repoDir, compare);
    expect(JSON.stringify(reused)).toBe(JSON.stringify(fresh));
  }

  it("matches a full recomputation after each kind of working tree change", async () => {
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const patchOnly = { mode: "uncommitted" } as const;
    const reuse = new CheckoutDiffFileReuse();
    const patchReuse = new CheckoutDiffFileReuse();
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "one"));
    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "one"));
    writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes"));
    await expectSameAsFresh(reuse, compare);
    await expectSameAsFresh(patchReuse, patchOnly);

    const steps: Array<() => void> = [
      () => writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "two")),
      () => writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes", "two")),
      () => unlinkSync(join(repoDir, "gamma.ts")),
      () => {
        git(repoDir, "mv", "delta.ts", "delta-renamed.ts");
        writeFileSync(join(repoDir, "delta-renamed.ts"), moduleSource("delta", "moved"));
      },
      () => renameSync(join(repoDir, "notes.ts"), join(repoDir, "notes-renamed.ts")),
      () => git(repoDir, "commit", "-am", "move head"),
      () => writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta")),
    ];
    for (const step of steps) {
      step();
      await expectSameAsFresh(reuse, compare);
      await expectSameAsFresh(patchReuse, patchOnly);
    }
  });

  it("matches a full recomputation when ignoreWhitespace is switched", async () => {
    const reuse = new CheckoutDiffFileReuse();
    writeFileSync(
      join(repoDir, "alpha.ts"),
      moduleSource("alpha").replace("alpha3 =", "alpha3  ="),
    );
    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "one"));
    for (const ignoreWhitespace of [false, true, false, true]) {
      await expectSameAsFresh(reuse, {
        mode: "uncommitted",
        includeStructured: true,
        ignoreWhitespace,
      });
    }
  });

  it("re-marks generated files when .gitattributes changes while their diffs are reused", async () => {
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const reuse = new CheckoutDiffFileReuse();
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "one"));
    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "one"));
    await expectSameAsFresh(reuse, compare);

    const generatedPaths = async () =>
      (await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse })).structured
        ?.filter((file) => file.generated)
        .map((file) => file.path);
    writeFileSync(join(repoDir, ".gitattributes"), "alpha.ts linguist-generated\n");
    expect(await generatedPaths()).toEqual(["alpha.ts"]);
    await expectSameAsFresh(reuse, compare);

    writeFileSync(join(repoDir, ".gitattributes"), "beta.ts linguist-generated\n");
    expect(await generatedPaths()).toEqual(["beta.ts"]);
    await expectSameAsFresh(reuse, compare);
  });

  it("only diffs the file that changed since the previous run", async () => {
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const reuse = new CheckoutDiffFileReuse();
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "one"));
    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "one"));
    writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes"));
    await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse });

    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "two"));
    startGitCommandMetrics();
    await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse });
    const metrics = stopGitCommandMetrics();

    const patchCommands = metrics.commands
      .map((command) => command.args)
      .filter((args) => args[0] === "diff" && args.includes("--"));
    expect(patchCommands).toEqual([
      [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "HEAD",
        "--",
        ":(literal)alpha.ts",
      ],
    ]);
  });

  it("uses watcher paths to catch a change that kept size and mtime", async () => {
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const reuse = new CheckoutDiffFileReuse();
    const alphaPath = join(repoDir, "alpha.ts");
    // 整秒时间戳能原样写回，两次写入的大小、mtime、inode 都相同
    const fixedTime = 1_700_000_000;
    writeFileSync(alphaPath, moduleSource("alpha", "aaa"));
    utimesSync(alphaPath, fixedTime, fixedTime);
    await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse });

    writeFileSync(alphaPath, moduleSource("alpha", "bbb"));
    utimesSync(alphaPath, fixedTime, fixedTime);
    reuse.markChanged([alphaPath]);

    await expectSameAsFresh(reuse, compare);
  });

  it("matches a full recomputation after a change signal without paths", async () => {
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const reuse = new CheckoutDiffFileReuse();
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "one"));
    writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes"));
    await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse });

    // 轮询降级只说「有变化」，不带路径：靠文件身份比对兜底
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "two-longer"));
    writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes", "two"));
    reuse.markChanged([]);
    await expectSameAsFresh(reuse, compare);
  });

  it("matches a full recomputation in base mode as commits land", async () => {
    git(repoDir, "checkout", "-b", "feature");
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "one"));
    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "one"));
    git(repoDir, "commit", "-am", "feature one");
    const compare = { mode: "base", baseRef: "main", includeStructured: true } as const;
    const reuse = new CheckoutDiffFileReuse();
    await expectSameAsFresh(reuse, compare);

    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "two"));
    git(repoDir, "commit", "-am", "feature two");
    await expectSameAsFresh(reuse, compare);

    git(repoDir, "mv", "beta.ts", "beta-renamed.ts");
    git(repoDir, "rm", "-q", "gamma.ts");
    git(repoDir, "commit", "-m", "feature three");
    await expectSameAsFresh(reuse, compare);

    git(repoDir, "checkout", "-q", "main");
    writeFileSync(join(repoDir, "delta.ts"), moduleSource("delta", "main"));
    git(repoDir, "commit", "-am", "main moves");
    git(repoDir, "checkout", "-q", "feature");
    git(repoDir, "merge", "-q", "--no-edit", "main");
    await expectSameAsFresh(reuse, compare);
  });

  const allChanges = { mode: "all", baseRef: "main", includeStructured: true } as const;
  const allChangesFilesOnly = { ...allChanges, filesOnly: true } as const;

  // 分支上删掉 gamma.ts 又在磁盘放回：真实 index 里它是未跟踪，私有 index 里恢复成跟踪文件
  function prepareAllChangesCheckout(): void {
    git(repoDir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha", "committed"));
    git(repoDir, "rm", "-q", "gamma.ts");
    git(repoDir, "commit", "-qam", "feature");
    writeFileSync(join(repoDir, "gamma.ts"), moduleSource("gamma", "restored"));
    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "working"));
    writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes"));
  }

  function diffedPaths(commands: Array<{ args: string[] }>): string[] {
    return commands
      .map((command) => command.args)
      .filter((args) => args[0] === "diff" && args.includes("--"))
      .flatMap((args) => args.slice(args.indexOf("--") + 1))
      .map((path) => path.replace(":(literal)", ""))
      .sort();
  }

  function fileListFields(files: ParsedDiffFile[] | undefined) {
    return files?.map(({ path, additions, deletions, generated }) => ({
      path,
      additions,
      deletions,
      generated,
    }));
  }

  it("matches a full recomputation in All changes mode as restored, untracked and committed files change", async () => {
    prepareAllChangesCheckout();
    const reuse = new CheckoutDiffFileReuse();
    const listReuse = new CheckoutDiffFileReuse();
    const initial = await getCheckoutDiff(repoDir, allChanges);
    expect(
      initial.structured?.map(({ path, isNew, isDeleted }) => ({ path, isNew, isDeleted })),
    ).toEqual([
      { path: "alpha.ts", isNew: false, isDeleted: false },
      { path: "beta.ts", isNew: false, isDeleted: false },
      { path: "gamma.ts", isNew: false, isDeleted: false },
      { path: "notes.ts", isNew: true, isDeleted: false },
    ]);
    await expectSameAsFresh(reuse, allChanges);
    await expectSameAsFresh(listReuse, allChangesFilesOnly);

    const steps: Array<() => void> = [
      () => writeFileSync(join(repoDir, "gamma.ts"), moduleSource("gamma", "again")),
      // 放回的内容与 base 相同：从改动里消失
      () => writeFileSync(join(repoDir, "gamma.ts"), moduleSource("gamma")),
      () => writeFileSync(join(repoDir, "gamma.ts"), moduleSource("gamma", "third")),
      () => git(repoDir, "add", "gamma.ts"),
      () => writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes", "two")),
      () => git(repoDir, "add", "notes.ts"),
      () => git(repoDir, "commit", "-qm", "working"),
      () => unlinkSync(join(repoDir, "gamma.ts")),
      () => writeFileSync(join(repoDir, "alpha.ts"), moduleSource("alpha")),
    ];
    for (const step of steps) {
      step();
      await expectSameAsFresh(reuse, allChanges);
      await expectSameAsFresh(listReuse, allChangesFilesOnly);
    }
    const final = await getCheckoutDiff(repoDir, allChanges, { diffFileReuse: reuse });
    expect(
      final.structured?.map(({ path, isNew, isDeleted }) => ({ path, isNew, isDeleted })),
    ).toEqual([
      { path: "beta.ts", isNew: false, isDeleted: false },
      { path: "gamma.ts", isNew: false, isDeleted: true },
      { path: "notes.ts", isNew: true, isDeleted: false },
    ]);
    // Windows 上约 32 秒，超过默认的 30 秒
  }, 120_000);

  it("only diffs the file that changed in All changes mode, restored base files included", async () => {
    prepareAllChangesCheckout();
    const reuse = new CheckoutDiffFileReuse();
    await getCheckoutDiff(repoDir, allChanges, { diffFileReuse: reuse });

    writeFileSync(join(repoDir, "beta.ts"), moduleSource("beta", "again"));
    startGitCommandMetrics();
    await getCheckoutDiff(repoDir, allChanges, { diffFileReuse: reuse });
    expect(diffedPaths(stopGitCommandMetrics().commands)).toEqual(["beta.ts"]);

    writeFileSync(join(repoDir, "gamma.ts"), moduleSource("gamma", "again"));
    startGitCommandMetrics();
    await getCheckoutDiff(repoDir, allChanges, { diffFileReuse: reuse });
    expect(diffedPaths(stopGitCommandMetrics().commands)).toEqual(["gamma.ts"]);

    writeFileSync(join(repoDir, "notes.ts"), moduleSource("notes", "again"));
    startGitCommandMetrics();
    await getCheckoutDiff(repoDir, allChanges, { diffFileReuse: reuse });
    expect(diffedPaths(stopGitCommandMetrics().commands)).toEqual(["notes.ts"]);
  });

  it("lists All changes files without reading contents and keeps generated marks", async () => {
    prepareAllChangesCheckout();
    writeFileSync(join(repoDir, ".gitattributes"), "gamma.ts linguist-generated\n");
    startGitCommandMetrics();
    const full = await getCheckoutDiff(repoDir, allChanges);
    const fullCommands = stopGitCommandMetrics().commands.map((command) => command.args[0]);
    startGitCommandMetrics();
    const list = await getCheckoutDiff(repoDir, allChangesFilesOnly);
    const commands = stopGitCommandMetrics().commands.map((command) => command.args[0]);

    // 完整订阅会读全文，清单订阅一次也不读
    expect(fullCommands).toContain("cat-file");
    expect(commands).not.toContain("cat-file");
    expect(commands).not.toContain("show");
    expect(list.structured?.map((file) => [file.path, file.hunks])).toEqual(
      list.structured?.map((file) => [file.path, []]),
    );
    expect(fileListFields(list.structured)).toEqual(fileListFields(full.structured));
    expect(list.structured?.filter((file) => file.generated).map((file) => file.path)).toEqual([
      "gamma.ts",
    ]);
  });

  it("keeps full-file highlighting when a change hint lands mid-run", async () => {
    // 块注释从第 1 行开到最后，被改的那行只有带上全文才会被识别成注释
    const commented = (edit: string) =>
      [
        "/*",
        ...Array.from({ length: 30 }, (_, index) => (index === 15 ? edit : `line ${index}`)),
        "*/",
        "",
      ].join("\n");
    writeFileSync(join(repoDir, "commented.ts"), commented("export const kept = 1;"));
    git(repoDir, "add", "commented.ts");
    git(repoDir, "commit", "-m", "commented");
    writeFileSync(join(repoDir, "commented.ts"), commented("export const changed = 2;"));
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const commentedPath = join(repoDir, "commented.ts");

    // 模拟监听回调正好落在「决定复用」和「取高亮」之间
    class HintMidRun extends CheckoutDiffFileReuse {
      armed = false;

      async begin(
        input: Parameters<CheckoutDiffFileReuse["begin"]>[0],
      ): Promise<CheckoutDiffReuseRun> {
        const run = await super.begin(input);
        const hasHighlighted = run.hasHighlighted.bind(run);
        run.hasHighlighted = (path: string) => {
          const result = hasHighlighted(path);
          if (this.armed && path === "commented.ts") this.markChanged([commentedPath]);
          return result;
        };
        return run;
      }
    }
    const reuse = new HintMidRun();
    await getCheckoutDiff(repoDir, compare, { diffFileReuse: reuse });
    reuse.armed = true;
    await expectSameAsFresh(reuse, compare);
  });

  it("never reuses a submodule entry whose own directory stat does not move", async () => {
    const subSource = realpathSync(mkdtempSync(join(tmpdir(), "checkout-diff-reuse-sub-")));
    try {
      git(subSource, "init", "-b", "main");
      git(subSource, "config", "user.email", "test@test.com");
      git(subSource, "config", "user.name", "Test");
      writeFileSync(join(subSource, "x.ts"), "export const x = 0;\n");
      git(subSource, "add", ".");
      git(subSource, "-c", "commit.gpgsign=false", "commit", "-m", "sub init");
      git(repoDir, "-c", "protocol.file.allow=always", "submodule", "add", "-q", subSource, "sub");
      git(repoDir, "commit", "-m", "add sub");
      const subDir = join(repoDir, "sub");
      git(subDir, "config", "user.email", "test@test.com");
      git(subDir, "config", "user.name", "Test");
      const compare = { mode: "uncommitted", includeStructured: true } as const;
      const reuse = new CheckoutDiffFileReuse();

      for (const value of [1, 2, 3]) {
        writeFileSync(join(subDir, "x.ts"), `export const x = ${value};\n`);
        git(subDir, "-c", "commit.gpgsign=false", "commit", "-qam", `sub ${value}`);
        await expectSameAsFresh(reuse, compare);
      }
    } finally {
      rmSync(subSource, { recursive: true, force: true });
    }
  });
});
