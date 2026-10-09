// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronBinary from "electron";
import { expect } from "playwright/test";
import { LEGACY_DATABASES, LEGACY_LOCAL_STORAGE } from "./fixtures/legacy-paseo/seed.mjs";
import { mainLogPath, resolveIsolatedAppData } from "./user-data-migration.electron.mjs";

const FIXTURE_USER_DATA = fileURLToPath(
  new URL("./fixtures/legacy-paseo/user-data", import.meta.url),
);
const IMPORTED_LOG_LINE = "[renderer-origin-migration] imported legacy renderer storage";
const REACT_DEVTOOLS_EXTENSION_ID = "fmkadmapgofadopljbjfkapdkoienihi";
const SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true };

// 1.0.0 的渲染器读取的名字，逐个写死：这里不能复用迁移代码里的映射表。
const CURRENT_LOCAL_STORAGE = {
  "@osuna:daemon-registry": LEGACY_LOCAL_STORAGE["@paseo:daemon-registry"],
  "@osuna:client-id-v1": LEGACY_LOCAL_STORAGE["@paseo:client-id-v1"],
  "@osuna:app-settings": LEGACY_LOCAL_STORAGE["@paseo:app-settings"],
  "@osuna:settings-migrations": LEGACY_LOCAL_STORAGE["@paseo:settings-migrations"],
  "@osuna:create-agent-preferences": LEGACY_LOCAL_STORAGE["@paseo:create-agent-preferences"],
  "@osuna:changes-preferences": LEGACY_LOCAL_STORAGE["@paseo:changes-preferences"],
  "@osuna:changes-ship-default:/home/ada/code/example-app":
    LEGACY_LOCAL_STORAGE["@paseo:changes-ship-default:/home/ada/code/example-app"],
  "@osuna:keyboard-shortcut-overrides": LEGACY_LOCAL_STORAGE["@paseo:keyboard-shortcut-overrides"],
  "@osuna:preferred-editor": LEGACY_LOCAL_STORAGE["@paseo:preferred-editor"],
  "@osuna:sidebar-callout-dismissals": LEGACY_LOCAL_STORAGE["@paseo:sidebar-callout-dismissals"],
  "@osuna/provider-snapshot-index/v2": LEGACY_LOCAL_STORAGE["@paseo/provider-snapshot-index/v2"],
  '@osuna/provider-snapshot/v2:["srv_local_example","cwd","/home/ada/code/example-app"]':
    LEGACY_LOCAL_STORAGE[
      '@paseo/provider-snapshot/v2:["srv_local_example","cwd","/home/ada/code/example-app"]'
    ],
  "osuna:last-workspace-route-selection":
    LEGACY_LOCAL_STORAGE["paseo:last-workspace-route-selection"],
  "osuna-drafts": LEGACY_LOCAL_STORAGE["paseo-drafts"],
  "panel-state": LEGACY_LOCAL_STORAGE["panel-state"],
  "workspace-layout-state": LEGACY_LOCAL_STORAGE["workspace-layout-state"],
  "workspace-browser-store": LEGACY_LOCAL_STORAGE["workspace-browser-store"],
  "sidebar-view": LEGACY_LOCAL_STORAGE["sidebar-view"],
  "sidebar-collapsed-sections": LEGACY_LOCAL_STORAGE["sidebar-collapsed-sections"],
  "sidebar-project-workspace-order": LEGACY_LOCAL_STORAGE["sidebar-project-workspace-order"],
  "session-history-scope": LEGACY_LOCAL_STORAGE["session-history-scope"],
  "workspace-service-route-preferences":
    LEGACY_LOCAL_STORAGE["workspace-service-route-preferences"],
};
const CURRENT_DATABASE_NAMES = {
  "paseo-replica-row-store": "osuna-replica-row-store",
  "paseo-project-icon-cache": "osuna-project-icon-cache",
  "paseo-attachment-bytes": "osuna-attachment-bytes",
};

// seed.mjs 描述的库内容，换成 readOrigin 读回来的形状。
function expectedRecordValue(record) {
  if (!record.blobField) return record.value;
  const blob = { blobText: record.blobText, type: record.blobType };
  return { ...record.value, [record.blobField]: blob };
}

function expectedStore(store) {
  return { keyPath: store.keyPath, values: store.records.map(expectedRecordValue) };
}

function expectedDatabase(database) {
  const stores = database.stores.map((store) => [store.name, expectedStore(store)]);
  return { version: database.version, stores: Object.fromEntries(stores) };
}

function expectedDatabases(renameDatabase) {
  const databases = LEGACY_DATABASES.map((database) => [
    renameDatabase(database.name),
    expectedDatabase(database),
  ]);
  return Object.fromEntries(databases);
}

