import { useCallback, useRef } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { isWeb } from "@/constants/platform";
import { getMimeTypeFromPath } from "@/attachments/file-types";
import { readDesktopFileBytes, type SelectedFile } from "@/attachments/selected-file";

/** 只给选这几种文件：网页的 accept、桌面对话框的 filters、原生文档选择器的 type 都按它。 */
export interface FilePickFilter {
  // 桌面对话框里这一类的名字。
  name: string;
  mimeTypes: string[];
  // 不带点。
  extensions: string[];
}

export interface FilePickOptions {
  filter: FilePickFilter;
}

async function pickFilesWithDesktopDialog(
  filter: FilePickFilter | null,
): Promise<SelectedFile[] | null> {
  const dialog = getDesktopHost()?.dialog;
  const dialogOpen = dialog?.open;
  if (typeof dialogOpen !== "function") {
    throw new Error("Desktop dialog API is not available.");
  }

  const selection = await dialogOpen({
    directory: false,
    multiple: true,
    ...(filter ? { filters: [{ name: filter.name, extensions: filter.extensions }] } : {}),
  });

  if (!selection) {
    return null;
  }

  const paths = Array.isArray(selection) ? selection : [selection];
  if (paths.length === 0) {
    return null;
  }

  const result: SelectedFile[] = [];

  for (const filePath of paths) {
    const fileName = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? filePath;
    const mimeType = getMimeTypeFromPath(filePath);
    result.push({ fileName, mimeType, readBytes: () => readDesktopFileBytes(filePath) });
  }

  return result;
}

function pickFilesWithWebInput(filter: FilePickFilter | null): Promise<SelectedFile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (filter) {
      input.accept = [...filter.mimeTypes, ...filter.extensions.map((ext) => `.${ext}`)].join(",");
    }
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve(null);
        return;
      }

      const result: SelectedFile[] = [];
      for (const file of files) {
        result.push({
          fileName: file.name,
          mimeType: file.type || getMimeTypeFromPath(file.name),
          readBytes: async () => new Uint8Array(await file.arrayBuffer()),
        });
      }
      resolve(result);
    });

    input.addEventListener("cancel", () => {
      resolve(null);
    });

    document.body.appendChild(input);
    input.click();

    // Clean up after a short delay to allow the change event to fire
    setTimeout(() => {
      input.remove();
    }, 60_000);
  });
}

async function pickFilesWithDocumentPicker(
  filter: FilePickFilter | null,
): Promise<SelectedFile[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    ...(filter ? { type: filter.mimeTypes } : {}),
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  return result.assets.map((asset) => ({
    fileName: asset.name,
    mimeType: asset.mimeType ?? getMimeTypeFromPath(asset.name),
    readBytes: () => new File(asset.uri).bytes(),
  }));
}

export function useFilePicker() {
  const isPickingRef = useRef(false);

  const pickFiles = useCallback(
    async (options?: FilePickOptions): Promise<SelectedFile[] | null> => {
      const filter = options?.filter ?? null;
      if (isPickingRef.current) {
        return null;
      }
      isPickingRef.current = true;

      try {
        if (isWeb && isElectronRuntime()) {
          return await pickFilesWithDesktopDialog(filter);
        }

        if (isWeb) {
          return await pickFilesWithWebInput(filter);
        }

        return await pickFilesWithDocumentPicker(filter);
      } catch (error) {
        console.error("[FilePicker] Failed to pick files:", error);
        throw error;
      } finally {
        isPickingRef.current = false;
      }
    },
    [],
  );

  return { pickFiles };
}
