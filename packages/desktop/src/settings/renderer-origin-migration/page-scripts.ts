// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import type {
  OriginStorageDatabase,
  OriginStorageObjectStore,
  OriginStorageSnapshot,
} from "./snapshot.js";

// 下面两个函数以源码文本注入隐藏窗口执行（见文件末尾），函数体必须自足：
// 不能引用模块作用域里的任何东西，只能用页面全局量。

// 枚举全部键与全部库，不认名字：渲染器以后再改名也不影响导出。
async function exportOriginStorage(): Promise<OriginStorageSnapshot> {
  const BLOB_MARKER = "__osunaOriginMigrationBlob";
  const CLONEABLE_TAGS = new Set([
    "Date",
    "RegExp",
    "Boolean",
    "Number",
    "String",
    "BigInt",
    "ArrayBuffer",
    "Error",
  ]);
  const blobReads: Array<Promise<void>> = [];

  function tagOf(value: object): string {
    return Object.prototype.toString.call(value).slice(8, -1);
  }

  function settled<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }

  // Blob 过不了 IPC，就地换成带 ArrayBuffer 的占位对象。返回 false 表示这条记录过不了 IPC：
  // 里面有其他宿主对象，或者 Blob 出现在没法就地替换的位置（Map 的键、Set 的成员）。
  function detachBlobs(value: unknown, replace: ((next: unknown) => void) | null): boolean {
    if (typeof value !== "object" || value === null) return true;
    const tag = tagOf(value);
    if (value instanceof Blob) {
      if (!replace) return false;
      const name = value instanceof File ? value.name : null;
      const lastModified = value instanceof File ? value.lastModified : null;
      blobReads.push(
        value
          .arrayBuffer()
          .then((buffer) =>
            replace({ [BLOB_MARKER]: true, type: value.type, name, lastModified, buffer }),
          ),
      );
      return true;
    }
    if (Array.isArray(value)) {
      return value.every((item, index) =>
        detachBlobs(item, (next) => {
          value[index] = next;
        }),
      );
    }
    if (value instanceof Map) {
      return [...value].every(
        ([key, item]) =>
          detachBlobs(key, null) && detachBlobs(item, (next) => value.set(key, next)),
      );
    }
    if (value instanceof Set) return [...value].every((item) => detachBlobs(item, null));
    if (tag === "Object") {
      return Object.keys(value).every((key) =>
        detachBlobs(Reflect.get(value, key), (next) => {
          Reflect.set(value, key, next);
        }),
      );
    }
    return ArrayBuffer.isView(value) || CLONEABLE_TAGS.has(tag);
  }

  const snapshot: OriginStorageSnapshot = { localStorage: [], databases: [], skippedRecords: [] };

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null) snapshot.localStorage.push([key, localStorage.getItem(key) ?? ""]);
  }

  for (const { name } of await indexedDB.databases()) {
    if (name === undefined) continue;
    const database = await settled(indexedDB.open(name));
    const exported: OriginStorageDatabase = {
      name,
      version: database.version,
      stores: [],
    };
    for (const storeName of Array.from(database.objectStoreNames)) {
      const store = database.transaction(storeName, "readonly").objectStore(storeName);
      const indexes = Array.from(store.indexNames, (indexName) => {
        const { keyPath, unique, multiEntry } = store.index(indexName);
        return { name: indexName, keyPath, unique, multiEntry };
      });
      const [keys, values] = await Promise.all([
        settled(store.getAllKeys()),
        settled(store.getAll()),
      ]);
      const records: OriginStorageObjectStore["records"] = [];
      keys.forEach((key, position) => {
        const record = { key, value: values[position] };
        const crossesIpc = detachBlobs(record.value, (next) => {
          record.value = next;
        });
        if (crossesIpc) records.push(record);
        else snapshot.skippedRecords.push({ database: name, store: storeName, key });
      });
      exported.stores.push({
        name: storeName,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes,
        records,
      });
    }
    database.close();
    snapshot.databases.push(exported);
  }

  await Promise.all(blobReads);
  return snapshot;
}

// 假定目标 origin 已被清空：每个库都从版本 0 升到导出时的版本，按导出的结构建表。
async function importOriginStorage(snapshot: OriginStorageSnapshot): Promise<void> {
  const BLOB_MARKER = "__osunaOriginMigrationBlob";

  function reviveBlobs(value: unknown, replace: (next: unknown) => void): void {
    if (typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        reviveBlobs(item, (next) => {
          value[index] = next;
        }),
      );
      return;
    }
    if (value instanceof Map) {
      for (const [key, item] of value) reviveBlobs(item, (next) => value.set(key, next));
      return;
    }
    if (Object.prototype.toString.call(value) !== "[object Object]") return;
    if (Reflect.get(value, BLOB_MARKER) !== true) {
      for (const key of Object.keys(value)) {
        reviveBlobs(Reflect.get(value, key), (next) => {
          Reflect.set(value, key, next);
        });
      }
      return;
    }
    const type: string = Reflect.get(value, "type");
    const buffer: ArrayBuffer = Reflect.get(value, "buffer");
    const name: string | null = Reflect.get(value, "name");
    const lastModified: number | null = Reflect.get(value, "lastModified");
    if (name === null || lastModified === null) replace(new Blob([buffer], { type }));
    else replace(new File([buffer], name, { type, lastModified }));
  }

  function openDatabase(database: OriginStorageDatabase): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(database.name, database.version);
      request.addEventListener("upgradeneeded", () => {
        for (const store of database.stores) {
          const created = request.result.createObjectStore(store.name, {
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
          });
          for (const { name, keyPath, unique, multiEntry } of store.indexes) {
            created.createIndex(name, keyPath, { unique, multiEntry });
          }
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () =>
        reject(new Error(`Opening ${database.name} was blocked`)),
      );
    });
  }

  function writeRecords(opened: IDBDatabase, store: OriginStorageObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = opened.transaction(store.name, "readwrite");
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () =>
        reject(transaction.error ?? new Error(`Writing ${opened.name}/${store.name} was aborted`)),
      );
      const objectStore = transaction.objectStore(store.name);
      try {
        for (const record of store.records) {
          reviveBlobs(record.value, (next) => {
            record.value = next;
          });
          // 键在值里的表不能再另外给键。
          if (store.keyPath === null) objectStore.put(record.value, record.key);
          else objectStore.put(record.value);
        }
      } catch (error) {
        reject(error);
        transaction.abort();
      }
    });
  }

  for (const [key, value] of snapshot.localStorage) localStorage.setItem(key, value);

  for (const database of snapshot.databases) {
    const opened = await openDatabase(database);
    for (const store of database.stores) {
      if (store.records.length > 0) await writeRecords(opened, store);
    }
    opened.close();
  }
}

export const EXPORT_PAGE_SCRIPT = `(${exportOriginStorage.toString()})()`;

export const IMPORT_PAGE_SCRIPT = `osunaOriginMigration.pull().then(${importOriginStorage.toString()})`;
