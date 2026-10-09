// 临时文件（不提交）：官网首页的局部视口截图（手机三连、切换到"审查"、命令弹窗）。
import { chromium } from "playwright";

const BASE = "http://localhost:8093";
const OUT = process.argv[2];
const browser = await chromium.launch();

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "审查" }).click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 420));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/detail-hero-review-1280.png` });
  for (let y = 420; y <= 1500; y += 120) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/detail-phones-1280.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "在远程机器上运行 Agent" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/detail-server-dialog-1280.png` });
  await page.close();
}

{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/detail-home-fold-390.png` });
  for (let y = 0; y <= 1150; y += 100) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/detail-phones-390.png` });
  await page.close();
}
await browser.close();
