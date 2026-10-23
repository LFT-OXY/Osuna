import {
  type AttachmentStore,
  type AttachmentMetadata,
  type SaveAttachmentInput,
} from "@/attachments/types";
import {
  blobToBase64,
  generateAttachmentId,
  normalizeMimeType,
  parseDataUrl,
} from "@/attachments/utils";

interface StoredBlobRecord {
  id: string;
  blob: Blob;
  createdAt: number;
  fileName: string | null;
}

// PR28-DEBUG: 临时诊断，合并前删除。
function debugLog(message: string): void {
  console.log(`[PR28-DEBUG] ${new Date().toISOString()} ${message}`);
}

function debugStack(): string {
  return (new Error().stack ?? "")
    .split("\n")
    .slice(2, 7)
    .map((line) => line.trim())
    .join(" < ");
}

async function debugQuota(): Promise<string> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate ? `usage=${estimate.usage} quota=${estimate.quota}` : "estimate unavailable";
  } catch (error) {
    return `estimate failed ${String(error)}`;
  }
}

const DB_NAME = "paseo-attachment-bytes";
const STORE_NAME = "attachments";
const DB_VERSION = 1;

function ensureIndexedDb(): IDBFactory {
  const idb = globalThis.indexedDB;
  if (!idb) {
    throw new Error("IndexedDB is unavailable in this runtime.");
  }
  return idb;
}

function openAttachmentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = ensureIndexedDb().open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Failed to open attachment IndexedDB."));
    });
  });
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = run(store);

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB transaction request failed."));
    });

    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    });
  });
}

async function sourceToBlob(input: SaveAttachmentInput): Promise<{ blob: Blob; mimeType: string }> {
  const source = input.source;
  if (source.kind === "bytes") {
    const mimeType = normalizeMimeType(input.mimeType);
    const buffer = new ArrayBuffer(source.bytes.byteLength);
    new Uint8Array(buffer).set(source.bytes);
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
    };
  }

  if (source.kind === "blob") {
    const mimeType = normalizeMimeType(input.mimeType ?? source.blob.type);
    const blob =
      source.blob.type === mimeType
        ? source.blob
        : source.blob.slice(0, source.blob.size, mimeType);
    return { blob, mimeType };
  }

  if (source.kind === "data_url") {
    const parsed = parseDataUrl(source.dataUrl);
    const response = await fetch(source.dataUrl);
    const blob = await response.blob();
    const mimeType = normalizeMimeType(input.mimeType ?? parsed.mimeType ?? blob.type);
    return {
      blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
      mimeType,
    };
  }

  const response = await fetch(source.uri);
  const blob = await response.blob();
  const mimeType = normalizeMimeType(input.mimeType ?? blob.type);
  return {
    blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
    mimeType,
  };
}

async function loadBlob(db: IDBDatabase, id: string): Promise<Blob> {
  const record = await runTx<StoredBlobRecord | undefined>(db, "readonly", (store) =>
    store.get(id),
  );
  if (!record?.blob) {
    throw new Error(`Attachment ${id} was not found in IndexedDB.`);
  }
  return record.blob;
}

export function createIndexedDbAttachmentStore(): AttachmentStore {
  return {
    storageType: "web-indexeddb",

    async save(input): Promise<AttachmentMetadata> {
      const id = input.id ?? generateAttachmentId();
      const createdAt = Date.now();
      const { blob, mimeType } = await sourceToBlob(input);
      const fileName = input.fileName ?? null;
      const db = await openAttachmentDb();

      try {
        await runTx(db, "readwrite", (store) =>
          store.put({ id, blob, createdAt, fileName } satisfies StoredBlobRecord),
        );
        debugLog(`idb put ok id=${id} size=${blob.size} type=${mimeType}`);
      } catch (error) {
        debugLog(
          `idb put FAILED id=${id} size=${blob.size} error=${String(error)} ${await debugQuota()}`,
        );
        throw error;
      } finally {
        db.close();
      }

      return {
        id,
        mimeType,
        storageType: "web-indexeddb",
        storageKey: id,
        fileName,
        byteSize: blob.size,
        createdAt,
      };
    },

    async encodeBase64({ attachment }): Promise<string> {
      const db = await openAttachmentDb();
      try {
        const blob = await loadBlob(db, attachment.storageKey);
        return await blobToBase64(blob);
      } finally {
        db.close();
      }
    },

    async resolvePreviewUrl({ attachment }): Promise<string> {
      const db = await openAttachmentDb();
      try {
        let blob: Blob;
        try {
          blob = await loadBlob(db, attachment.storageKey);
        } catch (error) {
          debugLog(
            `idb get FAILED id=${attachment.storageKey} error=${String(error)} ${await debugQuota()}`,
          );
          throw error;
        }
        const url = URL.createObjectURL(blob);
        debugLog(
          `createObjectURL id=${attachment.storageKey} size=${blob.size} type=${blob.type} url=${url}`,
        );
        return url;
      } finally {
        db.close();
      }
    },

    async releasePreviewUrl({ url }): Promise<void> {
      debugLog(`revokeObjectURL url=${url} stack=${debugStack()}`);
      URL.revokeObjectURL(url);
    },

    async delete({ attachment }): Promise<void> {
      const db = await openAttachmentDb();
      try {
        await runTx(db, "readwrite", (store) => store.delete(attachment.storageKey));
      } finally {
        db.close();
      }
    },

    async garbageCollect({ referencedIds }): Promise<void> {
      debugLog(`gc start referenced=[${Array.from(referencedIds).join(",")}]`);
      const db = await openAttachmentDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const cursorRequest = store.openCursor();

          cursorRequest.addEventListener("error", () => {
            reject(
              cursorRequest.error ?? new Error("Failed to iterate IndexedDB attachment store."),
            );
          });

          cursorRequest.addEventListener("success", () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              debugLog("gc done");
              resolve();
              return;
            }

            const key = String(cursor.key);
            if (!referencedIds.has(key)) {
              debugLog(`gc delete id=${key} (not referenced)`);
              cursor.delete();
            }
            cursor.continue();
          });

          tx.addEventListener("error", () => {
            reject(tx.error ?? new Error("Failed to garbage collect IndexedDB attachments."));
          });
        });
      } finally {
        db.close();
      }
    },
  };
}
