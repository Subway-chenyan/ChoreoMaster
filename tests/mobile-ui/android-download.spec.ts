import { test, expect } from '@playwright/test';
const manifestUrl = 'https://beat.cosdrama.cn/downloads/android/latest.json';
const url = 'https://beat.cosdrama.cn/downloads/android/releases/1.4.0/CosStage-1.4.0.apk';
test('web and Windows shared UI exposes only published Android downloads', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    isMobile: false,
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.route(manifestUrl, (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        channel: 'stable',
        applicationId: 'com.cosstage.mobile',
        version: '1.4.0',
        url,
        sha256: 'a'.repeat(64),
      },
    })
  );
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByRole('link', { name: '安卓下载', exact: true })).toHaveAttribute('href', url);
  await page.getByRole('button', { name: '我知道了', exact: true }).click();
  await page.getByRole('button', { name: '产品指南', exact: true }).click();
  await expect(page.getByRole('link', { name: '下载 Android · v1.4.0', exact: true })).toHaveAttribute(
    'href',
    url
  );
  await context.close();
});
test('unpublished Android release never offers a broken download link', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    isMobile: false,
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.route(manifestUrl, (route) => route.fulfill({ status: 404, body: 'Not Found' }));
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByLabel('安卓版待发布', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '安卓下载', exact: true })).toHaveCount(0);
  await context.close();
});
