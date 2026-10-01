export default async (page) => { await page.locator(`[data-testid="${process.env.TAB}"]`).first().click(); await page.waitForTimeout(3000); return "ok"; };
