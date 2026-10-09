import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// 进程内跑 CLI 的测试会解析默认 home：写 cli-client-id，并触发 0.14.x 的数据搬迁。
// 用户目录换成临时目录后，这些测试碰不到开发机上真实的 ~/.osuna 与旧数据目录。
const isolatedHome = mkdtempSync(path.join(os.tmpdir(), "osuna-vitest-os-home-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

// worker 线程里的 process.env 只是副本，改了也到不了 os.homedir()；那种池子下宁可不跑。
if (os.homedir() !== isolatedHome) {
  throw new Error(
    `Could not isolate the OS home for tests (os.homedir() is still ${os.homedir()}). Run vitest with the forks pool.`,
  );
}

afterAll(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
});
