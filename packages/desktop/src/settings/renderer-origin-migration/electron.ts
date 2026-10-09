// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, protocol, session } from "electron";
import log from "electron-log/main";

import {
  describeRendererOriginImportFailure,
  migrateLegacyRendererOrigin,
  type RendererOriginMigrationOutcome,
  type RendererOriginMigrationPorts,
} from "./index.js";
import { EXPORT_PAGE_SCRIPT, IMPORT_PAGE_SCRIPT } from "./page-scripts.js";
import type { OriginStorageSnapshot } from "./snapshot.js";

const LEGACY_SCHEME = "paseo";
const APP_SCHEME = "osuna";
const APP_ORIGIN = `${APP_SCHEME}://app`;
const PULL_CHANNEL = "osuna:renderer-origin-migration:pull";
const NO_CANCEL_BUTTON = -1;
const EXPORT_TIMEOUT_MS = 30_000;
const IMPORT_TIMEOUT_MS = 60_000;

// 与 0.14.x 登记 app scheme 时的权限一致：少了 standard，旧 origin 的存储就读不到。
// registerSchemesAsPrivileged 只能在 ready 前调用一次，所以由 main.ts 和 osuna 一起登记。
export const LEGACY_APP_SCHEME: Electron.CustomScheme = {
  scheme: LEGACY_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
};

export interface RendererOriginPages {
  exportUrl: string;
  exportScript: string;
  importUrl: string;
  importScript: string;
}

export const RENDERER_ORIGIN_PAGES: RendererOriginPages = {
  exportUrl: `${LEGACY_SCHEME}://app/__migrate-export`,
  exportScript: EXPORT_PAGE_SCRIPT,
  importUrl: `${APP_ORIGIN}/__migrate-import`,
  importScript: IMPORT_PAGE_SCRIPT,
};

interface HiddenPageRun {
  url: string;
  script: string;
  preloadPath: string | null;
  timeoutMs: number;
}

