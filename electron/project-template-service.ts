import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { ProjectImportResult, ProjectTemplateSummary } from './project-contract.js';
import { importProjectPackage } from './project-service.js';

const MAX_TEMPLATE_DOWNLOAD_BYTES = 64 * 1024 * 1024;

interface ProjectTemplateDefinition extends ProjectTemplateSummary {
  url: string;
  sha256: string;
  fileName: string;
}

interface TemplateResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type TemplateFetcher = (url: string) => Promise<TemplateResponse>;

const PROJECT_TEMPLATES: ProjectTemplateDefinition[] = [
  {
    id: 'chinajoy',
    name: 'ChinaJoy',
    description: '包含完整舞台结构、LED 背景和 4 个道具贴图的预设项目',
    version: '1',
    estimatedBytes: 5_997_411,
    fileName: 'chinajoy-v1.zip',
    url: 'https://beat.cosdrama.cn/templates/chinajoy-v1.zip',
    sha256: 'f21506b902e8fd0ebf4cdba6897e4ed7a037051f4176408343b46c346e9eb268',
  },
];

function findTemplate(templateId: string): ProjectTemplateDefinition {
  const template = PROJECT_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) throw new Error(`未知的项目模板：${templateId}`);
  return template;
}

async function fileSha256(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function downloadTemplate(
  template: ProjectTemplateDefinition,
  cachePath: string,
  fetcher: TemplateFetcher,
): Promise<void> {
  const response = await fetcher(template.url);
  if (!response.ok) {
    throw new Error(`模板下载失败（HTTP ${response.status}）`);
  }
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_TEMPLATE_DOWNLOAD_BYTES) {
    throw new Error('模板压缩包超过允许的下载大小');
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.byteLength === 0 || content.byteLength > MAX_TEMPLATE_DOWNLOAD_BYTES) {
    throw new Error('模板压缩包为空或超过允许的下载大小');
  }
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== template.sha256) {
    throw new Error('模板压缩包完整性校验失败');
  }

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.download-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, content);
    await fs.rename(temporaryPath, cachePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function listProjectTemplates(): ProjectTemplateSummary[] {
  return PROJECT_TEMPLATES.map(({ id, name, description, version, estimatedBytes }) => ({
    id,
    name,
    description,
    version,
    estimatedBytes,
  }));
}

export async function createProjectFromTemplate(
  storagePath: string,
  cacheRoot: string,
  templateId: string,
  projectName: string,
  fetcher: TemplateFetcher,
): Promise<ProjectImportResult> {
  const template = findTemplate(templateId);
  const cachePath = path.join(cacheRoot, template.fileName);
  if (await fileSha256(cachePath) !== template.sha256) {
    await fs.rm(cachePath, { force: true });
    await downloadTemplate(template, cachePath, fetcher);
  }
  return importProjectPackage(storagePath, cachePath, { name: projectName });
}
