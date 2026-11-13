// MCP 服务端到端测试：真实 HTTP 服务 + 官方 MCP Client
// 覆盖：工具注册、新建项目、修改帧/实体、undo/redo/rollback、flush 降级
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpChangeHistory } from '../dist-electron/mcp/history.js';
import { startMcpServer } from '../dist-electron/mcp/server.js';
import { readManagedProjectDocument } from '../dist-electron/project-service.js';

// 可配置的桩运行时上下文（替代 Electron runtime）
function createStubRuntime(getStoragePath) {
  const state = { activeProjectId: null, events: [], flushResult: true };
  return {
    state,
    runtime: {
      getStoragePath: async () => getStoragePath,
      getActiveProjectId: () => state.activeProjectId,
      setActiveProjectId: (projectId) => { state.activeProjectId = projectId; },
      clearActiveProjectId: (projectId) => {
        if (state.activeProjectId === projectId) state.activeProjectId = null;
      },
      flushRendererEdits: async () => state.flushResult,
      notifyProjectUpdated: (change) => state.events.push({ type: 'updated', ...change }),
      notifyOpenProject: (projectId) => state.events.push({ type: 'open', projectId }),
    },
  };
}

async function readDoc(storagePath, projectId) {
  return readManagedProjectDocument(storagePath, projectId);
}

