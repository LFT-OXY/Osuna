// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import { contextBridge, ipcRenderer } from "electron";

// 导入页的预加载脚本，跑在 Electron 沙箱里，运行时只能加载 "electron"。
// 桥名与频道名因此在这里写死，分别要与 page-scripts.ts、electron.ts 里的一致。
contextBridge.exposeInMainWorld("osunaOriginMigration", {
  pull: () => ipcRenderer.invoke("osuna:renderer-origin-migration:pull"),
});
