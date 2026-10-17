// 占用时重试的用例照 magpie（MIT，THIRD_PARTY_NOTICES）的 internal/steady/steady_test.go，读回上一份好的照 internal/lastgood/lastgood_test.go
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
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
  // 每回占用抛的都是这同一个错误，测试按引用比对。
  readError: NodeJS.ErrnoException;
  renameError: NodeJS.ErrnoException;
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: held by another program`), { code });
}

/** Windows 的样子：读先失败 reads 回（EBUSY）、改名先失败 renames 回（EPERM），之后照常。 */
function busyFileSystem(busy: { reads: number; renames: number }): BusyFileSystem {
  const pauses: number[] = [];
  const readError = errnoError("EBUSY");
  const renameError = errnoError("EPERM");
  let reads = busy.reads;
  let renames = busy.renames;
  const fileSystem: DataFileSystem = {
    platform: "win32",
    readFile: (filePath) => {
      if (reads > 0) {
        reads -= 1;
        throw readError;
      }
      return NODE_DATA_FILE_SYSTEM.readFile(filePath);
    },
    rename: (from, to) => {
      if (renames > 0) {
        renames -= 1;
        throw renameError;
      }
      NODE_DATA_FILE_SYSTEM.rename(from, to);
    },
    pause: (ms) => pauses.push(ms),
  };
  return { fileSystem, pauses, readError, renameError };
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

interface LogLine {
  level: number;
  msg: string;
  filePath: string;
  why: string;
  err?: { code?: string };
}

async function tokensFile(fileSystem: DataFileSystem) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-last-good-"));
  roots.push(root);
  const filePath = path.join(root, "gateway-tokens.json");
  await writeFile(filePath, JSON.stringify({ tokens: { claude: "token-1" } }));
  const logLines: LogLine[] = [];
  const logger = pino(
    { level: "warn" },
    { write: (line: string) => logLines.push(JSON.parse(line) as LogLine) },
  );
  const file = new LastGoodFile({
    filePath,
    parse: (raw) => TokensSchema.parse(raw),
    logger,
    now: () => new Date("2026-10-17T08:00:00.000Z"),
    fileSystem,
  });
  return { root, filePath, file, logLines };
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

    expect(thrownBy(() => held.file.read())).toBe(reading.readError);
    expect(reading.pauses).toEqual(Array.from({ length: 50 }, () => 10));

    const renaming = busyFileSystem({ reads: 0, renames: 1000 });
    const kept = await tokensFile(renaming.fileSystem);
    const before = await readFile(kept.filePath, "utf8");

    expect(thrownBy(() => kept.file.write({ tokens: { claude: "token-2" } }))).toBe(
      renaming.renameError,
    );
    // 第一次改名是存 .bak，就失败了：原文件没动，临时文件收走。
    expect(renaming.pauses).toEqual(Array.from({ length: 50 }, () => 10));
    expect(await readFile(kept.filePath, "utf8")).toBe(before);
    expect(await readdir(kept.root)).toEqual(["gateway-tokens.json"]);
  });

  test("elsewhere a failed read is not tried again", async () => {
    const { fileSystem, pauses, readError } = busyFileSystem({ reads: 1, renames: 0 });
    const { file } = await tokensFile({ ...fileSystem, platform: "darwin" });

    expect(thrownBy(() => file.read())).toBe(readError);
    expect(pauses).toEqual([]);
  });
});

describe("a bad data file whose last good copy cannot be put back", () => {
  test("is still served from the .bak, and the warning says it could not be put back", async () => {
    // 另存 .bad 与放回都要改名；held 超过 0.5 秒，两者都做不成。
    const renaming = busyFileSystem({ reads: 0, renames: 1000 });
    const { root, filePath, file, logLines } = await tokensFile(renaming.fileSystem);
    const good = JSON.stringify({ tokens: { claude: "token-1" } });
    await writeFile(`${filePath}.bak`, good);
    await writeFile(filePath, Buffer.alloc(16));

    const read = file.read();

    expect(read).toEqual({ tokens: { claude: "token-1" } });
    expect(await readFile(filePath)).toEqual(Buffer.alloc(16));
    expect((await readdir(root)).sort()).toEqual([
      "gateway-tokens.json",
      "gateway-tokens.json.bak",
    ]);
    expect(
      logLines.map(({ level, msg, filePath: logged, why, err }) => ({
        level,
        msg,
        filePath: logged,
        why,
        code: err?.code,
      })),
    ).toEqual([
      {
        level: 40,
        msg: "API endpoint data file could not be parsed; serving its last good copy, which could not be put back",
        filePath,
        why: "zero_bytes",
        code: "EPERM",
      },
    ]);
  });
});
