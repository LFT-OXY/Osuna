import { File as FSFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SaveTextFileInput } from "./save-text-file-types";

export type { SaveTextFileInput } from "./save-text-file-types";

/** Native: write the file to the cache and hand it to the system share sheet. */
export async function saveTextFile(input: SaveTextFileInput): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device");
  }
  const file = new FSFile(Paths.cache, input.fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(input.contents);
  await Sharing.shareAsync(file.uri, {
    mimeType: input.mimeType,
    UTI: input.uti,
    dialogTitle: input.fileName,
  });
}
