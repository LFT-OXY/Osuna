import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const devDaemonScript = join(import.meta.dirname, "dev-daemon.sh");
const skip = process.platform === "win32" ? "bash script" : false;

// 脚本最后会 exec npm 去构建并启动 daemon。换成一个只报出模型目录的假 npm，
// 测的就是脚本自己在启动之前对用户目录做了什么。
function runDevDaemonScript(prepareHome = () => {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "osuna-dev-daemon-")));
  const home = join(root, "home");
  const checkout = join(root, "checkout");
  const bin = join(root, "bin");
  for (const directory of [home, checkout, bin]) mkdirSync(directory);
  writeFileSync(
    join(bin, "npm"),
    '#!/bin/sh\necho "models-dir=${OSUNA_LOCAL_MODELS_DIR:-unset} home=${OSUNA_HOME}"\n',
  );
  chmodSync(join(bin, "npm"), 0o755);
  prepareHome(home);
  try {
    const output = execFileSync("bash", [devDaemonScript], {
      cwd: checkout,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home },
      encoding: "utf8",
    });
    return { output, home, checkout, entriesInHome: readdirSync(home) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the dev daemon script creates nothing in the user's home", { skip }, () => {
  const { output, checkout, entriesInHome } = runDevDaemonScript();

  assert.deepEqual(entriesInHome, []);
  assert.ok(output.includes(`models-dir=unset home=${join(checkout, ".dev/osuna-home")}`), output);
});

test("the dev daemon script shares speech models an install already has", { skip }, () => {
  const { output, home } = runDevDaemonScript((userHome) => {
    mkdirSync(join(userHome, ".osuna/models/local-speech"), { recursive: true });
  });

  assert.ok(output.includes(`models-dir=${join(home, ".osuna/models/local-speech")} `), output);
});