test('MCP 服务端到端：工具集 / 新建项目 / 修改 / 回退 / flush 降级', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'mcp-test-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storagePath, { recursive: true, force: true });
  });

  const { runtime, state } = createStubRuntime(storagePath);
  const history = new McpChangeHistory();
  const server = await startMcpServer({ port: 0, runtime, history });
  t.after(() => server.close());

  const client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`));
  await client.connect(transport);
  t.after(() => client.close());

  const call = async (name, arguments_) => {
    const result = await client.callTool({ name, arguments: arguments_ ?? {} });
    assert.ok(!result.isError, `工具 ${name} 不应报错：${result.content?.[0]?.text ?? ''}`);
    return result.structuredContent;
  };

  // ---- 工具注册齐全 ----
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [
    'choreo_apply_plan',
    'choreo_create_project',
    'choreo_get_project',
    'choreo_get_schema',
    'choreo_list_changes',
    'choreo_list_projects',
    'choreo_open_project',
    'choreo_redo',
    'choreo_rollback_to',
    'choreo_undo',
    'choreo_update_entities',
    'choreo_update_frames',
    'choreo_update_groups',
    'choreo_update_stage',
    'choreo_update_transition',
  ]);

  // ---- schema 文档可读 ----
  const schema = await call('choreo_get_schema');
  assert.ok(schema.schema.includes('坐标系'));

  // ---- 新建项目：分组 + 演员/道具 + 初始帧 ----
  const created = await call('choreo_create_project', {
    name: 'MCP 测试项目',
    groups: [{ name: '演员组' }, { name: '道具组', type: 'prop' }],
    entities: [
      { name: '演员A', type: 'performer', color: '#EF4444' },
      { name: '演员B', type: 'performer' },
      { name: '门板1', type: 'prop', width: 1.8, height: 2.5, depth: 0.15, groupName: '道具组' },
    ],
    frames: [
      { startTime: 0, duration: 3000, name: '开场', positions: { 演员A: { x: 20, y: 50 }, 演员B: { x: 80, y: 50 } } },
      { startTime: 5000, duration: 3000, name: '聚拢' },
    ],
  });
  const projectId = created.projectId;
  assert.ok(projectId, '应返回 projectId');
  assert.equal(state.activeProjectId, projectId, '新建后应设为活动项目');
  assert.ok(state.events.some((e) => e.type === 'open' && e.projectId === projectId), '应通知渲染端打开项目');

  let doc = await readDoc(storagePath, projectId);
  assert.equal(doc.performers.length, 3);
  assert.equal(doc.frames.length, 2);
  assert.equal(doc.performerGroups.length, 2);
  const door = doc.performers.find((p) => p.name === '门板1');
  assert.ok(door && door.type === 'prop' && door.width === 1.8);
  // 第一帧：显式站位（名称 key 解析）；第二帧：自动网格占位
  const opening = doc.frames.find((f) => f.name === '开场');
  const actorA = doc.performers.find((p) => p.name === '演员A');
  assert.equal(opening.positions[actorA.id].x, 20);
  const gather = doc.frames.find((f) => f.name === '聚拢');
  assert.equal(Object.keys(gather.positions).length, 3, '未显式给位的实体应自动网格占位');

  // ---- 修改帧：按帧名称定位、按演员名称改站位 ----
  await call('choreo_update_frames', {
    update: [{ frameName: '开场', positions: { 演员A: { x: 50, y: 75 } } }],
  });
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.frames.find((f) => f.name === '开场').positions[actorA.id].x, 50);
  const changes1 = await call('choreo_list_changes', {});
  assert.ok(changes1.changes.length >= 2, '历史应包含新建与改帧两条');

  // ---- 修改实体：新增演员自动在既有帧补位 ----
  await call('choreo_update_entities', {
    create: [{ name: '演员C', type: 'performer' }],
  });
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.performers.length, 4);
  for (const frame of doc.frames) {
    assert.ok(frame.positions[doc.performers.find((p) => p.name === '演员C').id], `帧 ${frame.name} 应为演员C补位`);
  }

  // ---- undo：回退最近一次（新增演员C） ----
  const undone = await call('choreo_undo', {});
  assert.ok(undone.undone.includes('修改实体'));
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.performers.length, 3, 'undo 后演员C应被移除');

  // ---- redo：重新应用 ----
  const redone = await call('choreo_redo', {});
  assert.ok(redone.redone.includes('修改实体'));
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.performers.length, 4);

  // ---- rollback_to：回退到「新建项目」之前不行（那是第一条），改为回退到改帧那条之前 ----
  const changeList = await call('choreo_list_changes', {});
  const frameChange = changeList.changes.find((c) => c.toolName === 'choreo_update_frames');
  assert.ok(frameChange, '历史中应包含改帧变更');
  const rollback = await call('choreo_rollback_to', { changeId: frameChange.id });
  assert.ok(rollback.undoneCount >= 1);
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.performers.length, 3, '回退后应移除演员C');
  assert.equal(doc.frames.find((f) => f.name === '开场').positions[actorA.id].x, 20, '回退后站位应恢复');

  // ---- flush 降级：渲染端不响应（返回 false）时写入仍应成功 ----
  state.flushResult = false;
  await call('choreo_update_stage', { patch: { width: 24 } });
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.stageConfig.width, 24);

  // ---- apply_plan：整套编排计划 ----
  await call('choreo_apply_plan', {
    plan: {
      intent: 'generate_formation',
      summary: '测试编排',
      entitiesToCreate: [
        { tempId: 't1', type: 'performer', name: '演员D', color: '#3B82F6' },
      ],
      framesToCreate: [
        { tempId: 'f1', name: '新队形', startTime: 10000, duration: 2000, positions: { t1: { x: 50, y: 50 } } },
      ],
    },
  });
  doc = await readDoc(storagePath, projectId);
  assert.equal(doc.frames.length, 3, '应新增一帧');
  assert.ok(doc.performers.some((p) => p.name === '演员D'));

  // ---- 实时通知：每次写操作都推送了 projectUpdated ----
  const updatedEvents = state.events.filter((e) => e.type === 'updated');
  assert.ok(updatedEvents.length >= 5, `应推送多次更新通知，实际 ${updatedEvents.length}`);
  assert.ok(updatedEvents.every((e) => e.projectId === projectId && e.changeId && e.description));

  // ---- 项目列表与读取 ----
  const projects = await call('choreo_list_projects');
  assert.equal(projects.projects.length, 1);
  const fetched = await call('choreo_get_project', {});
  assert.equal(fetched.project.performers.length, doc.performers.length);

  // ---- 打开项目 ----
  const opened = await call('choreo_open_project', { projectId });
  assert.ok(opened.projectId === projectId);

  // ---- 转场：新建并配置贝塞尔路径 ----
  const firstFrame = doc.frames[0];
  const secondFrame = doc.frames[1];
  await call('choreo_update_transition', {
    fromFrameId: firstFrame.id,
    toFrameId: secondFrame.id,
    duration: 1500,
    objectMotions: {
      演员A: { pathType: 'bezier', controlPoints: [{ x: 30, y: 20 }, { x: 70, y: 80 }] },
    },
  });
  doc = await readDoc(storagePath, projectId);
  const transition = (doc.transitions ?? []).find((t) => t.fromFrameId === firstFrame.id);
  assert.ok(transition, '应创建转场');
  assert.equal(transition.duration, 1500);
  const motion = transition.objectMotions[actorA.id];
  assert.ok(motion && motion.pathType === 'bezier' && motion.controlPoints.length === 2);

  // ---- project.json 落盘校验：不包含 choreo-asset:// 协议 URL ----
  const rawJson = await readFile(path.join(storagePath, 'projects', projectId, 'project.json'), 'utf8');
  assert.ok(!rawJson.includes('choreo-asset://'), '磁盘文档不应包含协议 URL');
});

test('MCP 并发写入串行化：同一项目并发改帧不丢更新', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'mcp-test-concurrent-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storagePath, { recursive: true, force: true });
  });

  const { runtime } = createStubRuntime(storagePath);
  const server = await startMcpServer({ port: 0, runtime, history: new McpChangeHistory() });
  t.after(() => server.close());

  const client = new Client({ name: 'mcp-test-client-concurrent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));
  t.after(() => client.close());

  const created = await client.callTool({
    name: 'choreo_create_project',
    arguments: {
      name: '并发测试',
      entities: [{ name: '演员A' }, { name: '演员B' }],
      frames: [{ startTime: 0, duration: 2000, name: 'F1' }],
    },
  });
  assert.ok(!created.isError, created.content?.[0]?.text);
  const projectId = created.structuredContent.projectId;

  // 并发发起 5 次实体新增：若未串行化，后写会覆盖前写导致实体丢失
  const results = await Promise.all(
    ['C', 'D', 'E', 'F', 'G'].map((suffix) => client.callTool({
      name: 'choreo_update_entities',
      arguments: { projectId, create: [{ name: `演员${suffix}` }] },
    })),
  );
  for (const result of results) {
    assert.ok(!result.isError, result.content?.[0]?.text);
  }

  const doc = await readDoc(storagePath, projectId);
  assert.equal(doc.performers.length, 7, `并发新增后应有 7 个实体，实际 ${doc.performers.length}`);
  for (const suffix of ['C', 'D', 'E', 'F', 'G']) {
    assert.ok(doc.performers.some((p) => p.name === `演员${suffix}`), `演员${suffix} 不应丢失`);
  }
  // 每个新实体都应在既有帧获得站位
  const frame = doc.frames[0];
  for (const performer of doc.performers) {
    assert.ok(frame.positions[performer.id], `${performer.name} 应在 F1 有站位`);
  }
});

test('MCP 错误处理：无活动项目时报错而非崩溃', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'mcp-test-err-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storagePath, { recursive: true, force: true });
  });

  const { runtime } = createStubRuntime(storagePath);
  const server = await startMcpServer({ port: 0, runtime, history: new McpChangeHistory() });
  t.after(() => server.close());

  const client = new Client({ name: 'mcp-test-client-err', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));
  t.after(() => client.close());

  const result = await client.callTool({ name: 'choreo_get_project', arguments: {} });
  assert.equal(result.isError, true, '无活动项目时 get_project 应返回 isError');
  assert.ok(result.content[0].text.includes('projectId'), '错误信息应引导传入 projectId');

  const undoResult = await client.callTool({ name: 'choreo_undo', arguments: {} });
  assert.equal(undoResult.isError, true, '无历史时 undo 应返回 isError');

  const badUpdate = await client.callTool({
    name: 'choreo_update_frames',
    arguments: { update: [{ frameName: '不存在的帧', positions: { a: { x: 1, y: 1 } } }] },
  });
  // 无活动项目：应引导设置项目；不会抛出未捕获异常
  assert.equal(badUpdate.isError, true);
});
