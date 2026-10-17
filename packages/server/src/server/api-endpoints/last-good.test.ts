import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { type DataFileSystem, LastGoodFile, NODE_DATA_FILE_SYSTEM } from "./last-good.js";

/*
 * Windows 上被占用时的重试：照 magpie（MIT，THIRD_PARTY_NOTICES）internal/steady/steady_test.go 的做法，
 * 换掉读文件与改名来模拟占用，不靠真的 Windows 和真实时间。
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const TokensSchema = z.object({ tokens: z.record(z.string(), z.string()) });

interface BusyFileSystem {
  fileSystem: DataFileSystem;
  pauses: number[];
}

/** Windows 的样子：读和改名各先失败 busyTimes 回（EBUSY / EPERM），之后照常。 */
function busyFileSystem(busy: { reads: number; renames: number }): BusyFileSystem {
  const pauses: number[] = [];
  let reads = busy.reads;
  let renames = busy.renames;
  const fileSystem: DataFileSystem = {
    platform: "win32",
    readFile: (filePath) => {
      if (reads > 0) {
        reads -= 1;
        throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${filePath}'`), {
          code: "EBUSY",
        });
      }
      return NODE_DATA_FILE_SYSTEM.readFile(filePath);
    },
    rename: (from, to) => {
      if (renames > 0) {
        renames -= 1;
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {
          code: "EPERM",
        });
      }
      NODE_DATA_FILE_SYSTEM.rename(from, to);
    },
    pause: (ms) => pauses.push(ms),
  };
  return { fileSystem, pauses };
}

async function tokensFile(fileSystem: DataFileSystem) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-last-good-"));
  roots.push(root);
  const filePath = path.join(root, "gateway-tokens.json");
  await writeFile(filePath, JSON.stringify({ tokens: { claude: "token-1" } }));
  const file = new LastGoodFile({
    filePath,
    parse: (raw) => TokensSchema.parse(raw),
    logger: createTestLogger(),
    now: () => new Date("2026-10-17T08:00:00.000Z"),
    fileSystem,
  });
  return { root, filePath, file };
}

describe("a data file held by another program on Windows", () => {
  test("is read and renamed over once it is let go, waiting 10 ms between tries", async () => {
    const { fileSystem, pauses } = busyFileSystem({ reads: 3, renames: 2 });
    const { root, filePath, file } = await tokensFile(fileSystem);

    const read = file.read();
    file.write({ tokens: { claude: "token-2" } });

    expect(read).toEqual({ tokens: { claude: "token-1" } });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ tokens: { claude: "token-2" } });
    expect(JSON.parse(await readFile(`${filePath}.bak`, "utf8"))).toEqual({
      tokens: { claude: "token-1" },
    });
    expect(pauses).toEqual([10, 10, 10, 10, 10]);
    expect((await readdir(root)).sort()).toEqual([
      "gateway-tokens.json",
      "gateway-tokens.json.bak",
    ]);
  });

  test("held longer than half a second is the error it was, and nothing is replaced", async () => {
    const reading = busyFileSystem({ reads: 1000, renames: 0 });
    const held = await tokensFile(reading.fileSystem);

    expect(() => held.file.read()).toThrow(expect.objectContaining({ code: "EBUSY" }));
    expect(reading.pauses).toEqual(Array.from({ length: 50 }, () => 10));

    const renaming = busyFileSystem({ reads: 0, renames: 1000 });
    const kept = await tokensFile(renaming.fileSystem);
    const before = await readFile(kept.filePath, "utf8");

    expect(() => kept.file.write({ tokens: { claude: "token-2" } })).toThrow(
      expect.objectContaining({ code: "EPERM" }),
    );
    // 第一次改名是存 .bak，就失败了：原文件没动，临时文件收走。
    expect(renaming.pauses).toEqual(Array.from({ length: 50 }, () => 10));
    expect(await readFile(kept.filePath, "utf8")).toBe(before);
    expect(await readdir(kept.root)).toEqual(["gateway-tokens.json"]);
  });

  test("elsewhere a failed read is not tried again", async () => {
    const { fileSystem, pauses } = busyFileSystem({ reads: 1, renames: 0 });
    const { file } = await tokensFile({ ...fileSystem, platform: "darwin" });

    expect(() => file.read()).toThrow(expect.objectContaining({ code: "EBUSY" }));
    expect(pauses).toEqual([]);
  });
});
