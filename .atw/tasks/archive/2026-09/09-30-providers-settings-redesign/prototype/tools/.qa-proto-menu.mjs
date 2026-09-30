import { chromium } from "playwright";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: "zh-CN" });
const page = await ctx.newPage();
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
await page.getByText("设置 providers").click();
await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
await page.getByText("外观", { exact: true }).first().click();
await page.waitForTimeout(2000);
const probe = (pts) => page.evaluate((pts) => { const out={}; for (const [k,[x,y]] of Object.entries(pts)) { let el=document.elementFromPoint(x,y); const c=[]; for(let i=0;i<5&&el;i++,el=el.parentElement){const s=getComputedStyle(el);const r=el.getBoundingClientRect();const o={t:el.tagName.toLowerCase(),box:[r.x,r.y,r.width,r.height].map(Math.round)};for(const p of ["fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderRadius","paddingTop","paddingRight","paddingLeft","gap","boxShadow","backdropFilter"]){const v=s[p];if(v&&v!=="none"&&v!=="normal"&&v!=="0px"&&v!=="rgba(0, 0, 0, 0)"&&v!=="rgb(0, 0, 0)"&&v!=="400"&&v!=="13.3333px"&&v!=="16px")o[p]=v;} c.push(o);} out[k]=c;} return out; }, pts);
const a = await probe({ selectTrigger:[1122,111], selectText:[1125,111] });
await page.getByText("oxydeMacBook-Pro.local").first().click();
await page.waitForTimeout(1000);
const b = await probe({ menuItemSel:[200,338], menuItemText:[128,338], menuPanelEdge:[30,375], menuItem2:[80,366], menuSub:[255,338] });
for (const [k,v] of Object.entries({...a,...b})) { console.log("##",k); v.forEach(c=>console.log("  ",JSON.stringify(c))); }
await browser.close();
