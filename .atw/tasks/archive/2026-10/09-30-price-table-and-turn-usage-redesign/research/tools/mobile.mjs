const measure = async (page) => page.evaluate(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100); };
  const seg = [...document.querySelectorAll('[data-testid="turn-usage-segment"]')].filter((e) => e.getBoundingClientRect().width > 0)[0];
  const l = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent === "本轮用量").pop();
  if (!l) return { seg: seg && R(seg), panel: null };
  const inner = l.parentElement, frame = inner.parentElement;
  return { vw: innerWidth, seg: R(seg), segBg: getComputedStyle(seg).backgroundColor, frame: R(frame), frameBg: getComputedStyle(frame).backgroundColor, inner: R(inner),
    rows: [...inner.children].slice(1, 3).map((r) => [...r.children].map((c) => ({ t: c.innerText, r: R(c) }))) };
});
export default async (_p, _c, browser) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN", colorScheme: "light" });
  const page = await ctx.newPage();
  const out = {};
  try {
    await page.goto("http://localhost:8081");
    await page.waitForTimeout(5000);
    await page.locator('[data-testid="menu-button"]').first().tap();
    await page.waitForTimeout(1200);
    await page.getByText("历史", { exact: true }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(2500);
    await page.getByText("/shuorenhua 只标问题", { exact: false }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(6000);
    const seg = page.locator('[data-testid="turn-usage-segment"]:visible').first();
    await seg.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/bl/m-agent.png" });
    await seg.tap();
    await page.waitForTimeout(800);
    out.light = await measure(page);
    await page.screenshot({ path: "/Users/oxy/.paseo/worktrees/0x9u2djy/wild-gecko/.atw/tasks/09-30-price-table-and-turn-usage-redesign/research/screens/turn-usage-panel-tap-390-light.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(800);
    out.dark = await measure(page);
    await page.screenshot({ path: "/Users/oxy/.paseo/worktrees/0x9u2djy/wild-gecko/.atw/tasks/09-30-price-table-and-turn-usage-redesign/research/screens/turn-usage-panel-tap-390-dark.png" });
  } catch (e) { out.err = e.message.slice(0, 300); await page.screenshot({ path: "/tmp/bl/m-err.png" }); }
  await ctx.close();
  return out;
};
