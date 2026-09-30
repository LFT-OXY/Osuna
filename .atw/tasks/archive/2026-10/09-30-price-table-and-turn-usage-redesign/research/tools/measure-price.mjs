const theme = process.env.THEME || "light";
export default async (page) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForTimeout(800);
  const card = page.locator('[data-testid="host-page-price-table-card"]');
  await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.mouse.move(5, 895);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/bl/price-${theme}-1280.png` });
  return await page.evaluate(() => {
    const pick = (el, label, keys) => {
      if (!el) return { label, missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const o = { label, tag: el.tagName.toLowerCase(), testid: el.getAttribute("data-testid") || undefined,
        rect: [Math.round(r.x*10)/10, Math.round(r.y*10)/10, Math.round(r.width*10)/10, Math.round(r.height*10)/10] };
      for (const k of keys) o[k] = cs[k];
      if (el.childElementCount === 0) o.text = el.textContent.slice(0, 60);
      return o;
    };
    const T = ["fontSize","fontWeight","lineHeight","color","fontFamily","fontVariantNumeric","textAlign"];
    const B = ["backgroundColor","borderTopWidth","borderTopColor","borderLeftColor","borderRadius","paddingTop","paddingRight","paddingBottom","paddingLeft","boxShadow","gap"];
    const card = document.querySelector('[data-testid="host-page-price-table-card"]');
    const out = [];
    out.push(pick(card, "section(testid)", [...B]));
    // 标题：section 下第一个文字节点
    const findText = (root, txt) => [...root.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.trim() === txt);
    const title = findText(card, "价格表"); out.push(pick(title, "section title 价格表", T));
    const au = findText(card, "自动更新"); out.push(pick(au, "自动更新 label", T));
    const sw = card.querySelector('[data-testid="price-table-auto-update-switch"]');
    out.push(pick(sw, "switch", [...B, "width","height"]));
    if (sw) { [...sw.querySelectorAll("*")].slice(0,6).forEach((c,i)=>out.push(pick(c, `switch child ${i}`, ["backgroundColor","width","height","borderRadius","boxShadow"]))); }
    const rf = card.querySelector('[data-testid="price-table-refresh"]');
    out.push(pick(rf, "refresh button (ghost sm)", [...B, "height"]));
    out.push(pick(findText(rf, "立即刷新"), "refresh label", T));
    const icon = rf?.querySelector("svg"); out.push(pick(icon, "refresh icon svg", ["width","height","color"]));
    if (icon) out.push({ label: "refresh icon stroke", stroke: icon.getAttribute("stroke") || icon.querySelector("[stroke]")?.getAttribute("stroke") });
    const sub = [...card.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.startsWith("每百万"));
    const cardInner = sub?.parentElement;
    out.push(pick(cardInner, "card (settingsStyles.card)", B));
    out.push(pick(sub, "subtitle", [...T, "paddingTop","paddingLeft"]));
    const err = card.querySelector('[data-testid="price-table-control-error"]'); out.push(pick(err, "control error placeholder", [...T,"minHeight"]));
    const hdr = findText(card, "模型"); const hdrRow = hdr?.parentElement;
    out.push(pick(hdrRow, "header row", [...B, "height"]));
    out.push(pick(hdr, "header cell 模型", [...T, "width"]));
    out.push(pick(findText(card, "输入"), "header cell 输入", [...T, "width"]));
    out.push(pick(findText(card, "来源"), "header cell 来源", [...T, "width","paddingLeft"]));
    out.push(pick(findText(card, "操作"), "header cell 操作", [...T, "width"]));
    const rows = [...card.querySelectorAll('[data-testid^="price-table-row-"]')];
    const unpriced = rows[0], priced = rows.find((r) => r.textContent.includes("LiteLLM"));
    for (const [row, name] of [[unpriced, "unpriced"], [priced, "priced"]]) {
      out.push(pick(row, `${name} rowBlock`, [...B, "height"]));
      const inner = row.firstElementChild; out.push(pick(inner, `${name} row (flex)`, ["gap","alignItems","height"]));
      const model = [...row.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent === row.getAttribute("data-testid").replace("price-table-row-",""));
      out.push(pick(model, `${name} model name`, [...T, "width"]));
      out.push(pick(model?.parentElement, `${name} model cell`, ["width","gap"]));
      const e = row.querySelector('[data-testid^="price-table-error-"]'); out.push(pick(e, `${name} row error placeholder`, [...T,"minHeight"]));
    }
    // badge
    const badgeText = findText(unpriced, unpriced.innerText.split("\n")[1]);
    out.push(pick(badgeText, "amber badge text", T));
    let b = badgeText?.parentElement; out.push(pick(b, "amber badge box (parent)", [...B, "height"]));
    out.push(pick(b?.parentElement, "amber badge box (grandparent)", [...B, "height"]));
    // inputs
    const inp = unpriced.querySelector('input'); out.push(pick(inp, "price input <input>", [...T, ...B, "width","height","outlineColor","outlineStyle"]));
    out.push(pick(inp?.parentElement, "price input wrapper", [...B, "width","height"]));
    out.push(pick(inp?.parentElement?.parentElement, "price input wrapper2", [...B, "width","height"]));
    const save = unpriced.querySelector('[data-testid^="price-table-save-"]'); out.push(pick(save, "保存 button (default sm)", [...B, "height","width"]));
    out.push(pick(findText(save, "保存"), "保存 label", T));
    const dash = findText(unpriced, "—"); out.push(pick(dash, "unpriced source —", [...T, "width","paddingLeft"]));
    // priced cells
    const nums = [...priced.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && /^[\d.]+$/.test(e.textContent));
    out.push(pick(nums[0], "priced price number", [...T, "width"]));
    out.push(pick(nums[0]?.parentElement, "price cell", ["width"]));
    out.push(pick(findText(priced, "LiteLLM"), "source LiteLLM", [...T, "width","paddingLeft"]));
    const edit = priced.querySelector('[data-testid^="price-table-edit-"]'); out.push(pick(edit, "自定义价格 button (ghost sm)", [...B, "height","width"]));
    out.push(pick(findText(edit, "自定义价格"), "自定义价格 label", T));
    out.push(pick(document.body, "body", ["backgroundColor","fontFamily"]));
    const main = cardInner?.closest('[data-testid]'); 
    out.push({ label: "page bg at (700,40)", el: document.elementFromPoint(700,40)?.tagName, bg: getComputedStyle(document.elementFromPoint(700,40)).backgroundColor });
    return out;
  });
};
