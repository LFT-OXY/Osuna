const theme = process.env.THEME || "light";
const idx = Number(process.env.IDX || 0);
const shot = process.env.SHOT;
export default async (page) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.mouse.move(640, 880);
  await page.waitForTimeout(500);
  const seg = page.locator('[data-testid="turn-usage-segment"]:visible').nth(idx);
  await seg.scrollIntoViewIfNeeded();
  const sb = await seg.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForTimeout(700);
  if (shot) {
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const pr = await page.evaluate(() => { const l = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent === "本轮用量").pop(); const f = l?.parentElement?.parentElement; if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const x0 = Math.max(0, Math.min(sb.x, pr ? pr.x : sb.x) - 140);
    const x1 = Math.min(vp.w, Math.max(sb.x + sb.width, pr ? pr.x + pr.w : 0) + 140);
    const y0 = Math.max(0, (pr ? Math.min(pr.y, sb.y) : sb.y) - 60);
    const y1 = Math.min(vp.h, Math.max(sb.y + sb.height, pr ? pr.y + pr.h : 0) + 60);
    await page.screenshot({ path: shot, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
    await page.screenshot({ path: shot.replace(/\.png$/, "-full.png") });
  }
  return await page.evaluate((idx) => {
    const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100); };
    const T = ["fontSize","fontWeight","lineHeight","color","fontVariantNumeric","textAlign","minWidth","width","marginTop","marginBottom"];
    const B = ["backgroundColor","borderTopWidth","borderTopColor","borderRadius","paddingTop","paddingRight","paddingBottom","paddingLeft","boxShadow","maxWidth","minWidth","width","overflow","position","left","top","gap","opacity","backdropFilter"];
    const pick = (el, label, keys) => { if (!el) return { label, missing: true }; const cs = getComputedStyle(el); const o = { label, rect: R(el) }; for (const k of keys) o[k] = cs[k]; if (el.childElementCount === 0) o.text = el.textContent; return o; };
    const seg = [...document.querySelectorAll('[data-testid="turn-usage-segment"]')].filter((e) => e.getBoundingClientRect().width > 0)[idx];
    const out = [];
    out.push(pick(seg, "trigger segment (hovered)", ["backgroundColor","borderRadius","paddingLeft","paddingRight","height"]));
    [...seg.children].forEach((c, i) => out.push(pick(c, `segment text ${i}`, T)));
    const footer = seg.parentElement; out.push(pick(footer, "segment parent", ["gap","height"]));
    out.push({ label: "footer row text", text: footer.parentElement?.innerText });
    const leaf = (txt) => [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent === txt).pop();
    const title = leaf("本轮用量");
    if (!title) return { out, err: "no tooltip" };
    // 从标题往上到 portal 根
    const chain = []; let e = title.parentElement;
    while (e && e !== document.body) { chain.push(e); e = e.parentElement; }
    chain.slice(0, 6).forEach((c, i) => out.push(pick(c, `ancestor ${i} of title (0=tooltip inner View)`, B)));
    const inner = title.parentElement;
    out.push({ label: "inner scroll/client", scrollWidth: inner.scrollWidth, clientWidth: inner.clientWidth });
    out.push(pick(title, "title 本轮用量", T));
    const rows = [...inner.children].slice(1);
    rows.forEach((row, i) => {
      out.push(pick(row, `inner child ${i + 1}`, ["gap","height","justifyContent","marginTop","display","flexDirection"]));
      out.push({ label: `  cells of child ${i + 1}`, cells: [...row.children].map((c) => ({ text: c.innerText, rect: R(c), fs: getComputedStyle(c).fontSize, fw: getComputedStyle(c).fontWeight, color: getComputedStyle(c).color, ta: getComputedStyle(c).textAlign, scrollW: c.scrollWidth, clientW: c.clientWidth })) });
    });
    // 行内细节：模型名 & unpriced pill
    return out;
  }, idx);
};
