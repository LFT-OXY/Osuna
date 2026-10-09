// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { mapLegacyDatabaseName, mapLegacyStorageKey, renameLegacySnapshot } from "./storage-names";

const appSourceDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../app/src");

function rendererSource(file: string): string {
  return readFileSync(join(appSourceDir, file), "utf8");
}

// 每行：0.14.x 写入的名字、1.0.0 渲染器读取的名字、定义该名字的渲染器文件。
// 新名字必须原样出现在渲染器源码里，渲染器再改名时这里会失败。
const STORAGE_KEYS: Array<[legacy: string, current: string, rendererFile: string]> = [
  ["@paseo:daemon-registry", "@osuna:daemon-registry", "runtime/host-runtime.ts"],
  ["@paseo:client-id-v1", "@osuna:client-id-v1", "utils/client-id.ts"],
  ["@paseo:app-settings", "@osuna:app-settings", "hooks/use-settings/keys.ts"],
  ["@paseo:settings", "@osuna:settings", "hooks/use-settings/keys.ts"],
  ["@paseo:settings-migrations", "@osuna:settings-migrations", "hooks/use-settings/keys.ts"],
  [
    "@paseo:create-agent-preferences",
    "@osuna:create-agent-preferences",
    "create-agent-preferences/storage.ts",
  ],
  [
    "@paseo:changes-preferences",
    "@osuna:changes-preferences",
    "hooks/use-changes-preferences/storage.ts",
  ],
  ["diff-wrap-lines", "diff-wrap-lines", "hooks/use-changes-preferences/storage.ts"],
  [
    "@paseo:keyboard-shortcut-overrides",
    "@osuna:keyboard-shortcut-overrides",
    "hooks/use-keyboard-shortcut-overrides.ts",
  ],
  ["@paseo:preferred-editor", "@osuna:preferred-editor", "hooks/use-preferred-editor.ts"],
  [
    "@paseo:sidebar-callout-dismissals",
    "@osuna:sidebar-callout-dismissals",
    "contexts/sidebar-callout-context.tsx",
  ],
  [
    "@paseo/provider-snapshot-index/v2",
    "@osuna/provider-snapshot-index/v2",
    "data/provider-snapshot-cache.ts",
  ],
  [
    "paseo:last-workspace-route-selection",
    "osuna:last-workspace-route-selection",
    "stores/last-workspace-selection.ts",
  ],
  ["paseo-drafts", "osuna-drafts", "stores/draft-store/index.ts"],
  ["panel-state", "panel-state", "stores/panel-store/index.ts"],
  ["workspace-layout-state", "workspace-layout-state", "stores/workspace-layout-store.ts"],
  ["workspace-browser-store", "workspace-browser-store", "desktop/browser/store/index.ts"],
  ["sidebar-view", "sidebar-view", "stores/sidebar-view-store.ts"],
  ["sidebar-group-mode", "sidebar-group-mode", "stores/sidebar-view-store.ts"],
  [
    "sidebar-collapsed-sections",
    "sidebar-collapsed-sections",
    "stores/sidebar-collapsed-sections-store/index.ts",
  ],
  [
    "sidebar-project-workspace-order",
    "sidebar-project-workspace-order",
    "stores/sidebar-order-store.ts",
  ],
  ["session-history-scope", "session-history-scope", "session-history/internal/scope-store.ts"],
  [
    "workspace-service-route-preferences",
    "workspace-service-route-preferences",
    "workspace-service-routes/store.ts",
  ],
  ["@paseo:project-icon-cache", "@osuna:project-icon-cache", "projects/icon-cache.ts"],
  ["@paseo:replica-cache", "@osuna:replica-cache", "runtime/replica-cache/legacy-cleanup.ts"],
  ["@paseo:e2e", "@osuna:e2e", "runtime/host-runtime.ts"],
  // 研究清单之外、0.14.x 同样会写的键：靠前缀规则一并覆盖。
  ["@paseo:review-draft-store", "@osuna:review-draft-store", "review/store.ts"],
];

// 动态键：渲染器源码里只有前缀，后缀是仓库路径、缓存键或主机 id，必须原样保留。
const DYNAMIC_STORAGE_KEYS: Array<
  [legacy: string, current: string, rendererFile: string, rendererPrefix: string]
