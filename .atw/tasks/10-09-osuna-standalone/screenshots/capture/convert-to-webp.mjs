// 临时脚本：把取到的 PNG 转成官网用的 WebP。用法：node convert.mjs <仓库根>
import path from "node:path";
import { createRequire } from "node:module";

const repoRoot = process.argv[2];
const require = createRequire(path.join(repoRoot, "package.json"));
const sharp = require("sharp");

const SHOTS = "/tmp/impl12-capture/shots";
const PUBLIC = path.join(repoRoot, "packages/website/public");

for (const name of [
  "app-desktop-chat",
  "app-desktop-review",
  "app-phone-workspaces",
  "app-phone-chat",
  "app-phone-changes",
]) {
  const input = path.join(SHOTS, `${name}.png`);
  const info = await sharp(input).webp({ quality: 88, effort: 6 }).toFile(path.join(PUBLIC, `${name}.webp`));
  const { data } = await sharp(input).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  console.log(name, `${info.width}x${info.height}`, `${Math.round(info.size / 1024)}KB`, "top-left rgb", [...data].slice(0, 3).join(","));
}
