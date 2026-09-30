// PROTOTYPE 截图脚本，用完挪进任务目录
import { chromium } from "playwright";
import path from "node:path";
const dir = process.argv[2];
const ids = process.argv[3].split(",");
const themes = (process.argv[4] || "light").split(",");
const sizes = { P0: [1440, 900], PM0: [390, 844], AM: [390, 844], BM: [390, 844], UM: [390, 700], VM: [390, 700] };
const browser = await chromium.launch();
for (const t of themes) for (const id of ids) {
  const [w, h] = sizes[id] || (id[0] === "T" || id[0] === "U" || id[0] === "V" ? [1100, 560] : [1440, 900]);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto("file://" + path.resolve(dir, "price-and-usage.html") + `?s=${id}&t=${t}&bare=1`);
  await page.waitForTimeout(200);
  await page.locator(".frame").screenshot({ path: path.resolve(dir, "shots", `${id}-${t}.png`) });
  await page.close();
}
await browser.close();
console.log("done");
