import { chromium } from "playwright";
const [sid, out, provider = "claude", theme = "light"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
await page.addInitScript(() => { try { const k="@paseo:app-settings"; const v=JSON.parse(localStorage.getItem(k)||"{}"); v.language="zh-CN"; localStorage.setItem(k, JSON.stringify(v)); } catch {} });
await page.goto("http://localhost:8081/");
await page.waitForTimeout(9000);
await page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, `/settings/hosts/${sid}/providers/${provider}`);
await page.waitForTimeout(6000);
await page.mouse.move(5, 895);
const scrollTo = process.argv[6]; if (scrollTo) { await page.getByTestId(scrollTo).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(500); }
await page.screenshot({ path: out });
console.log(await page.evaluate(() => location.pathname));
await browser.close();
