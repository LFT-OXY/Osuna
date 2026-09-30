// 用法：node tmp-baseline-run.mjs <file.mjs>，file 导出 default async (page, ctx, browser) => any
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
const mod = await import(pathToFileURL(process.argv[2]).href + "?t=" + Date.now());
try {
  const r = await mod.default(page, ctx, browser);
  if (r !== undefined) console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
} catch (e) { console.error("ERR", e.message); }
process.exit(0);
