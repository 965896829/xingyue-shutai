// Run against a desktop window with a disposable profile and a seeded recent book.
export async function verifyHomeNavigation(page, recentBookTitle) {
  const home = page.locator('.welcome');
  const title = page.getByRole('button', { name: '星月书台，返回首页', exact: true });
  const sidebar = page.locator('.sidebar').getByRole('button', { name: '返回首页', exact: true });
  const enterLab = home.getByRole('button', { name: '自由创作实验室' });
  const idea = page.getByRole('textbox', { name: '创作想法或题材组合' });
  const project = page.getByRole('button', { name: recentBookTitle, exact: true });
  const manuscript = page.getByRole('textbox', { name: '正文手稿' });

  await enterLab.click();
  const draft = '离线导航检查：保留实验室构想';
  await idea.fill(draft);
  await sidebar.click();
  await home.waitFor();
  await enterLab.click();
  if (await idea.inputValue() !== draft) throw new Error('返回后实验室构想丢失');

  const region = await title.evaluate(button => getComputedStyle(button).getPropertyValue('-webkit-app-region'));
  if (region !== 'no-drag') throw new Error('窗口拖动区域挡住了首页按钮');
  await title.press('Enter');
  await home.waitFor();
  await project.click();
  await manuscript.waitFor();
  await page.getByRole('button', { name: '创作任务', exact: true }).click();

  const request = page.getByRole('textbox', { name: '写作任务' });
  const unsent = '离线导航检查：未发送的写作要求';
  await request.fill(unsent);
  await title.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/当前任务输入尚未发送/).waitFor();
  await dialog.getByRole('button', { name: '取消' }).click();
  if (await request.inputValue() !== unsent) throw new Error('取消返回后写作要求丢失');

  await sidebar.click();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await home.waitFor();
  await project.click();
  await manuscript.waitFor();
  await title.click();
  await home.waitFor();
}
