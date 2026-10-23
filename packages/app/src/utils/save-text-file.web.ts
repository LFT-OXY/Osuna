import type { SaveTextFileInput } from "./save-text-file-types";

export type { SaveTextFileInput } from "./save-text-file-types";

/** Browser: the file downloads under its name. */
export async function saveTextFile(input: SaveTextFileInput): Promise<void> {
  const url = URL.createObjectURL(new Blob([input.contents], { type: input.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = input.fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 下载已经开始，下一轮再收回地址。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
