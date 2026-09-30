import { chromium } from "playwright";
import fs from "node:fs";
const OUT = "/Users/oxy/Documents/code/My/Osuna/.atw/tasks/09-30-providers-settings-redesign/research/screens";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme, locale: "zh-CN" });
const page = await ctx.newPage();
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
if (false) {
  await page.getByText("设置 providers").click();
  await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const cat = await page.evaluate(() => { const card=[...document.querySelectorAll("div")].find(d=>d.innerText&&d.innerText.startsWith("Agoragentic")&&getComputedStyle(d).borderRadius==="14px"); return card ? card.innerText.split("\n").slice(0,40) : null; });
  fs.writeFileSync(`${OUT}/catalog-text.json`, JSON.stringify(cat, null, 1));
  await page.goBack(); await page.waitForTimeout(1500);
}
await page.getByText("main", { exact: true }).nth(1).click();
await page.waitForTimeout(4000);
await page.mouse.move(1100, 650);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/08-workspace-${theme}.png` });
await page.getByRole("button", { name: /^选择模型/ }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/09-model-picker-${theme}.png` });
const gear = await page.evaluate(() => [...document.querySelectorAll('[role="button"],button')].map(b=>b.getAttribute("aria-label")).filter(Boolean).filter(l=>/设置|settings/i.test(l)));
console.log("gear:", gear.join(" | "));
const g = page.getByRole("button", { name: /Claude.*(设置|settings)|(设置|settings).*Claude/i }).first();
if (await g.count()) { await g.click(); await page.waitForTimeout(2000); await page.screenshot({ path: `${OUT}/09b-model-picker-gear-${theme}.png` }); }
const btns = await page.evaluate(() => [...document.querySelectorAll('[role="button"],button')].map(b=>b.getAttribute("aria-label")).filter(Boolean).slice(0,80));
console.log(btns.join(" | "));
await browser.close();
