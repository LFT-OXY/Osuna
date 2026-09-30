const scanVisible = async (page, label) => {
  const segs = page.locator('[data-testid="turn-usage-segment"]:visible');
  const n = await segs.count();
  const info = { label, url: page.url(), segments: n, panels: [] };
  for (let i = 0; i < n; i++) {
    await page.mouse.move(640, 880); await page.waitForTimeout(300);
    await segs.nth(i).scrollIntoViewIfNeeded();
    const b = await segs.nth(i).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(500);
    const txt = await page.evaluate(() => { const l = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent === "本轮用量").pop(); return l?.parentElement.innerText.replace(/\n/g, " | "); });
    info.panels.push({ i, txt });
  }
  console.log(JSON.stringify(info));
};
export default async (page) => {
  const entries = [["你好", 0], ["不要使用任何工具。只回复一个 bash 代码块", 0], ["你好", 3], ["你好", 4], ["给我一个单选的弹窗，我现在是在测试当前使用的客户端样式", 1]];
  for (const [text, nth] of entries) {
    await page.getByText("历史", { exact: true }).first().click();
    await page.waitForTimeout(2000);
    const items = page.locator("text=" + text);
    const c = await items.count();
    // 历史列表里的第 nth 个匹配（侧栏里也可能有同名，靠 url 判断）
    const main = page.locator('main, [role="main"]');
    await page.getByText(text, { exact: false }).filter({ visible: true }).nth(nth).click().catch((e) => console.log("click fail", text, nth, e.message.slice(0, 80)));
    await page.waitForTimeout(5000);
    await scanVisible(page, `${text}#${nth} (of ${c})`);
  }
};
