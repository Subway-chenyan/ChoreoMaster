import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import { androidVersionCode, artifactContract } from '../scripts/android/release-contract.mjs';
import { publishAndroid, isMissingCosObject } from '../scripts/android/publish.mjs';
test('COS missing objects are recognized on either stream without hiding permission or CLI failures', () => {
  assert.equal(isMissingCosObject({ stdout: 'Code: NoSuchKey' }), true);
  assert.equal(isMissingCosObject({ stderr: 'HTTP status: 404' }), true);
  assert.equal(isMissingCosObject({ stderr: 'HTTP status: 403 AccessDenied' }), false);
  assert.equal(isMissingCosObject({ stderr: 'coscli: command not found' }), false);
  assert.equal(isMissingCosObject({ code: 'ENOENT' }), false);
});
const sha = 'a'.repeat(40);
function fixture(channel = 'stable', version = '1.4.0') {
  const apk = Buffer.from('signed APK test bytes');
  const manifest = {
    ...artifactContract(channel, version, sha, '123-1'),
    size: apk.length,
    sha256: createHash('sha256').update(apk).digest('hex'),
  };
  const storage = new Map();
  const writes = [];
  return {
    manifest,
    apk,
    sidecar: Buffer.from(`${manifest.sha256}  ${manifest.name}\n`),
    storage,
    writes,
    cos: {
      read: async (key) => storage.get(key) ?? null,
      put: async (key, value, immutable) => {
        if (immutable && storage.has(key)) throw new Error('exists');
        storage.set(key, value);
        writes.push(key);
      },
    },
    verify: async () => {},
    purge: async () => {},
  };
}
test('Android codes follow semantic version order and stay within Android limits', () => {
  assert.equal(androidVersionCode('1.3.2'), 1003002);
  assert.ok(androidVersionCode('2.0.0') > androidVersionCode('1.999.999'));
  for (const invalid of ['1.0', '1.0.0-beta', '1.1000.0', '1.0.1000', '2101.0.0', '0.0.0', '01.0.1'])
    assert.throws(() => androidVersionCode(invalid));
  assert.notEqual(
    artifactContract('preview', '1.4.0', sha, '123-1').path,
    artifactContract('preview', '1.4.0', sha, '123-2').path
  );
});
test('stable publishes immutable bytes before pointers, safely retries identical content', async () => {
  const f = fixture();
  await publishAndroid(f);
  assert.equal(f.writes.at(-1), 'downloads/android/latest.json');
  assert.ok(f.writes.indexOf(f.manifest.path) < f.writes.indexOf('downloads/CosStage-Android.apk'));
  await publishAndroid(f);
  assert.deepEqual(JSON.parse(f.storage.get('downloads/android/latest.json')), f.manifest);
});
test('preview only writes isolated immutable objects', async () => {
  const f = fixture('preview');
  await publishAndroid(f);
  assert.ok(f.writes.every((p) => p.startsWith(`downloads/android/preview/${sha}/123-1/`)));
});
test('hash failure, immutable collision and public verification failure cannot advance stable', async () => {
  const corrupt = fixture();
  corrupt.apk = Buffer.from('bad');
  await assert.rejects(publishAndroid(corrupt), /integrity/);
  assert.equal(corrupt.writes.length, 0);
  const collision = fixture();
  collision.storage.set(collision.manifest.path, Buffer.from('old'));
  await assert.rejects(publishAndroid(collision), /differs/);
  assert.equal(collision.writes.length, 0);
  const unavailable = fixture();
  unavailable.verify = async () => {
    throw new Error('CDN unavailable');
  };
  await assert.rejects(publishAndroid(unavailable), /CDN/);
  assert.equal(unavailable.storage.has('downloads/android/latest.json'), false);
});
test('stable rejects rollback and same version from a different commit', async () => {
  const f = fixture();
  f.storage.set('downloads/android/latest.json', Buffer.from(JSON.stringify({ version: '2.0.0' })));
  await assert.rejects(publishAndroid(f), /downgrade/);
  f.storage.set(
    'downloads/android/latest.json',
    Buffer.from(JSON.stringify({ ...f.manifest, commit: 'b'.repeat(40) }))
  );
  await assert.rejects(publishAndroid(f), /different content/);
  assert.equal(f.writes.length, 0);
});
test('uncertain immutable upload recovers only identical remote bytes', async () => {
  const f = fixture();
  const put = f.cos.put;
  f.cos.put = async (...args) => {
    await put(...args);
    if (args[2]) throw new Error('lost response');
  };
  await publishAndroid(f);
  assert.ok(f.storage.has('downloads/android/latest.json'));
});
test('Android CI covers mobile changes, isolates PR secrets and gates stable publishing', async () => {
  const read = async (name) =>
    load(await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'));
  const preview = await read('android.yml');
  assert.deepEqual(preview.on.push.branches, ['main']);
  for (const path of [
    'mobile/**',
    'components/mobile/**',
    'types.ts',
    'android/**',
    'package*.json',
    'utils/**',
  ])
    assert.ok(preview.on.push.paths.includes(path));
  assert.equal(preview.jobs.build.secrets, undefined);
  assert.match(preview.jobs['publish-preview'].if, /!= 'pull_request'/);
  assert.match(preview.jobs['publish-preview'].if, /refs\/heads\/main/);
  const release = await read('desktop-release.yml');
  assert.equal(release.jobs['build-android'].with.channel, 'stable');
  assert.ok(release.jobs.publish.needs.includes('build-android'));
  assert.ok(release.jobs.publish.steps.find((s) => s.run === 'node scripts/android/publish.mjs'));
  const build = await read('android-build.yml');
  assert.equal(build.on.workflow_call.inputs.channel.required, true);
  for (const step of build.jobs.apk.steps.filter((s) => s.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  assert.ok(build.jobs.apk.steps.find((s) => s.name === 'Remove signing material' && s.if === 'always()'));
});
