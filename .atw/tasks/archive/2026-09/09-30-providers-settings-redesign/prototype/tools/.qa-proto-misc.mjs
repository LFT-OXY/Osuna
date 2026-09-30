import { chromium } from "playwright";
import fs from "node:fs";
const OUT = "/Users/oxy/Documents/code/My/Osuna/.atw/tasks/09-30-providers-settings-redesign/research/screens";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme, locale: "zh-CN" });
const page = await ctx.newPage();
const pickFn = `(el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); const o={t:el.tagName.toLowerCase(),role:el.getAttribute("role"),txt:(el.childNodes.length===1&&el.firstChild.nodeType===3)?el.textContent:undefined,box:[r.x,r.y,r.width,r.height].map(Math.round)}; for (const k of ["fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderRadius","paddingTop","paddingRight","paddingLeft","gap","boxShadow","backdropFilter"]) { const v=s[k]; if(v&&v!=="none"&&v!=="normal"&&v!=="0px"&&v!=="rgba(0, 0, 0, 0)"&&v!=="rgb(0, 0, 0)"&&v!=="400"&&v!=="13.3333px"&&v!=="16px") o[k]=v;} return o; }`;
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
await page.getByText("设置 providers").click();
await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
// 完整 ACP 图标
const acp = await page.evaluate(() => [...document.querySelectorAll("svg")].filter(s=>{const r=s.getBoundingClientRect();return Math.round(r.x)===557&&r.width===20;}).slice(0,6).map(s=>s.outerHTML));
fs.writeFileSync(`${OUT}/acp-icons-${theme}.json`, JSON.stringify(acp));
// 外观页
await page.getByText("外观", { exact: true }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/05-appearance-${theme}.png` });
const seg = await page.evaluate(`(() => { const pick=${pickFn}; const tabs=[...document.querySelectorAll('[role="tab"],[role="radio"],[aria-selected],[aria-checked]')].filter(e=>e.getBoundingClientRect().width>0).slice(0,8); return tabs.map(t=>{const c=[];let p=t;for(let i=0;i<3&&p;i++,p=p.parentElement)c.push(pick(p)); const inner=[...t.querySelectorAll("*")].slice(0,4).map(pick); return {chain:c, inner};}); })()`);
fs.writeFileSync(`${OUT}/dom-segmented-${theme}.json`, JSON.stringify(seg, null, 1));
// 主机行的下拉菜单
await page.getByText("oxydeMacBook-Pro.local").first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/06-dropdown-${theme}.png` });
const menu = await page.evaluate(`(() => { const pick=${pickFn}; const m=[...document.querySelectorAll('[role="menu"],[role="menuitem"],[role="listbox"],[role="option"]')].filter(e=>e.getBoundingClientRect().width>0).slice(0,6); return m.map(e=>({self:pick(e), parent:pick(e.parentElement), inner:[...e.querySelectorAll("*")].slice(0,5).map(pick)})); })()`);
fs.writeFileSync(`${OUT}/dom-menu-${theme}.json`, JSON.stringify(menu, null, 1));
console.log("seg", seg.length, "menu", menu.length);
await browser.close();
