// 接口自选的图片照 magpie（https://github.com/yetone/magpie，internal/provider/icon.go，7597c132）：按内容起名、同一张只存一份、
// 认图片格式、1 MB 上限、没人用就删。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { isErrnoException } from "../../utils/errno.js";
import { writePrivateFileAtomicSync } from "../private-files.js";

/*
 * 「自定义」加的接口可以用本机的一张图片当图标：daemon 在 $PASEO_HOME/api-endpoints/icons/ 存一份副本，接口的 icon 写
 * `file:<名字>`，客户端经 read_icon 取回。内置图标只是名字（如 deepseek-color），图在客户端。
 */

export const FILE_ICON_PREFIX = "file:";

/** 最多存这么大的图片（magpie MaxIcon）。 */
export const MAX_ICON_BYTES = 1 << 20;

// 存的时候选、保存前还没接口指向它的图片，过这么久仍没人用才删（magpie pruneIcons）。
const UNUSED_ICON_GRACE_MS = 60 * 60 * 1000;

const ICON_FILE_NAME = /^[0-9a-f]{16}\.(png|jpg|gif|webp|ico|svg)$/;

// 内置图标的名字：magpie 的图标文件名去掉扩展名（小写字母、数字与连字符）。
const BUILT_IN_ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MIME_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

export type StoreIconFailure = "icon_too_large" | "icon_not_image";

export class StoreIconError extends Error {
  readonly code: StoreIconFailure;

  constructor(code: StoreIconFailure, message: string) {
    super(message);
    this.name = "StoreIconError";
    this.code = code;
  }
}

/** 图片格式：认文件头，SVG 看开头 1 KB 里有没有 `<svg`（magpie iconExt）；都不是为 null。 */
function iconExtension(bytes: Buffer): string | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (startsWith(0xff, 0xd8, 0xff)) return "jpg";
  if (
    bytes
      .subarray(0, 6)
      .toString("latin1")
      .match(/^GIF8[79]a$/)
  )
    return "gif";
  const isRiffWebp =
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (isRiffWebp) return "webp";
  if (startsWith(0x00, 0x00, 0x01, 0x00)) return "ico";
  if (bytes.subarray(0, 1024).toString("utf8").toLowerCase().includes("<svg")) return "svg";
  return null;
}

/** 图标值说的是哪个存下的文件；不是 `file:` 或名字不合规矩（不能指到目录外）为 null。 */
export function storedIconName(icon: string): string | null {
  if (!icon.startsWith(FILE_ICON_PREFIX)) return null;
  const name = icon.slice(FILE_ICON_PREFIX.length);
  return ICON_FILE_NAME.test(name) ? name : null;
}

export function isBuiltInIconName(icon: string): boolean {
  return icon.length <= 64 && BUILT_IN_ICON_NAME.test(icon);
}

/** 认得的图片的 MIME 类型；超过 1 MB 或不是认得的图片为 null（同 store 的规矩）。 */
export function iconMimeType(bytes: Buffer): string | null {
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
  const extension = iconExtension(bytes);
  return extension === null ? null : MIME_TYPES[extension];
}

/** 存下的图标值，与它是不是这次才存下的。 */
export interface StoredIcon {
  icon: string;
  isNew: boolean;
}

export class EndpointIcons {
  private readonly dir: string;
  private readonly now: () => Date;

  constructor(options: { endpointsDir: string; now: () => Date }) {
    this.dir = path.join(options.endpointsDir, "icons");
    this.now = options.now;
  }

  /** 存下图片，返回指向它的图标值；同一张图片只存一份。 */
  store(bytes: Buffer): string {
    return this.storeTracked(bytes).icon;
  }

  /** 同 store，另说这张图片是不是这次才存下的（之前没有同样的一张）。 */
  storeTracked(bytes: Buffer): StoredIcon {
    if (bytes.length > MAX_ICON_BYTES) {
      throw new StoreIconError("icon_too_large", "The picture is over 1 MB; pick a smaller one");
    }
    const extension = bytes.length === 0 ? null : iconExtension(bytes);
    if (extension === null) {
      throw new StoreIconError(
        "icon_not_image",
        "Not a picture: use PNG, JPEG, GIF, WebP, ICO or SVG",
      );
    }
    const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${extension}`;
    const icon = FILE_ICON_PREFIX + name;
    const isNew = !this.isStored(icon);
    writePrivateFileAtomicSync(path.join(this.dir, name), bytes);
    return { icon, isNew };
  }

  /** 删掉一张存下的图片（存了却没加成接口时）；不在了不算错。 */
  discard(icon: string): void {
    const name = storedIconName(icon);
    if (name !== null) rmSync(path.join(this.dir, name), { force: true });
  }

  isStored(icon: string): boolean {
    const name = storedIconName(icon);
    if (name === null) return false;
    try {
      return statSync(path.join(this.dir, name)).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** 存下的图片的字节与 MIME 类型；不是存下的、或已经删了为 null。 */
  read(icon: string): { data: Buffer; mimeType: string } | null {
    const name = storedIconName(icon);
    if (name === null) return null;
    const extension = name.slice(name.lastIndexOf(".") + 1);
    try {
      return { data: readFileSync(path.join(this.dir, name)), mimeType: MIME_TYPES[extension] };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * 接口改动后删掉没人用的图片：刚才还有接口用、现在没有了的马上删；存了却一直没接口指向的，存了一小时后再删
   * （添加窗口里选了图片还没保存时不能删）。
   */
  prune(input: { usedBefore: readonly string[]; usedNow: readonly string[] }): void {
    const usedNow = new Set(input.usedNow.flatMap((icon) => storedIconName(icon) ?? []));
    const dropped = new Set(
      input.usedBefore
        .flatMap((icon) => storedIconName(icon) ?? [])
        .filter((name) => !usedNow.has(name)),
    );
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch (error) {
      // 还没存过图片就没有这个目录。
      if (isNotFound(error)) return;
      throw error;
    }
    const cutoff = this.now().getTime() - UNUSED_ICON_GRACE_MS;
    for (const name of names) {
      if (!ICON_FILE_NAME.test(name) || usedNow.has(name)) continue;
      const filePath = path.join(this.dir, name);
      if (dropped.has(name) || statSync(filePath).mtimeMs < cutoff)
        rmSync(filePath, { force: true });
    }
  }
}

function isNotFound(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}
