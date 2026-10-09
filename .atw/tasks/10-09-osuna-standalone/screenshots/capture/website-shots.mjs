// 临时文件（不提交）：给官网页面截图。用法：node zz-website-shot.mjs <输出目录> [场景名...]
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const BASE = process.env.SITE_BASE ?? "http://localhost:8093";
const outDir = process.argv[2];
const only = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
// 390 宽用安卓手机的 UA：手机访客看到的主按钮是安卓 APK。
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["Pixel 7"].userAgent,
};

const SCENES = [
  { name: "home-default-1280", path: "/", context: DESKTOP },
  { name: "home-default-390", path: "/", context: PHONE },
  { name: "download-stable-1280", path: "/download", context: DESKTOP },
  { name: "download-stable-390", path: "/download", context: PHONE },
  { name: "download-beta-1280", path: "/download?channel=beta", context: DESKTOP },
  { name: "download-beta-390", path: "/download?channel=beta", context: PHONE },
  { name: "privacy-default-1280", path: "/privacy", context: DESKTOP },
  { name: "terms-default-1280", path: "/terms", context: DESKTOP },
];

const browser = await chromium.launch();
for (const scene of SCENES) {
  if (only.length > 0 && !only.includes(scene.name)) continue;
  const context = await browser.newContext({ ...scene.context, colorScheme: "dark", locale: "zh-CN" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(BASE + scene.path, { waitUntil: "networkidle" });
  // 首页各区块在滚动进视口时才淡入：先滚到底再回顶，让整页都处于可见状态。
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 300) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${scene.name}.png`, fullPage: true });

  const report = await page.evaluate(() => {
    const text = document.body.innerText;
    const overflowing = [...document.querySelectorAll("a, button")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && (rect.right > window.innerWidth + 0.5 || rect.left < -0.5);
      })
      .map((el) => el.textContent?.trim().slice(0, 30));
    return {
      lang: document.documentElement.lang,
      title: document.title,
      paseo: /paseo/i.test(text) || /paseo/i.test(document.documentElement.innerHTML),
      hub: /\bhub\b/i.test(text),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflowing,
      hosts: [...new Set([...document.querySelectorAll("a[href^='http']")].map((a) => a.href.replace(/^(https:\/\/[^/]+(\/[^/]+\/[^/]+)?).*$/, "$1")))],
      images: [...document.querySelectorAll("img")].map((img) => `${img.getAttribute("src")}:${img.naturalWidth}`),
    };
  });
  console.log(scene.name, JSON.stringify(report), problems.length ? `PROBLEMS ${JSON.stringify(problems)}` : "");
  await context.close();
}
await browser.close();
