import { unzip, zip, strFromU8, strToU8 } from 'fflate';
import { parseProjectDocument } from '../electron/project-document';
import { PROJECT_SCHEMA_VERSION } from '../electron/model-asset-contract';
import type { ProjectDocument } from '../types';

export interface PortableProject {
  document: ProjectDocument;
  assets: Record<string, Blob>;
  warnings: string[];
}
export const MAX_MOBILE_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_MOBILE_EXTRACTED_BYTES = 128 * 1024 * 1024;
export const MAX_PACKAGE_ENTRIES = 500;

export function validateAssetPath(path: string): string {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[:\x00-\x1f]/.test(path) ||
    path.split('/').some((part) => part === '..' || part === '.' || part === '__proto__' || !part)
  ) {
    throw new Error(`项目内文件路径不安全：${path}`);
  }
  return path;
}

// 解压前检查中央目录，避免依据压缩体积预估内存或在写入后才发现越界。
export function inspectPackage(data: Uint8Array): Map<string, { size: number; crc: number }> {
  if (data.byteLength > MAX_MOBILE_PACKAGE_BYTES) throw new Error('移动端项目包不能超过 64 MB');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === data.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('项目包不完整或不是 ZIP 文件');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('不支持分卷项目包');
  const count = view.getUint16(end + 10, true);
  if (count > MAX_PACKAGE_ENTRIES) throw new Error('项目包文件数量超过 500');
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + view.getUint32(end + 12, true);
  if (directoryEnd > end || view.getUint16(end + 8, true) !== count) throw new Error('项目包目录损坏');
  let total = 0;
  const entries = new Map<string, { size: number; crc: number }>();
  const paths = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('项目包目录损坏');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    if (flags & 1 || ![0, 8].includes(method)) throw new Error('不支持加密或特殊压缩的项目包');
    total += view.getUint32(offset + 24, true);
    if (total > MAX_MOBILE_EXTRACTED_BYTES) throw new Error('项目包解压后超过 128 MB，请先精简素材');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength + extraLength + commentLength > directoryEnd)
      throw new Error('项目包目录损坏');
    const name = strFromU8(data.subarray(offset + 46, offset + 46 + nameLength));
    const clean = name.endsWith('/') ? name.slice(0, -1) : name;
    validateAssetPath(clean);
    if (paths.has(name)) throw new Error('项目包包含重复路径');
    paths.add(name);
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > directoryEnd || view.getUint32(local, true) !== 0x04034b50)
      throw new Error('项目包文件头损坏');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + view.getUint32(offset + 20, true) > view.getUint32(end + 16, true))
      throw new Error('项目包文件数据越界');
    entries.set(name, { size: view.getUint32(offset + 24, true), crc: view.getUint32(offset + 16, true) });
    const mode = view.getUint32(offset + 38, true) >>> 16;
    if ((mode & 0xf000) === 0xa000) throw new Error('不支持符号链接');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== directoryEnd || !paths.has('project.json'))
    throw new Error('项目包必须包含根目录 project.json');
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function checksum(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function parseMobileDocument(value: unknown, name = '未命名编排'): ProjectDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目内容不是有效对象');
  const raw = value as Record<string, unknown>;
  if ('format' in raw && (raw.format !== 'cosstage-choreography' || raw.schemaVersion !== 1))
    throw new Error('不支持的编排格式');
  if (
    (typeof raw.version === 'string' || typeof raw.version === 'number') &&
    Number.parseFloat(String(raw.version)) > Number.parseFloat(PROJECT_SCHEMA_VERSION)
  ) {
    throw new Error('项目来自更新版本，请先升级应用');
  }
  const portable = JSON.parse(
    JSON.stringify(raw, (key, child) => (key === 'runtimeUrl' ? undefined : child))
  );
  const document = parseProjectDocument(portable, name);
  referencedAssets(document).forEach(validateAssetPath);
  if (
    document.performerGroups.some(
      (group) => !group || typeof group.id !== 'string' || typeof group.name !== 'string'
    )
  )
    throw new Error('演员分组无效');
  if (
    document.frames.length !== (raw.frames as unknown[]).length ||
    document.performers.length !== (raw.performers as unknown[]).length
  ) {
    throw new Error('项目包含无效队形或演员');
  }
  if (
    ![document.stageConfig.width, document.stageConfig.depth].every(
      (v) => Number.isFinite(v) && v > 0 && v <= 1000
    )
  )
    throw new Error('舞台尺寸无效');
  for (const list of [document.frames, document.performers]) {
    if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error('项目包含重复 ID');
  }
  for (const frame of document.frames) {
    if (
      !Number.isFinite(frame.startTime) ||
      !Number.isFinite(frame.duration) ||
      frame.startTime < 0 ||
      frame.duration < 0
    )
      throw new Error('队形时间无效');
    for (const position of Object.values(frame.positions)) {
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y))
        throw new Error('演员坐标无效');
    }
  }
  return document;
}

