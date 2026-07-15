import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function assertStringArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是字符串数组`);
  const invalidIndex = value.findIndex((item) => typeof item !== 'string');
  if (invalidIndex >= 0) throw new Error(`${name}[${invalidIndex}] 必须是字符串`);
}

export function hasValidChangeIntent(changedPaths, labels) {
  assertStringArray(changedPaths, 'changedPaths');
  assertStringArray(labels, 'labels');

  const hasChangeset = changedPaths.some(
    (changedPath) => /^\.changeset\/(?!README\.md$).+\.md$/.test(changedPath),
  );
  const hasNone = labels.includes('release:none');

  if (hasChangeset && hasNone) {
    return { valid: false, reason: 'Changeset 与 release:none 不能同时存在' };
  }
  if (!hasChangeset && !hasNone) {
    return { valid: false, reason: '缺少 Changeset 或 release:none 标签' };
  }
  return { valid: true, reason: hasChangeset ? 'changeset' : 'release:none' };
}

function parseLabelsJson(source) {
  let labels;
  try {
    labels = JSON.parse(source || '[]');
    assertStringArray(labels, 'labels');
  } catch {
    throw new Error('PR_LABELS_JSON 必须是字符串数组 JSON');
  }
  return labels;
}

function readChangedPaths(base, head) {
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      encoding: 'utf8',
    }).split(/\r?\n/).filter(Boolean);
  } catch {
    throw new Error('无法读取 Git 变更文件');
  }
}

function main() {
  const base = process.env.CHANGE_BASE_SHA;
  const head = process.env.CHANGE_HEAD_SHA;
  if (!base || !head) throw new Error('CHANGE_BASE_SHA 和 CHANGE_HEAD_SHA 必须存在');

  const labels = parseLabelsJson(process.env.PR_LABELS_JSON);
  const result = hasValidChangeIntent(readChangedPaths(base, head), labels);
  console.log(result.reason);
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : '变更意图校验失败');
    process.exitCode = 1;
  }
}
