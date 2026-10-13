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
  doc.frames = Array.from({ length: 8 }, (_, i) => ({
    id: `f${i}`,
    name: `站位 ${i + 1}`,
    startTime: i * 2000,
    duration: 1000,
    positions: { lead: { x: 20 + i * 8, y: 30 + i * 5 } },
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
  await expect(page.getByRole('button', { name: '播放排练' })).toBeInViewport();
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

test('missing music still permits silent read-only rehearsal', async ({ page }) => {
  await page.goto('/?mobile=1');
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
