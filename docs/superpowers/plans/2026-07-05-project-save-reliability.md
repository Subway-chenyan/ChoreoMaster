# Project Save Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复保存后演员被清空的问题，并提供可靠的手动、快捷键和五分钟自动保存反馈。

**Architecture:** Renderer 以当前 React 状态为唯一编辑事实来源，所有保存入口经同一个串行协调函数提交不可变快照，保存结果只更新保存元数据而不反写演员或队形。Electron 主进程采用同目录临时文件写入和重命名替换，避免直接覆盖正式项目文件。

**Tech Stack:** React 19、TypeScript、Electron IPC、Node.js `fs/promises`、Node test runner。

---

### Task 1: 项目文件原子写入

**Files:**
- Modify: `tests/project-service.test.mjs`
- Modify: `electron/project-service.ts`

- [ ] **Step 1: 写入失败回归测试**

在 `tests/project-service.test.mjs` 增加用例：先创建并保存一个有效项目，再向待保存文档加入无法 JSON 序列化的 `BigInt` 值并断言保存失败；随后重新读取 `project.json`，确认原演员仍存在，并确认项目目录没有遗留 `.tmp` 文件。

```js
test('keeps the previous project file when atomic serialization fails', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Atomic Save Project');
    await saveManagedProject(storagePath, created.id, projectDocument('Atomic Save Project'));
    const invalid = projectDocument('Atomic Save Project');
    invalid.frames[0].positions['prop-1'].invalid = 1n;

    await assert.rejects(() => saveManagedProject(storagePath, created.id, invalid));

    const saved = JSON.parse(await readFile(path.join(created.path, 'project.json'), 'utf8'));
    assert.equal(saved.performers[0].id, 'prop-1');
    assert.deepEqual((await readdir(created.path)).filter((name) => name.includes('.tmp-')), []);
  });
});
```

- [ ] **Step 2: 验证测试先失败**

Run: `npm run build:main && node --test --test-name-pattern="atomic serialization" tests/project-service.test.mjs`

Expected: FAIL，因为现有实现会直接截断或覆盖 `project.json`，或者没有原子临时文件语义。

- [ ] **Step 3: 实现原子 JSON 写入**

在 `electron/project-service.ts` 新增内部函数。先完成 JSON 序列化，再写入同目录唯一临时文件，成功后用 `rename` 替换正式文件；无论成功失败都尝试清理临时文件。

```ts
async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
```

将 `createManagedProject` 和 `saveManagedProject` 的正式项目文档写入改为调用该函数，避免创建和保存路径行为不一致。

- [ ] **Step 4: 验证项目服务测试通过**

Run: `npm run test:project`

Expected: PASS，且新用例确认旧文件在失败后仍可读取。

### Task 2: 保存状态回归约束

**Files:**
- Modify: `tests/desktop-regressions.test.mjs`
- Modify: `App.tsx`
- Modify: `components/Sidebar.tsx`

- [ ] **Step 1: 写 renderer 静态回归测试**

在 `tests/desktop-regressions.test.mjs` 增加保存可靠性用例，读取 `App.tsx` 与 `components/Sidebar.tsx` 并断言：

```js
test('project saving preserves editor state and exposes autosave feedback', async () => {
  const [app, sidebar] = await Promise.all([read('App.tsx'), read('components/Sidebar.tsx')]);
  const saveHandler = app.slice(app.indexOf('const handleSaveProject'), app.indexOf('const handleImportProjectPackage'));

  assert.doesNotMatch(saveHandler, /setPerformers\(saved\.data\.performers\)/);
  assert.doesNotMatch(saveHandler, /setFrames\(saved\.data\.frames\)/);
  assert.match(app, /AUTO_SAVE_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(app, /SAVE_SUCCESS_DURATION_MS = 2000/);
  assert.match(app, /saveInFlightRef/);
  assert.match(app, /saveRequestedRef/);
  assert.match(app, /window\.setInterval/);
  assert.match(app, /保存成功/);
  assert.match(sidebar, /上次保存/);
  assert.match(sidebar, /保存中/);
});
```

- [ ] **Step 2: 验证 renderer 测试先失败**

Run: `node --test --test-name-pattern="project saving preserves" tests/desktop-regressions.test.mjs`

