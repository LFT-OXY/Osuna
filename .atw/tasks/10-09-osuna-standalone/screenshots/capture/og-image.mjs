// 临时文件（不提交）：用 Osuna 的 logo 与真实界面图合成官网 OG 图（1200 x 630）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const logo = dataUrl(path.join(repoRoot, "packages/app/assets/images/osuna-logo.png"), "image/png");
const shot = dataUrl("/tmp/impl12-capture/shots/app-desktop-chat.png", "image/png");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background:
      radial-gradient(ellipse 70% 60% at 50% 0%, rgba(35, 153, 86, 0.28), transparent 70%),
      #101615;
    font-family: -apple-system, "SF Pro Display", "PingFang SC", system-ui, sans-serif;
    color: #fafafa;
  }
  .brand { position: absolute; top: 44px; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 18px; }
  .brand img { width: 56px; height: 56px; }
  .brand span { font-size: 44px; font-weight: 500; letter-spacing: -0.01em; }
  .window {
    position: absolute; left: 90px; top: 144px; width: 1020px;
    border-radius: 14px 14px 0 0; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 30px 80px rgba(0, 0, 0, 0.5);
  }
  .window img { display: block; width: 100%; }
</style>
</head>
<body>
  <div class="brand"><img src="${logo}" alt="" /><span>Osuna</span></div>
  <div class="window"><img src="${shot}" alt="" /></div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(repoRoot, "packages/website/public/og-image.png") });
await browser.close();
