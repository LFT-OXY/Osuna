import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// 每个测试文件的第一条 import。没有显式选 home 时，CLI 不管连哪台 daemon 都会把 cli-client-id 写进默认 home，
// 默认 home 上还会触发 0.14.x 的数据搬迁。单独跑一个测试文件时没有 run-all.ts 替它换用户目录，
// 所以在这里换：之后启动的子进程继承临时目录，碰不到开发机上真实的 ~/.osuna 与旧数据目录。
const isolatedHome = mkdtempSync(join(tmpdir(), "osuna-cli-test-os-home-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

if (homedir() !== isolatedHome) {
  throw new Error(`Could not isolate the OS home for CLI tests (still ${homedir()}).`);
}

process.once("exit", () => rmSync(isolatedHome, { recursive: true, force: true }));
