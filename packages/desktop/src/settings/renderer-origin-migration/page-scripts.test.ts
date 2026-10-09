// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import { Deserializer, Serializer } from "node:v8";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { EXPORT_PAGE_SCRIPT, IMPORT_PAGE_SCRIPT } from "./page-scripts";
import type { OriginStorageSnapshot } from "./snapshot";

// 一个 origin 的渲染层存储：内存版 localStorage 加一套独立的 fake-indexeddb。
class MemoryLocalStorage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  entries(): Array<[string, string]> {
    return [...this.items.entries()];
  }
}

interface Origin {
  localStorage: MemoryLocalStorage;
  indexedDB: IDBFactory;
}

function createOrigin(): Origin {
  return { localStorage: new MemoryLocalStorage(), indexedDB: new IDBFactory() };
}

// 执行的就是主进程注入页面的那段脚本文本，页面全局量换成这个 origin 的存储。
function runPageScript<T>(script: string, globals: Record<string, unknown>): Promise<T> {
  const run = new Function(...Object.keys(globals), `return ${script}`);
  return run(...Object.values(globals)) as Promise<T>;
}

// Electron 的 IPC 用 V8 序列化器传值，Blob 这类宿主对象到对面就不再是原来的类型。
// 不带 Node 扩展的基础序列化器有同样的表现：Blob 被当成普通对象，内容丢失。
function sendOverIpc(snapshot: OriginStorageSnapshot): OriginStorageSnapshot {
  const serializer = new Serializer();
  serializer.writeHeader();
  serializer.writeValue(snapshot);
  const deserializer = new Deserializer(serializer.releaseBuffer());
  deserializer.readHeader();
  return deserializer.readValue();
}

function exportOrigin(origin: Origin): Promise<OriginStorageSnapshot> {
  return runPageScript(EXPORT_PAGE_SCRIPT, { ...origin });
}

function importIntoOrigin(origin: Origin, snapshot: OriginStorageSnapshot): Promise<void> {
  return runPageScript(IMPORT_PAGE_SCRIPT, {
    ...origin,
    osunaOriginMigration: { pull: async () => snapshot },
  });
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

async function createDatabase(
  origin: Origin,
  name: string,
  version: number,
  upgrade: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
  const request = origin.indexedDB.open(name, version);
  request.addEventListener("upgradeneeded", () => upgrade(request.result));
  return settled(request);
}

async function readStore(
  database: IDBDatabase,
  storeName: string,
): Promise<{ keys: IDBValidKey[]; values: unknown[] }> {
  const store = database.transaction(storeName, "readonly").objectStore(storeName);
  const [keys, values] = await Promise.all([settled(store.getAllKeys()), settled(store.getAll())]);
  return { keys, values };
}

async function seedLegacyOrigin(origin: Origin): Promise<void> {
  origin.localStorage.setItem("@paseo:daemon-registry", '[{"serverId":"srv_example"}]');
  origin.localStorage.setItem("panel-state", '{"state":{},"version":16}');
  origin.localStorage.setItem("paseo-drafts", "");

  const rows = await createDatabase(origin, "paseo-replica-row-store", 3, (database) => {
    const store = database.createObjectStore("rows", { keyPath: ["serverId", "kind", "id"] });
    store.createIndex("by-kind", "kind");
    store.createIndex("by-tag", "tags", { unique: false, multiEntry: true });
    database.createObjectStore("meta");
    database.createObjectStore("log", { autoIncrement: true });
  });
  const write = rows.transaction(["rows", "meta", "log"], "readwrite");
  write.objectStore("rows").put({
    serverId: "srv_example",
    kind: "agent",
    id: "agent-1",
    tags: ["pinned", "draft"],
    updatedAt: new Date("2026-09-01T08:00:00.000Z"),
    usage: new Map([["input", 12]]),
    digest: new Uint8Array([1, 2, 3]),
  });
  write.objectStore("meta").put(7, "schema_version");
  write.objectStore("log").add({ event: "opened" });
  write.objectStore("log").add({ event: "synced" });
  await committed(write);
  rows.close();

  const attachments = await createDatabase(origin, "paseo-attachment-bytes", 1, (database) => {
    database.createObjectStore("attachments", { keyPath: "id" });
  });
  const attach = attachments.transaction("attachments", "readwrite");
  attach.objectStore("attachments").put({
    id: "att-1",
    blob: new Blob(["draft attachment bytes"], { type: "text/plain" }),
    thumbnails: [new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })],
  });
  await committed(attach);
  attachments.close();
}

