import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAndroidDownloadUrl,
  parseAndroidDownload,
  ANDROID_DOWNLOAD_URL,
} from '../electron/android-download.ts';
test('Android downloads only accept verified stable metadata and exact public APK URLs', () => {
  const value = {
    schemaVersion: 1,
    channel: 'stable',
    applicationId: 'com.cosstage.mobile',
    version: '1.4.0',
    url: 'https://beat.cosdrama.cn/downloads/android/releases/1.4.0/CosStage-1.4.0.apk',
    sha256: 'a'.repeat(64),
  };
  assert.deepEqual(parseAndroidDownload(value), { version: value.version, url: value.url });
  assert.ok(isAndroidDownloadUrl(value.url));
  assert.ok(isAndroidDownloadUrl(ANDROID_DOWNLOAD_URL));
  for (const url of [
    'file:///tmp/x.apk',
    'https://evil.test/x.apk',
    value.url + '?redirect=evil',
    value.url.replace('1.4.0.apk', '1.4.1.apk'),
  ]) {
    assert.equal(isAndroidDownloadUrl(url), false);
    assert.equal(parseAndroidDownload({ ...value, url }), null);
  }
  assert.equal(parseAndroidDownload({ ...value, channel: 'preview' }), null);
  assert.equal(parseAndroidDownload({ ...value, sha256: 'bad' }), null);
});
