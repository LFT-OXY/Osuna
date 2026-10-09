// 重新生成 user-data/：一份 0.14.x 桌面端的 `Paseo` userData 样本，只留渲染层存储与两份主进程文档。
//
//   node packages/desktop/e2e/fixtures/legacy-paseo/generate.mjs
//
// 样本是合成的，不来自任何真机：用与 0.14.2 相同的 Electron 版本、相同的 scheme 登记方式
// （paseo，standard + secure + supportFetchAPI），在临时目录里向 paseo://app 写入 seed.mjs 的虚构数据。
// 仓库是公开的，真实 userData 里有主机列表、配对密钥、草稿正文和本机路径，不能拿来当样本。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronBinary from "electron";
import { LEGACY_DATABASES, LEGACY_LOCAL_STORAGE } from "./seed.mjs";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(fixtureDir, "user-data");

// 渲染层存储所在的两个目录；Cache、Partitions、Cookies 等与迁移无关的都不留。
const KEPT_DIRECTORIES = ["Local Storage", "IndexedDB"];
// leveldb 的运行期文件：LOCK 是进程锁，LOG 里有生成时的绝对路径，打开时都会重建。
const DROPPED_FILES = new Set(["LOCK", "LOG", "LOG.old"]);

const DESKTOP_SETTINGS = {
  version: 1,
  settings: {
    releaseChannel: "stable",
    notifications: { playSound: true },
    daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: false },
  },
  migrations: { legacyRendererSettingsImported: true, daemonStopOnQuitDefaultApplied: true },
};
const WINDOW_STATE = {
  version: 1,
  state: { x: 80, y: 60, width: 1280, height: 820, isMaximized: false },
};

// 在页面里执行：按 seed 的描述建库写数据，blobText 字段变成真正的 Blob。
async function writeSeed({ localStorageEntries, databases }) {
  for (const [key, value] of Object.entries(localStorageEntries)) localStorage.setItem(key, value);
  for (const database of databases) {
    const opened = await new Promise((resolve, reject) => {
      const request = indexedDB.open(database.name, database.version);
      request.addEventListener("upgradeneeded", () => {
        for (const store of database.stores) {
          request.result.createObjectStore(store.name, { keyPath: store.keyPath });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    const transaction = opened.transaction(
      database.stores.map((store) => store.name),
      "readwrite",
    );
    for (const store of database.stores) {
      for (const record of store.records) {
        const value = record.blobField
          ? {
              ...record.value,
              [record.blobField]: new Blob([record.blobText], { type: record.blobType }),
            }
          : record.value;
        if (store.keyPath === null) transaction.objectStore(store.name).put(value, record.key);
        else transaction.objectStore(store.name).put(value);
      }
    }
    await new Promise((resolve, reject) => {
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
    opened.close();
  }
  return localStorage.length;
}

function seedMainSource(userDataDir) {
  const seed = JSON.stringify({
    localStorageEntries: LEGACY_LOCAL_STORAGE,
    databases: LEGACY_DATABASES,
  });
  return `
const { app, BrowserWindow, protocol, session } = require("electron");
app.setPath("userData", ${JSON.stringify(userDataDir)});
protocol.registerSchemesAsPrivileged([
  { scheme: "paseo", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.whenReady().then(async () => {
  protocol.handle("paseo", () => new Response("<!doctype html><title>seed</title>", {
    headers: { "content-type": "text/html" },
  }));
  const window = new BrowserWindow({ show: false });
  await window.loadURL("paseo://app/");
  const written = await window.webContents.executeJavaScript(${JSON.stringify(
    `(${writeSeed.toString()})(${seed})`,
  )});
  await session.defaultSession.flushStorageData();
  window.destroy();
  process.stdout.write(String(written));
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error && error.stack || error));
  app.exit(1);
});
`;
}

async function copyKeptFiles(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (DROPPED_FILES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyKeptFiles(source, target);
    else await cp(source, target);
  }
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return total;
}

const root = await mkdtemp(path.join(tmpdir(), "osuna-legacy-fixture-"));
try {
  const home = path.join(root, "home");
  const userDataDir = path.join(root, "Paseo");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(root, "main.cjs"), seedMainSource(userDataDir));
  // userData 已在脚本里强制到临时目录；再把 home 整个指进去，Electron 的其余默认路径也落不到真机上。
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OSUNA_"))),
    HOME: home,
    USERPROFILE: home,
    CFFIXED_USER_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    OSUNA_HOME: path.join(root, "daemon"),
  };
  const seeded = spawnSync(electronBinary, ["--no-sandbox", path.join(root, "main.cjs")], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.equal(Number(seeded.stdout), Object.keys(LEGACY_LOCAL_STORAGE).length, seeded.stdout);

  await rm(outputDir, { recursive: true, force: true });
  for (const directory of KEPT_DIRECTORIES) {
    await copyKeptFiles(path.join(userDataDir, directory), path.join(outputDir, directory));
  }
  await writeFile(
    path.join(outputDir, "desktop-settings.json"),
    `${JSON.stringify(DESKTOP_SETTINGS, null, 2)}\n`,
  );
  await writeFile(
    path.join(outputDir, "window-state.json"),
    `${JSON.stringify(WINDOW_STATE, null, 2)}\n`,
  );
  console.log(`Wrote ${outputDir} (${await directorySize(outputDir)} bytes)`);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