// 在页面里执行：把当前 origin 的全部渲染层存储读成可以 JSON 化的形状。
async function readOrigin() {
  function settled(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }
  async function readable(value) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        item instanceof Blob ? { blobText: await item.text(), type: item.type } : item,
      ]),
    );
    return Object.fromEntries(entries);
  }
  const databases = {};
  for (const { name } of await indexedDB.databases()) {
    const database = await settled(indexedDB.open(name));
    const stores = {};
    for (const storeName of database.objectStoreNames) {
      const store = database.transaction(storeName, "readonly").objectStore(storeName);
      const values = await settled(store.getAll());
      stores[storeName] = {
        keyPath: store.keyPath,
        values: await Promise.all(
          values.map((value) =>
            typeof value === "object" && value !== null ? readable(value) : value,
          ),
        ),
      };
    }
    databases[name] = { version: database.version, stores };
    database.close();
  }
  return { localStorage: { ...localStorage }, databases };
}

// 没有监听器时 Electron 在最后一个窗口关掉后直接退出，这两个脚本里的窗口都是隐藏的临时窗口。
const SCHEMES_SOURCE = `
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: "osuna", privileges: ${JSON.stringify(SCHEME_PRIVILEGES)} },
  { scheme: "paseo", privileges: ${JSON.stringify(SCHEME_PRIVILEGES)} },
]);`;

// 迁移之外的旁观者：单独起一个 Electron，用同一份 userData 把两个 origin 各读一遍。
function readOriginsMainSource(userDataDir) {
  return `
const { app, BrowserWindow, protocol } = require("electron");
app.setPath("userData", ${JSON.stringify(userDataDir)});
${SCHEMES_SOURCE}
app.whenReady().then(async () => {
  const blank = () => new Response("<!doctype html><title>observer</title>", {
    headers: { "content-type": "text/html" },
  });
  protocol.handle("osuna", blank);
  protocol.handle("paseo", blank);
  const origins = {};
  for (const scheme of ["osuna", "paseo"]) {
    const window = new BrowserWindow({ show: false });
    await window.loadURL(scheme + "://app/");
    origins[scheme] = await window.webContents.executeJavaScript(${JSON.stringify(
      `(${readOrigin.toString()})()`,
    )});
    window.destroy();
  }
  process.stdout.write(JSON.stringify(origins));
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error && error.stack || error));
  app.exit(1);
});`;
}

// 与 main.ts 相同的接线，但导出页地址、导入脚本和失败后的选择可以换掉。
function faultMainSource({ repo, userDataDir }) {
  const dist = path.join(repo, "packages/desktop/dist/settings");
  return `
const { app, protocol } = require("electron");
app.setPath("userData", ${JSON.stringify(userDataDir)});
${SCHEMES_SOURCE}
app.whenReady().then(async () => {
  const { createDesktopSettingsStore } = require(${JSON.stringify(path.join(dist, "desktop-settings.js"))});
  const { migrateLegacyRendererOrigin } = require(${JSON.stringify(path.join(dist, "renderer-origin-migration/index.js"))});
  const { createElectronRendererOriginPorts, RENDERER_ORIGIN_PAGES } = require(${JSON.stringify(path.join(dist, "renderer-origin-migration/electron.js"))});
  const fault = JSON.parse(process.env.OSUNA_E2E_ORIGIN_MIGRATION_FAULT);
  const ports = createElectronRendererOriginPorts({
    marker: createDesktopSettingsStore({ userDataPath: app.getPath("userData") }),
    pages: { ...RENDERER_ORIGIN_PAGES, ...fault.pages },
  });
  const outcome = await migrateLegacyRendererOrigin({
    ...ports,
    askAfterFailure: async () => fault.choice,
  });
  process.stdout.write(JSON.stringify({ kind: outcome.kind, error: String(outcome.error) }));
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error && error.stack || error));
  app.exit(1);
});`;
}

