// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import type { OriginStorageSnapshot } from "./snapshot.js";

// 0.14.x 的品牌前缀 → 1.0.0 渲染器读取的前缀。只认开头，中间出现旧拼写的名字不动。
const LEGACY_PREFIXES: Array<[legacy: string, current: string]> = [
  ["@paseo:", "@osuna:"],
  ["@paseo/", "@osuna/"],
  ["paseo:", "osuna:"],
  ["paseo-", "osuna-"],
];

function renameLegacyPrefix(name: string): string {
  for (const [legacy, current] of LEGACY_PREFIXES) {
    if (name.startsWith(legacy)) return current + name.slice(legacy.length);
  }
  return name;
}

export function mapLegacyStorageKey(key: string): string {
  return renameLegacyPrefix(key);
}

export function mapLegacyDatabaseName(name: string): string {
  return renameLegacyPrefix(name);
}

// 只改 localStorage 键与库名。值是渲染器带校验的持久化内容，改一个字节就会被当成坏数据删掉。
export function renameLegacySnapshot(snapshot: OriginStorageSnapshot): OriginStorageSnapshot {
  return {
    ...snapshot,
    localStorage: snapshot.localStorage.map(([key, value]) => [mapLegacyStorageKey(key), value]),
    databases: snapshot.databases.map((database) => ({
      ...database,
      name: mapLegacyDatabaseName(database.name),
    })),
  };
}
