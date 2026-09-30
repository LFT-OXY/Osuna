export default async (page) => {
  const res = {};
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.mouse.move(640, 880); await page.waitForTimeout(500);
    const seg = page.locator('[data-testid="turn-usage-segment"]:visible').first();
    res[theme + "_segIdle"] = await seg.evaluate((e) => getComputedStyle(e).backgroundColor);
    res[theme + "_footer"] = await seg.evaluate((s) => {
      const row = s.parentElement.parentElement; 
      return [...row.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.getBoundingClientRect().width > 0).map((e) => { const c = getComputedStyle(e); return `${e.textContent.trim()} | ${c.fontSize} ${c.fontWeight} ${c.color}`; });
    });
    const b = await seg.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(600);
    res[theme + "_panel"] = await page.evaluate(() => {
      const l = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent === "本轮用量").pop();
      const inner = l.parentElement, frame = inner.parentElement;
      const f = getComputedStyle(frame);
      const s = (e) => { const c = getComputedStyle(e); return `${e.innerText.replace(/\n/g, " ")} | ${c.fontSize} w${c.fontWeight} ${c.color} lh=${c.lineHeight}`; };
      const kids = [...inner.children];
      return { frameBoxSizing: f.boxSizing, frameBorder: `${f.borderLeftWidth} ${f.borderStyle} ${f.borderLeftColor}`, frameZ: f.zIndex,
        modelName: s(kids[2].children[0].children[0] || kids[2].children[0]), dur: [...kids[kids.length - 2].children].map(s), note: s(kids[kids.length - 1]) };
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.mouse.move(640, 880);
  return res;
};
