export default async (page) => {
  const res = {};
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(() => { let e = document.querySelector('[data-testid="host-page-price-table-card"]'); while (e) { if (e.scrollTop > 0) e.scrollTop = 0; e = e.parentElement; } });
    await page.mouse.move(5, 895);
    await page.waitForTimeout(600);
    await page.screenshot({ path: "/Users/oxy/.paseo/worktrees/0x9u2djy/wild-gecko/.atw/tasks/09-30-price-table-and-turn-usage-redesign/research/screens/price-table-desktop-1280-" + theme + ".png" });
    res[theme] = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="host-page-price-table-card"]');
      const chain = []; let e = card; while (e) { const bg = getComputedStyle(e).backgroundColor; if (bg !== "rgba(0, 0, 0, 0)") chain.push({ tag: e.tagName, bg, w: e.getBoundingClientRect().width, x: e.getBoundingClientRect().x }); e = e.parentElement; }
      const sb = document.elementFromPoint(100, 450); const sbc = []; let s = sb; while (s) { const bg = getComputedStyle(s).backgroundColor; if (bg !== "rgba(0, 0, 0, 0)") { sbc.push({ bg, w: s.getBoundingClientRect().width }); break; } s = s.parentElement; }
      return { contentBgChain: chain, sidebarBg: sbc };
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  return res;
};
