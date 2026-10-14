import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const ANDROID_BASE_URL = 'https://beat.cosdrama.cn/downloads/android/';
export function androidVersionCode(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected x.y.z version');
  const [major, minor, patch] = version.split('.').map(Number);
  const code = major * 1000000 + minor * 1000 + patch;
  if (minor > 999 || patch > 999 || !Number.isSafeInteger(code) || code < 1 || code > 2100000000)
    throw new Error('Android versionCode out of range');
  return code;
}
export function artifactContract(channel, version, commit, runId) {
  const versionCode = androidVersionCode(version);
  if (!['stable', 'preview'].includes(channel) || !/^[a-f0-9]{40}$/.test(commit))
    throw new Error('Invalid Android release context');
  if (channel === 'preview' && !/^[1-9]\d*(?:-[1-9]\d*)?$/.test(runId))
    throw new Error('Invalid preview run ID');
  const name = channel === 'stable' ? `CosStage-${version}.apk` : 'CosStage-preview.apk';
  const prefix = channel === 'stable' ? `releases/${version}` : `preview/${commit}/${runId}`;
  return {
    schemaVersion: 1,
    channel,
    version,
    versionCode,
    commit,
    applicationId: channel === 'stable' ? 'com.cosstage.mobile' : 'com.cosstage.mobile.preview',
    name,
    path: `downloads/android/${prefix}/${name}`,
    url: `${ANDROID_BASE_URL}${prefix}/${name}`,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [channel, apk, output] = process.argv.slice(2);
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const contract = artifactContract(
    channel,
    version,
    process.env.GITHUB_SHA,
    `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  );
  const bytes = await readFile(apk);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/${contract.name}`, bytes);
  await writeFile(`${output}/${contract.name}.sha256`, `${sha256}  ${contract.name}\n`);
  await writeFile(
    `${output}/manifest.json`,
    JSON.stringify({ ...contract, sha256, size: bytes.length }, null, 2) + '\n'
  );
}
