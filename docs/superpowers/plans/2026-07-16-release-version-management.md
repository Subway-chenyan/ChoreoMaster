# CosStage 版本管理与桌面发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Changesets 聚合升版、产品指南版本历史、Major 升级提示、Windows 在线覆盖安装以及腾讯云 COS 原子发布与回滚流程。

**Architecture:** `.changeset/*.md` 是未发布变更输入，Release PR 统一生成包版本、`CHANGELOG.md`、结构化版本历史和当前发布说明。Electron 主进程通过共享更新契约规范化 `electron-updater` 状态，渲染层复用同一版本数据展示产品指南与升级体验；CI 将 Web、Release PR、桌面构建和 COS 发布拆分，并以根 `latest.yml` 作为最后的客户端更新提交点。

**Tech Stack:** Node.js 22、TypeScript 5.8、React 19、Electron 40、electron-builder 26、electron-updater 6、Changesets、GitHub Actions、腾讯云 COSCLI/tccli、Node `node:test`。

## Global Constraints

- 执行前先把当前 worktree 中既有 preload 修复独立验证并提交；不得把 `.trellis/spec/frontend/ipc-electron.md`、`electron/preload.cts` 等旧改动混入本计划提交。
- 第一个受治理版本必须由 Release PR 从 `1.0.0` 升到 `1.1.0`；普通任务不得直接手改 `package.json.version`。
- 用户可见变更必须有 Changeset；无产品影响的 PR 必须使用 `release:none` 标签。
- 首期只支持 Windows x64 stable 通道；不增加 Beta、macOS、Linux、灰度发布或客户端自动降级。
- 保持 `appId = com.choreomaster.app`、`productName = CosStage`、NSIS 安装目录和用户数据目录稳定。
- Patch/Minor 由用户点击下载；Major 必须先展示重大变化和迁移说明，并明确确认，不强制升级。
- 生产发布没有有效 Authenticode 签名时必须失败；本地只允许 unsigned dry-run。
- 必须原样发布 Electron Builder 生成的 `latest.yml` 和 blockmap，禁止自行重写 Builder SHA-512。
- COS 版本化制品不可覆盖；根 `latest.yml` 必须在不可变制品、稳定别名和版本索引验证完成后最后上传。
- UI 文案、错误和发布说明使用中文；代码标识符使用英文。
- 每个任务结束时只提交该任务列出的文件；所有命令从仓库根目录执行。

---

### Task 1: 建立发布领域模型与版本历史校验

**Files:**
- Create: `scripts/release/release-model.mjs`
- Create: `scripts/release/validate-release-data.mjs`
- Create: `tests/release-model.test.mjs`
- Create: `data/release-history.json`
- Create: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseChangesetDocument(source, packageName)` → `{ bump, body }`
- Produces: `highestBump(bumps)` → `'major' | 'minor' | 'patch'`
- Produces: `buildReleaseEntry({ version, date, changesets })` → `ReleaseEntry`
- Produces: `validateReleaseHistory(history, packageVersion)` → `string[]`
- Consumes: `package.json.version`

- [ ] **Step 1: 写发布模型失败测试**

```js
// tests/release-model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReleaseEntry,
  highestBump,
  parseChangesetDocument,
  validateReleaseHistory,
} from '../scripts/release/release-model.mjs';

test('aggregates the highest version bump', () => {
  assert.equal(highestBump(['patch', 'minor', 'patch']), 'minor');
  assert.equal(highestBump(['minor', 'major']), 'major');
});

test('parses the single private package changeset', () => {
  const parsed = parseChangesetDocument(`---\n"cosstage-desktop": minor\n---\n\n新增版本历史。\n`, 'cosstage-desktop');
  assert.deepEqual(parsed, { bump: 'minor', body: '新增版本历史。' });
});

test('requires major migration sections', () => {
  assert.throws(
    () => buildReleaseEntry({
      version: '2.0.0',
      date: '2026-07-16',
      changesets: [{ bump: 'major', body: '重构项目格式。' }],
    }),
    /重大变化.*迁移说明/,
  );
});

test('rejects duplicate or mismatched release history', () => {
  const history = {
    schemaVersion: 1,
    currentVersion: '1.1.0',
    releases: [
      { version: '1.1.0', date: '2026-07-16', kind: 'minor', title: 'A', summary: 'A', changes: [], breakingChanges: [], migrationSteps: [] },
      { version: '1.1.0', date: '2026-07-15', kind: 'patch', title: 'B', summary: 'B', changes: [], breakingChanges: [], migrationSteps: [] },
    ],
  };
  assert.deepEqual(validateReleaseHistory(history, '1.0.0'), [
    'currentVersion 1.1.0 与 package.json 1.0.0 不一致',
    '版本历史包含重复版本 1.1.0',
  ]);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/release-model.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`，因为 `scripts/release/release-model.mjs` 尚不存在。

- [ ] **Step 3: 实现发布模型**

```js
// scripts/release/release-model.mjs
const bumpRank = { patch: 0, minor: 1, major: 2 };
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function highestBump(bumps) {
  if (!Array.isArray(bumps) || bumps.length === 0) throw new Error('至少需要一个版本影响记录');
  for (const bump of bumps) {
    if (!(bump in bumpRank)) throw new Error(`未知版本影响：${bump}`);
  }
  return [...bumps].sort((a, b) => bumpRank[b] - bumpRank[a])[0];
}

export function compareSemver(left, right) {
  const a = semverPattern.exec(left);
  const b = semverPattern.exec(right);
  if (!a || !b) throw new Error(`无效 SemVer：${!a ? left : right}`);
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(a[index]) - Number(b[index]);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function parseChangesetDocument(source, packageName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(source.trim());
  if (!match) throw new Error('Changeset 缺少合法 frontmatter');
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bumpMatch = new RegExp(`^["']?${escapedName}["']?:\\s*(major|minor|patch)\\s*$`, 'm').exec(match[1]);
  if (!bumpMatch) throw new Error(`Changeset 未声明 ${packageName} 的版本影响`);
  const body = match[2].trim();
  if (!body) throw new Error('Changeset 缺少用户可读说明');
  return { bump: bumpMatch[1], body };
}

function extractSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'm').exec(body);
  return match?.[1].trim() || '';
}

export function buildReleaseEntry({ version, date, changesets }) {
  if (!semverPattern.test(version)) throw new Error(`无效 SemVer：${version}`);
  const kind = highestBump(changesets.map((item) => item.bump));
  const breakingChanges = changesets
    .filter((item) => item.bump === 'major')
    .map((item) => extractSection(item.body, '重大变化'))
    .filter(Boolean);
  const migrationSteps = changesets
    .map((item) => extractSection(item.body, '迁移说明'))
    .filter(Boolean);
  if (kind === 'major' && (breakingChanges.length === 0 || migrationSteps.length === 0)) {
    throw new Error('Major Changeset 必须包含“重大变化”和“迁移说明”');
  }
  const changes = changesets.map(({ bump, body }) => ({ kind: bump, text: body }));
  const firstLine = changesets[0].body.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'))?.trim() || `CosStage ${version}`;
  return {
    version,
    date,
    kind,
    title: `CosStage ${version}`,
    summary: firstLine,
    changes,
    breakingChanges,
    migrationSteps,
  };
}

export function validateReleaseHistory(history, packageVersion) {
  const errors = [];
  if (history?.schemaVersion !== 1) errors.push('release history schemaVersion 必须为 1');
  if (history?.currentVersion !== packageVersion) {
    errors.push(`currentVersion ${history?.currentVersion} 与 package.json ${packageVersion} 不一致`);
  }
  const releases = Array.isArray(history?.releases) ? history.releases : [];
  if (releases[0]?.version !== history?.currentVersion) {
    errors.push('版本历史首项必须等于 currentVersion');
  }
  const seen = new Set();
  for (const release of releases) {
    if (seen.has(release.version)) errors.push(`版本历史包含重复版本 ${release.version}`);
    seen.add(release.version);
    if (release.kind === 'major' && (!release.breakingChanges?.length || !release.migrationSteps?.length)) {
      errors.push(`Major 版本 ${release.version} 缺少重大变化或迁移说明`);
    }
  }
  for (let index = 1; index < releases.length; index += 1) {
    if (compareSemver(releases[index - 1].version, releases[index].version) <= 0) {
      errors.push('版本历史必须按版本号严格倒序排列');
      break;
    }
  }
  return errors;
}
```

- [ ] **Step 4: 初始化已发布历史和 changelog**

```json
// data/release-history.json
{
  "schemaVersion": 1,
  "currentVersion": "1.0.0",
  "releases": [
    {
      "version": "1.0.0",
      "date": "2026-07-15",
      "kind": "major",
      "title": "CosStage 1.0.0",
      "summary": "CosStage 首个 Windows 桌面版本。",
      "changes": [
        { "kind": "major", "text": "提供队形编排、时间轴、2D/3D 舞台预览与项目管理。" }
      ],
      "breakingChanges": [
        "这是首个公开版本，没有更早的稳定项目格式兼容承诺。"
      ],
      "migrationSteps": [
        "首次安装无需迁移；请在开始编排前选择项目存储目录。"
      ]
    }
  ]
}
```

```markdown
<!-- CHANGELOG.md -->
# CosStage 变更记录

## 1.0.0 — 2026-07-15

- 提供队形编排、时间轴、2D/3D 舞台预览与项目管理。
```

在 `package.json` 增加脚本：

```json
"test:release": "node --test tests/release-model.test.mjs",
"validate:release-data": "node scripts/release/validate-release-data.mjs"
```

同时创建 `scripts/release/validate-release-data.mjs`，完整入口为：

```js
import { readFile } from 'node:fs/promises';
import { validateReleaseHistory } from './release-model.mjs';

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const history = JSON.parse(await readFile(new URL('../../data/release-history.json', import.meta.url), 'utf8'));
const changelog = await readFile(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const errors = validateReleaseHistory(history, packageJson.version);
if (packageLock.packages?.['']?.version !== packageJson.version) {
  errors.push(`package-lock.json ${packageLock.packages?.['']?.version} 与 package.json ${packageJson.version} 不一致`);
}
if (!changelog.includes(`## ${packageJson.version}`)) {
  errors.push(`CHANGELOG.md 缺少 ${packageJson.version}`);
}
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`release history ${history.currentVersion} is valid`);
}
```

- [ ] **Step 5: 运行模型与数据测试**

Run: `npm run test:release && npm run validate:release-data`

Expected: 4 tests PASS，随后输出 `release history 1.0.0 is valid`。

- [ ] **Step 6: 提交发布领域模型**

```bash
git add package.json CHANGELOG.md data/release-history.json scripts/release/release-model.mjs scripts/release/validate-release-data.mjs tests/release-model.test.mjs
git commit -m "feat: add release version model"
```

---

### Task 2: 接入 Changesets 与 Release PR 版本生成

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`
- Create: `.changeset/first-governed-release.md`
- Create: `scripts/release/version-packages.mjs`
- Create: `scripts/release/validate-change-intent.mjs`
- Create: `tests/change-intent.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 `parseChangesetDocument`, `buildReleaseEntry`, `validateReleaseHistory`
- Produces: `hasValidChangeIntent(changedPaths, labels)` → `{ valid, reason }`
- Produces: `npm run version-packages`，更新 package、锁文件、changelog、历史和发布说明

- [ ] **Step 1: 写变更意图失败测试**

```js
// tests/change-intent.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidChangeIntent } from '../scripts/release/validate-change-intent.mjs';

