import { test, expect, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { createMobileDocument, addActor } from '../../mobile/editor-model';

function packageFile(missingMusic = false) {
  let doc = createMobileDocument('团员练习', () => 'opening');
  doc = addActor(doc, {
    id: 'lead',
    name: '领舞',
    label: 'A',
    shape: 'circle',
    color: '#38bdf8',
    type: 'performer',
  });
  doc = addActor(doc, {
    id: 'mate',
    name: '团员',
    label: 'B',
    shape: 'circle',
    color: '#34d399',
    type: 'performer',
  });
  doc.frames = Array.from({ length: 8 }, (_, i) => ({
    id: `f${i}`,
    name: `站位 ${i + 1}`,
    startTime: i * 2000,
    duration: 1000,
    positions: {
      lead: { x: 20 + i * 8, y: 30 + i * 5 },
      mate: { x: 70 - i * 4, y: 70 - i * 3 },
    },
    notes: `第 ${i + 1} 段：向舞台右侧移动\n注意与前排保持距离`,
  }));
  doc.musicAsset = 'assets/music.wav';
  doc.stageConfig.background = {
    value: 'assets/background.png',
    opacity: 1,
  } as typeof doc.stageConfig.background;
  const wav = Buffer.alloc(44 + 8000 * 2 * 16);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(doc)),
    'assets/background.png': new Uint8Array([9]),
    'assets/model.glb': new Uint8Array([8]),
  };
  if (!missingMusic) files['assets/music.wav'] = wav;
  return { name: 'rehearsal.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) };
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('cosstage-mobile', 1);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['projects', 'assets']);
    const read = (store: string) =>
      new Promise<unknown[]>((resolve) => {
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
      });
    const [projects, assets] = await Promise.all([read('projects'), read('assets')]);
    db.close();
    return { projects, assetNames: Object.keys(assets[0] as object) };
  });
}

test('read-only rehearsal: selective import, navigation, music, notes, rotation and reopen', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/?mobile=1');
  await page.getByLabel('导入团员排练包').setInputFiles(packageFile());
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  const original = await stored(page);
  expect(original.assetNames).toEqual(['assets/music.wav']);
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 1 段');
  await expect(page.getByRole('button', { name: '上一队形' })).toBeDisabled();
  await page.getByRole('button', { name: '下一队形' }).click();
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 2 段');
  await page.getByRole('button', { name: '队形 8 站位 8', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一队形' })).toBeDisabled();
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 8 段');
  await page.getByRole('button', { name: '队形 2 站位 2', exact: true }).click();
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect
    .poll(() =>
      page.locator('audio').evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 2)
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: '队形 3 站位 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 3 段');
  await page.getByRole('button', { name: '暂停排练' }).click();
  const box = await page.locator('[data-performer-id]').first().boundingBox();
  if (!box) throw new Error('演员不可见');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await page.getByRole('button', { name: '重置舞台视角' }).click();
  expect(await stored(page)).toEqual(original);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  const width = (await page.locator('.rehearsal-stage').boundingBox())?.width ?? 0;
  await page.getByRole('button', { name: '收起队形列表' }).click();
  expect((await page.locator('.rehearsal-stage').boundingBox())?.width).toBeGreaterThan(width + 100);
  await expect(page.getByRole('region', { name: '当前队形备注' })).not.toBeVisible();
  await expect(page.locator('.rehearsal-header')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '展开队形列表' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '播放排练' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '上一队形' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '下一队形' })).toBeInViewport();
  await page.getByRole('button', { name: '展开队形列表' }).click();
  await page.screenshot({ path: info.outputPath('rehearsal-landscape.png'), scale: 'css' });
  await page.setViewportSize({ width: 360, height: 640 });
  for (const name of ['播放排练', '上一队形', '下一队形'])
    await expect(page.getByRole('button', { name })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('rehearsal-portrait.png'), scale: 'css' });
  await page.getByRole('button', { name: '返回项目库' }).click();
  await page.reload();
  await page.getByRole('button', { name: /团员练习.*只读排练/ }).click();
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '下一队形' }).click();
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 2 段');
  expect(await stored(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test('display settings and performer perspective persist across reopen', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/?mobile=1');
  await page.getByLabel('导入团员排练包').setInputFiles(packageFile());
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  // 默认演员视角：平面 180° 点镜像，文字元素保持正向
  const surface = page.locator('.stage-surface');
  await expect(surface).toHaveAttribute('style', /rotate\(180deg\)/);
  const label = page.locator('.stage-surface').getByText('领舞', { exact: true });
  await expect(label).toBeVisible();
  const dot = page.locator('[data-performer-id]').first();
  const setScale = async (percent: number) => {
    await page.getByRole('button', { name: '显示设置' }).click();
    const dialog = page.getByRole('dialog', { name: '显示设置' });
    await expect(dialog).toBeVisible();
    // React 受控 range 需要走原生 value setter 才会触发 onChange
    await dialog.getByLabel(/人物大小/).evaluate((element: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(percent));
    await expect(dialog.getByText(`人物大小 ${percent}%`)).toBeVisible();
    await page.getByRole('button', { name: '关闭显示设置' }).click();
    await expect(dialog).toHaveCount(0);
  };
  await setScale(200);
  const enlarged = (await dot.boundingBox())?.width ?? 0;
  await setScale(100);
  const base = (await dot.boundingBox())?.width ?? 0;
  expect(base).toBeGreaterThan(0);
  expect(enlarged).toBeGreaterThan(base * 1.5);
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByRole('dialog', { name: '显示设置' }).getByRole('switch', { name: '显示名字' }).click();
  await expect(label).toHaveCount(0);
  await page.getByRole('button', { name: '关闭显示设置' }).click();
  await page.getByRole('button', { name: '切换到导演视角' }).click();
  await expect(surface).not.toHaveAttribute('style', /rotate\(180deg\)/);
  await page.getByRole('button', { name: '返回项目库' }).click();
  await page.reload();
  await page.getByRole('button', { name: /团员练习.*只读排练/ }).click();
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  await expect(surface).not.toHaveAttribute('style', /rotate\(180deg\)/);
  await expect(page.locator('.stage-surface').getByText('领舞', { exact: true })).toHaveCount(0);
  // 重开后设置保留：人物大小回 100%、名字隐藏、导演视角
  await page.getByRole('button', { name: '显示设置' }).click();
  const reopened = page.getByRole('dialog', { name: '显示设置' });
  await expect(reopened.getByText('人物大小 100%')).toBeVisible();
  await expect(reopened.getByRole('switch', { name: '显示名字' })).toHaveAttribute('aria-checked', 'false');
});

test('tapping a performer keeps a highlight across formations; collapsed toast announces them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/?mobile=1');
  await page.getByLabel('导入团员排练包').setInputFiles(packageFile());
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  const dots = page.locator('[data-performer-id]');
  const ringOf = (index: number) => dots.nth(index).locator('.animate-pulse');
  await dots.first().click();
  await expect(ringOf(0)).toHaveCount(1);
  // 轻点其他演员切换高亮
  await dots.nth(1).click();
  await expect(ringOf(0)).toHaveCount(0);
  await expect(ringOf(1)).toHaveCount(1);
  // 高亮跨队形保持
  await page.getByRole('button', { name: '下一队形' }).click();
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 2 段');
  await expect(ringOf(1)).toHaveCount(1);
  // 再点同一演员取消高亮
  await dots.nth(1).click();
  await expect(ringOf(1)).toHaveCount(0);
  // 收起态：队形切换时右上角提示队形名，2 秒后消失
  await page.getByRole('button', { name: '收起队形列表' }).click();
  const toast = page.locator('.rehearsal-toast');
  await expect(toast).toContainText('2. 站位 2');
  await page.getByRole('button', { name: '下一队形' }).click();
  await expect(toast).toContainText('3. 站位 3');
  await page.waitForTimeout(2300);
  await expect(toast).toHaveCount(0);
  // 高亮状态不收起后仍在
  await page.getByRole('button', { name: '展开队形列表' }).click();
  await expect(ringOf(1)).toHaveCount(0);
});

