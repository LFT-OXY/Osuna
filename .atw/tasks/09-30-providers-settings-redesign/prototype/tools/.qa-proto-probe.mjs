import { chromium } from "playwright";
const theme = process.argv[2] ?? "light";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: "zh-CN" });
const page = await ctx.newPage();
await page.goto("http://localhost:8081/", { waitUntil: "domcontentloaded" });
await page.getByText("设置 providers").waitFor({ timeout: 60000 });
await page.getByText("设置 providers").click();
await page.getByText("Mock Slow Provider").waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);
const pts = { sidebarBg:[100,700], divider:[319,450], headerLine:[800,35.5], iconFrame:[560,115], iconFrameEdge:[555,103], switchTrack:[1165,115], switchThumb:[1182,115], switchOffTrack:[1160,227], switchOffThumb:[1150,227], dotOn:[1076,115], dotOff:[1064,228], dotWarn:[1064,508], chevron:[1215,115], hdrIcon:[345,17], searchBox:[700,612] };
const out = await page.evaluate((pts) => {
  const res = {};
  for (const [k,[x,y]] of Object.entries(pts)) {
    let el = document.elementFromPoint(x,y); const chain=[];
    for (let i=0;i<5&&el;i++,el=el.parentElement){ const s=getComputedStyle(el); const r=el.getBoundingClientRect(); const o={t:el.tagName.toLowerCase(),box:[r.x,r.y,r.width,r.height].map(Math.round)}; for (const p of ["backgroundColor","borderTopColor","borderRightWidth","borderRightColor","borderBottomWidth","borderBottomColor","borderTopWidth","borderRadius","boxShadow","color","transform","fill","stroke"]) { const v=s[p]; if(v&&v!=="none"&&v!=="0px"&&v!=="rgba(0, 0, 0, 0)"&&v!=="rgb(0, 0, 0)") o[p]=v;} chain.push(o);} res[k]=chain; }
  return res;
}, pts);
for (const [k,v] of Object.entries(out)) { console.log("##",k); for (const c of v) console.log("  ",JSON.stringify(c)); }
await browser.close();