test('accepts a product changeset', () => {
  assert.deepEqual(hasValidChangeIntent(['.changeset/bright-stage.md'], []), { valid: true, reason: 'changeset' });
});

test('accepts an explicit no-release label', () => {
  assert.deepEqual(hasValidChangeIntent(['tests/a.test.ts'], ['release:none']), { valid: true, reason: 'release:none' });
});

test('rejects missing and conflicting intent', () => {
  assert.equal(hasValidChangeIntent(['App.tsx'], []).valid, false);
  assert.equal(hasValidChangeIntent(['.changeset/a.md'], ['release:none']).valid, false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/change-intent.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 安装并配置 Changesets**

Run: `npm install --save-dev @changesets/cli@^2.31.0`

Create `.changeset/config.json`：

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "privatePackages": {
    "version": true,
    "tag": false
  }
}
```

Create `.changeset/README.md`：

```markdown
# Changesets

用户可见变更运行 `npm run changeset`，选择 major/minor/patch 并填写中文摘要。
Major 正文必须包含 `## 重大变化` 和 `## 迁移说明`。无产品影响的 PR 使用 `release:none` 标签。
```

- [ ] **Step 4: 实现变更意图校验**

```js
// scripts/release/validate-change-intent.mjs
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function hasValidChangeIntent(changedPaths, labels) {
  const hasChangeset = changedPaths.some((path) => /^\.changeset\/(?!README\.md$).+\.md$/.test(path));
  const hasNone = labels.includes('release:none');
  if (hasChangeset && hasNone) return { valid: false, reason: 'Changeset 与 release:none 不能同时存在' };
  if (!hasChangeset && !hasNone) return { valid: false, reason: '缺少 Changeset 或 release:none 标签' };
  return { valid: true, reason: hasChangeset ? 'changeset' : 'release:none' };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.CHANGE_BASE_SHA;
  const head = process.env.CHANGE_HEAD_SHA;
  if (!base || !head) throw new Error('CHANGE_BASE_SHA 和 CHANGE_HEAD_SHA 必须存在');
  const changedPaths = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  const labels = JSON.parse(process.env.PR_LABELS_JSON || '[]');
  const result = hasValidChangeIntent(changedPaths, labels);
  console.log(result.reason);
  if (!result.valid) process.exitCode = 1;
}
```

- [ ] **Step 5: 实现原子版本生成命令**

`scripts/release/version-packages.mjs` 必须先快照 Changeset，运行 Changesets 后再生成派生数据：

```js
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildReleaseEntry, parseChangesetDocument, validateReleaseHistory } from './release-model.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const packagePath = path.join(root, 'package.json');
const historyPath = path.join(root, 'data/release-history.json');
const changesetDir = path.join(root, '.changeset');
const packageBefore = JSON.parse(await readFile(packagePath, 'utf8'));
const files = (await readdir(changesetDir)).filter((name) => name.endsWith('.md') && name !== 'README.md');
if (files.length === 0) throw new Error('没有可发布 Changeset');
const changesets = await Promise.all(files.map(async (name) => (
  parseChangesetDocument(await readFile(path.join(changesetDir, name), 'utf8'), packageBefore.name)
)));

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCommand, ['exec', 'changeset', 'version'], { cwd: root, stdio: 'inherit' });
execFileSync(npmCommand, ['install', '--package-lock-only', '--ignore-scripts'], { cwd: root, stdio: 'inherit' });

const packageAfter = JSON.parse(await readFile(packagePath, 'utf8'));
const history = JSON.parse(await readFile(historyPath, 'utf8'));
const entry = buildReleaseEntry({
  version: packageAfter.version,
  date: new Date().toISOString().slice(0, 10),
  changesets,
});
history.currentVersion = packageAfter.version;
history.releases = [entry, ...history.releases.filter((item) => item.version !== entry.version)];
const errors = validateReleaseHistory(history, packageAfter.version);
if (errors.length > 0) throw new Error(errors.join('\n'));
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);

const notes = [
  `# ${entry.title}`,
  '',
  entry.summary,
  '',
  ...entry.changes.map((change) => `- ${change.text}`),
  ...(entry.breakingChanges.length ? ['', '## 重大变化', '', ...entry.breakingChanges] : []),
  ...(entry.migrationSteps.length ? ['', '## 迁移说明', '', ...entry.migrationSteps] : []),
  '',
].join('\n');
await writeFile(path.join(root, 'build/release-notes.md'), notes);
console.log(`prepared CosStage ${entry.version}`);
```

在 `package.json` 增加：

```json
"changeset": "changeset",
"version-packages": "node scripts/release/version-packages.mjs",
"test:release": "node --test tests/release-model.test.mjs tests/change-intent.test.mjs"
```

- [ ] **Step 6: 添加首个受治理版本记录**

```markdown
---
"cosstage-desktop": minor
---

建立可审计的桌面版本历史、应用内更新与腾讯云原子发布流程。

## 迁移说明

1.0.0 用户需要从官网下载 1.1.0 安装包并覆盖安装一次；项目和设置会保留。
```

保存为 `.changeset/first-governed-release.md`。不要在本任务运行 `npm run version-packages`，它应由 Release PR 自动执行。

- [ ] **Step 7: 验证 Changesets 与校验脚本**

Run: `npm run test:release && npm run validate:release-data && npm exec changeset status`

Expected: 7 tests PASS，历史仍为 `1.0.0`，Changesets status 报告下一版本为 `1.1.0`。

- [ ] **Step 8: 提交 Changesets 接入**

```bash
git add .changeset package.json package-lock.json scripts/release/version-packages.mjs scripts/release/validate-change-intent.mjs tests/change-intent.test.mjs
git commit -m "feat: add changeset release workflow"
```

---

### Task 3: 统一 Electron 更新契约与应用版本

**Files:**
- Create: `electron/update-contract.ts`
- Create: `tests/update-contract.test.ts`
- Modify: `electron/updater.ts:1-136`
- Modify: `electron/preload.cts:16-40,72-83,119-139`
- Modify: `electron-bridge.d.ts:1-29,70-83`
- Modify: `components/UpdateNotification.tsx:1-31,90-130`
- Modify: `electron-builder.config.cjs:8-18`
- Modify: `package.json`

**Interfaces:**
- Produces: `classifyUpdate(currentVersion, availableVersion)` → `UpdateKind`
- Produces: `normalizeReleaseNotes(value)` → `string | undefined`
- Produces: shared `UpdateState`
- Produces: `window.electronAPI.getAppVersion()` → `Promise<string>`
- Consumes: existing IPC `app:getVersion`

- [ ] **Step 1: 写更新契约失败测试**

```ts
// tests/update-contract.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUpdate, normalizeReleaseNotes, shouldClearUpdateCache } from '../electron/update-contract.ts';

test('classifies patch, minor, and major updates', () => {
  assert.equal(classifyUpdate('1.2.3', '1.2.4'), 'patch');
  assert.equal(classifyUpdate('1.2.3', '1.3.0'), 'minor');
  assert.equal(classifyUpdate('1.9.9', '2.0.0'), 'major');
});

test('normalizes array release notes', () => {
  assert.equal(normalizeReleaseNotes([{ version: '1.1.0', note: '新增版本历史' }]), '新增版本历史');
  assert.equal(normalizeReleaseNotes(null), undefined);
});

test('rejects non-upgrades', () => {
  assert.throws(() => classifyUpdate('1.2.3', '1.2.3'), /必须高于/);
});

