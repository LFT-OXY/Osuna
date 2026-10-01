export default async (page) => {
  await page.getByText("历史", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.getByText(process.env.ENTRY, { exact: false }).filter({ visible: true }).nth(Number(process.env.NTH || 0)).click();
  await page.waitForTimeout(5000);
  return page.url();
};