describe("renderer origin page scripts", () => {
  it("carries every localStorage key and IndexedDB database to another origin over IPC", async () => {
    const legacy = createOrigin();
    const current = createOrigin();
    await seedLegacyOrigin(legacy);

    const snapshot = sendOverIpc(await exportOrigin(legacy));
    await importIntoOrigin(current, snapshot);

    expect(snapshot.skippedRecords).toEqual([]);
    expect(current.localStorage.entries()).toEqual([
      ["@paseo:daemon-registry", '[{"serverId":"srv_example"}]'],
      ["panel-state", '{"state":{},"version":16}'],
      ["paseo-drafts", ""],
    ]);
    expect(
      (await current.indexedDB.databases()).toSorted((a, b) => a.name!.localeCompare(b.name!)),
    ).toEqual([
      { name: "paseo-attachment-bytes", version: 1 },
      { name: "paseo-replica-row-store", version: 3 },
    ]);

    const rows = await settled(current.indexedDB.open("paseo-replica-row-store"));
    expect([...rows.objectStoreNames]).toEqual(["log", "meta", "rows"]);
    const rowStore = rows.transaction("rows", "readonly").objectStore("rows");
    expect(rowStore.keyPath).toEqual(["serverId", "kind", "id"]);
    expect([...rowStore.indexNames]).toEqual(["by-kind", "by-tag"]);
    expect(rowStore.index("by-kind").keyPath).toBe("kind");
    expect(rowStore.index("by-tag").multiEntry).toBe(true);
    expect(await readStore(rows, "rows")).toEqual({
      keys: [["srv_example", "agent", "agent-1"]],
      values: [
        {
          serverId: "srv_example",
          kind: "agent",
          id: "agent-1",
          tags: ["pinned", "draft"],
          updatedAt: new Date("2026-09-01T08:00:00.000Z"),
          usage: new Map([["input", 12]]),
          digest: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    expect(await readStore(rows, "meta")).toEqual({ keys: ["schema_version"], values: [7] });
    expect(await readStore(rows, "log")).toEqual({
      keys: [1, 2],
      values: [{ event: "opened" }, { event: "synced" }],
    });
    // 自增计数接着旧库往下走，不会覆盖已有记录。
    const append = rows.transaction("log", "readwrite");
    const appendedKey = settled(append.objectStore("log").add({ event: "after-import" }));
    await committed(append);
    expect(await appendedKey).toBe(3);
    rows.close();

    const attachments = await settled(current.indexedDB.open("paseo-attachment-bytes"));
    const { keys, values } = await readStore(attachments, "attachments");
    attachments.close();
    const attachment = values[0] as { id: string; blob: Blob; thumbnails: Blob[] };
    expect(keys).toEqual(["att-1"]);
    expect(attachment.id).toBe("att-1");
    expect(attachment.blob).toBeInstanceOf(Blob);
    expect(attachment.blob.type).toBe("text/plain");
    expect(await attachment.blob.text()).toBe("draft attachment bytes");
    expect(attachment.thumbnails[0].type).toBe("image/png");
    expect([...new Uint8Array(await attachment.thumbnails[0].arrayBuffer())]).toEqual([
      137, 80, 78, 71,
    ]);
  });

  it("leaves out a record that holds a host object IPC cannot carry and reports it", async () => {
    const legacy = createOrigin();
    const current = createOrigin();
    const signingKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
    ]);
    const database = await createDatabase(legacy, "keyring", 1, (upgrading) => {
      upgrading.createObjectStore("entries");
    });
    const write = database.transaction("entries", "readwrite");
    write.objectStore("entries").put({ label: "plain" }, "kept");
    write.objectStore("entries").put({ label: "host object", signingKey }, "dropped");
    await committed(write);
    database.close();

    const snapshot = sendOverIpc(await exportOrigin(legacy));
    await importIntoOrigin(current, snapshot);

    expect(snapshot.skippedRecords).toEqual([
      { database: "keyring", store: "entries", key: "dropped" },
    ]);
    const imported = await settled(current.indexedDB.open("keyring"));
    expect(await readStore(imported, "entries")).toEqual({
      keys: ["kept"],
      values: [{ label: "plain" }],
    });
    imported.close();
  });

  it("rejects when a record cannot be written into the target origin", async () => {
    const current = createOrigin();

    const importing = importIntoOrigin(current, {
      localStorage: [],
      databases: [
        {
          name: "osuna-attachment-bytes",
          version: 1,
          stores: [
            {
              name: "attachments",
              keyPath: "id",
              autoIncrement: false,
              indexes: [],
              records: [{ key: "att-1", value: { blob: "record without its in-line key" } }],
            },
          ],
        },
      ],
      skippedRecords: [],
    });

    await expect(importing).rejects.toMatchObject({ name: "DataError" });
  });
});