test('clears only checksum, signature, or corrupt download failures', () => {
  assert.equal(shouldClearUpdateCache('sha512 checksum mismatch'), true);
  assert.equal(shouldClearUpdateCache('network timeout'), false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --experimental-strip-types --test tests/update-contract.test.ts`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 创建共享契约**

```ts
// electron/update-contract.ts
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
export type UpdateKind = 'major' | 'minor' | 'patch';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  updateKind?: UpdateKind;
  releaseNotes?: string;
  progress?: UpdateProgress;
  error?: string;
}

function parse(version: string): [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`无效 SemVer：${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function classifyUpdate(currentVersion: string, availableVersion: string): UpdateKind {
  const current = parse(currentVersion);
  const available = parse(availableVersion);
  const comparison = available.findIndex((value, index) => value !== current[index]);
  if (comparison < 0 || available[comparison] < current[comparison]) {
    throw new Error(`可用版本 ${availableVersion} 必须高于当前版本 ${currentVersion}`);
  }
  return comparison === 0 ? 'major' : comparison === 1 ? 'minor' : 'patch';
}

export function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .map((item) => item && typeof item === 'object' && 'note' in item ? String(item.note).trim() : '')
    .filter(Boolean);
  return notes.length > 0 ? notes.join('\n\n') : undefined;
}

export function shouldClearUpdateCache(message: string): boolean {
  return /sha-?512|checksum|signature|corrupt/i.test(message);
}
```

- [ ] **Step 4: 让主进程只发送规范化状态**

在 `electron/updater.ts` 删除本地类型和 `any`，导入契约，并将可用状态写成：

```ts
import type { UpdateInfo } from 'electron-updater';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { classifyUpdate, normalizeReleaseNotes, shouldClearUpdateCache, type UpdateState } from './update-contract.js';

private state: UpdateState = { status: 'idle', currentVersion: '0.0.0' };

init(mainWindow: BrowserWindow): void {
  this.mainWindow = mainWindow;
  this.state = { status: 'idle', currentVersion: app.getVersion() };
  // 保留现有 autoUpdater 配置并注册事件
}

autoUpdater.on('update-available', (info: UpdateInfo) => {
  const currentVersion = app.getVersion();
  this.setState({
    status: 'available',
    currentVersion,
    availableVersion: info.version,
    updateKind: classifyUpdate(currentVersion, info.version),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    progress: undefined,
    error: undefined,
  });
});
```

`update-downloaded` 使用相同字段；`checking`、`not-available` 和 `error` 必须清除不适用的 `progress`，catch 参数改为 `unknown`，通过 `error instanceof Error ? error.message : String(error)` 生成错误文本。校验或签名失败时只清理固定 updater cache 的 `pending` 子目录：

```ts
private async clearCorruptDownload(message: string): Promise<void> {
  if (!shouldClearUpdateCache(message)) return;
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return;
  const localAppData = path.resolve(process.env.LOCALAPPDATA);
  const cacheRoot = path.resolve(localAppData, 'cosstage-desktop-updater');
  const pending = path.resolve(cacheRoot, 'pending');
  const cacheRelative = path.relative(localAppData, cacheRoot);
  const pendingRelative = path.relative(cacheRoot, pending);
  if (cacheRelative !== 'cosstage-desktop-updater' || pendingRelative !== 'pending') throw new Error('更新缓存路径越界');
  await rm(pending, { recursive: true, force: true });
}

autoUpdater.on('error', (error: Error) => {
  void this.clearCorruptDownload(error.message).finally(() => {
    this.setState({ status: 'error', currentVersion: app.getVersion(), error: error.message, progress: undefined });
  });
});
```

- [ ] **Step 5: 让 preload 和渲染层复用同一类型**

`electron/preload.cts` 与 `electron-bridge.d.ts` 删除重复 `UpdateState`，改为：

```ts
import type { UpdateState } from './electron/update-contract.js';

// ElectronAPI system information
isElectron: boolean;
platform: string;
getAppVersion: () => Promise<string>;
```

preload 实现：

```ts
isElectron: true,
platform: process.platform,
getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
```

删除原先把 `process.versions.electron` 暴露为 `version` 的字段。`components/UpdateNotification.tsx` 导入 `UpdateState`，并把 `state.version` 全部替换为 `state.availableVersion`。

`electron-builder.config.cjs` 的 `files` 增加：

```js
'dist-electron/update-contract.js',
```

- [ ] **Step 6: 把契约测试加入桌面测试**

将 `package.json` 的 `test:desktop` 改为：

```json
"test:desktop": "node --experimental-strip-types --test tests/desktop-regressions.test.mjs tests/update-contract.test.ts tests/cross-project-clipboard.test.ts tests/performer-grouping.test.ts tests/stage-grid-behavior.test.ts"
```

- [ ] **Step 7: 运行契约、类型和桌面测试**

Run: `npm run typecheck && npm run test:desktop`

Expected: TypeScript 通过；更新契约 4 tests PASS；既有桌面回归全部 PASS。

- [ ] **Step 8: 提交更新契约**

```bash
git add electron/update-contract.ts electron/updater.ts electron/preload.cts electron-bridge.d.ts components/UpdateNotification.tsx electron-builder.config.cjs tests/update-contract.test.ts package.json
git commit -m "refactor: unify desktop update contract"
```

---

### Task 4: 在产品指南展示同源版本历史

**Files:**
- Create: `utils/release-history.ts`
- Create: `components/ProductGuideVersions.tsx`
- Create: `tests/release-history.test.ts`
- Modify: `components/ProductGuide.tsx:19-23,79-105,127-143,286-288`
- Modify: `tsconfig.app.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `ReleaseHistory`, `ReleaseEntry`
- Produces: `visibleReleases(history, maxVersion)` → `ReleaseEntry[]`
- Produces: `loadProductReleaseHistory(electronAPI, fetchImpl)` → published/bundled history
- Produces: `<ProductGuideVersions />`
- Consumes: `data/release-history.json` and Task 3 `getAppVersion()`

- [ ] **Step 1: 写版本可见性失败测试**

```ts
// tests/release-history.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleReleases } from '../utils/release-history.ts';

const history = {
  schemaVersion: 1 as const,
  currentVersion: '2.0.0',
  releases: [
    { version: '2.0.0', date: '2026-08-01', kind: 'major' as const, title: '2.0', summary: '2.0', changes: [], breakingChanges: ['格式变化'], migrationSteps: ['先备份'] },
    { version: '1.1.0', date: '2026-07-16', kind: 'minor' as const, title: '1.1', summary: '1.1', changes: [], breakingChanges: [], migrationSteps: [] },
  ],
};

test('desktop hides releases newer than the installed app', () => {
  assert.deepEqual(visibleReleases(history, '1.1.0').map((item) => item.version), ['1.1.0']);
});

test('web can display the complete published index', () => {
  assert.deepEqual(visibleReleases(history).map((item) => item.version), ['2.0.0', '1.1.0']);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --experimental-strip-types --test tests/release-history.test.ts`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现版本历史读取与过滤**

```ts
// utils/release-history.ts
import bundledHistory from '../data/release-history.json' with { type: 'json' };

export type ReleaseKind = 'major' | 'minor' | 'patch';
export interface ReleaseChange { kind: ReleaseKind; text: string }
export interface ReleaseEntry {
  version: string;
  date: string;
  kind: ReleaseKind;
  title: string;
  summary: string;
  changes: ReleaseChange[];
  breakingChanges: string[];
  migrationSteps: string[];
}
export interface ReleaseHistory { schemaVersion: 1; currentVersion: string; releases: ReleaseEntry[] }

function tuple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`无效 SemVer：${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atMost(version: string, maximum: string): boolean {
  const left = tuple(version);
  const right = tuple(maximum);
  return left[0] < right[0]
    || (left[0] === right[0] && left[1] < right[1])
    || (left[0] === right[0] && left[1] === right[1] && left[2] <= right[2]);
}

export function visibleReleases(history: ReleaseHistory, maxVersion?: string): ReleaseEntry[] {
  return maxVersion ? history.releases.filter((release) => atMost(release.version, maxVersion)) : history.releases;
}

export async function loadProductReleaseHistory(): Promise<{ history: ReleaseHistory; currentVersion: string }> {
  if (window.electronAPI?.isElectron) {
    const currentVersion = await window.electronAPI.getAppVersion();
    const history = bundledHistory as ReleaseHistory;
    return { history: { ...history, releases: visibleReleases(history, currentVersion) }, currentVersion };
  }
  const response = await fetch('https://beat.cosdrama.cn/downloads/releases.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`版本信息请求失败：HTTP ${response.status}`);
  const history = await response.json() as ReleaseHistory & { stableVersion: string };
  return { history, currentVersion: history.stableVersion };
}
```

在 `tsconfig.app.json` 增加 `"resolveJsonModule": true`。

- [ ] **Step 4: 创建版本历史展示组件**

`components/ProductGuideVersions.tsx` 完整实现 loading、error 和 success 三态：

```tsx
import React, { useEffect, useState } from 'react';
import { loadProductReleaseHistory, type ReleaseHistory } from '../utils/release-history';

function ReleaseList({ title, items, tone }: { title: string; items: string[]; tone: 'danger' | 'warning' }) {
  const border = tone === 'danger' ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10';
  return (
    <div className={`mt-4 rounded-xl border p-4 ${border}`}>
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

export const ProductGuideVersions: React.FC = () => {
  const [data, setData] = useState<{ history: ReleaseHistory; currentVersion: string } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    loadProductReleaseHistory()
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  return (
    <section id="versions" className="scroll-mt-16 border-t border-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <p className="text-sm font-semibold text-blue-500">版本更新</p>
        {!data && !error && <p className="mt-4 text-sm text-slate-400">正在加载版本信息…</p>}
        {error && <p className="mt-4 text-sm text-red-400">版本信息暂时无法加载，请稍后重试</p>}
        {data && (
          <>
            <h2 className="mt-4 text-4xl font-semibold">当前版本 {data.currentVersion}</h2>
            <div className="mt-10 space-y-4">
              {data.history.releases.map((release) => (
                <details key={release.version} open={release.version === data.currentVersion} className="rounded-2xl border border-slate-700 p-6">
                  <summary className="cursor-pointer font-semibold">
                    {release.version} · {release.kind.toUpperCase()} · {release.date}
                  </summary>
                  <p className="mt-4 text-sm leading-6">{release.summary}</p>
                  <ul className="mt-4 list-disc space-y-2 pl-5">
                    {release.changes.map((change, index) => <li key={`${release.version}-${index}`}>{change.text}</li>)}
                  </ul>
                  {release.breakingChanges.length > 0 && <ReleaseList title="重大变化" items={release.breakingChanges} tone="danger" />}
                  {release.migrationSteps.length > 0 && <ReleaseList title="迁移说明" items={release.migrationSteps} tone="warning" />}
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
```

错误态不得回退展示未发布的 bundled 最新记录。

- [ ] **Step 5: 接入产品指南导航**

在 `components/ProductGuide.tsx`：

```tsx
import { ProductGuideVersions } from './ProductGuideVersions';
```

在“详细操作”和“权益声明”之间增加导航按钮：

```tsx
<button type="button" onClick={() => scrollToSection('versions')} className={navClass}>
  版本更新
</button>
```

在 `<ProductGuideOperations />` 后、`terms` 前增加：

```tsx
<ProductGuideVersions />
```

将重复导航 className 提取为现有组件内常量 `navClass`，不改变原有导航文案和滚动行为。

- [ ] **Step 6: 把版本历史测试加入桌面测试并验证**

将 `tests/release-history.test.ts` 加入 `test:desktop` 后运行：

Run: `npm run typecheck && npm run test:desktop && npm run build`

Expected: 类型检查和测试 PASS；Vite 构建成功；产物包含“版本更新”和 `releases.json` 请求 URL。

- [ ] **Step 7: 提交产品指南版本历史**

```bash
git add utils/release-history.ts components/ProductGuideVersions.tsx components/ProductGuide.tsx tests/release-history.test.ts tsconfig.app.json package.json
git commit -m "feat: show release history in product guide"
```

---

### Task 5: 实现 Major 提示、更新后说明和保存后安装

**Files:**
- Create: `utils/update-preferences.ts`
- Create: `components/MajorUpdateDialog.tsx`
- Create: `components/WhatsNewDialog.tsx`
- Create: `tests/update-preferences.test.ts`
- Modify: `components/UpdateNotification.tsx:1-196`
- Modify: `App.tsx:394-396,1266-1277,4231-4233`
- Modify: `package.json`

**Interfaces:**
- Produces: `shouldShowWhatsNew(currentVersion, lastSeenVersion)`
- Produces: `shouldPromptIgnoredUpdate(availableVersion, ignoredVersion)`
- Produces: `<UpdateNotification beforeInstall={() => Promise<boolean>} />`
- Consumes: Task 3 `UpdateState`, Task 4 bundled release entries, existing `saveBeforeProjectOperation()`

- [ ] **Step 1: 写偏好与忽略规则失败测试**

```ts
// tests/update-preferences.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPromptIgnoredUpdate, shouldShowWhatsNew } from '../utils/update-preferences.ts';

test('shows whats new only after an upgrade', () => {
  assert.equal(shouldShowWhatsNew('1.1.0', '1.0.0'), true);
  assert.equal(shouldShowWhatsNew('1.1.0', '1.1.0'), false);
});

test('does not repeat the same ignored major update', () => {
  assert.equal(shouldPromptIgnoredUpdate('2.0.0', '2.0.0'), false);
  assert.equal(shouldPromptIgnoredUpdate('2.0.1', '2.0.0'), true);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --experimental-strip-types --test tests/update-preferences.test.ts`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现版本偏好规则**

```ts
// utils/update-preferences.ts
function compare(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

export function shouldShowWhatsNew(currentVersion: string, lastSeenVersion: string | null): boolean {
  return lastSeenVersion !== null && compare(currentVersion, lastSeenVersion) > 0;
}

export function shouldPromptIgnoredUpdate(availableVersion: string, ignoredVersion: string | null): boolean {
  return ignoredVersion === null || compare(availableVersion, ignoredVersion) > 0;
}
```

首次安装没有 `lastSeenVersion` 时只写入当前版本，不弹历史更新；从已有版本升级时才弹“本次更新”。

- [ ] **Step 4: 创建 Major 和本次更新对话框**

`components/MajorUpdateDialog.tsx`：

```tsx
import React from 'react';

interface MajorUpdateDialogProps {
  version: string;
  releaseNotes?: string;
  onConfirm: () => void;
  onLater: () => void;
}

export const MajorUpdateDialog: React.FC<MajorUpdateDialogProps> = ({ version, releaseNotes, onConfirm, onLater }) => (
  <div className="fixed inset-0 z-[60000] flex items-center justify-center bg-black/70 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="major-update-title" className="w-full max-w-xl rounded-2xl border border-amber-500/40 bg-slate-950 p-6 text-slate-100 shadow-2xl">
      <h2 id="major-update-title" className="text-2xl font-semibold">重大版本更新 {version}</h2>
      <div className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">{releaseNotes || '请在升级前查看版本迁移说明。'}</div>
      <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">建议确认当前项目已经保存，并保留重要项目备份。</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onLater} className="rounded-lg border border-slate-700 px-4 py-2">稍后提醒</button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">确认并下载</button>
      </div>
    </div>
  </div>
);
```

`components/WhatsNewDialog.tsx`：

```tsx
import React from 'react';
import type { ReleaseEntry } from '../utils/release-history';

export const WhatsNewDialog: React.FC<{ release: ReleaseEntry; onAcknowledge: () => void }> = ({ release, onAcknowledge }) => (
  <div className="fixed inset-0 z-[60000] flex items-center justify-center bg-black/70 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="whats-new-title" className="w-full max-w-xl rounded-2xl border border-blue-500/40 bg-slate-950 p-6 text-slate-100 shadow-2xl">
      <h2 id="whats-new-title" className="text-2xl font-semibold">本次更新 · {release.version}</h2>
      <p className="mt-3 text-sm text-slate-300">{release.summary}</p>
      <ul className="mt-4 max-h-56 list-disc space-y-2 overflow-y-auto pl-5 text-sm text-slate-300">
        {release.changes.map((change, index) => <li key={`${release.version}-${index}`}>{change.text}</li>)}
      </ul>
      {release.breakingChanges.length > 0 && <p className="mt-4 text-sm text-red-300">重大变化：{release.breakingChanges.join('；')}</p>}
      {release.migrationSteps.length > 0 && <p className="mt-2 text-sm text-amber-200">迁移说明：{release.migrationSteps.join('；')}</p>}
      <div className="mt-6 flex justify-end"><button type="button" onClick={onAcknowledge} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">我知道了</button></div>
    </div>
  </div>
);
```

- [ ] **Step 5: 重构更新通知状态机**

`UpdateNotification` 导入两个对话框、`UpdateState`、bundled history 与偏好函数，并把 props 接口改为：

```tsx
interface UpdateNotificationProps {
  beforeInstall: () => Promise<boolean>;
}
```

在现有组件函数的 `showPanel` state 后增加：

```tsx
const [showMajorDialog, setShowMajorDialog] = useState(false);
const [installPending, setInstallPending] = useState(false);
const [whatsNewRelease, setWhatsNewRelease] = useState<ReleaseEntry | null>(null);
```

关键 handler 使用以下完整控制流：

```tsx
const handleDownload = useCallback(async () => {
  if (!isElectron || !state?.availableVersion) return;
  if (state.updateKind === 'major') {
    setShowMajorDialog(true);
    return;
  }
  await window.electronAPI.update.download();
}, [isElectron, state]);

const confirmMajorDownload = useCallback(async () => {
  setShowMajorDialog(false);
  await window.electronAPI.update.download();
}, []);

const postponeMajor = useCallback(() => {
  if (state?.availableVersion) localStorage.setItem('cosstage:update:ignored-version', state.availableVersion);
  setShowMajorDialog(false);
  setDismissed(true);
}, [state?.availableVersion]);

const handleInstall = useCallback(async () => {
  if (!isElectron || installPending) return;
  setInstallPending(true);
  try {
    if (await beforeInstall()) await window.electronAPI.update.install();
  } finally {
    setInstallPending(false);
  }
}, [beforeInstall, installPending, isElectron]);
```

订阅新状态时，用 ignored version 决定是否自动展开；主动检查先清除忽略记录：

```tsx
const ignoredVersion = localStorage.getItem('cosstage:update:ignored-version');
const shouldAutoOpen = newState.status === 'downloaded'
  || (newState.status === 'available'
    && newState.availableVersion !== undefined
    && (newState.updateKind !== 'major'
      || shouldPromptIgnoredUpdate(newState.availableVersion, ignoredVersion)));
if (shouldAutoOpen) setShowPanel(true);

const handleCheck = useCallback(async () => {
  if (!isElectron) return;
  localStorage.removeItem('cosstage:update:ignored-version');
  setDismissed(false);
  setShowPanel(true);
  await window.electronAPI.update.check();
}, [isElectron]);
```

错误态增加明确操作：

```tsx
{isError && (
  <div className="space-y-3 text-sm text-red-400">
    <p>{state.error || '更新检查失败'}</p>
    <div className="flex gap-2">
      <button type="button" onClick={handleCheck} className="rounded-lg bg-slate-700 px-3 py-2 text-white">重试检查</button>
      <a href="https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe" target="_blank" rel="noreferrer" className="rounded-lg border border-slate-700 px-3 py-2 text-white">人工下载安装包</a>
    </div>
  </div>
)}
```

下载完成按钮在 `installPending` 时显示“正在保存项目…”。在组件最外层 fragment 尾部渲染：

```tsx
{showMajorDialog && state.availableVersion && (
  <MajorUpdateDialog
    version={state.availableVersion}
    releaseNotes={state.releaseNotes}
    onConfirm={confirmMajorDownload}
    onLater={postponeMajor}
  />
)}
{whatsNewRelease && (
  <WhatsNewDialog
    release={whatsNewRelease}
    onAcknowledge={() => {
      localStorage.setItem('cosstage:update:last-seen-version', whatsNewRelease.version);
      setWhatsNewRelease(null);
    }}
  />
)}
```

相同 ignored Major 不自动展开，但用户手动点击更新图标或主动检查时仍可查看。

- [ ] **Step 6: 实现更新后首次说明**

组件 mount 时调用 `getAppVersion()`，读取 `cosstage:update:last-seen-version`：

```tsx
const currentVersion = await window.electronAPI.getAppVersion();
const lastSeen = localStorage.getItem('cosstage:update:last-seen-version');
if (lastSeen === null) {
  localStorage.setItem('cosstage:update:last-seen-version', currentVersion);
} else if (shouldShowWhatsNew(currentVersion, lastSeen)) {
  const release = bundledHistory.releases.find((item) => item.version === currentVersion);
  if (release) setWhatsNewRelease(release as ReleaseEntry);
}
```

`WhatsNewDialog.onAcknowledge` 写入当前版本后关闭；不得在对话框自动打开时提前写入。

- [ ] **Step 7: 接入项目保存保护**

在 `App.tsx` 保留现有 `saveBeforeProjectOperation()`，只修改渲染调用：

```tsx
<UpdateNotification beforeInstall={saveBeforeProjectOperation} />
```

保存返回 `false` 或抛错时不调用 `update.install()`，现有项目消息显示“当前项目保存失败，已取消本次操作”。

- [ ] **Step 8: 增加桌面源代码回归断言**

在 `tests/desktop-regressions.test.mjs` 增加：

```js
test('desktop update install is gated by project save', async () => {
  const app = await readFile(path.join(root, 'App.tsx'), 'utf8');
  const notification = await readFile(path.join(root, 'components/UpdateNotification.tsx'), 'utf8');
  assert.match(app, /<UpdateNotification beforeInstall=\{saveBeforeProjectOperation\}/);
  assert.match(notification, /if \(await beforeInstall\(\)\) await window\.electronAPI\.update\.install\(\)/);
  assert.match(notification, /state\.updateKind === 'major'/);
});
```

- [ ] **Step 9: 运行更新 UX 测试**

把 `tests/update-preferences.test.ts` 加入 `test:desktop`，运行：

Run: `npm run typecheck && npm run test:desktop && npm run build`

Expected: 全部 PASS；构建产物包含“确认并下载”“正在保存项目”“本次更新”。

- [ ] **Step 10: 提交更新体验**

```bash
git add utils/update-preferences.ts components/MajorUpdateDialog.tsx components/WhatsNewDialog.tsx components/UpdateNotification.tsx App.tsx tests/update-preferences.test.ts tests/desktop-regressions.test.mjs package.json
git commit -m "feat: add safe desktop upgrade experience"
```

---

### Task 6: 生成可校验的 Builder 制品并强制生产签名

**Files:**
- Create: `build/release-notes.md`
- Create: `scripts/release/verify-builder-output.mjs`
- Create: `scripts/release/verify-windows-signature.ps1`
- Create: `tests/release-artifacts.test.mjs`
- Modify: `electron-builder.config.cjs:1-58`
- Modify: `package.json`

**Interfaces:**
- Produces: `verifyBuilderOutput({ releaseDir, version })` → `{ installerPath, blockmapPath, latestPath, sha256Path }`
- Produces: signed Windows artifact gate driven by `COSSTAGE_REQUIRE_CODE_SIGNING=true`
- Consumes: Task 2 `build/release-notes.md` and package version

- [ ] **Step 1: 写 Builder 元数据失败测试**

```js
// tests/release-artifacts.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyBuilderOutput } from '../scripts/release/verify-builder-output.mjs';

test('accepts builder metadata without rewriting sha512', async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'cosstage-release-'));
  const installer = Buffer.from('signed-installer-fixture');
  const name = 'CosStage-Setup-1.1.0-x64.exe';
  await writeFile(path.join(releaseDir, name), installer);
  await writeFile(path.join(releaseDir, `${name}.blockmap`), 'blockmap');
  await writeFile(path.join(releaseDir, 'latest.yml'), [
    'version: 1.1.0',
    'files:',
    `  - url: ${name}`,
    `    sha512: ${createHash('sha512').update(installer).digest('base64')}`,
    `    size: ${installer.length}`,
    `path: ${name}`,
    '',
  ].join('\n'));
  const result = await verifyBuilderOutput({ releaseDir, version: '1.1.0' });
  assert.equal(path.basename(result.installerPath), name);
  assert.match(await readFile(result.sha256Path, 'utf8'), /^[a-f0-9]{64}  CosStage-Setup-1\.1\.0-x64\.exe$/);
});

test('rejects a mismatched builder hash', async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'cosstage-release-'));
  const name = 'CosStage-Setup-1.1.0-x64.exe';
  await writeFile(path.join(releaseDir, name), 'installer');
  await writeFile(path.join(releaseDir, `${name}.blockmap`), 'blockmap');
  await writeFile(path.join(releaseDir, 'latest.yml'), `version: 1.1.0\nfiles:\n  - url: ${name}\n    sha512: invalid\n    size: 9\npath: ${name}\n`);
  await assert.rejects(() => verifyBuilderOutput({ releaseDir, version: '1.1.0' }), /SHA-512/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/release-artifacts.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现 Builder 产物校验**

```js
// scripts/release/verify-builder-output.mjs
import { createHash } from 'node:crypto';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function field(source, expression, label) {
  const match = expression.exec(source);
  if (!match) throw new Error(`latest.yml 缺少 ${label}`);
  return match[1].trim();
}

export async function verifyBuilderOutput({ releaseDir, version }) {
  const latestPath = path.join(releaseDir, 'latest.yml');
  const latest = await readFile(latestPath, 'utf8');
  const metadataVersion = field(latest, /^version:\s*(\S+)\s*$/m, 'version');
  if (metadataVersion !== version) throw new Error(`latest.yml 版本 ${metadataVersion} 与 ${version} 不一致`);
  const installerName = field(latest, /^\s*- url:\s*(\S+)\s*$/m, 'files.url');
  const expectedName = `CosStage-Setup-${version}-x64.exe`;
  if (installerName !== expectedName) throw new Error(`安装包名称必须为 ${expectedName}`);
  const installerPath = path.join(releaseDir, installerName);
  const blockmapPath = path.join(releaseDir, `${installerName}.blockmap`);
  const installer = await readFile(installerPath);
  await stat(blockmapPath);
  const declaredSize = Number(field(latest, /^\s*size:\s*(\d+)\s*$/m, 'files.size'));
  if (declaredSize !== installer.length) throw new Error('latest.yml 安装包长度不一致');
  const declaredSha512 = field(latest, /^\s*sha512:\s*(\S+)\s*$/m, 'files.sha512');
  const actualSha512 = createHash('sha512').update(installer).digest('base64');
  if (declaredSha512 !== actualSha512) throw new Error('latest.yml SHA-512 与安装包不一致');
  const sha256Path = path.join(releaseDir, `${installerName}.sha256`);
  await writeFile(sha256Path, `${createHash('sha256').update(installer).digest('hex')}  ${installerName}\n`);
  await copyFile(installerPath, path.join(releaseDir, 'CosStage-Setup-x64.exe'));
  return { installerPath, blockmapPath, latestPath, sha256Path };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) throw new Error('用法：node verify-builder-output.mjs <version>');
  await verifyBuilderOutput({ releaseDir: path.resolve('release'), version });
  console.log(`builder output ${version} is valid`);
}
```

- [ ] **Step 4: 添加 Windows 签名门禁**

```powershell
# scripts/release/verify-windows-signature.ps1
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [string]$ExpectedPublisher = '',
  [switch]$AllowUnsigned
)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $InstallerPath
$actualVersion = $item.VersionInfo.ProductVersion
if (-not $actualVersion.StartsWith($ExpectedVersion)) {
  throw "Installer product version $actualVersion does not match $ExpectedVersion"
}
$signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
if ($AllowUnsigned -and $signature.Status -eq 'NotSigned') {
  Write-Host 'Unsigned artifact accepted for dry-run only.'
  exit 0
}
if ($signature.Status -ne 'Valid') {
  throw "Authenticode status is $($signature.Status)"
}
if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
  throw 'ExpectedPublisher is required for signed production artifacts'
}
if (-not $signature.SignerCertificate.Subject.Contains($ExpectedPublisher)) {
  throw "Signer subject does not contain $ExpectedPublisher"
}
Write-Host "Valid signature: $($signature.SignerCertificate.Subject)"
```

- [ ] **Step 5: 配置 Builder 发布说明和生产签名**

在 `electron-builder.config.cjs` 顶部增加：

```js
const requireCodeSigning = process.env.COSSTAGE_REQUIRE_CODE_SIGNING === 'true';
const publisherName = process.env.COSSTAGE_WINDOWS_PUBLISHER_NAME;
```

在现有导出对象增加 `forceCodeSigning` 与 `releaseInfo`，并把发布者合并进现有 `win`：

```js
forceCodeSigning: requireCodeSigning,
releaseInfo: {
  releaseNotesFile: 'build/release-notes.md',
},
win: {
  target: [{ target: 'nsis', arch: ['x64'] }],
  icon: 'build/icon.ico',
  artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  ...(publisherName ? { publisherName: [publisherName] } : {}),
},
```

创建 `build/release-notes.md` 初始内容：

```markdown
# CosStage 1.0.0

CosStage 首个 Windows 桌面版本。
```

- [ ] **Step 6: 增加 Windows dry-run 命令**

在 `package.json` 增加并扩展测试：

```json
"build:electron:win": "npm run build:main && npm run build && electron-builder --win nsis --x64 --config electron-builder.config.cjs",
"verify:release-artifacts": "node scripts/release/verify-builder-output.mjs",
"release:dry-run": "npm run validate:release-data && npm test && npm run build:electron:win",
"test:release": "node --test tests/release-model.test.mjs tests/change-intent.test.mjs tests/release-artifacts.test.mjs"
```

- [ ] **Step 7: 运行制品单元测试和本地构建**

Run: `npm run test:release && npm run build:electron:win && node scripts/release/verify-builder-output.mjs 1.0.0`

Expected: 单元测试 PASS；生成 `CosStage-Setup-1.0.0-x64.exe`、blockmap 和 Builder 原始 `latest.yml`；校验输出 `builder output 1.0.0 is valid`。本地构建允许未签名，但不得上传。

- [ ] **Step 8: 提交 Builder 制品门禁**

```bash
git add build/release-notes.md scripts/release/verify-builder-output.mjs scripts/release/verify-windows-signature.ps1 tests/release-artifacts.test.mjs electron-builder.config.cjs package.json
git commit -m "build: verify signed desktop release artifacts"
```

---

### Task 7: 建立 PR 质量门禁与 Changesets Release PR

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-pr.yml`
- Modify: `package.json`

**Interfaces:**
- Produces: PR check `quality`
- Produces: singleton Release PR titled `chore: version packages`
- Consumes: Task 2 `validate-change-intent.mjs` and `version-packages`

- [ ] **Step 1: 先验证当前脚本作为 CI 入口可运行**

Run: `npm run test:release && npm run typecheck`

Expected: PASS。若失败，先修复 Task 1–6，不创建工作流。

- [ ] **Step 2: 创建 PR/main 质量工作流**

```yaml
# .github/workflows/ci.yml
name: Quality

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: read

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip
          cache-dependency-path: backend/requirements.txt
      - run: pip install -r backend/requirements.txt
      - run: npm ci
      - name: Validate release intent
        if: github.event_name == 'pull_request' && github.actor != 'github-actions[bot]'
        env:
          CHANGE_BASE_SHA: ${{ github.event.pull_request.base.sha }}
          CHANGE_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          PR_LABELS_JSON: ${{ toJSON(github.event.pull_request.labels.*.name) }}
        run: node scripts/release/validate-change-intent.mjs
      - run: npm run validate:release-data
      - run: npm test
```

Release PR 由 `github-actions[bot]` 创建并跳过普通 Changeset 意图门禁，但仍执行版本数据和完整测试。

- [ ] **Step 3: 创建 Release PR 工作流**

```yaml
# .github/workflows/release-pr.yml
name: Release PR

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: changesets-release-pr
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write

jobs:
  release-pr:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: changesets/action@v1
        with:
          version: npm run version-packages
          commit: 'chore: version packages'
          title: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: 在临时 clone 模拟版本 PR**

不能在当前 worktree 运行 `npm run version-packages` 后再手工恢复文件。使用：

```powershell
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "cosstage-version-$([guid]::NewGuid())"
git clone --no-hardlinks . $temp
Push-Location $temp
npm ci
npm run version-packages
npm run validate:release-data
npm run test:release
Pop-Location
Remove-Item -LiteralPath $temp -Recurse -Force
```

Expected: 临时仓库版本变为 `1.1.0`，Changeset 被消费，历史首项为 `1.1.0`，测试 PASS；当前 worktree 保持 `1.0.0`。

- [ ] **Step 5: 检查工作流 YAML**

Run: `npx --yes yaml-lint .github/workflows/ci.yml .github/workflows/release-pr.yml`

Expected: YAML parse PASS。若环境已安装 `actionlint`，再运行 `actionlint .github/workflows/ci.yml .github/workflows/release-pr.yml`，Expected: 无错误。

- [ ] **Step 6: 提交 CI 与 Release PR**

```bash
git add .github/workflows/ci.yml .github/workflows/release-pr.yml package.json
git commit -m "ci: add release intent and version pr gates"
```

---

### Task 8: 拆分 Web 部署并实现 COS 原子桌面发布

**Files:**
- Create: `scripts/release/published-index.mjs`
- Create: `scripts/release/publish-cos.sh`
- Create: `tests/published-index.test.mjs`
- Create: `.github/workflows/web-deploy.yml`
- Create: `.github/workflows/desktop-release.yml`
- Delete: `.github/workflows/deploy-cos.yml`
- Modify: `package.json`

**Interfaces:**
- Produces: `mergePublishedRelease(history, existingIndex, version, publishedAt)`
- Produces: reusable Web workflow input `force: boolean`
- Produces: desktop release modes `skip | publish | repair-release`
- Consumes: signed Task 6 artifact and COS stable objects

- [ ] **Step 1: 写已发布索引失败测试**

```js
// tests/published-index.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePublishedRelease } from '../scripts/release/published-index.mjs';

const history = {
  schemaVersion: 1,
  currentVersion: '1.1.0',
  releases: [{ version: '1.1.0', date: '2026-07-16', kind: 'minor', title: '1.1', summary: '版本管理', changes: [], breakingChanges: [], migrationSteps: [] }],
};

test('publishes only the selected release and makes it stable', () => {
  const result = mergePublishedRelease(history, null, '1.1.0', '2026-07-16T12:00:00.000Z');
  assert.equal(result.stableVersion, '1.1.0');
  assert.equal(result.releases[0].installerUrl, 'https://beat.cosdrama.cn/downloads/CosStage-Setup-1.1.0-x64.exe');
  assert.equal(result.releases[0].publishedAt, '2026-07-16T12:00:00.000Z');
});

test('preserves an existing published timestamp on retry', () => {
  const first = mergePublishedRelease(history, null, '1.1.0', '2026-07-16T12:00:00.000Z');
  const retry = mergePublishedRelease(history, first, '1.1.0', '2026-07-17T12:00:00.000Z');
  assert.equal(retry.releases[0].publishedAt, '2026-07-16T12:00:00.000Z');
});
```

- [ ] **Step 2: 实现已发布索引生成器**

```js
// scripts/release/published-index.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function mergePublishedRelease(history, existingIndex, version, publishedAt) {
  const release = history.releases.find((item) => item.version === version);
  if (!release) throw new Error(`版本历史中不存在 ${version}`);
  const previous = existingIndex?.releases?.find((item) => item.version === version);
  const published = {
    ...release,
    publishedAt: previous?.publishedAt || publishedAt,
    installerUrl: `https://beat.cosdrama.cn/downloads/CosStage-Setup-${version}-x64.exe`,
  };
  const older = (existingIndex?.releases || []).filter((item) => item.version !== version);
  return { schemaVersion: 1, currentVersion: version, stableVersion: version, releases: [published, ...older] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [historyPath, existingPath, version, outputPath] = process.argv.slice(2);
  if (!historyPath || !existingPath || !version || !outputPath) {
    throw new Error('用法：node published-index.mjs <history> <existing> <version> <output>');
  }
  const history = JSON.parse(await readFile(historyPath, 'utf8'));
  const existingSource = await readFile(existingPath, 'utf8');
  const existing = existingSource.trim() ? JSON.parse(existingSource) : null;
  const result = mergePublishedRelease(history, existing, version, new Date().toISOString());
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
```

- [ ] **Step 3: 创建可复用 Web 部署工作流**

`.github/workflows/web-deploy.yml` 使用下列完整 job。版本提交由桌面发布成功后以 `force=true` 调用；普通 `main` 提交继续即时部署：

```yaml
name: Deploy Web
on:
  push:
    branches: [main]
  workflow_call:
    inputs:
      force:
        type: boolean
        default: false
  workflow_dispatch:

concurrency:
  group: deploy-web-production
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    env:
      CDN_URL: https://beat.cosdrama.cn/
      TENCENT_SECRET_ID: ${{ secrets.TENCENT_SECRET_ID }}
      TENCENT_SECRET_KEY: ${{ secrets.TENCENT_SECRET_KEY }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - name: Detect pending release commit
        id: gate
        env:
          FORCE_DEPLOY: ${{ inputs.force || false }}
        shell: bash
        run: |
          if [ "$FORCE_DEPLOY" = "true" ]; then
            echo "deploy=true" >> "$GITHUB_OUTPUT"
          elif git diff --quiet HEAD^ HEAD -- package.json data/release-history.json; then
            echo "deploy=true" >> "$GITHUB_OUTPUT"
          else
            echo "deploy=false" >> "$GITHUB_OUTPUT"
            echo "Desktop release commit waits for Desktop Release."
          fi
      - uses: actions/setup-node@v4
        if: steps.gate.outputs.deploy == 'true'
        with: { node-version: 22, cache: npm }
      - if: steps.gate.outputs.deploy == 'true'
        run: npm ci
      - if: steps.gate.outputs.deploy == 'true'
        run: npm run build
      - name: Install COSCLI and tccli
        if: steps.gate.outputs.deploy == 'true'
        run: |
          curl -fsSL "https://github.com/tencentyun/coscli/releases/download/v1.0.8/coscli-v1.0.8-linux-amd64" -o /usr/local/bin/coscli
          chmod +x /usr/local/bin/coscli
          pip install --disable-pip-version-check tccli
          coscli config add --init-skip=true -a production -b beat-1317738912 -r ap-guangzhou -e cos.accelerate.myqcloud.com -i "$TENCENT_SECRET_ID" -k "$TENCENT_SECRET_KEY"
      - name: Upload web
        if: steps.gate.outputs.deploy == 'true'
        run: |
          coscli sync ./dist/ cos://production/ --recursive --force --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"
          coscli cp ./dist/index.html cos://production/index.html --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:no-cache"
          coscli rm cos://production/sw.js --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" -f || true
          coscli rm cos://production/manifest.webmanifest --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" -f || true
          tccli cdn PurgeUrlsCache --secretId "$TENCENT_SECRET_ID" --secretKey "$TENCENT_SECRET_KEY" --region ap-guangzhou --Urls "[\"${CDN_URL}index.html\",\"${CDN_URL}sw.js\",\"${CDN_URL}manifest.webmanifest\"]" --Area mainland
      - name: Verify web
        if: steps.gate.outputs.deploy == 'true'
        run: |
          expected_asset="$(grep -oE 'assets/index-[^\"]+\.js' dist/index.html | head -n 1)"
          test -n "$expected_asset"
          deployed_html=""
          for attempt in $(seq 1 12); do
            deployed_html="$(curl -fsSL "${CDN_URL}?deploy=${GITHUB_SHA}" || true)"
            grep -Fq "$expected_asset" <<< "$deployed_html" && break
            sleep 5
          done
          grep -Fq "$expected_asset" <<< "$deployed_html"
          curl -fsSI --retry 5 --retry-delay 3 "${CDN_URL}${expected_asset}" >/dev/null
          if grep -R -n -E 'sw\.js|manifest\.webmanifest|serviceWorker\.register' dist; then exit 1; fi
```

- [ ] **Step 4: 创建桌面发布状态检测与 Windows 构建**

`.github/workflows/desktop-release.yml` 的触发、并发、detect 和 build jobs：

```yaml
name: Desktop Release
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: desktop-release-stable
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.detect.outputs.version }}
      mode: ${{ steps.detect.outputs.mode }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: detect
        env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
        shell: bash
        run: |
          version="$(node -p 'require("./package.json").version')"
          node -e "const v=process.argv[1].split('.').map(Number); if(v[0] < 1 || (v[0] === 1 && v[1] < 1)) process.exit(1)" "$version" || {
            echo "version=$version" >> "$GITHUB_OUTPUT"; echo "mode=skip" >> "$GITHUB_OUTPUT"; exit 0;
          }
          tag="v$version"
          if git rev-parse "$tag" >/dev/null 2>&1; then
            if gh release view "$tag" >/dev/null 2>&1; then mode=skip; else mode=repair-release; fi
          else
            mode=publish
          fi
          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "mode=$mode" >> "$GITHUB_OUTPUT"

  build-windows:
    needs: detect
    if: needs.detect.outputs.mode == 'publish'
    runs-on: windows-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - name: Build signed installer
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          COSSTAGE_REQUIRE_CODE_SIGNING: 'true'
          COSSTAGE_WINDOWS_PUBLISHER_NAME: ${{ vars.WINDOWS_PUBLISHER_NAME }}
        run: npm run build:electron:win
      - shell: pwsh
        run: |
          $version = '${{ needs.detect.outputs.version }}'
          node scripts/release/verify-builder-output.mjs $version
          ./scripts/release/verify-windows-signature.ps1 -InstallerPath "release/CosStage-Setup-$version-x64.exe" -ExpectedVersion $version -ExpectedPublisher '${{ vars.WINDOWS_PUBLISHER_NAME }}'
          Copy-Item -LiteralPath build/release-notes.md -Destination release/release-notes.md -Force
      - uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ needs.detect.outputs.version }}
          path: |
            release/CosStage-Setup-${{ needs.detect.outputs.version }}-x64.exe
            release/CosStage-Setup-${{ needs.detect.outputs.version }}-x64.exe.blockmap
            release/CosStage-Setup-${{ needs.detect.outputs.version }}-x64.exe.sha256
            release/CosStage-Setup-x64.exe
            release/latest.yml
            release/release-notes.md
```

- [ ] **Step 5: 实现 COS 原子 publish job**

publish job 只允许 `main` 写生产 COS；非 `main` workflow dispatch 可以完成签名构建，但必须在 publish job 的 `if` 处停止：

```yaml
  publish:
    needs: [detect, build-windows]
    if: needs.detect.outputs.mode == 'publish' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    env:
      VERSION: ${{ needs.detect.outputs.version }}
      CDN_URL: https://beat.cosdrama.cn/
      INSTALLER_URL: https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      TENCENT_SECRET_ID: ${{ secrets.TENCENT_SECRET_ID }}
      TENCENT_SECRET_KEY: ${{ secrets.TENCENT_SECRET_KEY }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with:
          name: desktop-${{ needs.detect.outputs.version }}
          path: desktop
      - name: Install and configure Tencent CLIs
        run: |
          curl -fsSL "https://github.com/tencentyun/coscli/releases/download/v1.0.8/coscli-v1.0.8-linux-amd64" -o /usr/local/bin/coscli
          chmod +x /usr/local/bin/coscli
          pip install --disable-pip-version-check tccli
          coscli config add --init-skip=true -a production -b beat-1317738912 -r ap-guangzhou -e cos.accelerate.myqcloud.com -i "$TENCENT_SECRET_ID" -k "$TENCENT_SECRET_KEY"
      - name: Download existing release index
        run: |
          if ! coscli cp cos://production/downloads/releases.json releases.previous.json --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"; then
            : > releases.previous.json
          fi
      - name: Publish immutable artifacts and pointers
        run: bash scripts/release/publish-cos.sh
```

创建 `scripts/release/publish-cos.sh`。文件开头和不可变对象上传逻辑为：

```bash
#!/usr/bin/env bash
set -euo pipefail

upload_immutable() {
  local source="$1" object="$2" remote_file
  remote_file="$(mktemp)"
  if coscli cp "cos://production/$object" "$remote_file" --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" >/dev/null 2>&1; then
    test "$(sha256sum "$source" | cut -d' ' -f1)" = "$(sha256sum "$remote_file" | cut -d' ' -f1)" || {
      echo "Immutable object differs: $object"; exit 1;
    }
  else
    coscli cp "$source" "cos://production/$object" --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:public,max-age=31536000,immutable"
  fi
  rm -f "$remote_file"
}

upload_immutable "desktop/CosStage-Setup-$VERSION-x64.exe" "downloads/CosStage-Setup-$VERSION-x64.exe"
upload_immutable "desktop/CosStage-Setup-$VERSION-x64.exe.blockmap" "downloads/CosStage-Setup-$VERSION-x64.exe.blockmap"
upload_immutable "desktop/CosStage-Setup-$VERSION-x64.exe.sha256" "downloads/CosStage-Setup-$VERSION-x64.exe.sha256"
upload_immutable "desktop/latest.yml" "downloads/metadata/$VERSION/latest.yml"
upload_immutable "desktop/release-notes.md" "downloads/release-notes-$VERSION.md"
```

同一文件紧接着生成索引并上传三个可变指针：

```bash
node scripts/release/published-index.mjs data/release-history.json releases.previous.json "$VERSION" releases.next.json
coscli cp "desktop/CosStage-Setup-x64.exe" cos://production/downloads/CosStage-Setup-x64.exe --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:public,max-age=300#Content-Disposition:attachment; filename=CosStage-Setup-x64.exe#Content-Type:application/vnd.microsoft.portable-executable"
coscli cp releases.next.json cos://production/downloads/releases.json --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:no-cache#Content-Type:application/json"
coscli cp desktop/latest.yml cos://production/downloads/latest.yml --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:no-cache#Content-Type:text/yaml"
```

根 `latest.yml` 必须是最后一次 COS 写操作。同一文件随后定向刷新并验证：

```bash
tccli cdn PurgeUrlsCache --secretId "$TENCENT_SECRET_ID" --secretKey "$TENCENT_SECRET_KEY" --region ap-guangzhou --Urls "[\"${INSTALLER_URL}\",\"${CDN_URL}downloads/releases.json\",\"${CDN_URL}downloads/latest.yml\"]" --Area mainland
test "$(curl -fsSI "$INSTALLER_URL?release=$GITHUB_SHA" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)" = "$(stat -c%s "desktop/CosStage-Setup-$VERSION-x64.exe")"
curl -fsSL "$CDN_URL/downloads/latest.yml?release=$GITHUB_SHA" | grep -Fxq "version: $VERSION"
curl -fsSL "$CDN_URL/downloads/releases.json?release=$GITHUB_SHA" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(JSON.parse(s).stableVersion!==process.argv[1])process.exit(1)})" "$VERSION"
```

同一文件最后在公网验证成功后创建版本记录：

```bash
git tag -a "v$VERSION" "$GITHUB_SHA" -m "CosStage $VERSION"
git push origin "v$VERSION"
gh release create "v$VERSION" "desktop/CosStage-Setup-$VERSION-x64.exe" "desktop/CosStage-Setup-$VERSION-x64.exe.sha256" --title "CosStage $VERSION" --notes-file desktop/release-notes.md
```

`repair-release` job 从 COS 下载版本化安装包和说明，仅执行缺失的 `gh release create`，不得修改稳定指针。

```yaml
  repair-release:
    needs: detect
    if: needs.detect.outputs.mode == 'repair-release' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    env:
      VERSION: ${{ needs.detect.outputs.version }}
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: Download immutable release files
        run: |
          curl -fsSLo "CosStage-Setup-$VERSION-x64.exe" "https://beat.cosdrama.cn/downloads/CosStage-Setup-$VERSION-x64.exe"
          curl -fsSLo "CosStage-Setup-$VERSION-x64.exe.sha256" "https://beat.cosdrama.cn/downloads/CosStage-Setup-$VERSION-x64.exe.sha256"
          curl -fsSLo release-notes.md "https://beat.cosdrama.cn/downloads/release-notes-$VERSION.md"
          grep -Fq "$(sha256sum "CosStage-Setup-$VERSION-x64.exe" | cut -d' ' -f1)" "CosStage-Setup-$VERSION-x64.exe.sha256"
      - name: Repair GitHub Release only
        run: gh release create "v$VERSION" "CosStage-Setup-$VERSION-x64.exe" "CosStage-Setup-$VERSION-x64.exe.sha256" --title "CosStage $VERSION" --notes-file release-notes.md