Expected: FAIL，因为当前保存会反写演员状态，且没有自动保存、保存中状态或上次保存时间。

- [ ] **Step 3: 增加保存元数据与最新状态 refs**

在 `App.tsx` 增加：

```ts
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;
const SAVE_SUCCESS_DURATION_MS = 2000;

const [isProjectSaving, setIsProjectSaving] = useState(false);
const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
const [saveSuccessVisible, setSaveSuccessVisible] = useState(false);
const latestProjectSnapshotRef = useRef<{ projectId: string | null; document: ProjectDocument; state: string } | null>(null);
const saveInFlightRef = useRef<Promise<boolean> | null>(null);
const saveRequestedRef = useRef(false);
const saveToastTimerRef = useRef<number | null>(null);
```

每次项目状态变化时同步 `latestProjectSnapshotRef`，使全局键盘监听和定时器不依赖过期闭包。加载项目时使用合法的 `updatedAt` 初始化 `lastSavedAt`，新建项目时使用当前时间。

- [ ] **Step 4: 重写单向、串行保存管线**

`handleSaveProject` 捕获最新快照并启动唯一 Promise。并发调用将 `saveRequestedRef` 置为 `true` 并复用当前 Promise；当前写入结束后，如果最新状态与刚保存状态不同且收到重复请求，则继续保存最新快照。成功路径只更新 `lastSavedState`、`projectHasChanges`、`lastSavedAt`、`isProjectSaving` 和成功提示；不得调用演员、队形或舞台 setter。

保存失败时保留 `projectHasChanges`，显示“项目保存失败，请检查磁盘空间和目录权限”，并返回 `false`。

- [ ] **Step 5: 接入快捷键、五分钟自动保存与两秒提示**

快捷键 effect 只注册一次，通过保存函数 ref 调用最新逻辑并阻止默认行为。自动保存 effect 使用 `window.setInterval(..., AUTO_SAVE_INTERVAL_MS)`，仅在当前项目存在且 ref 中状态与 `lastSavedState` 不同时触发。成功提示 effect 或辅助函数在 `SAVE_SUCCESS_DURATION_MS` 后隐藏，并在卸载时清理 timer。

- [ ] **Step 6: 更新设置页保存 UI**

扩展 `SidebarProps`：

```ts
onSaveProject?: () => Promise<boolean>;
isProjectSaving?: boolean;
lastSavedAt?: number | null;
```

保存按钮仅在 `isProjectSaving` 时禁用；文案依次为“保存中…”、“保存项目”或“已保存”。按钮下方显示 `上次保存：${new Date(lastSavedAt).toLocaleString('zh-CN')}`，没有成功保存记录时显示“尚未保存”。

- [ ] **Step 7: 渲染两秒成功提示并传递 props**

从 `App.tsx` 向 `Sidebar` 传递 `isProjectSaving` 与 `lastSavedAt`。在现有项目消息浮层附近渲染独立的绿色“保存成功”提示，由 `saveSuccessVisible` 控制，避免错误消息的手动关闭语义与两秒成功反馈互相干扰。

- [ ] **Step 8: 验证桌面回归与生产构建**

Run: `npm run test:desktop`

Expected: PASS。

Run: `npm run build`

Expected: PASS，无 TypeScript 或 Vite 构建错误。

### Task 3: 全量验证与提交准备

**Files:**
- Verify only: all task files

- [ ] **Step 1: 运行项目相关完整验证**

Run: `npm run test:project && npm run test:desktop && npm run build`

Expected: 全部 PASS。

- [ ] **Step 2: 检查差异范围**

Run: `git diff -- App.tsx components/Sidebar.tsx electron/project-service.ts tests/project-service.test.mjs tests/desktop-regressions.test.mjs`

Expected: 仅包含本任务保存可靠性相关改动；不覆盖已有 `dist-electron` 更新功能改动和演员备注文档。

- [ ] **Step 3: 按 Trellis 完成规范复盘和提交确认**

加载 `trellis-check` 与 `trellis-update-spec`，记录可复用的保存规则；向用户展示精确提交文件与提交信息 `fix(project): make saves reliable and observable`，获得确认后再提交，不推送。