function runElectron({ root, env, script, extraEnv = {} }) {
  const run = spawnSync(electronBinary, ["--no-sandbox", path.join(root, script)], {
    cwd: root,
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

async function readMarker(userDataDir) {
  const document = JSON.parse(
    await readFile(path.join(userDataDir, "desktop-settings.json"), "utf8"),
  );
  return document.migrations.legacyRendererOriginImported === true;
}

async function copyFixture(userDataDir) {
  await cp(FIXTURE_USER_DATA, userDataDir, { recursive: true });
  // 未打包的主进程会在首个窗口前下载 React DevTools；放一个空壳让它跳过下载，加载失败只是一条警告。
  const extensionDir = path.join(userDataDir, "extensions", REACT_DEVTOOLS_EXTENSION_ID);
  await mkdir(extensionDir, { recursive: true });
  await writeFile(path.join(extensionDir, "manifest.json"), "{}");
}

// 真实主进程走完迁移后还要活到正常退出，localStorage 才会落盘：给首个窗口一张空白页，再用 SIGTERM 让它自己退出。
async function launchMainUntilFirstWindowLoads({ repo, root, env, logPath }) {
  let firstWindowRequested = false;
  const devServer = createServer((_request, response) => {
    firstWindowRequested = true;
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>blank renderer</title>");
  });
  await new Promise((resolve) => devServer.listen(0, "127.0.0.1", resolve));
  const desktop = spawn(
    electronBinary,
    [path.join(repo, "packages/desktop/dist/main.js"), "--no-sandbox"],
    {
      cwd: root,
      env: { ...env, EXPO_DEV_URL: `http://127.0.0.1:${devServer.address().port}` },
      stdio: "ignore",
    },
  );
  const exited = once(desktop, "exit");
  try {
    await expect
      .poll(() => readFile(logPath, "utf8").catch(() => ""), { timeout: 60_000 })
      .toContain(IMPORTED_LOG_LINE);
    // 首个窗口来取页面，说明迁移之后主进程照常接管了 osuna scheme 并走到了开窗。
    await expect.poll(() => firstWindowRequested, { timeout: 60_000 }).toBe(true);
    assert.equal(desktop.exitCode, null);
    desktop.kill("SIGTERM");
    await expect
      .poll(() => desktop.exitCode ?? desktop.signalCode, { timeout: 30_000 })
      .not.toBeNull();
    return await readFile(logPath, "utf8");
  } finally {
    desktop.kill("SIGKILL");
    await exited;
    devServer.close();
  }
}

// 0.14.x 的渲染层存储在首个窗口打开前从 paseo://app 抄到 osuna://app，旧 origin 原样保留。
export async function verifyLegacyRendererOriginMigration({ repo, env: baseEnv }) {
  const root = await mkdtemp(path.join(tmpdir(), "osuna renderer origin migration "));
  const home = path.join(root, "home");
  const env = {
    ...baseEnv,
    HOME: home,
    USERPROFILE: home,
    CFFIXED_USER_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    OSUNA_HOME: path.join(root, "daemon"),
    OSUNA_DISABLE_SINGLE_INSTANCE_LOCK: "1",
  };
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(root, "probe.cjs"),
    'const { app } = require("electron"); process.stdout.write(app.getPath("appData")); app.exit(0);',
  );

  try {
    const appData = resolveIsolatedAppData({ root, home, env });
    const userDataDir = path.join(appData, "Osuna");
    await copyFixture(path.join(appData, "Paseo"));

    const mainLog = await launchMainUntilFirstWindowLoads({
      repo,
      root,
      env,
      logPath: mainLogPath({ home, appData }),
    });

    assert.equal(mainLog.split(IMPORTED_LOG_LINE).length - 1, 1, mainLog);
    assert.equal(await readMarker(userDataDir), true);
    await writeFile(path.join(root, "read-origins.cjs"), readOriginsMainSource(userDataDir));
    const migrated = runElectron({ root, env, script: "read-origins.cjs" });
    assert.deepEqual(migrated.osuna, {
      localStorage: CURRENT_LOCAL_STORAGE,
      databases: expectedDatabases((name) => CURRENT_DATABASE_NAMES[name]),
    });
    assert.deepEqual(migrated.paseo, {
      localStorage: LEGACY_LOCAL_STORAGE,
      databases: expectedDatabases((name) => name),
    });
    console.log(
      "PASS: hosts, drafts, panel layout and IndexedDB reach osuna://app on first launch; paseo://app keeps its data.",
    );

    const faultUserData = path.join(root, "fault-user-data");
    await copyFixture(faultUserData);
    await writeFile(
      path.join(root, "fault.cjs"),
      faultMainSource({ repo, userDataDir: faultUserData }),
    );
    await writeFile(
      path.join(root, "read-fault-origins.cjs"),
      readOriginsMainSource(faultUserData),
    );
    const runWithFault = (fault) =>
      runElectron({
        root,
        env,
        script: "fault.cjs",
        extraEnv: { OSUNA_E2E_ORIGIN_MIGRATION_FAULT: JSON.stringify(fault) },
      });

    const missingExportPage = runWithFault({
      pages: { exportUrl: "paseo://app/__not-the-export-page" },
      choice: "retry",
    });
    assert.equal(missingExportPage.kind, "retry-on-next-launch", missingExportPage.error);
    assert.equal(await readMarker(faultUserData), false);

    const throwingImport = runWithFault({
      pages: {
        importScript:
          'osunaOriginMigration.pull().then(() => { localStorage.setItem("half-written", "1"); throw new Error("injected import failure"); })',
      },
      choice: "retry",
    });
    assert.deepEqual(throwingImport, {
      kind: "retry-on-next-launch",
      error: "Error: injected import failure",
    });
    assert.equal(await readMarker(faultUserData), false);

    assert.equal(runWithFault({ pages: {}, choice: "retry" }).kind, "imported");
    assert.equal(await readMarker(faultUserData), true);
    const recovered = runElectron({ root, env, script: "read-fault-origins.cjs" });
    assert.deepEqual(recovered.osuna.localStorage, CURRENT_LOCAL_STORAGE);
    assert.deepEqual(recovered.paseo.localStorage, LEGACY_LOCAL_STORAGE);
    console.log(
      "PASS: a missing export page and a throwing import leave the marker unset; the next launch imports cleanly.",
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
