import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigFileGuarded, type ConfigFileChange } from "./config-file.js";

describe("writeConfigFileGuarded", () => {
  let directory: string;
  let filePath: string;
  // commit 时看到的文件内容，以及落下的「接管记录」。
  let committed: Array<{ fileAtCommit: string | null; value: string }>;

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "paseo-config-file-"));
    filePath = path.join(directory, "settings.json");
    committed = [];
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function readOrNull(): string | null {
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  // 把读到的内容加上一行标记，模拟「基于当前内容算补丁」。
  function write(options: {
    change?: (current: string) => ConfigFileChange;
    onRecheck?: () => void;
  }) {
    const inputs: Array<string | null> = [];
    const result = writeConfigFileGuarded({
      filePath,
      compute: (current) => {
        const text = current?.toString("utf8") ?? "";
        inputs.push(current === null ? null : text);
        const change = options.change?.(text) ?? { kind: "write", text: `${text}patched\n` };
        return { change, value: `record for ${JSON.stringify(text)}` };
      },
      commit: (value) => committed.push({ fileAtCommit: readOrNull(), value }),
      rollback: () => committed.pop(),
      ...(options.onRecheck ? { beforeRecheck: options.onRecheck } : {}),
    });
    return { result, inputs };
  }

  it("writes once and commits the record before replacing the file", () => {
    writeFileSync(filePath, "user\n");

    const { result, inputs } = write({});

    expect(result).toEqual({ kind: "written", value: 'record for "user\\n"' });
    expect(inputs).toEqual(["user\n"]);
    expect(readOrNull()).toBe("user\npatched\n");
    expect(committed).toEqual([{ fileAtCommit: "user\n", value: 'record for "user\\n"' }]);
    expect(readdirSync(directory)).toEqual(["settings.json"]);
  });

  it("recomputes on the new content when the file changes before the replace", () => {
    writeFileSync(filePath, "user\n");
    let changes = 0;

    const { result, inputs } = write({
      onRecheck: () => {
        if (changes === 0) writeFileSync(filePath, "user\nother tool\n");
        changes += 1;
      },
    });

    expect(result).toEqual({ kind: "written", value: 'record for "user\\nother tool\\n"' });
    expect(inputs).toEqual(["user\n", "user\nother tool\n"]);
    expect(readOrNull()).toBe("user\nother tool\npatched\n");
    expect(committed).toHaveLength(1);
  });

  it("gives up after three tries and writes nothing", () => {
    writeFileSync(filePath, "user\n");
    let changes = 0;

    const { result, inputs } = write({
      onRecheck: () => {
        changes += 1;
        writeFileSync(filePath, `other tool ${changes}\n`);
      },
    });

    expect(result).toEqual({ kind: "conflict" });
    expect(inputs).toHaveLength(3);
    expect(readOrNull()).toBe("other tool 3\n");
    // 每次比对不通过都回滚了先落的记录。
    expect(committed).toEqual([]);
    expect(readdirSync(directory)).toEqual(["settings.json"]);
  });

  it("notices a file that appears while it is being computed", () => {
    let changes = 0;

    const { result, inputs } = write({
      change: (current) => (current === "" ? { kind: "keep" } : { kind: "delete" }),
      onRecheck: () => {
        if (changes === 0) writeFileSync(filePath, "created meanwhile\n");
        changes += 1;
      },
    });

    expect(result.kind).toBe("written");
    expect(inputs).toEqual([null, "created meanwhile\n"]);
    expect(readOrNull()).toBeNull();
  });

  it("keeps the file untouched when there is nothing to change but still commits", () => {
    writeFileSync(filePath, "user\n");

    const { result } = write({ change: () => ({ kind: "keep" }) });

    expect(result.kind).toBe("written");
    expect(readOrNull()).toBe("user\n");
    expect(committed).toHaveLength(1);
  });
});
