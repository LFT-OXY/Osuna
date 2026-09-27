import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// 从 packages/desktop/icon-source/osuna.png 派生桌面端与 Web 的全部图标。
// 换 logo 时只替换源图再运行：node scripts/generate-osuna-icons.mjs
// 源图约定：方形 RGBA 画布，不透明的圆角底板按 Apple 图标栅格留白（约占 80%）。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "packages/desktop/icon-source/osuna.png");
const desktopAssets = path.join(repoRoot, "packages/desktop/assets");
const appImages = path.join(repoRoot, "packages/app/assets/images");
const appPublic = path.join(repoRoot, "packages/app/public");

// 边缘抗锯齿只有 1–2 像素；再往外、或 alpha 低于这个值的都是杂点。
const EDGE_BAND_PX = 2;
const EDGE_MIN_ALPHA = 16;

// favicon 状态标记沿用原来的画法：700 画布上圆心 (570,570)、半径 130 的圆点。
const FAVICON_SIZE = 48;
const FAVICON_DOT = { cx: 570 / 700, cy: 570 / 700, r: 130 / 700 };
const FAVICON_STATUS_COLORS = { running: "#3b82f6", attention: "#22c55e" };
// 圆点外圈挖掉一道透明缝，让它在任何标签栏底色上都和底板分开。
const FAVICON_DOT_GAP = 40 / 700;

const DEV_HUE_ROTATION = 140;
const DEV_SATURATION_FLOOR = 40;
const DEV_SATURATION_RAMP = 60;

async function readRgba(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width !== info.height) {
    throw new Error(
      `Expected a square RGBA image, got ${info.width}x${info.height}x${info.channels}`,
    );
  }
  return { data, size: info.width };
}

// 从 seeds 出发做 4 邻域灌水，把 canEnter 为真的像素标成 id，返回标记的像素数。
function floodFill(size, seeds, canEnter, marks, id) {
  const stack = [];
  for (const seed of seeds) {
    if (!marks[seed] && canEnter(seed)) {
      marks[seed] = id;
      stack.push(seed);
    }
  }
  let count = 0;
  while (stack.length > 0) {
    const p = stack.pop();
    count++;
    const x = p % size;
    const neighbors = [p - size, p + size, x > 0 ? p - 1 : -1, x < size - 1 ? p + 1 : -1];
    for (const q of neighbors) {
      if (q < 0 || q >= size * size || marks[q] || !canEnter(q)) continue;
      marks[q] = id;
      stack.push(q);
    }
  }
  return count;
}

// 底板 = alpha ≥ 128 的最大连通区域（含其内部的洞）。
function findTileMask(data, size) {
  function isSolid(p) {
    return data[p * 4 + 3] >= 128;
  }
  const labels = new Int32Array(size * size);
  let best = { id: 0, count: 0 };
  let nextId = 1;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || !isSolid(start)) continue;
    const id = nextId++;
    const count = floodFill(size, [start], isSolid, labels, id);
    if (count > best.count) best = { id, count };
  }

  // 从画布边缘灌水找出底板外部，剩下的都算底板内部（填掉可能的洞）。
  const edgeSeeds = [];
  for (let i = 0; i < size; i++) {
    edgeSeeds.push(i, (size - 1) * size + i, i * size, i * size + size - 1);
  }
  const outside = new Uint8Array(size * size);
  function isOutsideTile(p) {
    return labels[p] !== best.id;
  }
  floodFill(size, edgeSeeds, isOutsideTile, outside, 1);

  const tile = new Uint8Array(size * size);
  for (let i = 0; i < tile.length; i++) tile[i] = outside[i] ? 0 : 1;
  return tile;
}

// 方形邻域的膨胀可以拆成先横向、再纵向两次一维膨胀。
function dilate(mask, size, radius) {
  function dilateLine(source, lineStart, step) {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (!source[lineStart + i * step]) continue;
      out.fill(1, Math.max(0, i - radius), Math.min(size, i + radius + 1));
    }
    return out;
  }
  const horizontal = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) horizontal.set(dilateLine(mask, y * size, 1), y * size);
  const result = new Uint8Array(size * size);
  for (let x = 0; x < size; x++) {
    const column = dilateLine(horizontal, x, size);
    for (let y = 0; y < size; y++) result[y * size + x] = column[y];
  }
  return result;
}

