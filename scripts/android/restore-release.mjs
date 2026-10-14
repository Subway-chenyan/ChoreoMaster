import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { artifactContract } from './release-contract.mjs';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const expected = artifactContract('stable', version, process.env.GITHUB_SHA);
const base = expected.url.slice(0, expected.url.lastIndexOf('/') + 1);
const response = await fetch(`${base}manifest.json`, {
  signal: AbortSignal.timeout(30000),
  cache: 'no-store',
});
if (response.status === 404) process.exit(0);
if (!response.ok) throw new Error(`Existing APK lookup failed: ${response.status}`);
const manifest = await response.json();
for (const [key, value] of Object.entries(expected))
  if (manifest[key] !== value) throw new Error(`Existing APK metadata mismatch: ${key}`);
if (
  !/^[0-9a-f]{64}$/.test(manifest.sha256) ||
  !Number.isInteger(manifest.size) ||
  manifest.size <= 0 ||
  manifest.size > 512 * 1024 * 1024
)
  throw new Error('Invalid existing APK manifest');
const download = await fetch(expected.url, { signal: AbortSignal.timeout(120000) });
if (!download.ok) throw new Error(`Existing APK download failed: ${download.status}`);
const bytes = Buffer.from(await download.arrayBuffer());
if (bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
  throw new Error('Existing APK hash mismatch');
await mkdir('android-release', { recursive: true });
await writeFile(`android-release/${expected.name}`, bytes);
await writeFile(`android-release/${expected.name}.sha256`, `${manifest.sha256}  ${expected.name}\n`);
await writeFile('android-release/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Restored immutable APK for the same source commit');
