# Cross-Project Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让框选演员和完整队形在项目切换后仍可粘贴，并完整恢复对象、资源、坐标、旋转和隐藏状态。

**Architecture:** 新建 `utils/cross-project-clipboard.ts`，把剪贴板载荷构建、资源自包含和粘贴 ID 重映射从 `App.tsx` 分离成可测试模块。`App.tsx` 只负责捕获当前场景、调用异步复制、合并粘贴结果，以及记录复合撤销动作。

**Tech Stack:** React 19、TypeScript、Node test runner、Electron 自定义资源协议。

---

### Task 1: 纯剪贴板数据模型与演员粘贴

**Files:**
- Create: `utils/cross-project-clipboard.ts`
- Create: `tests/cross-project-clipboard.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写演员跨项目粘贴失败测试**

测试使用与目标 frame ID 无关的载荷，并断言粘贴结果只更新指定目标 frame、恢复原坐标/旋转、创建新分组和新对象 ID，且名字不添加后缀。

```ts
const createIds = (...ids: string[]) => {
  let index = 0;
  return () => ids[index++];
};

test('pastes selected performers into the target frame at copied scene coordinates', () => {
  const payload: PerformerClipboardPayload = {
    kind: 'performers',
    performers: [{ id: 'actor-a', name: 'A', color: '#fff', label: 'A', shape: 'circle', groupId: 'group-a' }],
    groups: [{ id: 'group-a', name: '主演', color: '#fff', collapsed: false }],
    scene: { 'actor-a': { position: { x: 24, y: 61 }, rotation: 1.25 } },
  };
  const pasted = pastePerformerPayload(payload, 'target-frame', createIds('group-new', 'actor-new'));
  assert.equal(pasted.performers[0].name, 'A');
  assert.equal(pasted.performers[0].groupId, 'group-new');
  assert.deepEqual(pasted.frameUpdates['target-frame'].positions['actor-new'], { x: 24, y: 61 });
  assert.equal(pasted.frameUpdates['target-frame'].rotations['actor-new'], 1.25);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --experimental-strip-types --test tests/cross-project-clipboard.test.ts`

Expected: FAIL，模块或导出函数尚不存在。

- [ ] **Step 3: 实现演员载荷与 ID 重映射**

在新模块导出以下类型和函数：

```ts
export interface SceneClipboardEntry {
  position: Position;
  rotation?: number;
}

export interface PerformerClipboardPayload {
  kind: 'performers';
  performers: Performer[];
  groups: PerformerGroup[];
  scene: Record<string, SceneClipboardEntry>;
}

export interface PerformerPasteResult {
  performers: Performer[];
  groups: PerformerGroup[];
  frameUpdates: Record<string, { positions: Record<string, Position>; rotations: Record<string, number> }>;
}

export function pastePerformerPayload(
  payload: PerformerClipboardPayload,
  targetFrameId: string,
  createId: () => string,
): PerformerPasteResult;
```

先为分组创建映射，再为对象创建映射。`groupId` 仅在源分组存在时重映射；`boundToId` 仅在被绑定对象也在载荷中时重映射，否则清除，避免目标项目出现悬空引用。每个场景条目无条件写入目标 frame，因此粘贴对象默认显示。

- [ ] **Step 4: 更新桌面测试脚本并确认 GREEN**

将 `tests/cross-project-clipboard.test.ts` 加入 `test:desktop`。

Run: `npm run test:desktop`

Expected: PASS。

### Task 2: 完整队形重映射

**Files:**
- Modify: `utils/cross-project-clipboard.ts`
- Modify: `tests/cross-project-clipboard.test.ts`

- [ ] **Step 1: 写完整项目对象与隐藏状态测试**

构造两名演员、一个道具、两个分组和一个 Frame，其中一名演员没有位置、一个分组位于 `hiddenGroupIds`，道具 `boundToId` 指向演员。断言粘贴后全部三个对象均创建，名称原样保留，位置/旋转/绑定/隐藏组均使用新 ID。

```ts
test('pastes a formation with every source object and remapped hidden state', () => {
  const payload: FormationClipboardPayload = {
    kind: 'formation',
    groups: [
      { id: 'visible-group', name: '可见组', color: '#fff', collapsed: false },
      { id: 'hidden-group', name: '隐藏组', color: '#000', collapsed: false },
    ],
    performers: [
      { id: 'a', name: 'A', color: '#fff', label: 'A', shape: 'circle', groupId: 'visible-group' },
      { id: 'b', name: 'B', color: '#fff', label: 'B', shape: 'circle', groupId: 'hidden-group' },
      { id: 'door', name: '门板', color: '#999', label: '门', shape: 'square', type: 'prop', boundToId: 'a' },
    ],
    frame: {
      id: 'source-frame', name: 'Opening', startTime: 0, duration: 2000,
      positions: { a: { x: 10, y: 20 }, door: { x: 30, y: 40 } },
      rotations: { a: 0.5, door: 1 }, hiddenGroupIds: ['hidden-group'],
    },
  };
  const pasted = pasteFormationPayload(
    payload,
    9000,
    createIds('group-new-1', 'group-new-2', 'actor-new-a', 'actor-new-b', 'prop-new', 'frame-new'),
  );
  assert.equal(pasted.performers.length, 3);
  assert.deepEqual(pasted.performers.map((item) => item.name), ['A', 'B', '门板']);
  assert.equal(pasted.performers[2].boundToId, pasted.performers[0].id);
  assert.equal(Object.keys(pasted.frame.positions).length, 2);
  assert.deepEqual(pasted.frame.hiddenGroupIds, [pasted.groups[1].id]);
  assert.equal(pasted.frame.startTime, 9000);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --experimental-strip-types --test --test-name-pattern="formation with every" tests/cross-project-clipboard.test.ts`

Expected: FAIL，队形载荷与函数尚不存在。

- [ ] **Step 3: 实现队形载荷与统一映射**

导出：

```ts
export interface FormationClipboardPayload {
  kind: 'formation';
  performers: Performer[];
  groups: PerformerGroup[];
  frame: Frame;
}

export interface FormationPasteResult {
  performers: Performer[];
  groups: PerformerGroup[];
  frame: Frame;
}

export function pasteFormationPayload(
  payload: FormationClipboardPayload,
  startTime: number,
  createId: () => string,
): FormationPasteResult;
```

函数为全部分组、全部对象和新 Frame 生成 ID，重映射 `groupId`、`boundToId`、`positions`、`rotations` 和 `hiddenGroupIds`。无位置对象仍保留在 `performers`，Frame 名称改为 `${source.name} (复制)`，对象名称完全不变。

- [ ] **Step 4: 运行纯函数测试并确认 GREEN**

Run: `node --experimental-strip-types --test tests/cross-project-clipboard.test.ts`

Expected: PASS。

### Task 3: 贴图自包含

**Files:**
- Modify: `utils/cross-project-clipboard.ts`
- Modify: `tests/cross-project-clipboard.test.ts`

- [ ] **Step 1: 写贴图迁移测试**

测试覆盖 `textureDataUrl`、六面贴图和挤出贴图。注入资源读取函数，将 `choreo-asset:` URL 转成固定 data URL，断言结果移除 `textureAssetPath`/`assetPath` 并保留 `fileName`。

```ts
test('makes performer textures self-contained for another project', async () => {
  const sourceProp: Performer = {
    id: 'door', name: '门板', color: '#fff', label: '门', shape: 'square', type: 'prop',
    textureDataUrl: 'choreo-asset://asset/source/assets/props/legacy.png',
    textureAssetPath: 'assets/props/legacy.png',
    boxTextures: {
      front: {
        dataUrl: 'choreo-asset://asset/source/assets/props/front.png',
        assetPath: 'assets/props/front.png',
        fileName: 'front.png',
      },
    },
  };
  const [portable] = await makePerformersPortable([sourceProp], async (url) => {
    assert.match(url, /^choreo-asset:/);
    return 'data:image/png;base64,cG9ydGFibGU=';
  });
  assert.equal(portable.textureAssetPath, undefined);
  assert.match(portable.textureDataUrl ?? '', /^data:image\/png/);
  assert.equal(portable.boxTextures?.front?.assetPath, undefined);
  assert.equal(portable.boxTextures?.front?.fileName, 'front.png');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --experimental-strip-types --test --test-name-pattern="self-contained" tests/cross-project-clipboard.test.ts`

Expected: FAIL，资源转换函数尚不存在。

- [ ] **Step 3: 实现异步资源转换**

导出：

```ts
export type LoadAssetAsDataUrl = (url: string) => Promise<string>;

export async function makePerformersPortable(
  performers: Performer[],
  loadAssetAsDataUrl: LoadAssetAsDataUrl,
): Promise<Performer[]>;
```

已有 `data:` URL 直接保留；其他 `dataUrl` 交给 loader；只有 `assetPath` 时也交给 loader 解析。转换成功后删除所有源项目 asset path。loader 抛错时整个复制失败，防止生成丢贴图的半成品剪贴板。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `node --experimental-strip-types --test tests/cross-project-clipboard.test.ts`

Expected: PASS。

### Task 4: React 接入、复合撤销和帮助文案

**Files:**
- Modify: `App.tsx`
- Modify: `components/HelpModal.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: 写 App 接入回归测试**

静态回归断言 `App.tsx` 不再定义 `positions: Record<string, Position>` 的旧 `ClipboardItem`；使用判别联合载荷；复制演员读取 `currentSceneState.positions/rotations`；复制 Frame 时携带全部 `performers` 和 `performerGroups`；粘贴调用两个纯函数；帮助文案明确支持跨项目。

```js
test('cross-project clipboard carries entities, scene state, and portable assets', async () => {
  const [app, helper, help] = await Promise.all([
    read('App.tsx'),
    read('utils/cross-project-clipboard.ts'),
    read('components/HelpModal.tsx'),
  ]);
  assert.doesNotMatch(app, /interface ClipboardItem/);
  assert.match(app, /currentSceneState\.positions/);
  assert.match(app, /currentSceneState\.rotations/);
  assert.match(app, /kind: 'formation'/);
  assert.match(app, /performers,/);
  assert.match(app, /performerGroups/);
  assert.match(app, /pastePerformerPayload/);
  assert.match(app, /pasteFormationPayload/);
  assert.match(helper, /makePerformersPortable/);
  assert.match(help, /跨项目/);
});
```

- [ ] **Step 2: 运行回归测试并确认 RED**

Run: `node --test --test-name-pattern="cross-project clipboard" tests/desktop-regressions.test.mjs`

Expected: FAIL，App 仍使用源 frame ID 映射和裸 Frame 剪贴板。

- [ ] **Step 3: 接入异步演员复制**

将两个 state 替换为一个判别联合：

```ts
type AppClipboard = PerformerClipboardPayload | FormationClipboardPayload | null;
const [appClipboard, setAppClipboard] = useState<AppClipboard>(null);
```

`copyPerformersToClipboard` 从 `currentSceneState` 捕获每个已选对象的 position/rotation，收集其分组，调用 `makePerformersPortable` 后写入 payload。浏览器 loader 使用 `fetch(url) -> blob -> FileReader.readAsDataURL`；相对 asset path 使用当前 `currentProjectId` 构造 `choreo-asset://asset/<project>/<path>`。成功和失败均通过 `projectMessages` 反馈。

- [ ] **Step 4: 接入演员粘贴与撤销**

粘贴要求 `currentFrameId` 存在。调用 `pastePerformerPayload` 后合并 groups、performers 和目标 Frame 的 positions/rotations。扩展 `PastePerformersUndoAction` 保存新 groups 与 rotation updates；撤销时删除新对象和仅由本次粘贴创建的 groups，重做时完整恢复。

- [ ] **Step 5: 接入完整队形复制/粘贴与复合撤销**

未选择演员时，复制当前 Frame、全部 performers 和全部 performerGroups，并异步内嵌贴图。粘贴调用 `pasteFormationPayload`，追加全部新 groups/performers/frame。

新增 `PasteFormationUndoAction`：

```ts
type PasteFormationUndoAction = {
  type: 'paste-formation';
  performers: Performer[];
  groups: PerformerGroup[];
  frame: Frame;
  previousCurrentFrameId: string | null;
  previousSelectedIds: string[];
};
```

撤销一次删除这三个集合，重做一次恢复这三个集合。粘贴后选择新对象并切换到新 Frame。

- [ ] **Step 6: 更新快捷键异步处理与帮助**

Ctrl/Cmd+C 调用异步复制并立即阻止默认行为；Ctrl/Cmd+V 根据 `appClipboard.kind` 分派。帮助弹窗补充“复制内容可在其他项目粘贴，演员恢复复制瞬间位置，完整队形携带全部演员、道具和贴图”。

- [ ] **Step 7: 运行桌面与构建验证**

Run: `npm run test:desktop && npm run build`

Expected: PASS。

### Task 5: 最终验证与规范更新

**Files:**
- Modify: `.trellis/spec/frontend/state-management.md` or the applicable clipboard spec selected during review

- [ ] **Step 1: 运行完整测试**

Run: `npm test`

Expected: backend、project、desktop 与 Vite build 全部 PASS。

- [ ] **Step 2: 检查任务差异**

Run: `git diff --check && git diff -- App.tsx components/HelpModal.tsx utils/cross-project-clipboard.ts tests/cross-project-clipboard.test.ts tests/desktop-regressions.test.mjs package.json`

Expected: 无空白错误，且不包含既有 `dist-electron` 与 7 月 3 日演员备注文档改动。

- [ ] **Step 3: Trellis 质量检查与提交确认**

加载 `trellis-check`、`trellis-update-spec` 和 `verification-before-completion`；记录跨项目剪贴板必须自包含资源并统一重映射所有实体引用。向用户展示精确提交范围，确认后使用 `feat(project): support cross-project copy and paste` 提交。
