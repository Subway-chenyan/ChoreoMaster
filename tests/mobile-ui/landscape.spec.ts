import { test, expect, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/?mobile=1');
  await page.getByRole('button', { name: '新建编排', exact: true }).click();
  await page.getByLabel('编排名', { exact: true }).fill('横屏排练');
  await page.getByLabel('初始演员人数').fill('4');
  await page.getByRole('button', { name: '进入舞台' }).click();
  await expect(page.locator('.stage-surface')).toBeVisible();
}

async function documentState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('cosstage-mobile', 1);
      request.onsuccess = () => resolve(request.result);
    });
    const entries = await new Promise<
      Array<{
        document: { frames: Array<{ id: string; positions: Record<string, { x: number; y: number }> }> };
      }>
    >((resolve) => {
      const request = db.transaction('projects').objectStore('projects').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return entries[0].document;
  });
}

for (const viewport of [
  { width: 640, height: 360 },
  { width: 812, height: 375 },
  { width: 915, height: 412 },
]) {
  test(`landscape ${viewport.width}x${viewport.height}: rails, navigation, collapse and rotation`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await create(page);
    for (const name of ['移动', '多选', '平移', '演员', '舞台', '复制当前队形', '播放排练', '收起队形栏']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport();
    }
    const stageBefore = await page.locator('.mobile-editor__stage').boundingBox();
    const tools = await page.getByRole('navigation', { name: '舞台工具' }).boundingBox();
    expect(stageBefore && tools && tools.x + tools.width <= stageBefore.x + 1).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: '复制当前队形' }).click();
    await expect.poll(async () => (await documentState(page)).frames.length).toBe(9);
    await expect(page.locator('.mobile-frame[aria-pressed="true"]')).toBeInViewport({ ratio: 0.95 });
    const before = await documentState(page);
    await page.getByRole('button', { name: '收起队形栏' }).click();
    await expect(page.getByRole('button', { name: '播放排练' })).toBeInViewport();
    await expect(page.getByRole('button', { name: '下一队形' })).toBeInViewport();
    const stageAfter = await page.locator('.mobile-editor__stage').boundingBox();
    expect(stageAfter && stageBefore && stageAfter.width > stageBefore.width + 100).toBeTruthy();
    expect(await documentState(page)).toEqual(before);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(async () => (await documentState(page)).frames.length).toBe(8);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect.poll(async () => (await documentState(page)).frames.length).toBe(9);
    await page.setViewportSize({ width: 360, height: 640 });
    await expect(page.locator('.mobile-frame[aria-pressed="true"]')).toBeInViewport({ ratio: 0.95 });
    await expect(page.getByRole('button', { name: '复制当前队形' })).toBeInViewport();
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '展开队形栏' })).toBeVisible();
    await page.getByRole('button', { name: '展开队形栏' }).click();
    await expect(page.locator('.mobile-frame[aria-pressed="true"]')).toBeInViewport({ ratio: 0.95 });
    await page.screenshot({ path: info.outputPath(`landscape-${viewport.width}.png`), scale: 'css' });
    await page.getByRole('button', { name: /^队形 9 / }).click();
    // Scrubbing must offer an explicit edit action for the displayed formation.
    await page.getByRole('slider', { name: '播放位置' }).focus();
    await page.getByRole('slider', { name: '播放位置' }).press('Home');
    await expect(page.getByRole('button', { name: '编辑当前队形' })).toBeVisible();
    await page.getByRole('button', { name: '编辑当前队形' }).click();
    await expect(page.getByRole('button', { name: '队形 1 开场', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('button', { name: '复制当前队形' })).toBeEnabled();
  });
}

test('precision actions, side drawer focus and portrait keyboard-sized layout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 915, height: 412 });
  await create(page);
  const actor = page.locator('[data-performer-id]').first();
  const id = await actor.getAttribute('data-performer-id');
  if (!id) throw new Error('Missing actor');
  const before = await documentState(page);
  await actor.tap();
  const client = await page.context().newCDPSession(page);
  const actorBox = await actor.boundingBox();
  if (!actorBox) throw new Error('Missing actor bounds');
  const point = { x: actorBox.x + actorBox.width / 2, y: actorBox.y + actorBox.height / 2, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...point, x: point.x + 3 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // A tap with snapping enabled must not move an actor or create undo history.
  expect(await documentState(page)).toEqual(before);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  for (const name of ['向左微调', '向上微调', '向下微调', '向右微调', '清空选择'])
    await expect(page.getByRole('button', { name })).toBeInViewport();
  await page.getByRole('button', { name: '向右微调' }).click();
  await expect
    .poll(async () => (await documentState(page)).frames[0].positions[id].x)
    .toBeCloseTo(before.frames[0].positions[id].x + (0.1 / 14) * 100, 6);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await documentState(page)).frames[0].positions[id])
    .toEqual(before.frames[0].positions[id]);
  await page.getByRole('button', { name: '编辑所选演员' }).click();
  const dialog = page.getByRole('dialog', { name: '演员与选择' });
  const box = await dialog.boundingBox();
  expect(box && box.x > 400 && box.width < 420).toBeTruthy();
  await page.getByLabel('姓名', { exact: true }).fill('领舞 A');
  await expect(page.getByRole('button', { name: '关闭面板' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('landscape-drawer.png'), scale: 'css' });
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect(page.getByRole('button', { name: '编辑所选演员' })).toBeFocused();
  await page.getByRole('button', { name: '清空选择' }).click();
  await page.getByRole('button', { name: '多选', exact: true }).click();
  await page.locator('[data-performer-id]').nth(0).tap();
  await page.locator('[data-performer-id]').nth(3).tap();
  await page.getByRole('button', { name: '完成多选' }).click();
  await expect(page.getByRole('button', { name: '移动', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByText('已选 2 人', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '微调步长 0.1 米，点击切换' }).click();
  await expect(page.getByRole('button', { name: '微调步长 0.5 米，点击切换' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('landscape-selection.png'), scale: 'css' });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.getByRole('button', { name: '向右微调' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '清空选择' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('portrait-selection.png'), scale: 'css' });
  await page.setViewportSize({ width: 360, height: 300 });
  expect(await page.getByRole('button', { name: '收起队形栏' }).isVisible()).toBe(false);
  expect(errors).toEqual([]);
});
