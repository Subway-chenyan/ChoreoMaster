import { test, expect, type Page } from '@playwright/test';

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cosstage-mobile', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise<
      Array<{
        id: string;
        document: { name: string; frames: Array<{ positions: Record<string, { x: number; y: number }> }> };
      }>
    >((resolve, reject) => {
      const request = db.transaction('projects').objectStore('projects').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return entries;
  });
}
async function create(page: Page) {
  await page.goto('/?mobile=1');
  await page.getByRole('button', { name: '新建编排', exact: true }).click();
  await page.getByLabel('编排名', { exact: true }).fill('夏夜排练');
  await page.getByLabel('初始演员人数').fill('4');
  await page.getByRole('button', { name: '进入舞台' }).click();
  await expect(page.getByLabel('舞台编辑区域', { exact: true })).toBeVisible();
  await expect(page.getByText('已保存在本机', { exact: false }).first()).toBeVisible();
}

test('touch editing, pinch cancellation, undo, landscape, offline persistence and file interchange', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page);
  const first = page.locator('[data-performer-id]').first();
  const actorId = await first.getAttribute('data-performer-id');
  if (!actorId) throw new Error('演员未挂载');
  const original = (await stored(page))[0].document.frames[0].positions[actorId];
  let box = await first.boundingBox();
  if (!box) throw new Error('演员没有尺寸');
  const session = await page.context().newCDPSession(page);
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Array<{ x: number; y: number; id: number }>
  ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  await touch('touchStart', [start]);
  await touch('touchMove', [{ ...start, x: start.x + 35, y: start.y + 25 }]);
  await touch('touchEnd', []);
  await expect
    .poll(async () => (await stored(page))[0].document.frames[0].positions[actorId])
    .not.toEqual(original);
  const moved = (await stored(page))[0].document.frames[0].positions[actorId];
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await stored(page))[0].document.frames[0].positions[actorId])
    .toEqual(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0].document.frames[0].positions[actorId]).toEqual(moved);
  box = await first.boundingBox();
  if (!box) throw new Error('演员没有尺寸');
  const a = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  const b = { x: a.x + 100, y: a.y + 50, id: 2 };
  await touch('touchStart', [a]);
  await touch('touchMove', [{ ...a, x: a.x + 8 }]);
  await touch('touchStart', [{ ...a, x: a.x + 8 }, b]);
  await touch('touchMove', [
    { ...a, x: a.x - 20 },
    { ...b, x: b.x + 40 },
  ]);
  await touch('touchEnd', []);
  await expect
    .poll(() => page.locator('.stage-surface').evaluate((element: HTMLElement) => element.style.transform))
    .not.toContain('scale(1)');
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
  expect((await stored(page))[0].document.frames[0].positions[actorId]).toEqual(moved);
  await page.getByRole('button', { name: '重置舞台视角' }).click();
  await page.getByRole('button', { name: '复制当前队形' }).click();
  await expect.poll(async () => (await stored(page))[0].document.frames.length).toBe(2);
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect(page.getByRole('button', { name: '暂停排练' })).toBeVisible();
  await page.getByRole('button', { name: '暂停排练' }).click();
  await page.getByRole('button', { name: '队形 1 开场', exact: true }).click();
  await page.screenshot({ path: info.outputPath('mobile-portrait.png'), fullPage: true });
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByRole('button', { name: '播放排练' })).toBeInViewport();
  await expect(first).toBeInViewport();
  await page.screenshot({ path: info.outputPath('mobile-landscape.png'), fullPage: true });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.getByRole('button', { name: '项目与分享', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '分享完整项目包' }).click();
  const download = await downloadEvent;
  const exported = info.outputPath('mobile.zip');
  await download.saveAs(exported);
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '返回项目库' }).click();
  await expect(page.getByText('夏夜排练', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText('夏夜排练', { exact: true }).click();
  expect((await stored(page))[0].document.frames[0].positions[actorId]).toEqual(moved);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '复制当前队形' }).click();
  await expect.poll(async () => (await stored(page))[0].document.frames.length).toBe(3);
  await page.getByRole('button', { name: '返回项目库' }).click();
  await page.context().setOffline(false);
  await page.getByLabel('导入桌面项目包').setInputFiles(exported);
  await expect(page.getByLabel('舞台编辑区域', { exact: true })).toBeVisible();
  expect(await stored(page)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('invalid import retains existing library and portrait layout fits narrow phones', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await create(page);
  await expect(page.getByRole('button', { name: '移动', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '编辑时长与备注' }).click();
  await page.getByLabel('保持时长（秒）').fill('');
  await page.getByLabel('保持时长（秒）').fill('12.5');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '编辑时长与备注' }).click();
  await expect(page.getByLabel('保持时长（秒）')).toHaveValue('12.5');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '返回项目库' }).click();
  await page
    .getByLabel('导入桌面项目包')
    .setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('项目包不完整');
  expect(await stored(page)).toHaveLength(1);
  await expect(page.getByText('夏夜排练', { exact: true })).toBeVisible();
});

