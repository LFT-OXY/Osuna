import { chromium } from "playwright";
const DIR = "/Users/oxy/Documents/code/My/Osuna/.atw/tasks/09-30-providers-settings-redesign/prototype";
const SIZES = { D: [1440, 900], N: [1024, 900], C: [390, 844], M: [1440, 900] };
const ids = (process.argv[2] || "D1").split(",");
const themes = (process.argv[3] || "light").split(",");
const browser = await chromium.launch();
for (const t of themes) for (const id of ids) {
  const [w, h] = SIZES[id[0]];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log("PAGEERROR", id, e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", id, m.text()); });
  await page.goto(`file://${DIR}/providers-redesign.html?s=${id}&t=${t}&bare=1`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/shots/${id}-${t}.png` });
  await page.close();
}
await browser.close();
console.log("done");
