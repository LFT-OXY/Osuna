import { chromium } from "playwright";
const browser = await chromium.launch();
const theme = process.argv[2] ?? "light";
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme, locale: "zh-CN" });
const page = await ctx.newPage();
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
await page.getByText("设置 providers").click();
await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /Codex/ }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `/Users/oxy/Documents/code/My/Osuna/.atw/tasks/09-30-providers-settings-redesign/research/screens/07-codex-endpoint-${theme}.png` });
const styles = await page.evaluate(() => { const pick=(el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();const o={t:el.tagName.toLowerCase(),box:[r.x,r.y,r.width,r.height].map(Math.round)};for(const k of ["fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderLeftWidth","borderRadius","paddingTop","paddingRight","paddingBottom","paddingLeft","gap"]){const v=s[k];if(v&&v!=="normal"&&v!=="0px"&&v!=="rgba(0, 0, 0, 0)"&&v!=="rgb(0, 0, 0)"&&v!=="400"&&v!=="13.3333px"&&v!=="16px")o[k]=v;}return o;}; const all=[...document.querySelectorAll("div,span")]; const out={}; for (const t of ["Codex 的配置文件已被外部修改","重新应用","切回官方","使用","chinhae","https://chinhae.cc/v1","12 个模型","使用中"]) { const el=all.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()===t)).pop(); if(!el) continue; const c=[];let p=el;for(let i=0;i<5&&p;i++,p=p.parentElement)c.push(pick(p)); out[t]=c;} return out; });
for (const [k,v] of Object.entries(styles)) { console.log("##",k); v.forEach(c=>console.log("  ",JSON.stringify(c))); }
const txt = await page.evaluate(() => { const d=[...document.querySelectorAll("div")].filter(e=>getComputedStyle(e).backdropFilter.includes("12px")); return d.map(e=>e.innerText).join("\n----\n"); });

await browser.close();
