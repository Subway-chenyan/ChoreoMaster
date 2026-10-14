import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { artifactContract } from './release-contract.mjs';

export async function restoreRelease({ version, commit, request = fetch, outputDir = 'android-release' }) {
  const expected = artifactContract('stable', version, commit);
  const base = expected.url.slice(0, expected.url.lastIndexOf('/') + 1);
  const response = await request(`${base}manifest.json`, {
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 404) return false;
    throw new Error(`Existing APK lookup failed: ${response.status}`);
  }
  // beat.cosdrama.cn 是 SPA 静态站：对象缺失时回退返回 200 的 index.html 而不是 404；
  // 只有能解析成 manifest 的响应才代表同一版本已发布，误判交由 publish 的不可变预检兜底。
  let manifest;
  try {
    manifest = await response.json();
  } catch {
    return false;
  }
  for (const [key, value] of Object.entries(expected))
    if (manifest[key] !== value) throw new Error(`Existing APK metadata mismatch: ${key}`);
  if (
    !/^[0-9a-f]{64}$/.test(manifest.sha256) ||
    !Number.isInteger(manifest.size) ||
    manifest.size <= 0 ||
    manifest.size > 512 * 1024 * 1024
  )
    throw new Error('Invalid existing APK manifest');
  const download = await request(expected.url, { signal: AbortSignal.timeout(120000) });
  if (!download.ok) throw new Error(`Existing APK download failed: ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
    throw new Error('Existing APK hash mismatch');
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/${expected.name}`, bytes);
  await writeFile(`${outputDir}/${expected.name}.sha256`, `${manifest.sha256}  ${expected.name}\n`);
  await writeFile(`${outputDir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const restored = await restoreRelease({ version, commit: process.env.GITHUB_SHA });
  if (restored) console.log('Restored immutable APK for the same source commit');
  else console.log('No published APK for this version and commit; building fresh');
}