// 底板内部 alpha 补到 255；紧贴底板的抗锯齿带保留；其余一律清成全透明。
function cleanSource(data, size) {
  const tile = findTileMask(data, size);
  const band = dilate(tile, size, EDGE_BAND_PX);
  const cleaned = Buffer.from(data);
  for (let i = 0; i < tile.length; i++) {
    const alphaIndex = i * 4 + 3;
    if (tile[i]) {
      cleaned[alphaIndex] = 255;
    } else if (!band[i] || cleaned[alphaIndex] < EDGE_MIN_ALPHA) {
      cleaned.fill(0, i * 4, i * 4 + 4);
    }
  }
  assertCleaned(cleaned, size, tile, band);
  return { data: cleaned, tileBox: boundingBox(tile, size) };
}

function assertCleaned(data, size, tile, band) {
  for (let i = 0; i < tile.length; i++) {
    const alpha = data[i * 4 + 3];
    if (tile[i] && alpha !== 255) throw new Error(`Tile pixel ${i} has alpha ${alpha}`);
    if (!band[i] && alpha !== 0) throw new Error(`Stray pixel ${i} outside the tile`);
  }
}

function boundingBox(mask, size) {
  let left = size;
  let top = size;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function rawImage(data, size) {
  return sharp(data, { raw: { width: size, height: size, channels: 4 } });
}

function encodePng(image) {
  return image.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

function resized(data, size, target) {
  return rawImage(data, size).resize(target, target, { kernel: "lanczos3" });
}

function resizedPng(data, size, target) {
  return encodePng(resized(data, size, target));
}

function resizedRaw(data, size, target) {
  return resized(data, size, target).raw().toBuffer();
}

// 裁出以底板为中心的正方形（底板略不方时两侧留透明），用于需要满版的 Web 图标和应用内 logo。
async function cropToTile(data, size, box) {
  const side = Math.max(box.width, box.height);
  const left = box.left - Math.floor((side - box.width) / 2);
  const top = box.top - Math.floor((side - box.height) / 2);
  const cropped = await rawImage(data, size)
    .extract({ left, top, width: side, height: side })
    .raw()
    .toBuffer();
  return { data: cropped, size: side };
}

function encodeIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((entry) => entry.png)]);
}

function encodeIcns(entries) {
  const chunks = entries.map(({ type, payload }) => {
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(type, 0, "ascii");
    chunkHeader.writeUInt32BE(payload.length + 8, 4);
    return Buffer.concat([chunkHeader, payload]);
  });
  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, "ascii");
  fileHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([fileHeader, ...chunks]);
}

// ic04/ic05（16、32 的 1x）只认 ARGB 格式："ARGB" 后接 A、R、G、B 四个平面，
// 每个平面按 icns 的 RLE 编码。这里只写字面量段（控制字节 n-1 后跟 n 个字节，n ≤ 128），
// 与 iconutil 生成的条目类型一致。
function encodeIcnsArgb(raw) {
  const pixelCount = raw.length / 4;
  const parts = [Buffer.from("ARGB", "ascii")];
  for (const channel of [3, 0, 1, 2]) {
    const plane = Buffer.alloc(pixelCount);
    for (let i = 0; i < pixelCount; i++) plane[i] = raw[i * 4 + channel];
    for (let start = 0; start < pixelCount; start += 128) {
      const run = plane.subarray(start, Math.min(start + 128, pixelCount));
      parts.push(Buffer.from([run.length - 1]), run);
    }
  }
  return Buffer.concat(parts);
}