export function referencedAssets(document: ProjectDocument): string[] {
  const paths = new Set<string>();
  if (document.musicAsset) paths.add(document.musicAsset);
  if (document.stageConfig.background?.value) paths.add(document.stageConfig.background.value);
  const led = document.stageConfig.ledContent;
  if (led && (led.type === 'image' || led.type === 'video') && led.value) paths.add(led.value);
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'assetPath' && typeof child === 'string') paths.add(child);
      else walk(child);
    }
  };
  walk(document.modelAssets);
  return [...paths].filter((path) => !path.startsWith('data:'));
}

export function getMissingAssets(document: ProjectDocument, assets: Record<string, Blob>): string[] {
  return referencedAssets(document)
    .filter((path) => !Object.hasOwn(assets, path))
    .map((path) => `缺少素材：${path}`);
}

export function assetMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return (
    (
      {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        ogg: 'audio/ogg',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        mp4: 'video/mp4',
        glb: 'model/gltf-binary',
      } as Record<string, string>
    )[ext ?? ''] ?? 'application/octet-stream'
  );
}

export async function readProjectPackage(file: Blob, name = '导入的编排'): Promise<PortableProject> {
  if (file.size > MAX_MOBILE_PACKAGE_BYTES) throw new Error('移动端项目包不能超过 64 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = inspectPackage(bytes);
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, (error, result) => (error ? reject(error) : resolve(result)))
  );
  for (const [path, expected] of entries) {
    const content = files[path];
    if (!content || content.byteLength !== expected.size || checksum(content) !== expected.crc)
      throw new Error(`项目包文件校验失败：${path}`);
  }
  const document = parseMobileDocument(JSON.parse(strFromU8(files['project.json'])), name);
  const assets: Record<string, Blob> = Object.create(null);
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('/') || path === 'project.json' || path === 'meta.json') continue;
    validateAssetPath(path);
    assets[path] = new Blob([Uint8Array.from(content).buffer], { type: assetMime(path) });
  }
  return { document, assets, warnings: getMissingAssets(document, assets) };
}

export async function writeProjectPackage(
  document: ProjectDocument,
  assets: Record<string, Blob>
): Promise<Blob> {
  const files: Record<string, Uint8Array> = Object.create(null);
  // 不把临时 blob URL 写入可移植项目。
  const portable = JSON.parse(
    JSON.stringify(document, (key, value) => (key === 'runtimeUrl' ? undefined : value))
  );
  files['project.json'] = strToU8(JSON.stringify(portable, null, 2));
  let total = files['project.json'].byteLength;
  for (const [path, blob] of Object.entries(assets)) {
    validateAssetPath(path);
    if (path === 'project.json' || path === 'meta.json') continue;
    total += blob.size;
    if (total > MAX_MOBILE_PACKAGE_BYTES) throw new Error('导出内容超过移动端 64 MB 限制，请精简素材');
    files[path] = new Uint8Array(await blob.arrayBuffer());
  }
  if (Object.keys(files).length > MAX_PACKAGE_ENTRIES) throw new Error('项目文件数量超过 500');
  const result = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)))
  );
  if (result.byteLength > MAX_MOBILE_PACKAGE_BYTES) throw new Error('导出的项目包超过 64 MB');
  return new Blob([Uint8Array.from(result).buffer], { type: 'application/zip' });
}
