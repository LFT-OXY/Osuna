import { chromium } from "playwright";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, locale: "zh-CN", hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
await page.getByText("设置 providers").first().click();
await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const pick = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); const o={t:el.tagName.toLowerCase(),box:[r.x,r.y,r.width,r.height].map(Math.round)}; for (const k of ["fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderRadius","paddingTop","paddingLeft","gap"]) { const v=s[k]; if(v&&v!=="normal"&&v!=="0px"&&v!=="rgba(0, 0, 0, 0)"&&v!=="rgb(0, 0, 0)") o[k]=v;} return o; };
  const all=[...document.querySelectorAll("div,span")];
  const out={};
  for (const t of ["Providers","Claude","15 个 Model","添加 Provider"]) { const els=all.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()===t)); out[t]=els.slice(0,2).map(el=>{const c=[];let p=el;for(let i=0;i<5&&p;i++,p=p.parentElement)c.push(pick(p));return c;}); }
  const sw=document.querySelector('[role="switch"]'); out.switch=[...sw.querySelectorAll("*")].map(pick);
  return out;
});
for (const [k,v] of Object.entries(r)) { console.log("##",k); console.log(JSON.stringify(v).slice(0,1800)); }
await browser.close();