test('play after jumping to a formation starts at its end to skip the hold', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/?mobile=1');
  // 拦截 play() 记录每次开播时音频被设置的起点：断言起播时间本身，不受 CI 音频启动时延影响
  await page.evaluate(() => {
    const state = window as unknown as { playStarts: number[] };
    state.playStarts = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      state.playStarts.push(this.currentTime);
      return original.call(this);
    };
  });
  await page.getByLabel('导入团员排练包').setInputFiles(packageFile());
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  const lastPlayStart = () =>
    page.evaluate(() => (window as unknown as { playStarts: number[] }).playStarts.at(-1));
  // 跳到队形 2（2s–3s）后按播放：应从 3s 的过渡起点开播，而不是重播持场
  await page.getByRole('button', { name: '队形 2 站位 2', exact: true }).click();
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect.poll(lastPlayStart).toBeGreaterThan(2.8);
  await page.getByRole('button', { name: '暂停排练' }).click();
  // 拖动进度条清除跳过意图后播放：从所选时间开始
  await page.getByLabel('排练进度').evaluate((element: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, '0');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect.poll(lastPlayStart).toBeLessThan(0.5);
  await page.getByRole('button', { name: '暂停排练' }).click();
});

test('missing music still permits silent read-only rehearsal', async ({ page }) => {  await page.goto('/?mobile=1');
  await page.getByLabel('导入团员排练包').setInputFiles(packageFile(true));
  await expect(page.getByRole('status')).toContainText('未找到编排引用的音乐');
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect(page.getByRole('button', { name: '暂停排练' })).toBeVisible();
  await page.getByRole('button', { name: '下一队形' }).click();
  await expect(page.getByRole('region', { name: '当前队形备注' })).toContainText('第 2 段');
  await expect(page.getByRole('button', { name: '播放排练' })).toBeVisible();
});

test('late play completion cannot interrupt a newer rehearsal playback', async ({ page }) => {
  await page.goto('/?mobile=1');
  await page.getByLabel('导入团员排练包').setInputFiles(packageFile());
  await expect(page.getByText('团员排练 · 只读', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = window as unknown as { pendingPlays: Array<() => void> };
    state.pendingPlays = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const ready = original.call(this);
      return new Promise<void>((resolve, reject) => {
        ready.then(() => state.pendingPlays.push(resolve), reject);
      });
    };
  });
  const pendingCount = () =>
    page.evaluate(() => (window as unknown as { pendingPlays: unknown[] }).pendingPlays.length);
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect.poll(pendingCount).toBe(1);
  await page.getByRole('button', { name: '下一队形' }).click();
  await page.getByRole('button', { name: '播放排练' }).click();
  await expect.poll(pendingCount).toBe(2);
  await page.evaluate(() => (window as unknown as { pendingPlays: Array<() => void> }).pendingPlays[1]());
  await expect(page.getByRole('button', { name: '暂停排练' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { pendingPlays: Array<() => void> }).pendingPlays[0]());
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => !audio.paused))
    .toBe(true);
  await page.getByRole('button', { name: '暂停排练' }).click();
});