test('multi-select moves actors together, locks hold, and failed asset saves recover atomically', async ({
  page,
}) => {
  await create(page);
  await page.getByRole('button', { name: '吸附到网格' }).click();
  const actors = page.locator('[data-performer-id]');
  const ids = await actors.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-performer-id') ?? '')
  );
  await page.getByRole('button', { name: '多选', exact: true }).click();
  await actors.nth(0).tap();
  await actors.nth(3).tap();
  await expect(page.getByText('已选 2 人')).toBeVisible();
  await page.getByRole('button', { name: '移动', exact: true }).click();
  const before = (await stored(page))[0].document.frames[0].positions;
  const box = await actors.first().boundingBox();
  if (!box) throw new Error('演员没有尺寸');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 38, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await stored(page))[0].document.frames[0].positions[ids[0]])
    .not.toEqual(before[ids[0]]);
  const after = (await stored(page))[0].document.frames[0].positions;
  expect(after[ids[0]].y - before[ids[0]].y).toBeCloseTo(after[ids[3]].y - before[ids[3]].y, 5);
  expect(after[ids[1]]).toEqual(before[ids[1]]);
  await page.getByRole('button', { name: '演员', exact: true }).click();
  await page.getByRole('button', { name: '演员 1', exact: true }).click();
  await page.getByLabel('锁定演员位置').check();
  await page.getByRole('button', { name: '关闭面板' }).click();
  const lockedBox = await actors.first().boundingBox();
  if (!lockedBox) throw new Error('演员没有尺寸');
  await page.mouse.move(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lockedBox.x + lockedBox.width / 2 + 35, lockedBox.y + lockedBox.height / 2 + 30);
  await page.mouse.up();
  expect((await stored(page))[0].document.frames[0].positions[ids[0]]).toEqual(after[ids[0]]);

  // 模拟 IndexedDB 的真实写入边界失败，不替换 UI 的保存状态。
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (sessionStorage.getItem('test-quota') === 'full')
        throw new DOMException('测试存储空间不足', 'QuotaExceededError');
      return original.apply(this, args);
    };
    sessionStorage.setItem('test-quota', 'full');
  });
  const wave = Buffer.alloc(44 + 8000 * 2);
  wave.write('RIFF');
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(wave.length - 44, 40);
  await page
    .getByLabel('选择音乐文件')
    .setInputFiles({ name: '排练.wav', mimeType: 'audio/wav', buffer: wave });
  await expect(page.getByRole('button', { name: /本机保存失败/ })).toBeVisible();
  if (await page.getByRole('button', { name: '关闭提示' }).isVisible())
    await page.getByRole('button', { name: '关闭提示' }).click();
  await page.getByRole('button', { name: '返回项目库' }).click();
  await expect(page.getByLabel('舞台编辑区域', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('test-quota'));
  if (await page.getByRole('button', { name: '关闭提示' }).isVisible())
    await page.getByRole('button', { name: '关闭提示' }).click();
  // 普通文档修改也必须重试前次未保存的素材。
  await page.getByRole('button', { name: '项目与分享', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('恢复后的排练');
  await expect(page.getByText('已保存在本机', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect(page.getByRole('button', { name: '暂停排练' })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.05);
  await page.getByRole('button', { name: '暂停排练' }).click();
  await page.getByRole('button', { name: '返回项目库' }).click();
  await page.reload();
  await page.getByText('恢复后的排练', { exact: true }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByText(/缺少素材/)).toHaveCount(0);
});

test('desktop browser still opens the original editor', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    isMobile: false,
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.locator('.stage-surface')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.mobile-app')).toHaveCount(0);
  await context.close();
});
