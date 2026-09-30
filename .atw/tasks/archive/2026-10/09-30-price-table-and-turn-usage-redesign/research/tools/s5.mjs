export default async (page) => {
  await page.screenshot({ path: "/Users/oxy/.paseo/worktrees/0x9u2djy/wild-gecko/.atw/tasks/09-30-price-table-and-turn-usage-redesign/research/screens/price-table-compact-390-light.png" });
  return await page.evaluate(() => {
    const card = document.querySelector('[data-testid="host-page-price-table-card"]');
    const sub = [...card.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.startsWith("每百万"));
    const inner = sub.parentElement;
    const rows = card.querySelector('[data-testid^="price-table-row-"]');
    let sc = rows; while (sc && !(sc.scrollWidth > sc.clientWidth + 1 && getComputedStyle(sc).overflowX !== "visible")) sc = sc.parentElement;
    const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10); };
    return { vw: innerWidth, section: r(card), card: r(inner), cardRadius: getComputedStyle(inner).borderRadius, cardOverflow: getComputedStyle(inner).overflow,
      scroller: sc ? { rect: r(sc), scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth, overflowX: getComputedStyle(sc).overflowX, scrollbarWidth: getComputedStyle(sc).scrollbarWidth } : null,
      subtitle: r(sub) };
  });
};
