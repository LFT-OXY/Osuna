// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import { describe, expect, it } from "vitest";

import {
  describeRendererOriginImportFailure,
  migrateLegacyRendererOrigin,
  type RendererOriginImportChoice,
  type RendererOriginMigrationPorts,
} from "./index";
import type { OriginStorageSnapshot } from "./snapshot";

const EMPTY_ORIGIN: OriginStorageSnapshot = { localStorage: [], databases: [], skippedRecords: [] };

const LEGACY_ORIGIN: OriginStorageSnapshot = {
  localStorage: [
    ["@paseo:daemon-registry", '[{"serverId":"srv_example"}]'],
    ["paseo-drafts", '{"state":{"drafts":{}},"version":2}'],
    ["panel-state", '{"state":{},"version":16}'],
  ],
  databases: [
    {
      name: "paseo-attachment-bytes",
      version: 1,
      stores: [
        {
          name: "attachments",
          keyPath: "id",
          autoIncrement: false,
          indexes: [],
          records: [
            { key: "att-1", value: { id: "att-1" } },
            { key: "att-2", value: { id: "att-2" } },
          ],
        },
      ],
    },
  ],
  skippedRecords: [],
};

interface FakeDesktop {
  ports: RendererOriginMigrationPorts;
  // 新 origin 里现有的内容；null 表示从没被清空或写入过。
  appOrigin(): OriginStorageSnapshot | null;
  isMarkedImported(): boolean;
  exportCount(): number;
  askedAbout(): unknown[];
}

function createFakeDesktop(input: {
  legacyOrigin?: OriginStorageSnapshot;
  alreadyImported?: boolean;
  exportError?: Error;
  importError?: Error;
  choice?: RendererOriginImportChoice;
}): FakeDesktop {
  let imported = input.alreadyImported ?? false;
  let appOrigin: OriginStorageSnapshot | null = null;
  let exportCount = 0;
  const askedAbout: unknown[] = [];

  return {
    ports: {
      marker: {
        hasImportedLegacyRendererOrigin: async () => imported,
        markLegacyRendererOriginImported: async () => {
          imported = true;
        },
      },
      exportLegacyOrigin: async () => {
        exportCount += 1;
        if (input.exportError) throw input.exportError;
        return input.legacyOrigin ?? EMPTY_ORIGIN;
      },
      replaceAppOrigin: async (snapshot) => {
        // 先清空再写：写到一半失败时新 origin 里留下的是半份数据。
        appOrigin = EMPTY_ORIGIN;
        if (input.importError) throw input.importError;
        appOrigin = snapshot;
      },
      askAfterFailure: async (error) => {
        askedAbout.push(error);
        return input.choice ?? "retry";
      },
    },
    appOrigin: () => appOrigin,
    isMarkedImported: () => imported,
    exportCount: () => exportCount,
    askedAbout: () => askedAbout,
  };
}

describe("migrateLegacyRendererOrigin", () => {
  it("writes the legacy origin into the app origin under the new names and marks it done", async () => {
    const desktop = createFakeDesktop({ legacyOrigin: LEGACY_ORIGIN });

    const outcome = await migrateLegacyRendererOrigin(desktop.ports);

    expect(outcome).toEqual({
      kind: "imported",
      localStorageKeys: 3,
      databases: 1,
      records: 2,
      skippedRecords: [],
    });
    expect(desktop.appOrigin()).toEqual({
      localStorage: [
        ["@osuna:daemon-registry", '[{"serverId":"srv_example"}]'],
        ["osuna-drafts", '{"state":{"drafts":{}},"version":2}'],
        ["panel-state", '{"state":{},"version":16}'],
      ],
      databases: [{ ...LEGACY_ORIGIN.databases[0], name: "osuna-attachment-bytes" }],
      skippedRecords: [],
    });
    expect(desktop.isMarkedImported()).toBe(true);
    expect(desktop.askedAbout()).toEqual([]);
  });

  it("does not open the legacy origin again once the import is marked done", async () => {
    const desktop = createFakeDesktop({ legacyOrigin: LEGACY_ORIGIN, alreadyImported: true });

    const outcome = await migrateLegacyRendererOrigin(desktop.ports);

    expect(outcome).toEqual({ kind: "already-imported" });
    expect(desktop.exportCount()).toBe(0);
    expect(desktop.appOrigin()).toBeNull();
  });

  it("marks a fresh install done without clearing the app origin", async () => {
    const desktop = createFakeDesktop({ legacyOrigin: EMPTY_ORIGIN });

    const outcome = await migrateLegacyRendererOrigin(desktop.ports);

    expect(outcome).toEqual({ kind: "nothing-to-import" });
    expect(desktop.appOrigin()).toBeNull();
    expect(desktop.isMarkedImported()).toBe(true);
  });

  it("leaves the import unmarked when the export fails and the user retries", async () => {
    const exportError = new Error("ERR_FAILED (-2) loading 'paseo://app/__migrate-export'");
    const desktop = createFakeDesktop({ legacyOrigin: LEGACY_ORIGIN, exportError });

    const outcome = await migrateLegacyRendererOrigin(desktop.ports);

    expect(outcome).toEqual({ kind: "retry-on-next-launch", error: exportError });
    expect(desktop.askedAbout()).toEqual([exportError]);
    expect(desktop.isMarkedImported()).toBe(false);
    expect(desktop.appOrigin()).toBeNull();
  });

  it("leaves the import unmarked when writing the app origin fails and the user retries", async () => {
    const importError = new Error("QuotaExceededError");
    const desktop = createFakeDesktop({ legacyOrigin: LEGACY_ORIGIN, importError });

    const outcome = await migrateLegacyRendererOrigin(desktop.ports);

    expect(outcome).toEqual({ kind: "retry-on-next-launch", error: importError });
    expect(desktop.askedAbout()).toEqual([importError]);
    expect(desktop.isMarkedImported()).toBe(false);
  });

  it("marks the import done when the user abandons the old data, and never clears the app origin again", async () => {
    const importError = new Error("QuotaExceededError");
    const desktop = createFakeDesktop({
      legacyOrigin: LEGACY_ORIGIN,
      importError,
      choice: "abandon",
    });

    const abandoned = await migrateLegacyRendererOrigin(desktop.ports);
    const nextLaunch = await migrateLegacyRendererOrigin(desktop.ports);

    expect(abandoned).toEqual({ kind: "abandoned", error: importError });
    expect(nextLaunch).toEqual({ kind: "already-imported" });
    expect(desktop.isMarkedImported()).toBe(true);
    expect(desktop.exportCount()).toBe(1);
  });
});

describe("describeRendererOriginImportFailure", () => {
  it("offers retry and abandon in Chinese and says the old data is still there", () => {
    expect(
      describeRendererOriginImportFailure(new Error("Exporting paseo://app timed out after 30s")),
    ).toEqual({
      title: "Osuna 无法导入旧版数据",
      message: "旧版 Paseo 的主机列表、设置、草稿和面板布局没能导入 Osuna。",
      detail: [
        "旧数据没有丢失，仍保存在原处。",
        "",
        "重试：退出 Osuna，下次启动时再导入一次。",
        "放弃旧数据继续：不再导入，直接启动 Osuna。主机需要重新添加，设置、草稿和面板布局回到默认状态。",
        "",
        "原因：Exporting paseo://app timed out after 30s",
      ].join("\n"),
      options: [
        { choice: "retry", label: "重试" },
        { choice: "abandon", label: "放弃旧数据继续" },
      ],
    });
  });
});
