import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--remote-debugging-port=9333"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: "zh-CN", colorScheme: "light" });
const page = await ctx.newPage();
await page.goto("http://localhost:8081");
console.log("ready");
await new Promise(() => {});