// 迁移期间这个 scheme 只认一张内联空白页，其余一律 404：旧 scheme 不再提供应用本体。
function serveOnly(pageUrl: string): (request: Request) => Response {
  return (request) => {
    if (request.url !== pageUrl) return new Response(null, { status: 404 });
    return new Response("<!doctype html><title>Osuna</title>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}

async function loadAndRun<Result>(window: BrowserWindow, run: HiddenPageRun): Promise<Result> {
  let status = 0;
  window.webContents.once("did-navigate", (_event, _url, httpResponseCode) => {
    status = httpResponseCode;
  });
  await window.loadURL(run.url);
  // 404 的页面仍然属于这个 origin，脚本照样跑得起来；页面没按预期提供出来就不该继续。
  if (status !== 200) throw new Error(`${run.url} answered ${status}`);
  return window.webContents.executeJavaScript(run.script);
}

// 必须是顶层窗口：放进 iframe 会被第三方存储分区隔开，看到的是空存储。
async function runInHiddenPage<Result>(run: HiddenPageRun): Promise<Result> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 隐藏窗口默认会被节流，十几 MB 的读写不能慢下来。
      backgroundThrottling: false,
      ...(run.preloadPath ? { preload: run.preloadPath } : {}),
    },
  });
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${run.url} did not finish within ${run.timeoutMs / 1000}s`)),
      run.timeoutMs,
    );
  });
  const finished = loadAndRun<Result>(window, run);
  try {
    return await Promise.race([finished, timedOut]);
  } finally {
    clearTimeout(timer);
    // 超时后窗口被销毁，还没跑完的脚本会跟着失败，那个失败已经没人关心。
    finished.catch(() => undefined);
    window.destroy();
  }
}

export function createElectronRendererOriginPorts(input: {
  marker: RendererOriginMigrationPorts["marker"];
  pages: RendererOriginPages;
}): RendererOriginMigrationPorts {
  const { marker, pages } = input;
  return {
    marker,

    async exportLegacyOrigin() {
      protocol.handle(LEGACY_SCHEME, serveOnly(RENDERER_ORIGIN_PAGES.exportUrl));
      try {
        return await runInHiddenPage<OriginStorageSnapshot>({
          url: pages.exportUrl,
          script: pages.exportScript,
          preloadPath: null,
          timeoutMs: EXPORT_TIMEOUT_MS,
        });
      } finally {
        protocol.unhandle(LEGACY_SCHEME);
      }
    },

    async replaceAppOrigin(snapshot) {
      await session.defaultSession.clearStorageData({
        origin: APP_ORIGIN,
        storages: ["localstorage", "indexdb"],
      });
      // main.ts 要等迁移结束才接管 osuna scheme，这段时间导入页由这里临时提供。
      protocol.handle(APP_SCHEME, serveOnly(RENDERER_ORIGIN_PAGES.importUrl));
      // 十几 MB 的数据由页面主动来拉，不拼进脚本文本。此刻导入窗口是唯一存在的 webContents。
      ipcMain.handle(PULL_CHANNEL, () => snapshot);
      try {
        await runInHiddenPage<void>({
          url: pages.importUrl,
          script: pages.importScript,
          preloadPath: path.join(__dirname, "preload.js"),
          timeoutMs: IMPORT_TIMEOUT_MS,
        });
        // localStorage 默认延迟几秒才落盘；完成标记写下之前先催它写。
        session.defaultSession.flushStorageData();
      } finally {
        ipcMain.removeHandler(PULL_CHANNEL);
        protocol.unhandle(APP_SCHEME);
      }
    },

    async askAfterFailure(error) {
      // 原因先落日志：对话框只告诉用户去哪里看，用户选完之前进程可能就被杀掉了。
      log.error("[renderer-origin-migration] import failed", error);
      const { title, message, detail, options, defaultChoice } =
        describeRendererOriginImportFailure({ logPath: log.transports.file.getFile().path });
      const retryIndex = options.findIndex((option) => option.choice === defaultChoice);
      const { response } = await dialog.showMessageBox({
        type: "error",
        title,
        message,
        detail,
        buttons: options.map((option) => option.label),
        defaultId: retryIndex,
        // 两个按钮都不当取消键。把「重试」设成取消键的话 macOS 会把它排到最后并去掉默认高亮；
        // 不设的话 Electron 自己会挑「放弃旧数据继续」当取消键，Esc 就成了放弃数据。
        cancelId: NO_CANCEL_BUTTON,
        noLink: true,
      });
      // 没点任何按钮就关掉对话框（Windows / Linux 的关闭按钮）等同「重试」：不替用户做放弃数据的决定。
      const pickedAButton = response >= 0 && response < options.length;
      if (!pickedAButton) return defaultChoice;
      return options[response].choice;
    },
  };
}

// 成功静默：只留一条 info。失败的原因在弹对话框之前已经记下，这里只记用户选了什么。
export async function runLegacyRendererOriginMigration(
  marker: RendererOriginMigrationPorts["marker"],
): Promise<RendererOriginMigrationOutcome> {
  const outcome = await migrateLegacyRendererOrigin(
    createElectronRendererOriginPorts({ marker, pages: RENDERER_ORIGIN_PAGES }),
  );
  if (outcome.kind === "imported") {
    const { localStorageKeys, databases, records, skippedRecords } = outcome;
    log.info("[renderer-origin-migration] imported legacy renderer storage", {
      localStorageKeys,
      databases,
      records,
    });
    if (skippedRecords.length > 0) {
      log.warn("[renderer-origin-migration] skipped records that cannot cross IPC", skippedRecords);
    }
  } else if (outcome.kind === "abandoned") {
    log.warn("[renderer-origin-migration] user abandoned the legacy renderer storage");
  } else if (outcome.kind === "retry-on-next-launch") {
    log.info("[renderer-origin-migration] user chose to retry the import on the next launch");
  }
  return outcome;
}