```

- [ ] **Step 6: 发布完成后调用 Web 工作流**

在 `desktop-release.yml` 增加 reusable workflow job：

```yaml
  deploy-web:
    needs: [detect, publish, repair-release]
    if: always() && (needs.publish.result == 'success' || needs.repair-release.result == 'success')
    uses: ./.github/workflows/web-deploy.yml
    with:
      force: true
    secrets: inherit
```

`publish` 和 `repair-release` 必须用互斥 `if`；未执行的 job 结果为 `skipped`。`deploy-web` 只包含 `uses/with/secrets`。

- [ ] **Step 7: 删除旧混合部署并验证**

删除 `.github/workflows/deploy-cos.yml`，把 `tests/published-index.test.mjs` 加入 `test:release`，运行：

Run: `npm run test:release && npx --yes yaml-lint .github/workflows/web-deploy.yml .github/workflows/desktop-release.yml`

Expected: 发布索引 2 tests PASS；YAML parse PASS；`rg "Generate latest.yml" .github/workflows` 无结果；`rg "cancel-in-progress: false" .github/workflows/desktop-release.yml` 命中。

- [ ] **Step 8: 提交部署拆分与原子发布**

```bash
git add scripts/release/published-index.mjs scripts/release/publish-cos.sh tests/published-index.test.mjs .github/workflows/web-deploy.yml .github/workflows/desktop-release.yml package.json
git rm .github/workflows/deploy-cos.yml
git commit -m "ci: publish signed desktop releases atomically"
```

---

### Task 9: 增加稳定版本回滚工作流

**Files:**
- Modify: `scripts/release/published-index.mjs`
- Modify: `scripts/release/publish-cos.sh`
- Modify: `tests/published-index.test.mjs`
- Create: `.github/workflows/desktop-rollback.yml`

**Interfaces:**
- Produces: `setStableVersion(index, version)` → updated published index
- Consumes: COS `metadata/<version>/latest.yml` and immutable artifacts

- [ ] **Step 1: 写回滚索引失败测试**

在 `tests/published-index.test.mjs` 增加 import 和测试：

```js
import { mergePublishedRelease, setStableVersion } from '../scripts/release/published-index.mjs';