> = [
  [
    "@paseo:changes-ship-default:/home/ada/code/paseo-notes",
    "@osuna:changes-ship-default:/home/ada/code/paseo-notes",
    "git/use-actions.tsx",
    "@osuna:changes-ship-default:",
  ],
  [
    '@paseo/provider-snapshot/v2:["srv_example","cwd","/home/ada/code/paseo-notes"]',
    '@osuna/provider-snapshot/v2:["srv_example","cwd","/home/ada/code/paseo-notes"]',
    "data/provider-snapshot-cache.ts",
    "@osuna/provider-snapshot/v2",
  ],
  [
    "@paseo:legacy-favorites-to-agent-profiles:v1:srv_example",
    "@osuna:legacy-favorites-to-agent-profiles:v1:srv_example",
    "agent-profiles/migration/index.ts",
    "@osuna:legacy-favorites-to-agent-profiles:v1:",
  ],
];

const DATABASES: Array<[legacy: string, current: string, rendererFile: string]> = [
  ["paseo-replica-row-store", "osuna-replica-row-store", "runtime/replica-cache/row-store.web.ts"],
  ["paseo-project-icon-cache", "osuna-project-icon-cache", "projects/icon-cache-storage.web.ts"],
  [
    "paseo-attachment-bytes",
    "osuna-attachment-bytes",
    "attachments/web/indexeddb-attachment-store.ts",
  ],
  ["paseo-replica-cache", "osuna-replica-cache", "runtime/replica-cache/legacy-cleanup.web.ts"],
];

describe("mapLegacyStorageKey", () => {
  it.each(STORAGE_KEYS)("maps %s to the key the renderer reads", (legacy, current, file) => {
    expect(mapLegacyStorageKey(legacy)).toBe(current);
    expect(rendererSource(file)).toContain(JSON.stringify(current));
  });

  it.each(DYNAMIC_STORAGE_KEYS)(
    "maps %s by its prefix and keeps the suffix",
    (legacy, current, file, rendererPrefix) => {
      expect(mapLegacyStorageKey(legacy)).toBe(current);
      expect(current.startsWith(rendererPrefix)).toBe(true);
      expect(rendererSource(file)).toContain(rendererPrefix);
    },
  );

  it("renames the push token key that only native builds wrote", () => {
    expect(mapLegacyStorageKey("@paseo:expo-push-token:srv_example")).toBe(
      "@osuna:expo-push-token:srv_example",
    );
  });

  it("keeps keys whose old spelling is not a prefix", () => {
    expect(mapLegacyStorageKey("my-paseo-notes")).toBe("my-paseo-notes");
    expect(mapLegacyStorageKey("third-party:@paseo:setting")).toBe("third-party:@paseo:setting");
  });
});

describe("mapLegacyDatabaseName", () => {
  it.each(DATABASES)("maps %s to the database the renderer opens", (legacy, current, file) => {
    expect(mapLegacyDatabaseName(legacy)).toBe(current);
    expect(rendererSource(file)).toContain(JSON.stringify(current));
  });

  it("keeps databases without the old prefix", () => {
    expect(mapLegacyDatabaseName("keyval-store")).toBe("keyval-store");
  });
});

describe("renameLegacySnapshot", () => {
  it("renames keys and databases and leaves values, stores and records untouched", () => {
    const rows = {
      name: "rows",
      keyPath: ["serverId", "kind", "id"],
      autoIncrement: false,
      indexes: [],
      records: [{ key: ["srv_example", "agent", "paseo-1"], value: { title: "@paseo:title" } }],
    };

    expect(
      renameLegacySnapshot({
        localStorage: [
          ["@paseo:daemon-registry", '[{"label":"paseo-box"}]'],
          ["panel-state", '{"version":16}'],
        ],
        databases: [{ name: "paseo-replica-row-store", version: 1, stores: [rows] }],
        skippedRecords: [],
      }),
    ).toEqual({
      localStorage: [
        ["@osuna:daemon-registry", '[{"label":"paseo-box"}]'],
        ["panel-state", '{"version":16}'],
      ],
      databases: [{ name: "osuna-replica-row-store", version: 1, stores: [rows] }],
      skippedRecords: [],
    });
  });
});
