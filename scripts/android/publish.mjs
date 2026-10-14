import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactContract, androidVersionCode } from './release-contract.mjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function isMissingCosObject(error) {
  // coscli 不同版本可能把服务端错误写到 stdout 或 stderr；权限/网络错误不能当成对象不存在。
  const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  return /\bNoSuchKey\b|HTTP[^0-9\n]*404\b|status[^0-9\n]*404\b|cos object not found:/i.test(output);
}
export function cosErrorDetails(error, secrets = []) {
  let detail = `${error.code ?? 'unknown'} ${error.stderr ?? ''} ${error.stdout ?? ''}`;
  for (const secret of secrets.filter(Boolean)) detail = detail.split(secret).join('[REDACTED]');
  return detail.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, '$1?[REDACTED]').slice(-2000);
}
export async function publishAndroid({ manifest, apk, sidecar, cos, verify, purge }) {
  const expected = artifactContract(
    manifest.channel,
    manifest.version,
    manifest.commit,
    manifest.channel === 'preview' ? manifest.path.split('/').at(-2) : undefined
  );
  for (const [key, value] of Object.entries(expected))
    if (manifest[key] !== value) throw new Error(`Invalid manifest ${key}`);
  if (
    hash(apk) !== manifest.sha256 ||
    apk.length !== manifest.size ||
    sidecar.toString() !== `${manifest.sha256}  ${manifest.name}\n`
  )
    throw new Error('APK integrity check failed');
  const stable = manifest.channel === 'stable';
  const pointer = 'downloads/android/latest.json';
  if (stable) {
    const previous = await cos.read(pointer);
    if (previous) {
      const old = JSON.parse(previous.toString());
      const previousCode = androidVersionCode(old.version);
      if (previousCode > manifest.versionCode) throw new Error('Refusing Android stable downgrade');
      if (
        previousCode === manifest.versionCode &&
        (old.commit !== manifest.commit || old.sha256 !== manifest.sha256)
      )
        throw new Error('Stable version already has different content');
    }
  }
  const metadata = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const manifestPath = manifest.path.slice(0, manifest.path.lastIndexOf('/') + 1) + 'manifest.json';
  const objects = [
    [manifest.path, apk],
    [manifest.path + '.sha256', sidecar],
    [manifestPath, metadata],
  ];
  // 先完整预检，再创建；重试只接受相同字节，不覆盖任何已发布版本。
  for (const [path, bytes] of objects) {
    const old = await cos.read(path);
    if (old && hash(old) !== hash(bytes)) throw new Error(`Immutable Android object differs: ${path}`);
  }
  for (const [path, bytes] of objects) {
    const old = await cos.read(path);
    if (!old) {
      try {
        await cos.put(path, bytes, true);
      } catch {
        const recovered = await cos.read(path);
        if (!recovered || hash(recovered) !== hash(bytes)) throw new Error(`Android upload failed: ${path}`);
      }
    }
    const stored = await cos.read(path);
    if (!stored || hash(stored) !== hash(bytes))
      throw new Error(`Android upload verification failed: ${path}`);
  }
  await purge(objects.map(([path]) => path));
  await verify(manifest.path, apk);
  if (stable) {
    await cos.put('downloads/CosStage-Android.apk', apk, false);
    await cos.put(pointer, metadata, false);
    await purge(['downloads/CosStage-Android.apk', pointer]);
    await verify('downloads/CosStage-Android.apk', apk);
    await verify(pointer, metadata);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? 'android-release';
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  // 在用 manifest.name 读取本地文件前约束名字。
  if (!/^CosStage-(?:\d+\.\d+\.\d+|preview)\.apk$/.test(manifest.name)) throw new Error('Invalid APK name');
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY)
    throw new Error('COS credentials missing');
  const args = ['--secret-id', process.env.TENCENT_SECRET_ID, '--secret-key', process.env.TENCENT_SECRET_KEY];
  const temp = await mkdtemp(join(tmpdir(), 'cosstage-android-'));
  const exec = promisify(execFile);
  let serial = 0;
  const cos = {
    async read(path) {
      const target = join(temp, String(serial++));
      try {
        await exec('coscli', ['cp', `cos://production/${path}`, target, ...args], { maxBuffer: 16 * 1024 * 1024 });
        return await readFile(target);
      } catch (error) {
        if (isMissingCosObject(error)) return null;
        throw new Error(`COS read failed: ${path}; ${cosErrorDetails(error, [process.env.TENCENT_SECRET_ID, process.env.TENCENT_SECRET_KEY])}`);
      }
    },
    async put(path, bytes, immutable) {
      const source = join(temp, String(serial++));
      await writeFile(source, bytes);
      const contentType = path.endsWith('.apk')
        ? 'application/vnd.android.package-archive'
        : path.endsWith('.json')
        ? 'application/json'
        : 'text/plain';
      const meta = `Cache-Control:${
        immutable ? 'public,max-age=31536000,immutable' : 'no-cache'
      }#Content-Type:${contentType}`;
      try {
        await exec('coscli', [
          'cp',
          source,
          `cos://production/${path}`,
          ...args,
          ...(immutable ? ['--forbid-overwrite'] : []),
          '--meta',
          meta,
        ]);
      } catch {
        throw new Error(`COS upload failed: ${path}`);
      }
    },
  };
  const purge = async (paths) => {
    try {
      await exec('tccli', [
        'cdn',
        'PurgeUrlsCache',
        '--secretId',
        process.env.TENCENT_SECRET_ID,
        '--secretKey',
        process.env.TENCENT_SECRET_KEY,
        '--region',
        'ap-guangzhou',
        '--Urls',
        JSON.stringify(paths.map((p) => `https://beat.cosdrama.cn/${p}`)),
        '--Area',
        'mainland',
      ]);
    } catch {
      throw new Error('Android CDN purge failed');
    }
  };
  const verify = async (path, expected) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const response = await fetch(
          `https://beat.cosdrama.cn/${path}?verify=${manifest.commit}&attempt=${attempt}`,
          { signal: AbortSignal.timeout(120000), cache: 'no-store' }
        );
        if (response.ok && hash(Buffer.from(await response.arrayBuffer())) === hash(expected)) return;
      } catch {
        /* 等待 CDN 生效。 */
      }
      if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`Public APK verification failed: ${path}`);
  };
  try {
    await publishAndroid({
      manifest,
      apk: await readFile(join(directory, manifest.name)),
      sidecar: await readFile(join(directory, manifest.name + '.sha256')),
      cos,
      verify,
      purge,
    });
    console.log(`Published verified Android ${manifest.channel}: ${manifest.url}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
