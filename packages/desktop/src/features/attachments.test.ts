import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyAttachmentFileToManagedStorage, writeAttachmentBase64 } from "./attachments";

const originalOsunaHome = process.env.OSUNA_HOME;
const originalUserHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let testHome: string | null = null;

async function useTempOsunaHome(): Promise<string> {
  testHome = await mkdtemp(path.join(os.tmpdir(), "osuna-desktop-attachments-"));
  process.env.OSUNA_HOME = testHome;
  return testHome;
}

describe("desktop attachment files", () => {
  afterEach(async () => {
    if (originalOsunaHome === undefined) {
      delete process.env.OSUNA_HOME;
    } else {
      process.env.OSUNA_HOME = originalOsunaHome;
    }

    for (const [key, value] of Object.entries(originalUserHome)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    if (testHome) {
      await rm(testHome, { recursive: true, force: true });
      testHome = null;
    }
  });

  it("accepts dot-prefixed picker extensions for managed copies", async () => {
    const osunaHome = await useTempOsunaHome();
    const sourcePath = path.join(osunaHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown",
      sourcePath,
      extension: ".md",
    });

    expect(result).toEqual({
      path: path.join(osunaHome, "desktop-attachments", "att_markdown.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  it("normalizes legacy bare extensions for managed copies", async () => {
    const osunaHome = await useTempOsunaHome();
    const sourcePath = path.join(osunaHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown_legacy",
      sourcePath,
      extension: "md",
    });

    expect(result).toEqual({
      path: path.join(osunaHome, "desktop-attachments", "att_markdown_legacy.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  // COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
  // 内置 daemon 还没启动过（或被关掉管理）时，附件是桌面端第一个往默认 home 写东西的入口。
  it.skipIf(process.platform === "win32")(
    "moves a 0.14.x data directory before the first attachment lands in the default home",
    async () => {
      testHome = await realpath(
        await mkdtemp(path.join(os.tmpdir(), "osuna-desktop-attachments-")),
      );
      process.env.HOME = testHome;
      process.env.USERPROFILE = testHome;
      delete process.env.OSUNA_HOME;
      // 这次走的是真实的默认 home：用户目录没换成临时目录就不往下走。
      expect(os.homedir()).toBe(testHome);
      const legacyHome = path.join(testHome, ".paseo");
      await mkdir(legacyHome);
      await writeFile(path.join(legacyHome, "config.json"), '{"version":1}\n');
      const result = await writeAttachmentBase64({
        attachmentId: "att_first",
        base64: Buffer.from("first").toString("base64"),
        extension: ".txt",
      });
      expect(result).toEqual({
        path: path.join(testHome, ".osuna", "desktop-attachments", "att_first.txt"),
        byteSize: 5,
      });
      expect((await lstat(legacyHome)).isSymbolicLink()).toBe(true);
      await expect(readFile(path.join(testHome, ".osuna", "config.json"), "utf8")).resolves.toBe(
        '{"version":1}\n',
      );
    },
  );
});
