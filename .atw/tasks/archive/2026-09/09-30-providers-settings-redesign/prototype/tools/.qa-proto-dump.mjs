import { chromium } from "playwright";
import fs from "node:fs";
const OUT = "/Users/oxy/Documents/code/My/Osuna/.atw/tasks/09-30-providers-settings-redesign/research/screens";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme, locale: "zh-CN" });
const page = await ctx.newPage();
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
await page.getByText("设置 providers").click();
await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
const dumpFn = () => {
  const pick = (el) => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    const o = { tag: el.tagName.toLowerCase(), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    for (const k of ["fontFamily","fontSize","fontWeight","lineHeight","letterSpacing","color","backgroundColor","borderTopWidth","borderTopColor","borderBottomWidth","borderBottomColor","borderLeftWidth","borderRadius","paddingTop","paddingRight","paddingBottom","paddingLeft","gap","boxShadow","backdropFilter","opacity"]) {
      const v = s[k]; if (v && v !== "none" && v !== "normal" && v !== "0px" && v !== "rgba(0, 0, 0, 0)" && v !== "auto") o[k] = v;
    }
    return o;
  };
  const texts = ["返回","应用","通用","主机","oxydeMacBook-Pro.local","Providers","Claude","15 个 Model","可用","已禁用","未安装","添加 Provider","Agoragentic","1.3.6","安装说明","添加","搜索 providers"];
  const res = { body: pick(document.body), html: getComputedStyle(document.documentElement).backgroundColor, items: [] };
  const all = [...document.querySelectorAll("div,span,a,input,button")];
  for (const t of texts) {
    const hits = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === t) || (e.tagName==="INPUT" && e.placeholder===t));
    for (const el of hits.slice(0, 3)) {
      const chain = []; let p = el; for (let i = 0; i < 7 && p; i++, p = p.parentElement) chain.push(pick(p));
      res.items.push({ text: t, chain });
    }
  }
  // 开关
  res.switches = [...document.querySelectorAll('[role="switch"]')].slice(0, 3).map((el) => { const c=[]; el.querySelectorAll("*").forEach((x)=>c.push(pick(x))); return { self: pick(el), children: c }; });
  // svg
  res.svgs = [...document.querySelectorAll("svg")].filter((s) => s.getBoundingClientRect().width > 0).map((s) => { const r = s.getBoundingClientRect(); return { box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], color: getComputedStyle(s).color, html: s.outerHTML.slice(0, 6000) }; });
  return res;
};
const page1 = await page.evaluate(dumpFn);
fs.writeFileSync(`${OUT}/dom-providers-${theme}.json`, JSON.stringify(page1, null, 1));
await page.getByRole("button", { name: /Claude/ }).first().click();
await page.waitForTimeout(2500);
const sheetFn = () => {
  const pick = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); const o = { tag: el.tagName.toLowerCase(), box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] };
    for (const k of ["fontFamily","fontSize","fontWeight","lineHeight","letterSpacing","color","backgroundColor","borderTopWidth","borderTopColor","borderBottomWidth","borderBottomColor","borderLeftWidth","borderLeftColor","borderRadius","paddingTop","paddingRight","paddingBottom","paddingLeft","gap","boxShadow","backdropFilter","opacity"]) { const v=s[k]; if (v && v!=="none"&&v!=="normal"&&v!=="0px"&&v!=="rgba(0, 0, 0, 0)"&&v!=="auto") o[k]=v; } return o; };
  const texts = ["Claude","第三方接口","添加","官方","使用中","已发现","15","Opus 5.5","claude-opus-5-5","Opus 5.5 · Latest release","添加 Model","诊断","刷新"];
  const all = [...document.querySelectorAll("div,span,a,input,button")];
  const items = [];
  for (const t of texts) { const hits = all.filter((e)=>[...e.childNodes].some((n)=>n.nodeType===3&&n.textContent.trim().startsWith(t))); for (const el of hits.slice(-2)) { const chain=[]; let p=el; for (let i=0;i<8&&p;i++,p=p.parentElement) chain.push(pick(p)); items.push({ text:t, chain }); } }
  const inp = document.querySelector('input[placeholder="搜索 Models"]'); const ichain=[]; let p=inp; for (let i=0;i<8&&p;i++,p=p.parentElement) ichain.push(pick(p));
  const scrim = [...document.querySelectorAll("div")].filter((d)=>{const s=getComputedStyle(d);return s.backdropFilter&&s.backdropFilter!=="none";}).map(pick);
  const svgs = [...document.querySelectorAll("svg")].filter((s)=>{const r=s.getBoundingClientRect();return r.x>620&&r.x<1000&&r.width>0;}).map((s)=>{const r=s.getBoundingClientRect();return {box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],color:getComputedStyle(s).color,html:s.outerHTML.slice(0,3000)};});
  return { items, input: ichain, blurred: scrim, svgs };
};
fs.writeFileSync(`${OUT}/dom-sheet-${theme}.json`, JSON.stringify(await page.evaluate(sheetFn), null, 1));
// 抓 RN Web 的真实 CSS（原子类）备查
const css = await page.evaluate(() => [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n"));
fs.writeFileSync(`${OUT}/rnw-css-${theme}.css`, css);
await browser.close();
console.log("ok");
