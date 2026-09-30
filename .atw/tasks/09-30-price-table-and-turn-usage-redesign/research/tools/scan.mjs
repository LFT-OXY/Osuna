export default async (page) => {
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="workspace-tab-agent_"]')].map((e) => e.getAttribute("data-testid")));
  const res = [];
  for (const t of [...new Set(tabs)]) {
    await page.locator(`[data-testid="${t}"]`).first().click();
    await page.waitForTimeout(4000);
    const segs = page.locator('[data-testid="turn-usage-segment"]:visible');
    const n = await segs.count();
    const info = { tab: t, segments: n, panels: [] };
    for (let i = 0; i < n; i++) {
      await page.mouse.move(640, 880); await page.waitForTimeout(300);
      await segs.nth(i).scrollIntoViewIfNeeded();
      const b = await segs.nth(i).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(500);
      const txt = await page.evaluate(() => { const l = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent === "本轮用量").pop(); return l?.parentElement.innerText.replace(/\n/g, " | "); });
      info.panels.push({ i, seg: await segs.nth(i).innerText(), txt });
    }
    res.push(info); console.log(JSON.stringify(info));
  }
  await page.mouse.move(640, 880);
  return res;
};
