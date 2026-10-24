import { getDesktopHost } from "./host";
import type { SaveTextFileInput } from "@/utils/save-text-file-types";

/** Desktop: the save dialog asks where; cancelling saves nothing. */
export async function saveTextFileWithDesktopDialog(input: SaveTextFileInput): Promise<void> {
  const saveText = getDesktopHost()?.dialog?.saveText;
  if (typeof saveText !== "function") {
    throw new Error("Desktop dialog saveText() is unavailable in this environment.");
  }
  await saveText({
    defaultPath: input.fileName,
    filters: [{ name: input.filterName, extensions: [input.extension] }],
    contents: input.contents,
  });
}
