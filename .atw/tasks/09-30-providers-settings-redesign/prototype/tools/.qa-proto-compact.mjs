import { chromium } from "playwright";
const OUT = "/Users/oxy/Documents/code/My/Osuna/.atw/tasks/09-30-providers-settings-redesign/research/screens";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
// 桌面：第三方接口添加表单
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
  await page.getByText("设置 providers").waitFor({ timeout: 60000 });
  await page.getByText("设置 providers").click();
  await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Claude/ }).first().click();
  await page.waitForTimeout(1500);
  await page.mouse.click(917, 237);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-api-endpoint-form-${theme}.png` });
  await ctx.close();
}
// 紧凑端
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, locale: "zh-CN", hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${OUT}/10-compact-home-${theme}.png` });
  const entry = page.getByText("设置 providers");
  if (await entry.count()) { await entry.first().click(); }
  await page.waitForTimeout(4000);
  console.log("url", page.url());
  await page.screenshot({ path: `${OUT}/11-compact-providers-${theme}.png` });
  const row = page.getByRole("button", { name: /Claude/ }).first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(2500); await page.screenshot({ path: `${OUT}/12-compact-sheet-${theme}.png` }); }
  await ctx.close();
}
await browser.close();
