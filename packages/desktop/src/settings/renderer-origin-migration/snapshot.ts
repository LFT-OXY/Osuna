// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.

// 一个 origin 下渲染层存储的整份内容。导出页产出、主进程转手、导入页写回，
// 全程走结构化克隆，所以记录值可以是 Date、Map、ArrayBuffer 等任何可克隆类型。
export interface OriginStorageSnapshot {
  localStorage: Array<[key: string, value: string]>;
  databases: OriginStorageDatabase[];
  // 含有过不了 IPC 的宿主对象（CryptoKey、文件句柄等）而被跳过的记录。
  skippedRecords: OriginStorageSkippedRecord[];
}

export interface OriginStorageSkippedRecord {
  database: string;
  store: string;
  key: IDBValidKey;
}

export interface OriginStorageDatabase {
  name: string;
  version: number;
  stores: OriginStorageObjectStore[];
}

export interface OriginStorageObjectStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: OriginStorageIndex[];
  records: OriginStorageRecord[];
}

export interface OriginStorageRecord {
  key: IDBValidKey;
  value: unknown;
}

export interface OriginStorageIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}

export function isEmptySnapshot(snapshot: OriginStorageSnapshot): boolean {
  return snapshot.localStorage.length === 0 && snapshot.databases.length === 0;
}