// icns 条目类型及其像素尺寸（含 @2x），与 iconutil 的输出一致。
const ICNS_TYPES = [
  ["ic04", 16, "argb"],
  ["ic11", 32, "png"],
  ["ic05", 32, "argb"],
  ["ic12", 64, "png"],
  ["ic07", 128, "png"],
  ["ic13", 256, "png"],
  ["ic08", 256, "png"],
  ["ic14", 512, "png"],
  ["ic09", 512, "png"],
  ["ic10", 1024, "png"],
];
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

async function faviconWithStatus(tile, status) {
  const base = resized(tile.data, tile.size, FAVICON_SIZE);
  if (status === "none") return encodePng(base);
  const s = FAVICON_SIZE;
  function circle(r, fill) {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${FAVICON_DOT.cx * s}" cy="${FAVICON_DOT.cy * s}" r="${r * s}" fill="${fill}"/></svg>`,
    );
  }
  const withGap = await base
    .composite([{ input: circle(FAVICON_DOT.r + FAVICON_DOT_GAP, "#000"), blend: "dest-out" }])
    .raw()
    .toBuffer();
  return encodePng(
    rawImage(withGap, s).composite([
      { input: circle(FAVICON_DOT.r, FAVICON_STATUS_COLORS[status]) },
    ]),
  );
}

// 开发版：鸟转成橙色。按原图饱和度混合，低饱和的米色底板不跟着转色。
async function devVariant(data, size) {
  const rotated = await rawImage(data, size).modulate({ hue: DEV_HUE_ROTATION }).raw().toBuffer();
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const saturation =
      Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    const weight = Math.min(
      1,
      Math.max(0, (saturation - DEV_SATURATION_FLOOR) / DEV_SATURATION_RAMP),
    );
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.round(data[i + c] + (rotated[i + c] - data[i + c]) * weight);
    }
  }
  return out;
}

async function main() {
  const source = await readRgba(sourcePath);
  const { data: master, tileBox } = cleanSource(source.data, source.size);
  const tile = await cropToTile(master, source.size, tileBox);
  const outputs = new Map();

  // 桌面端用整张画布，保留 Apple 栅格留白，Dock 里的大小才和系统图标一致。
  outputs.set(
    path.join(desktopAssets, "icon.icns"),
    encodeIcns(
      await Promise.all(
        ICNS_TYPES.map(async ([type, px, format]) => ({
          type,
          payload:
            format === "argb"
              ? encodeIcnsArgb(await resizedRaw(master, source.size, px))
              : await resizedPng(master, source.size, px),
        })),
      ),
    ),
  );
  outputs.set(
    path.join(desktopAssets, "icon.ico"),
    encodeIco(
      await Promise.all(
        ICO_SIZES.map(async (px) => ({ size: px, png: await resizedPng(master, source.size, px) })),
      ),
    ),
  );
  for (const [name, px] of [
    ["icon.png", 512],
    ["32x32.png", 32],
    ["64x64.png", 64],
    ["128x128.png", 128],
    ["128x128@2x.png", 256],
  ]) {
    outputs.set(path.join(desktopAssets, name), await resizedPng(master, source.size, px));
  }
  outputs.set(
    path.join(desktopAssets, "icon-dev.png"),
    await encodePng(rawImage(await devVariant(master, source.size), source.size)),
  );

  // Web 图标和应用内 logo 用底板满版裁切，和原来的图标一致。
  outputs.set(path.join(appImages, "osuna-logo.png"), await resizedPng(tile.data, tile.size, 288));
  outputs.set(path.join(appImages, "favicon.png"), await faviconWithStatus(tile, "none"));
  for (const scheme of ["dark", "light"]) {
    for (const status of ["none", "running", "attention"]) {
      const suffix = status === "none" ? "" : `-${status}`;
      outputs.set(
        path.join(appImages, `favicon-${scheme}${suffix}.png`),
        await faviconWithStatus(tile, status),
      );
    }
  }
  for (const [name, px] of [
    ["pwa-icon-192.png", 192],
    ["pwa-icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ]) {
    outputs.set(path.join(appPublic, name), await resizedPng(tile.data, tile.size, px));
  }

  for (const [filePath, buffer] of outputs) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    console.log(`wrote ${path.relative(repoRoot, filePath)}`);
  }
}

await main();
