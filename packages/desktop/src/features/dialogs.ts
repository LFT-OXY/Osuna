import { writeFile } from "node:fs/promises";
import { dialog, ipcMain, BrowserWindow } from "electron";
import { SaveTextOptionsSchema } from "./save-text-options.js";

interface AskOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

interface AskWithCheckboxOptions extends AskOptions {
  checkboxLabel: string;
  checkboxChecked?: boolean;
}

interface OpenOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  createDirectory?: boolean;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}

function resolveDialogType(kind: AskOptions["kind"]): "warning" | "error" | "question" {
  if (kind === "warning") return "warning";
  if (kind === "error") return "error";
  return "question";
}

export function registerDialogHandlers(): void {
  ipcMain.handle("paseo:dialog:ask", async (event, message: string, options?: AskOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(win ?? BrowserWindow.getFocusedWindow()!, {
      type: resolveDialogType(options?.kind),
      title: options?.title ?? "Confirm",
      message,
      buttons: [options?.cancelLabel ?? "Cancel", options?.okLabel ?? "OK"],
      defaultId: 1,
      cancelId: 0,
    });
    return result.response === 1;
  });

  ipcMain.handle(
    "paseo:dialog:askWithCheckbox",
    async (event, message: string, options: AskWithCheckboxOptions) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showMessageBox(win ?? BrowserWindow.getFocusedWindow()!, {
        type: resolveDialogType(options.kind),
        title: options.title ?? "Confirm",
        message,
        buttons: [options.cancelLabel ?? "Cancel", options.okLabel ?? "OK"],
        defaultId: 1,
        cancelId: 0,
        checkboxLabel: options.checkboxLabel,
        checkboxChecked: options.checkboxChecked ?? false,
      });
      return {
        confirmed: result.response === 1,
        dontAskAgain: result.checkboxChecked,
      };
    },
  );

  ipcMain.handle("paseo:dialog:open", async (event, options?: OpenOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const properties: Electron.OpenDialogOptions["properties"] = [];
    if (options?.directory) properties.push("openDirectory");
    if (options?.createDirectory) properties.push("createDirectory");
    if (options?.multiple) properties.push("multiSelections");
    if (!options?.directory) properties.push("openFile");

    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      title: options?.title,
      defaultPath: options?.defaultPath,
      properties,
      filters: options?.filters,
    });

    if (result.canceled) return null;
    return options?.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  });

  // 渲染进程在沙箱里写不了文件：选好位置后由主进程写入，取消则回 null。
  ipcMain.handle("paseo:dialog:saveText", async (event, payload: unknown) => {
    // 这是第一个写盘的 IPC：先校验，不合格直接拒绝。
    const options = SaveTextOptionsSchema.parse(payload);
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, options.contents, "utf8");
    return result.filePath;
  });
}
