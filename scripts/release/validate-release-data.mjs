import { readFile } from 'node:fs/promises';
import { validateReleaseHistory } from './release-model.mjs';

async function readTextFile(url, label) {
  try {
    return await readFile(url, 'utf8');
  } catch {
    throw new Error(`无法读取 ${label}`);
  }
}

async function readJsonFile(url, label) {
  const source = await readTextFile(url, label);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
}

async function main() {
  const packageJson = await readJsonFile(new URL('../../package.json', import.meta.url), 'package.json');
  const packageLock = await readJsonFile(
    new URL('../../package-lock.json', import.meta.url),
    'package-lock.json',
  );
  const history = await readJsonFile(
    new URL('../../data/release-history.json', import.meta.url),
    'data/release-history.json',
  );
  const changelog = await readTextFile(new URL('../../CHANGELOG.md', import.meta.url), 'CHANGELOG.md');

  const errors = validateReleaseHistory(history, packageJson?.version);
  const lockVersion = packageLock?.packages?.['']?.version;
  if (typeof lockVersion !== 'string') {
    errors.push('package-lock.json 缺少根包版本');
  } else if (lockVersion !== packageJson?.version) {
    errors.push(`package-lock.json ${lockVersion} 与 package.json ${String(packageJson?.version)} 不一致`);
  }
  if (!changelog.includes(`## ${String(packageJson?.version)}`)) {
    errors.push(`CHANGELOG.md 缺少 ${String(packageJson?.version)}`);
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`发布历史 ${history.currentVersion} 校验通过`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : '发布数据校验失败');
  process.exitCode = 1;
}
