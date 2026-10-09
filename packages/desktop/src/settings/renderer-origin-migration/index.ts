// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import type { DesktopSettingsStore } from "../desktop-settings.js";
import { isEmptySnapshot, type OriginStorageSnapshot } from "./snapshot.js";
import { renameLegacySnapshot } from "./storage-names.js";

// 0.14.x 的渲染器从 paseo://app 加载，1.0.0 从 osuna://app 加载。Chromium 按 origin 隔离存储，
// 没有别名机制，所以主机列表、设置、草稿、面板布局要在首个窗口打开前从旧 origin 抄到新 origin。
// 旧 origin 的数据永不删除。

export type RendererOriginImportChoice = "retry" | "abandon";

export interface RendererOriginMigrationPorts {
  marker: Pick<
    DesktopSettingsStore,
    "hasImportedLegacyRendererOrigin" | "markLegacyRendererOriginImported"
  >;
  exportLegacyOrigin(): Promise<OriginStorageSnapshot>;
  // 整体替换：先清空新 origin 再写入，所以上次写到一半的残留不会留下来。
  replaceAppOrigin(snapshot: OriginStorageSnapshot): Promise<void>;
  askAfterFailure(error: unknown): Promise<RendererOriginImportChoice>;
}

export interface RendererOriginImported {
  kind: "imported";
  localStorageKeys: number;
  databases: number;
  records: number;
  skippedRecords: OriginStorageSnapshot["skippedRecords"];
}

export type RendererOriginMigrationOutcome =
  | { kind: "already-imported" }
  | { kind: "nothing-to-import" }
  | RendererOriginImported
  // 用户选了「放弃旧数据继续」：标记已写，之后不再清空新 origin。
  | { kind: "abandoned"; error: unknown }
  // 用户选了「重试」：标记没写，调用方退出，下次启动再跑。
  | { kind: "retry-on-next-launch"; error: unknown };

function countRecords(snapshot: OriginStorageSnapshot): number {
  const stores = snapshot.databases.flatMap((database) => database.stores);
  return stores.reduce((total, store) => total + store.records.length, 0);
}

async function importLegacyOrigin(
  ports: RendererOriginMigrationPorts,
): Promise<RendererOriginMigrationOutcome> {
  const legacy = await ports.exportLegacyOrigin();
  // 旧 origin 是空的（全新安装）就不碰新 origin：那里可能已经有这一版写下的数据。
  if (isEmptySnapshot(legacy)) {
    await ports.marker.markLegacyRendererOriginImported();
    return { kind: "nothing-to-import" };
  }
  await ports.replaceAppOrigin(renameLegacySnapshot(legacy));
  await ports.marker.markLegacyRendererOriginImported();
  return {
    kind: "imported",
    localStorageKeys: legacy.localStorage.length,
    databases: legacy.databases.length,
    records: countRecords(legacy),
    skippedRecords: legacy.skippedRecords,
  };
}

// 不设失败计数也不设重试上限：标记没写就每次启动都再跑，直到成功或用户放弃。
export async function migrateLegacyRendererOrigin(
  ports: RendererOriginMigrationPorts,
): Promise<RendererOriginMigrationOutcome> {
  if (await ports.marker.hasImportedLegacyRendererOrigin()) return { kind: "already-imported" };
  try {
    return await importLegacyOrigin(ports);
  } catch (error) {
    // 导出页打不开、脚本抛错、超时、标记写不进去都走这里：没有手工修复路径，只能让用户选。
    if ((await ports.askAfterFailure(error)) === "retry") {
      return { kind: "retry-on-next-launch", error };
    }
    await ports.marker.markLegacyRendererOriginImported();
    return { kind: "abandoned", error };
  }
}

export interface RendererOriginImportFailureOption {
  choice: RendererOriginImportChoice;
  label: string;
}

export interface RendererOriginImportFailureDialog {
  title: string;
  message: string;
  detail: string;
  // 顺序即对话框里按钮的顺序。
  options: RendererOriginImportFailureOption[];
}

export function describeRendererOriginImportFailure(
  error: unknown,
): RendererOriginImportFailureDialog {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    title: "Osuna 无法导入旧版数据",
    message: "旧版 Paseo 的主机列表、设置、草稿和面板布局没能导入 Osuna。",
    detail: [
      "旧数据没有丢失，仍保存在原处。",
      "",
      "重试：退出 Osuna，下次启动时再导入一次。",
      "放弃旧数据继续：不再导入，直接启动 Osuna。主机需要重新添加，设置、草稿和面板布局回到默认状态。",
      "",
      `原因：${cause}`,
    ].join("\n"),
    options: [
      { choice: "retry", label: "重试" },
      { choice: "abandon", label: "放弃旧数据继续" },
    ],
  };
}