test('switches stableVersion without deleting release history', () => {
  const index = {
    schemaVersion: 1,
    currentVersion: '1.2.0',
    stableVersion: '1.2.0',
    releases: [{ version: '1.2.0' }, { version: '1.1.0' }],
  };
  const rolledBack = setStableVersion(index, '1.1.0');
  assert.equal(rolledBack.stableVersion, '1.1.0');
  assert.deepEqual(rolledBack.releases.map((item) => item.version), ['1.2.0', '1.1.0']);
  assert.throws(() => setStableVersion(index, '1.0.0'), /尚未发布/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/published-index.test.mjs`

Expected: FAIL，错误表示 `setStableVersion` 未导出。

- [ ] **Step 3: 实现稳定指针切换和 rollback CLI**

在 `published-index.mjs` 增加：

```js
export function setStableVersion(index, version) {
  if (!index.releases.some((item) => item.version === version)) {
    throw new Error(`版本 ${version} 尚未发布`);
  }
  return { ...index, stableVersion: version };
}
```

将 CLI 改为显式子命令：

```js
const [command, ...args] = process.argv.slice(2);
if (command === 'publish') {
  const [historyPath, existingPath, version, outputPath] = args;
  const history = JSON.parse(await readFile(historyPath, 'utf8'));
  const source = await readFile(existingPath, 'utf8');
  await writeFile(outputPath, `${JSON.stringify(mergePublishedRelease(history, source.trim() ? JSON.parse(source) : null, version, new Date().toISOString()), null, 2)}\n`);
} else if (command === 'rollback') {
  const [existingPath, version, outputPath] = args;
  const index = JSON.parse(await readFile(existingPath, 'utf8'));
  await writeFile(outputPath, `${JSON.stringify(setStableVersion(index, version), null, 2)}\n`);
} else {
  throw new Error('命令必须为 publish 或 rollback');
}
```

同步修改 `scripts/release/publish-cos.sh` 调用为 `node scripts/release/published-index.mjs publish ...`。

- [ ] **Step 4: 创建人工回滚工作流**

```yaml
# .github/workflows/desktop-rollback.yml
name: Desktop Rollback
on:
  workflow_dispatch:
    inputs:
      version:
        description: Existing published SemVer
        required: true
        type: string

concurrency:
  group: desktop-release-stable
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: production
    env:
      VERSION: ${{ inputs.version }}
      TENCENT_SECRET_ID: ${{ secrets.TENCENT_SECRET_ID }}
      TENCENT_SECRET_KEY: ${{ secrets.TENCENT_SECRET_KEY }}
    steps:
      - uses: actions/checkout@v4
      - name: Validate version input
        run: node -e "if(!/^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.test(process.env.VERSION))process.exit(1)"
      - name: Install and configure COSCLI
        run: |
          curl -fsSL "https://github.com/tencentyun/coscli/releases/download/v1.0.8/coscli-v1.0.8-linux-amd64" -o /usr/local/bin/coscli
          chmod +x /usr/local/bin/coscli
          pip install --disable-pip-version-check tccli
          coscli config add --init-skip=true -a production -b beat-1317738912 -r ap-guangzhou -e cos.accelerate.myqcloud.com -i "$TENCENT_SECRET_ID" -k "$TENCENT_SECRET_KEY"
      - name: Download and verify historical release
        run: |
          coscli cp "cos://production/downloads/CosStage-Setup-$VERSION-x64.exe" installer.exe --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"
          coscli cp "cos://production/downloads/CosStage-Setup-$VERSION-x64.exe.sha256" installer.sha256 --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"
          coscli cp "cos://production/downloads/metadata/$VERSION/latest.yml" latest.yml --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"
          coscli cp "cos://production/downloads/releases.json" releases.json --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"
          grep -Fq "$(sha256sum installer.exe | cut -d' ' -f1)" installer.sha256
          grep -Fxq "version: $VERSION" latest.yml
          node scripts/release/published-index.mjs rollback releases.json "$VERSION" releases.next.json
      - name: Commit rollback pointers
        run: |
          coscli cp installer.exe cos://production/downloads/CosStage-Setup-x64.exe --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:public,max-age=300"
          coscli cp releases.next.json cos://production/downloads/releases.json --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:no-cache#Content-Type:application/json"
          coscli cp latest.yml cos://production/downloads/latest.yml --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --meta "Cache-Control:no-cache#Content-Type:text/yaml"
          tccli cdn PurgeUrlsCache --secretId "$TENCENT_SECRET_ID" --secretKey "$TENCENT_SECRET_KEY" --region ap-guangzhou --Urls "[\"https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe\",\"https://beat.cosdrama.cn/downloads/releases.json\",\"https://beat.cosdrama.cn/downloads/latest.yml\"]" --Area mainland
      - name: Verify rollback
        run: |
          curl -fsSL "https://beat.cosdrama.cn/downloads/latest.yml?rollback=$GITHUB_RUN_ID" | grep -Fxq "version: $VERSION"
          curl -fsSL "https://beat.cosdrama.cn/downloads/releases.json?rollback=$GITHUB_RUN_ID" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(JSON.parse(s).stableVersion!==process.argv[1])process.exit(1)})" "$VERSION"
```

工作流不得删除任何版本化对象、tag 或 GitHub Release。回滚成功后，Task 8 的 detect 因当前版本已有 tag 和 GitHub Release 而保持 `skip`，不会在下一次 main push 自动重新提升被撤回版本。

- [ ] **Step 5: 验证回滚测试和工作流**

Run: `npm run test:release && npx --yes yaml-lint .github/workflows/desktop-rollback.yml`

Expected: published index 3 tests PASS；YAML parse PASS；`rg "push:" .github/workflows/desktop-rollback.yml` 无结果。

- [ ] **Step 6: 提交回滚能力**

```bash
git add scripts/release/published-index.mjs scripts/release/publish-cos.sh tests/published-index.test.mjs .github/workflows/desktop-release.yml .github/workflows/desktop-rollback.yml
git commit -m "ci: add desktop release rollback"
```

---

### Task 10: 编写发布手册并完成 `1.1.0` 上线前验收

**Files:**
- Create: `docs/releasing.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `tests/desktop-regressions.test.mjs`

**Interfaces:**
- Produces: 开发、Release PR、生产发布、失败补偿、回滚、`1.0.0` 迁移操作手册
- Consumes: Tasks 1–9 的命令、workflow 和稳定 URL

- [ ] **Step 1: 添加发布配置回归断言**

在 `tests/desktop-regressions.test.mjs` 增加：

```js
test('release pipeline keeps builder metadata and stable app identity', async () => {
  const builder = await readFile(path.join(root, 'electron-builder.config.cjs'), 'utf8');
  const release = await readFile(path.join(root, '.github/workflows/desktop-release.yml'), 'utf8');
  assert.match(builder, /appId: 'com\.choreomaster\.app'/);
  assert.match(builder, /releaseNotesFile: 'build\/release-notes\.md'/);
  assert.match(release, /cancel-in-progress: false/);
  assert.doesNotMatch(release, /Get-FileHash -Algorithm SHA512/);
  assert.match(release, /downloads\/metadata\/\$VERSION\/latest\.yml/);
});
```

- [ ] **Step 2: 编写完整发布手册**

`docs/releasing.md` 使用以下正文：

```markdown
# CosStage 发布手册

## 日常变更

用户可见变更运行 `npm run changeset`；内部变更给 PR 添加 `release:none`。功能分支不得修改 `package.json.version`。

## Release PR

检查版本级别、中文摘要、Major 的“重大变化/迁移说明”、`CHANGELOG.md`、`data/release-history.json` 和 `npm test`。确认后合并 `chore: version packages`。

## Production Environment

Secrets：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`CSC_LINK`、`CSC_KEY_PASSWORD`。
Variable：`WINDOWS_PUBLISHER_NAME`，值必须与 Authenticode 证书 Subject 中的发布者一致。
仓库标签：创建 `release:none`，仅用于明确声明 PR 没有产品版本影响。

## 生产发布

Release PR 合并后观察 `Desktop Release`。成功标准：COS 公网验证通过、`vX.Y.Z` tag 和 GitHub Release 存在、Web 产品指南显示同一 stableVersion。

## 失败补偿

在根 `latest.yml` 更新前失败可直接 rerun。提交点后失败会复用哈希相同的不可变制品并补齐 tag、GitHub Release 或 Web 部署；远端同名不同哈希必须停止调查。

## 回滚

在 Actions 手工运行 `Desktop Rollback`，输入已存在版本号。回滚不会让已安装高版本自动降级；受影响客户端通过发布更高 Patch 恢复。

## 1.0.0 迁移

旧版更新 IPC 不可靠。用户从 `https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe` 下载 1.1.0 并覆盖安装一次，项目目录和设置保留。
```

在 README 的开发命令表后增加：

```markdown
桌面版本、发布和回滚流程见 [发布手册](docs/releasing.md)。
```

- [ ] **Step 3: 记录本地变量名称但不写秘密**

在 `.env.example` 末尾增加：

```dotenv
# Release dry-run only. Production values live in GitHub Environment secrets/variables.
COSSTAGE_REQUIRE_CODE_SIGNING=false
COSSTAGE_WINDOWS_PUBLISHER_NAME=
```

不得加入 `CSC_LINK`、`CSC_KEY_PASSWORD`、腾讯云密钥或证书内容。

- [ ] **Step 4: 执行完整本地验收**

Run: `npm ci`

Run: `npm run validate:release-data`

Run: `npm run test:release`

Run: `npm test`

Run on Windows: `npm run build:electron:win`

Run: `node scripts/release/verify-builder-output.mjs 1.0.0`

Run on Windows unsigned dry-run:

```powershell
./scripts/release/verify-windows-signature.ps1 -InstallerPath release/CosStage-Setup-1.0.0-x64.exe -ExpectedVersion 1.0.0 -ExpectedPublisher "$env:COSSTAGE_WINDOWS_PUBLISHER_NAME" -AllowUnsigned
```

Expected: 所有测试和构建 PASS；Builder 元数据哈希一致；签名脚本只在显式 `-AllowUnsigned` 时接受本地 unsigned 产物。

- [ ] **Step 5: 执行 Release PR 临时仓库验收**

重复 Task 7 的临时 clone 流程，运行 `npm run version-packages` 后额外执行：

```powershell
node -e "const p=require('./package.json');const h=require('./data/release-history.json');if(p.version!=='1.1.0'||h.currentVersion!==p.version)process.exit(1)"
npm test
npm run build:electron:win
node scripts/release/verify-builder-output.mjs 1.1.0
```

Expected: 临时仓库的包、历史、安装包和 `latest.yml` 全部为 `1.1.0`；当前真实 worktree 仍保持 `1.0.0` 和未消费 Changeset。

- [ ] **Step 6: 执行生产配置预检但不发布**

在 GitHub 手工运行 `Desktop Release` 前，确认 Production Environment 已配置四个 secrets、一个 publisher variable、`release:none` 标签和 required reviewers。先在非 `main` 临时分支通过 `workflow_dispatch` 验证 Windows 签名 job；Task 8 的 `github.ref == 'refs/heads/main'` 条件必须让 publish 与 repair job 显示 skipped。下载 CI artifact 后运行 `Get-AuthenticodeSignature`，Expected: `Status = Valid` 且 Subject 包含 `WINDOWS_PUBLISHER_NAME`。

- [ ] **Step 7: 提交发布手册与验收**

```bash
git add docs/releasing.md README.md .env.example tests/desktop-regressions.test.mjs
git commit -m "docs: add desktop release runbook"
```

- [ ] **Step 8: 创建并评审首个 Release PR**

将上述实现提交合入 `main` 后，`release-pr.yml` 应自动创建 `chore: version packages`。在合并前确认：

```text
package.json.version = 1.1.0
package-lock.json 根版本 = 1.1.0
data/release-history.json.currentVersion = 1.1.0
CHANGELOG.md 首个版本 = 1.1.0
build/release-notes.md 标题 = CosStage 1.1.0
.changeset/first-governed-release.md 已被消费
```

Release PR 合并属于生产发布授权，必须由有发布权限的人员执行。合并后观察桌面工作流直到签名、COS、tag、GitHub Release 和 Web 验证全部通过。

---

## Final Verification Matrix

| 设计要求 | 实施任务 | 权威验证 |
|---|---|---|
| 每个变更声明版本影响 | Tasks 1–2、7 | PR change-intent check |
| 聚合 Release PR 升版 | Tasks 2、7 | 临时 clone 生成 `1.1.0` |
| changelog 与结构化历史 | Tasks 1–2 | `validate:release-data` |
| 产品指南版本更新 | Task 4 | release-history tests + Vite build |
| Major 专用提示 | Tasks 3、5 | update contract/preferences tests |
| 安装前保存项目 | Task 5 | desktop regression + handler behavior |
| 在线覆盖安装 | Tasks 3、5、6 | signed NSIS build + updater state |
| Builder 原始更新元数据 | Task 6 | SHA-512/size verifier |
| COS 原子发布 | Task 8 | immutable upload + public verification |
| 签名与权限门禁 | Tasks 6、8、10 | Authenticode + Production Environment |
| 回滚 | Task 9 | index unit test + manual workflow |
| `1.0.0` 一次迁移 | Tasks 2、10 | first changeset + runbook |

计划执行完成后，只有首个 Release PR 的人工合并会触发真实 `1.1.0` 生产发布；实现任务自身不得手工上传或改写 COS stable 指针。

## Primary References

- [Changesets CLI](https://www.npmjs.com/package/@changesets/cli) — Changeset、version 和 status 命令及当前版本。
- [electron-builder Code Signing](https://www.electron.build/docs/features/code-signing/) — `CSC_LINK`、签名环境变量与 `forceCodeSigning`。
- [electron-builder ReleaseInfo](https://www.electron.build/docs/api/electron-builder.interface.releaseinfo/) — `releaseNotesFile` 配置。
