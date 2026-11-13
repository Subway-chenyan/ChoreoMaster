import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpRuntimeContext, } from './context.js';
import { McpToolError } from './context.js';
import type { McpChangeEntry, McpChangeHistory, McpChangeSummary } from './history.js';
import {
  applyChoreoPlan,
  createGridPosition,
  generateEntityId,
  type AIChoreoPlan,
} from './plan-apply.js';
import { CHOREO_SCHEMA_DOC } from './schema-doc.js';
import type {
  Frame,
  Performer,
  Position,
  ProjectDocument,
  ProjectMeta,
  StageConfig,
  TransitionSegment,
} from '../project-contract.js';
import { normalizeTransitions } from '../project-contract.js';
import {
  createManagedProject,
  listManagedProjects,
  readManagedProjectDocument,
  saveManagedProject,
} from '../project-service.js';

// ==================== 结果构造（技能最佳实践：始终带 text fallback） ====================

function ok(payload: object, summary: string): CallToolResult {
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: payload,
  };
}

function fail(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

// ==================== 通用解析辅助 ====================

async function resolveProjectId(ctx: McpRuntimeContext, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const active = ctx.getActiveProjectId();
  if (!active) {
    throw new McpToolError('未指定 projectId，且桌面端当前没有打开的项目。请显式传入 projectId，或先用 choreo_open_project / choreo_create_project 设置活动项目。');
  }
  return active;
}

function resolvePerformerRef(doc: ProjectDocument, ref: string): Performer {
  const byId = doc.performers.find((p) => p.id === ref);
  if (byId) return byId;
  const byName = doc.performers.filter((p) => p.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new McpToolError(`名称 "${ref}" 匹配到 ${byName.length} 个实体，存在歧义，请使用实体 id。`);
  }
  throw new McpToolError(`未找到实体 "${ref}"。可用实体：${doc.performers.map((p) => `${p.name}(${p.id})`).join('、') || '无'}`);
}

function resolveFrameRef(doc: ProjectDocument, ref: string): Frame {
  const byId = doc.frames.find((f) => f.id === ref);
  if (byId) return byId;
  const byName = doc.frames.filter((f) => f.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new McpToolError(`帧名称 "${ref}" 匹配到 ${byName.length} 个帧，存在歧义，请使用帧 id。`);
  }
  throw new McpToolError(`未找到帧 "${ref}"。可用帧：${doc.frames.map((f) => `${f.name}(${f.id}, t=${f.startTime}ms)`).join('；') || '无'}`);
}

function resolveGroupRef(doc: ProjectDocument, ref: string) {
  const byId = doc.performerGroups.find((g) => g.id === ref);
  if (byId) return byId;
  const byName = doc.performerGroups.filter((g) => g.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new McpToolError(`分组名称 "${ref}" 匹配到 ${byName.length} 个分组，存在歧义，请使用分组 id。`);
  }
  throw new McpToolError(`未找到分组 "${ref}"。可用分组：${doc.performerGroups.map((g) => `${g.name}(${g.id})`).join('、') || '无'}`);
}

// positions 的 key 支持 实体id 或 实体名称，统一解析为实体 id
function resolvePositions(doc: ProjectDocument, positions: Record<string, Position>): Record<string, Position> {
  const resolved: Record<string, Position> = {};
  for (const [ref, pos] of Object.entries(positions)) {
    resolved[resolvePerformerRef(doc, ref).id] = pos;
  }
  return resolved;
}

function resolveRotations(doc: ProjectDocument, rotations: Record<string, number>): Record<string, number> {
  const resolved: Record<string, number> = {};
  for (const [ref, value] of Object.entries(rotations)) {
    resolved[resolvePerformerRef(doc, ref).id] = value;
  }
  return resolved;
}

// ==================== 统一写流程：flush → 读 → 变换 → 落盘 → 记历史 → 通知渲染端 ====================

// 按项目串行化写入：MCP 服务为 stateless（每请求独立 server 实例），
// 同一项目并发调用会读-改-写同一份文档，必须排队避免丢失更新。
const projectWriteQueues = new Map<string, Promise<unknown>>();

async function withProjectLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = projectWriteQueues.get(projectId) ?? Promise.resolve();
  // 前序任务失败不应阻断后续任务
  const next = previous.then(task, task);
  // 链条存的是"已吞掉错误"的版本，避免未处理的 rejection
  projectWriteQueues.set(projectId, next.catch(() => undefined));
  return next;
}

interface WriteOptions {
  projectId?: string;
  toolName: string;
  description: string;
  mutate: (doc: ProjectDocument) => ProjectDocument | Promise<ProjectDocument>;
}

async function writeWithHistory(
  ctx: McpRuntimeContext,
  history: McpChangeHistory,
  options: WriteOptions,
): Promise<{ projectId: string; before: ProjectDocument; after: ProjectDocument; entry: McpChangeEntry }> {
  const projectId = await resolveProjectId(ctx, options.projectId);
  return withProjectLock(projectId, async () => {
    const storagePath = await ctx.getStoragePath();
    // 写前 flush 渲染端未保存编辑（best-effort，超时降级使用磁盘版本）
    await ctx.flushRendererEdits(projectId).catch(() => false);
    const before = await readManagedProjectDocument(storagePath, projectId);
    const draft = await options.mutate(structuredClone(before));
    const after = await saveManagedProject(storagePath, projectId, draft);
    const entry = history.push({ projectId, toolName: options.toolName, description: options.description, before, after });
    ctx.notifyProjectUpdated({
      changeId: entry.id,
      projectId,
      toolName: options.toolName,
      description: options.description,
      timestamp: entry.timestamp,
    });
    return { projectId, before, after, entry };
  });
}

async function readActiveDoc(ctx: McpRuntimeContext, projectId?: string): Promise<{ projectId: string; doc: ProjectDocument }> {
  const id = await resolveProjectId(ctx, projectId);
  const storagePath = await ctx.getStoragePath();
  const doc = await readManagedProjectDocument(storagePath, id);
  return { projectId: id, doc };
}

function describeEntity(p: Performer): string {
  return `${p.name}(${p.id}${p.type === 'prop' ? ', 道具' : ''})`;
}

// ==================== zod 输入模型 ====================

const positionSchema = z.object({
  x: z.number().describe('舞台横向百分比 0-100（0=左，100=右）'),
  y: z.number().describe('舞台纵深百分比 0-100（0=台后，100=台口）'),
  z: z.number().optional().describe('离地高度（米），默认 0'),
});

const projectIdSchema = z.string().optional().describe('目标项目 id；缺省时使用桌面端当前打开的活动项目');

const entityCreateSchema = z.object({
  name: z.string().describe('实体名称，如 演员A / 门板1'),
  type: z.enum(['performer', 'prop']).optional().describe('performer=演员（缺省），prop=道具'),
  color: z.string().optional().describe('hex 颜色，如 #EF4444'),
  label: z.string().optional().describe('舞台上显示的单字标签，缺省取名称首字符'),
  shape: z.enum(['circle', 'square', 'triangle']).optional().describe('形状；演员常用 circle，道具常用 square'),
  groupId: z.string().optional().describe('所属分组 id'),
  groupName: z.string().optional().describe('所属分组名称（与 groupId 二选一，名称需唯一）'),
  width: z.number().optional().describe('宽（米），道具建议必填，如门板 1.8'),
  height: z.number().optional().describe('高（米），道具建议必填，如门板 2.5'),
  depth: z.number().optional().describe('深（米），道具建议必填，如门板 0.15'),
  rotation: z.number().optional().describe('初始朝向（度）'),
  modelAssetId: z.string().optional().describe('绑定的 3D 模型资产 id（道具用；1.6+ 以模型资产替代旧几何贴图）'),
  modelAspectLocked: z.boolean().optional().describe('是否锁定模型宽高比'),
  propCategory: z.enum(['prop', 'platform']).optional().describe('道具类别：prop=道具，platform=平台'),
  locked: z.boolean().optional().describe('是否锁定'),
});

const entityUpdateSchema = entityCreateSchema.partial().extend({
  entityId: z.string().optional().describe('实体 id（与 name 二选一）'),
  name: z.string().optional().describe('按名称定位实体；也可用于重命名（当 entityId 存在时）'),
});

const frameCreateSchema = z.object({
  name: z.string().optional().describe('帧名称，缺省自动编号'),
  startTime: z.number().int().nonnegative().describe('帧起始时间（毫秒）'),
  duration: z.number().int().positive().optional().describe('帧时长（毫秒），缺省 2000'),
  positions: z.record(z.string(), positionSchema).optional().describe('该帧站位，key=实体id或名称；未提及的实体自动网格占位'),
  rotations: z.record(z.string(), z.number()).optional().describe('该帧朝向（度），key=实体id或名称'),
  notes: z.string().optional().describe('帧备注'),
});

const frameUpdateSchema = z.object({
  frameId: z.string().optional().describe('帧 id（与 frameName 二选一）'),
  frameName: z.string().optional().describe('帧名称定位（需唯一）'),
  name: z.string().optional().describe('新帧名称'),
  startTime: z.number().int().nonnegative().optional().describe('新起始时间（毫秒）'),
  duration: z.number().int().positive().optional().describe('新时长（毫秒）'),
  notes: z.string().optional().describe('新备注'),
  positions: z.record(z.string(), positionSchema).optional().describe('要合并的站位更新，key=实体id或名称'),
  rotations: z.record(z.string(), z.number()).optional().describe('要合并的朝向更新（度）'),
  clearPositions: z.boolean().optional().describe('true 时先清空原站位再应用 positions'),
});

const objectMotionSchema = z.object({
  pathType: z.enum(['linear', 'bezier']).optional().describe('路径类型，缺省 linear'),
  controlPoints: z.array(positionSchema).max(2).optional().describe('贝塞尔控制点（最多 2 个，百分比坐标），pathType=bezier 时使用'),
  rotationMode: z.enum(['fixed', 'lerp']).optional().describe('旋转模式：fixed 保持起始朝向，lerp 插值'),
  startRotation: z.number().optional().describe('起始朝向（度）'),
  endRotation: z.number().optional().describe('结束朝向（度）'),
});

const planSchema: z.ZodType<AIChoreoPlan> = z.object({
  intent: z.string().optional(),
  summary: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  groupsToCreate: z.array(z.object({
    tempId: z.string(),
    name: z.string(),
    color: z.string(),
    type: z.enum(['performer', 'prop']).optional(),
  })).optional(),
  entitiesToCreate: z.array(z.object({
    tempId: z.string(),
    type: z.enum(['performer', 'prop']).optional(),
    name: z.string(),
    color: z.string(),
    label: z.string().optional(),
    shape: z.enum(['circle', 'square', 'triangle']).optional(),
    groupTempId: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    depth: z.number().optional(),
    rotation: z.number().optional(),
    modelAssetId: z.string().optional(),
    modelAspectLocked: z.boolean().optional(),
    propCategory: z.enum(['prop', 'platform']).optional(),
  })).optional(),
  framesToCreate: z.array(z.object({
    tempId: z.string().optional(),
    name: z.string(),
    startTime: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    positions: z.record(z.string(), positionSchema),
    notes: z.string().optional(),
  })).optional(),
  positionUpdates: z.array(z.object({
    frameId: z.string(),
    positions: z.record(z.string(), positionSchema),
  })).optional(),
}) as z.ZodType<AIChoreoPlan>;

// ==================== 工具注册 ====================

export function registerChoreoTools(
  server: McpServer,
  ctx: McpRuntimeContext,
  history: McpChangeHistory,
): void {
  // ---------- 数据结构说明 ----------
  server.registerTool('choreo_get_schema', {
    title: '获取数据结构说明',
    description: '获取 CosStage 项目数据结构（ProjectDocument）、坐标系、AIChoreoPlan 格式与常用队形速查。编排前必读。',
    inputSchema: z.object({}),
  }, async (): Promise<CallToolResult> => ok({ schema: CHOREO_SCHEMA_DOC }, CHOREO_SCHEMA_DOC));

  // ---------- 项目列表 ----------
  server.registerTool('choreo_list_projects', {
    title: '列出项目',
    description: '列出本地存储中的全部 CosStage 项目（id、名称、创建/更新时间）。',
    inputSchema: z.object({}),
  }, async (): Promise<CallToolResult> => {
    try {
      const storagePath = await ctx.getStoragePath();
      const projects: ProjectMeta[] = await listManagedProjects(storagePath);
      const lines = projects.map((p) => `- ${p.name} (id=${p.id}, 更新于 ${p.updatedAt})`);
      return ok({ projects }, `共 ${projects.length} 个项目：\n${lines.join('\n') || '（空）'}`);
    } catch (error) {
      return fail(`列出项目失败：${(error as Error).message}`);
    }
  });

  // ---------- 读取项目 ----------
  server.registerTool('choreo_get_project', {
    title: '读取项目',
    description: '读取完整项目文档（分组/实体/帧/转场/舞台配置）。缺省读取活动项目。修改前用它获取真实 id。',
    inputSchema: z.object({ projectId: projectIdSchema }),
  }, async ({ projectId }): Promise<CallToolResult> => {
    try {
      const { projectId: id, doc } = await readActiveDoc(ctx, projectId);
      const summary = `项目「${doc.name}」：${doc.performerGroups.length} 分组 / ${doc.performers.length} 实体（含道具）/ ${doc.frames.length} 帧 / ${doc.transitions?.length ?? 0} 转场`;
      return ok({ projectId: id, project: doc }, summary);
    } catch (error) {
      return fail(`读取项目失败：${(error as Error).message}`);
    }
  });

  // ---------- 新建项目 ----------
  server.registerTool('choreo_create_project', {
    title: '新建项目',
    description: '快速创建新项目：可一并指定分组、演员/道具、舞台配置与初始帧。创建后自动设为活动项目并在桌面端打开。',
    inputSchema: z.object({
      name: z.string().describe('项目名称'),
      groups: z.array(z.object({
        name: z.string(),
        color: z.string().optional(),
        type: z.enum(['performer', 'prop']).optional().describe('缺省 performer'),
      })).optional().describe('初始分组'),
      entities: z.array(entityCreateSchema).optional().describe('初始演员与道具'),
      stageConfig: z.object({
        width: z.number().optional(),
        depth: z.number().optional(),
        wingWidth: z.number().optional(),
        ledWidth: z.number().optional(),
        ledHeight: z.number().optional(),
      }).optional().describe('舞台配置（米），缺省 20 x 11.25'),
      frames: z.array(frameCreateSchema).optional().describe('初始帧；未提及的实体自动网格占位'),
      open: z.boolean().optional().describe('是否在桌面端打开（缺省 true）'),
    }),
  }, async ({ name, groups, entities, stageConfig, frames, open }): Promise<CallToolResult> => {
    try {
      const storagePath = await ctx.getStoragePath();
      const created = await createManagedProject(storagePath, name);
      const projectId = created.id;
      const before = await readManagedProjectDocument(storagePath, projectId);

      const draft = structuredClone(before);
      draft.name = name;
      if (stageConfig) {
        draft.stageConfig = { ...draft.stageConfig, ...stageConfig };
      }
      const createdGroups = (groups ?? []).map((g) => ({
        id: generateEntityId(),
        name: g.name,
        color: g.color || '#3B82F6',
        collapsed: false,
        type: g.type || 'performer',
      }));
      draft.performerGroups = [...draft.performerGroups, ...createdGroups];

      const createdPerformers: Performer[] = (entities ?? []).map((e) => {
        const groupId = e.groupId
          ? resolveGroupRef(draft, e.groupId).id
          : (e.groupName ? resolveGroupRef(draft, e.groupName).id : undefined);
        return {
          id: generateEntityId(),
          name: e.name,
          color: e.color || (e.type === 'prop' ? '#78716C' : '#EF4444'),
          label: e.label || e.name.charAt(0).toUpperCase(),
          shape: e.shape || (e.type === 'prop' ? 'square' : 'circle'),
          type: e.type,
          groupId,
          width: e.type === 'prop' ? (e.width ?? 1) : e.width,
          height: e.type === 'prop' ? (e.height ?? 2) : e.height,
          depth: e.type === 'prop' ? (e.depth ?? 0.3) : e.depth,
          rotation: e.rotation,
          modelAssetId: e.modelAssetId,
          propCategory: e.type === 'prop' ? (e.propCategory ?? 'prop') : e.propCategory,
        };
      });
      draft.performers = [...draft.performers, ...createdPerformers];

      const totalEntities = draft.performers.length;
      const createdFrames: Frame[] = (frames ?? []).map((f, index) => {
        const positions = f.positions
          ? resolvePositions(draft, f.positions)
          : {};
        // 未显式给出站位的实体自动网格占位（与 applyAIPlan 语义一致）
        draft.performers.forEach((p, pIndex) => {
          if (positions[p.id] === undefined) {
            positions[p.id] = createGridPosition(pIndex, totalEntities);
          }
        });
        return {
          id: generateEntityId(),
          name: f.name || `队形 ${index + 1}`,
          startTime: f.startTime,
          duration: f.duration ?? 2000,
          positions,
          rotations: f.rotations ? resolveRotations(draft, f.rotations) : {},
          notes: f.notes,
        };
      });
      createdFrames.sort((a, b) => a.startTime - b.startTime);
      draft.frames = [...draft.frames, ...createdFrames];

      const after = await saveManagedProject(storagePath, projectId, draft);
      const entry = history.push({
        projectId,
        toolName: 'choreo_create_project',
        description: `新建项目「${name}」`,
        before,
        after,
      });

      ctx.setActiveProjectId(projectId);
      if (open !== false) {
        ctx.notifyOpenProject(projectId);
      }
      ctx.notifyProjectUpdated({
        changeId: entry.id,
        projectId,
        toolName: 'choreo_create_project',
        description: `新建项目「${name}」`,
        timestamp: entry.timestamp,
      });

      return ok({
        projectId,
        changeId: entry.id,
        entityIds: after.performers.map((p) => p.id),
        frameIds: after.frames.map((f) => f.id),
      }, `项目「${name}」已创建（${after.performers.length} 实体 / ${after.frames.length} 帧），已在桌面端打开。实体：${after.performers.map(describeEntity).join('、') || '无'}`);
    } catch (error) {
      return fail(`创建项目失败：${(error as Error).message}`);
    }
  });

  // ---------- 打开项目 ----------
  server.registerTool('choreo_open_project', {
    title: '打开项目',
    description: '将指定项目设为活动项目，并让桌面端打开它。后续工具调用缺省作用于该活动项目。',
    inputSchema: z.object({ projectId: z.string().describe('项目 id') }),
  }, async ({ projectId }): Promise<CallToolResult> => {
    try {
      const storagePath = await ctx.getStoragePath();
      const doc = await readManagedProjectDocument(storagePath, projectId);
      ctx.setActiveProjectId(projectId);
      ctx.notifyOpenProject(projectId);
      return ok({ projectId }, `已在桌面端打开项目「${doc.name}」（${doc.performers.length} 实体 / ${doc.frames.length} 帧），后续修改默认作用于该项目。`);
    } catch (error) {
      return fail(`打开项目失败：${(error as Error).message}`);
    }
  });

  // ---------- 帧增删改 ----------
  server.registerTool('choreo_update_frames', {
    title: '修改帧/队形',
    description: '批量创建/更新/删除队形关键帧。更新支持按帧 id 或帧名称定位，positions 的 key 支持实体 id 或名称；未显式给位的实体在新帧中自动网格占位。这是修改指定帧队形的核心工具。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      create: z.array(frameCreateSchema).optional().describe('要新增的帧'),
      update: z.array(frameUpdateSchema).optional().describe('要更新的帧'),
      deleteFrameIds: z.array(z.string()).optional().describe('要删除的帧 id 或名称列表'),
    }),
  }, async ({ projectId, create, update, deleteFrameIds }): Promise<CallToolResult> => {
    if (!create && !update && !deleteFrameIds) return fail('至少提供 create / update / deleteFrameIds 之一。');
    try {
      const result = await writeWithHistory(ctx, history, {
        projectId,
        toolName: 'choreo_update_frames',
        description: `修改帧（+${create?.length ?? 0} / 改${update?.length ?? 0} / 删${deleteFrameIds?.length ?? 0}）`,
        mutate: (doc) => {
          const created: Frame[] = (create ?? []).map((f, index) => {
            const positions = f.positions ? resolvePositions(doc, f.positions) : {};
            doc.performers.forEach((p, pIndex) => {
              if (positions[p.id] === undefined) {
                positions[p.id] = createGridPosition(pIndex, doc.performers.length);
              }
            });
            return {
              id: generateEntityId(),
              name: f.name || `队形 ${doc.frames.length + index + 1}`,
              startTime: f.startTime,
              duration: f.duration ?? 2000,
              positions,
              rotations: f.rotations ? resolveRotations(doc, f.rotations) : {},
              notes: f.notes,
            };
          });
          doc.frames = [...doc.frames, ...created];

          for (const spec of update ?? []) {
            const target = resolveFrameRef(doc, spec.frameId || spec.frameName || '');
            const patch = { ...target } as Frame;
            if (spec.name !== undefined) patch.name = spec.name;
            if (spec.startTime !== undefined) patch.startTime = spec.startTime;
            if (spec.duration !== undefined) patch.duration = spec.duration;
            if (spec.notes !== undefined) patch.notes = spec.notes;
            if (spec.positions) {
              const merged = spec.clearPositions ? {} : { ...patch.positions };
              Object.assign(merged, resolvePositions(doc, spec.positions));
              patch.positions = merged;
            }
            if (spec.rotations) {
              patch.rotations = { ...(patch.rotations ?? {}), ...resolveRotations(doc, spec.rotations) };
            }
            doc.frames = doc.frames.map((f) => (f.id === target.id ? patch : f));
          }

          if (deleteFrameIds?.length) {
            const deleteIds = new Set(deleteFrameIds.map((ref) => resolveFrameRef(doc, ref).id));
            doc.frames = doc.frames.filter((f) => !deleteIds.has(f.id));
            doc.transitions = (doc.transitions ?? []).filter(
              (t) => !deleteIds.has(t.fromFrameId) && !deleteIds.has(t.toFrameId),
            );
          }

          doc.frames.sort((a, b) => a.startTime - b.startTime);
          return doc;
        },
      });
      const doc = result.after;
      return ok({
        projectId: result.projectId,
        changeId: result.entry.id,
        frames: doc.frames.map((f) => ({ id: f.id, name: f.name, startTime: f.startTime })),
      }, `帧修改已应用并实时同步。当前 ${doc.frames.length} 帧：${doc.frames.map((f) => `${f.name}(t=${f.startTime}ms)`).join('；') || '无'}`);
    } catch (error) {
      return fail(`修改帧失败：${(error as Error).message}`);
    }
  });

  // ---------- 实体（演员/道具）增删改 ----------
  server.registerTool('choreo_update_entities', {
    title: '修改演员/道具',
    description: '批量创建/更新/删除演员与道具（统一实体模型）。新实体会在既有帧自动补网格站位；删除实体会级联清理各帧站位与转场运动。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      create: z.array(entityCreateSchema).optional().describe('要新增的演员/道具'),
      update: z.array(entityUpdateSchema).optional().describe('要更新的实体（按 entityId 或 name 定位）'),
      deleteEntityIds: z.array(z.string()).optional().describe('要删除的实体 id 或名称列表'),
    }),
  }, async ({ projectId, create, update, deleteEntityIds }): Promise<CallToolResult> => {
    if (!create && !update && !deleteEntityIds) return fail('至少提供 create / update / deleteEntityIds 之一。');
    try {
      const result = await writeWithHistory(ctx, history, {
        projectId,
        toolName: 'choreo_update_entities',
        description: `修改实体（+${create?.length ?? 0} / 改${update?.length ?? 0} / 删${deleteEntityIds?.length ?? 0}）`,
        mutate: (doc) => {
          const baseCount = doc.performers.length;
          const created: (Performer & { _gridIndex: number })[] = (create ?? []).map((e, index) => {
            const groupId = e.groupId
              ? resolveGroupRef(doc, e.groupId).id
              : (e.groupName ? resolveGroupRef(doc, e.groupName).id : undefined);
            return {
              id: generateEntityId(),
              name: e.name,
              color: e.color || (e.type === 'prop' ? '#78716C' : '#EF4444'),
              label: e.label || e.name.charAt(0).toUpperCase(),
              shape: e.shape || (e.type === 'prop' ? 'square' : 'circle'),
              type: e.type,
              groupId,
              width: e.type === 'prop' ? (e.width ?? 1) : e.width,
              height: e.type === 'prop' ? (e.height ?? 2) : e.height,
              depth: e.type === 'prop' ? (e.depth ?? 0.3) : e.depth,
              rotation: e.rotation,
              modelAssetId: e.modelAssetId,
              propCategory: e.type === 'prop' ? (e.propCategory ?? 'prop') : e.propCategory,
              locked: e.locked,
              // 网格占位索引（与 applyAIPlan 的 baseCount+index 语义一致）
              _gridIndex: baseCount + index,
            } as Performer & { _gridIndex: number };
          });

          const totalCount = baseCount + created.length;
          const plainCreated: Performer[] = created.map(({ _gridIndex, ...rest }) => {
            // 新实体在既有帧自动补网格占位
            doc.frames = doc.frames.map((frame) => ({
              ...frame,
              positions: {
                ...frame.positions,
                [rest.id]: frame.positions[rest.id] ?? createGridPosition(_gridIndex, totalCount),
              },
            }));
            return rest;
          });
          doc.performers = [...doc.performers, ...plainCreated];

          for (const spec of update ?? []) {
            const target = resolvePerformerRef(doc, spec.entityId || spec.name || '');
            const patch = { ...target } as Partial<Performer>;
            if (spec.entityId && spec.name !== undefined) patch.name = spec.name;
            if (spec.color !== undefined) patch.color = spec.color;
            if (spec.label !== undefined) patch.label = spec.label;
            if (spec.shape !== undefined) patch.shape = spec.shape;
            if (spec.width !== undefined) patch.width = spec.width;
            if (spec.height !== undefined) patch.height = spec.height;
            if (spec.depth !== undefined) patch.depth = spec.depth;
            if (spec.rotation !== undefined) patch.rotation = spec.rotation;
            if (spec.modelAssetId !== undefined) patch.modelAssetId = spec.modelAssetId || undefined;
            if (spec.modelAspectLocked !== undefined) patch.modelAspectLocked = spec.modelAspectLocked;
            if (spec.propCategory !== undefined) patch.propCategory = spec.propCategory;
            if (spec.locked !== undefined) patch.locked = spec.locked;
            if (spec.groupId !== undefined) patch.groupId = spec.groupId || undefined;
            if (spec.groupName !== undefined) patch.groupId = spec.groupName ? resolveGroupRef(doc, spec.groupName).id : undefined;
            doc.performers = doc.performers.map((p) => (p.id === target.id ? (patch as Performer) : p));
          }

          if (deleteEntityIds?.length) {
            const deleteIds = new Set(deleteEntityIds.map((ref) => resolvePerformerRef(doc, ref).id));
            doc.performers = doc.performers.filter((p) => !deleteIds.has(p.id));
            doc.frames = doc.frames.map((frame) => {
              const positions = { ...frame.positions };
              const rotations = { ...(frame.rotations ?? {}) };
              deleteIds.forEach((id) => {
                delete positions[id];
                delete rotations[id];
              });
              return { ...frame, positions, rotations };
            });
            doc.transitions = (doc.transitions ?? []).map((t) => {
              const objectMotions = { ...t.objectMotions };
              deleteIds.forEach((id) => delete objectMotions[id]);
              return { ...t, objectMotions };
            });
            doc.performerNotes = (doc.performerNotes ?? []).filter((n) => !deleteIds.has(n.performerId));
          }
          return doc;
        },
      });
      const doc = result.after;
      return ok({
        projectId: result.projectId,
        changeId: result.entry.id,
        entities: doc.performers.map((p) => ({ id: p.id, name: p.name, type: p.type ?? 'performer' })),
      }, `实体修改已应用并实时同步。当前 ${doc.performers.length} 个实体：${doc.performers.map(describeEntity).join('、') || '无'}`);
    } catch (error) {
      return fail(`修改实体失败：${(error as Error).message}`);
    }
  });

  // ---------- 分组增删改 ----------
  server.registerTool('choreo_update_groups', {
    title: '修改分组',
    description: '批量创建/更新/删除演员/道具分组。删除分组时组内实体保留并解除归属。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      create: z.array(z.object({
        name: z.string(),
        color: z.string().optional(),
        type: z.enum(['performer', 'prop']).optional(),
      })).optional(),
      update: z.array(z.object({
        groupId: z.string().optional().describe('分组 id（与 name 二选一）'),
        name: z.string().optional().describe('按名称定位；也可用于重命名（当 groupId 存在时）'),
        color: z.string().optional(),
        type: z.enum(['performer', 'prop']).optional(),
      })).optional(),
      deleteGroupIds: z.array(z.string()).optional().describe('要删除的分组 id 或名称列表'),
    }),
  }, async ({ projectId, create, update, deleteGroupIds }): Promise<CallToolResult> => {
    if (!create && !update && !deleteGroupIds) return fail('至少提供 create / update / deleteGroupIds 之一。');
    try {
      const result = await writeWithHistory(ctx, history, {
        projectId,
        toolName: 'choreo_update_groups',
        description: `修改分组（+${create?.length ?? 0} / 改${update?.length ?? 0} / 删${deleteGroupIds?.length ?? 0}）`,
        mutate: (doc) => {
          doc.performerGroups = [...doc.performerGroups, ...(create ?? []).map((g) => ({
            id: generateEntityId(),
            name: g.name,
            color: g.color || '#3B82F6',
            collapsed: false,
            type: g.type || 'performer',
          }))];

          for (const spec of update ?? []) {
            const target = resolveGroupRef(doc, spec.groupId || spec.name || '');
            const patch = { ...target };
            if (spec.groupId && spec.name !== undefined) patch.name = spec.name;
            if (spec.color !== undefined) patch.color = spec.color;
            if (spec.type !== undefined) patch.type = spec.type;
            doc.performerGroups = doc.performerGroups.map((g) => (g.id === target.id ? patch : g));
          }

          if (deleteGroupIds?.length) {
            const deleteIds = new Set(deleteGroupIds.map((ref) => resolveGroupRef(doc, ref).id));
            doc.performerGroups = doc.performerGroups.filter((g) => !deleteIds.has(g.id));
            doc.performers = doc.performers.map((p) => (
              p.groupId && deleteIds.has(p.groupId) ? { ...p, groupId: undefined } : p
            ));
          }
          return doc;
        },
      });
      const doc = result.after;
      return ok({
        projectId: result.projectId,
        changeId: result.entry.id,
        groups: doc.performerGroups.map((g) => ({ id: g.id, name: g.name })),
      }, `分组修改已应用并实时同步。当前分组：${doc.performerGroups.map((g) => g.name).join('、') || '无'}`);
    } catch (error) {
      return fail(`修改分组失败：${(error as Error).message}`);
    }
  });

  // ---------- 舞台配置 ----------
  server.registerTool('choreo_update_stage', {
    title: '修改舞台配置',
    description: '修改舞台配置（宽/深/侧台/LED 等尺寸，单位米）。只更新传入的字段。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      patch: z.object({
        width: z.number().positive().optional().describe('主舞台宽（米）'),
        depth: z.number().positive().optional().describe('主舞台深（米）'),
        wingWidth: z.number().nonnegative().optional().describe('侧台宽（米）'),
        ledWidth: z.number().positive().optional().describe('LED 宽（米）'),
        ledHeight: z.number().nonnegative().optional().describe('LED 高（米）'),
        ledBottomHeight: z.number().nonnegative().optional().describe('LED 底部离地高（米）'),
        showStageLines: z.boolean().optional().describe('是否显示舞台标线'),
      }).describe('要更新的舞台配置字段'),
    }),
  }, async ({ projectId, patch }): Promise<CallToolResult> => {
    try {
      const result = await writeWithHistory(ctx, history, {
        projectId,
        toolName: 'choreo_update_stage',
        description: `修改舞台配置（${Object.keys(patch).join('、')}）`,
        mutate: (doc) => {
          doc.stageConfig = { ...doc.stageConfig, ...patch } as StageConfig;
          return doc;
        },
      });
      const stage = result.after.stageConfig;
      return ok({
        projectId: result.projectId,
        changeId: result.entry.id,
        stageConfig: stage,
      }, `舞台配置已更新并实时同步：${stage.width}m x ${stage.depth}m${stage.wingWidth ? `，侧台 ${stage.wingWidth}m` : ''}。`);
    } catch (error) {
      return fail(`修改舞台配置失败：${(error as Error).message}`);
    }
  });

  // ---------- 转场 ----------
  server.registerTool('choreo_update_transition', {
    title: '修改转场',
    description: '修改两帧之间的转场：时长、每实体的运动路径（直线/贝塞尔控制点）与朝向插值。按 transitionId 或 fromFrameId+toFrameId 定位；转场不存在时会新建。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      transitionId: z.string().optional().describe('转场 id（与 fromFrameId+toFrameId 二选一）'),
      fromFrameId: z.string().optional().describe('起始帧 id 或名称'),
      toFrameId: z.string().optional().describe('目标帧 id 或名称'),
      duration: z.number().int().positive().optional().describe('转场时长（毫秒）'),
      objectMotions: z.record(z.string(), objectMotionSchema).optional().describe('实体运动配置，key=实体id或名称；未配置的实体默认直线移动'),
      removeObjectMotionIds: z.array(z.string()).optional().describe('要清除运动配置的实体 id 或名称（恢复默认直线）'),
      remove: z.boolean().optional().describe('true 时删除该转场（恢复默认直线过渡）'),
    }),
  }, async ({ projectId, transitionId, fromFrameId, toFrameId, duration, objectMotions, removeObjectMotionIds, remove }): Promise<CallToolResult> => {
    if (!transitionId && !(fromFrameId && toFrameId)) {
      return fail('请提供 transitionId，或同时提供 fromFrameId 与 toFrameId 来定位转场。');
    }
    try {
      const result = await writeWithHistory(ctx, history, {
        projectId,
        toolName: 'choreo_update_transition',
        description: `修改转场（${transitionId || `${fromFrameId}→${toFrameId}`}）`,
        mutate: (doc) => {
          const fromId = fromFrameId ? resolveFrameRef(doc, fromFrameId).id : undefined;
          const toId = toFrameId ? resolveFrameRef(doc, toFrameId).id : undefined;
          const transitions = [...(doc.transitions ?? [])];
          let index = transitionId
            ? transitions.findIndex((t) => t.id === transitionId)
            : transitions.findIndex((t) => t.fromFrameId === fromId && t.toFrameId === toId);

          if (remove) {
            if (index < 0) throw new McpToolError('未找到要删除的转场。');
            transitions.splice(index, 1);
            doc.transitions = transitions;
            return doc;
          }

          if (index < 0) {
            if (!fromId || !toId) throw new McpToolError('转场不存在，且缺少 fromFrameId/toFrameId，无法新建。');
            transitions.push({
              id: `transition-${fromId}-${toId}`,
              fromFrameId: fromId,
              toFrameId: toId,
              objectMotions: {},
            });
            index = transitions.length - 1;
          }

          const target = { ...transitions[index] };
          if (duration !== undefined) target.duration = duration;
          if (objectMotions) {
            const motions = { ...target.objectMotions };
            for (const [ref, motion] of Object.entries(objectMotions)) {
              const entityId = resolvePerformerRef(doc, ref).id;
              const sanitized = normalizeTransitions([{
                id: 'probe',
                fromFrameId: target.fromFrameId,
                toFrameId: target.toFrameId,
                objectMotions: { [entityId]: motion },
              }])[0].objectMotions[entityId];
              if (sanitized) motions[entityId] = sanitized;
            }
            target.objectMotions = motions;
          }
          if (removeObjectMotionIds?.length) {
            const motions = { ...target.objectMotions };
            removeObjectMotionIds.forEach((ref) => delete motions[resolvePerformerRef(doc, ref).id]);
            target.objectMotions = motions;
          }
          transitions[index] = target;
          doc.transitions = transitions;
          return doc;
        },
      });
      return ok({
        projectId: result.projectId,
        changeId: result.entry.id,
        transition: result.after.transitions?.find((t) =>
          transitionId ? t.id === transitionId : (fromFrameId && t.fromFrameId === resolveFrameRef(result.after, fromFrameId).id)),
      }, '转场修改已应用并实时同步。');
    } catch (error) {
      return fail(`修改转场失败：${(error as Error).message}`);
    }
  });

  // ---------- 应用 AIChoreoPlan ----------
  server.registerTool('choreo_apply_plan', {
    title: '应用编排计划',
    description: '一次性应用一整套编排计划（AIChoreoPlan 格式，见 choreo_get_schema）：批量建分组/实体/帧并合并站位更新。灵感编排的推荐方式：由你（模型）生成完整 plan 后调用本工具。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      plan: planSchema.describe('AIChoreoPlan 编排计划'),
      overwrite: z.boolean().optional().describe('true 时清空既有分组/实体/帧后重建（缺省追加合并）'),
    }),
  }, async ({ projectId, plan, overwrite }): Promise<CallToolResult> => {
    try {
      const result = await writeWithHistory(ctx, history, {
        projectId,
        toolName: 'choreo_apply_plan',
        description: `应用编排计划（${plan.summary || plan.intent || 'AIChoreoPlan'}${overwrite ? '，覆盖模式' : ''}）`,
        mutate: (doc) => applyChoreoPlan(doc, plan, overwrite === true).document,
      });
      const doc = result.after;
      const warnings = plan.warnings?.length ? `\n注意：${plan.warnings.join('；')}` : '';
      return ok({
        projectId: result.projectId,
        changeId: result.entry.id,
        entityCount: doc.performers.length,
        frameCount: doc.frames.length,
        frames: doc.frames.map((f) => ({ id: f.id, name: f.name, startTime: f.startTime })),
      }, `编排计划已应用并实时同步：${doc.performers.length} 实体 / ${doc.frames.length} 帧。${warnings}`);
    } catch (error) {
      return fail(`应用编排计划失败：${(error as Error).message}`);
    }
  });

  // ---------- 历史 ----------
  server.registerTool('choreo_list_changes', {
    title: '列出变更历史',
    description: '列出该项目的 MCP 变更历史（最新在前），返回 changeId 可用于 choreo_rollback_to 精确回退。',
    inputSchema: z.object({
      projectId: projectIdSchema,
      limit: z.number().int().positive().max(50).optional().describe('返回条数，缺省 20'),
    }),
  }, async ({ projectId, limit }): Promise<CallToolResult> => {
    try {
      const { projectId: id } = await readActiveDoc(ctx, projectId);
      const changes: McpChangeSummary[] = history.listUndoable(id).slice(0, limit ?? 20);
      const lines = changes.map((c) => `- [${new Date(c.timestamp).toLocaleTimeString()}] ${c.toolName}: ${c.description} (changeId=${c.id})`);
      return ok({ projectId: id, changes }, `可回退变更 ${changes.length} 条：\n${lines.join('\n') || '（无）'}`);
    } catch (error) {
      return fail(`读取历史失败：${(error as Error).message}`);
    }
  });

  // ---------- 撤销 ----------
  server.registerTool('choreo_undo', {
    title: '撤销上一次 MCP 修改',
    description: '回退该项目最近一次 MCP 修改（恢复修改前文档并实时同步桌面端）。桌面端手动编辑不在 MCP 历史内。',
    inputSchema: z.object({ projectId: projectIdSchema }),
  }, async ({ projectId }): Promise<CallToolResult> => {
    try {
      const id = await resolveProjectId(ctx, projectId);
      if (!history.canUndo(id)) return fail('没有可撤销的 MCP 修改。');
      const entry = await withProjectLock(id, async () => {
        const popped = history.popUndo(id);
        if (!popped) return null;
        const storagePath = await ctx.getStoragePath();
        // undo 不做写前 flush：语义是恢复修改前状态，渲染端本地编辑由其 undo 栈保护
        await saveManagedProject(storagePath, id, structuredClone(popped.before));
        return popped;
      });
      if (!entry) return fail('没有可撤销的 MCP 修改。');
      ctx.notifyProjectUpdated({
        changeId: entry.id,
        projectId: id,
        toolName: 'choreo_undo',
        description: `撤销：${entry.description}`,
        timestamp: Date.now(),
      });
      const restored = await readManagedProjectDocument(await ctx.getStoragePath(), id);
      return ok({ projectId: id, undone: entry.description, restoredFrameCount: restored.frames.length }, `已撤销「${entry.description}」，桌面端已回退。`);
    } catch (error) {
      return fail(`撤销失败：${(error as Error).message}`);
    }
  });

  // ---------- 重做 ----------
  server.registerTool('choreo_redo', {
    title: '重做被撤销的修改',
    description: '重新应用该项目最近一次被撤销的 MCP 修改，并实时同步桌面端。',
    inputSchema: z.object({ projectId: projectIdSchema }),
  }, async ({ projectId }): Promise<CallToolResult> => {
    try {
      const id = await resolveProjectId(ctx, projectId);
      if (!history.canRedo(id)) return fail('没有可重做的修改。');
      const entry = await withProjectLock(id, async () => {
        const popped = history.popRedo(id);
        if (!popped) return null;
        const storagePath = await ctx.getStoragePath();
        await saveManagedProject(storagePath, id, structuredClone(popped.after));
        return popped;
      });
      if (!entry) return fail('没有可重做的修改。');
      ctx.notifyProjectUpdated({
        changeId: entry.id,
        projectId: id,
        toolName: 'choreo_redo',
        description: `重做：${entry.description}`,
        timestamp: Date.now(),
      });
      const restored = await readManagedProjectDocument(await ctx.getStoragePath(), id);
      return ok({ projectId: id, redone: entry.description, frameCount: restored.frames.length }, `已重做「${entry.description}」，桌面端已同步。`);
    } catch (error) {
      return fail(`重做失败：${(error as Error).message}`);
    }
  });

  // ---------- 回退到指定变更 ----------
  server.registerTool('choreo_rollback_to', {
    title: '回退到指定变更点',
    description: '把项目回退到指定 changeId（来自 choreo_list_changes）之前的状态：该变更及其后所有 MCP 修改全部撤销，并实时同步桌面端。',
    inputSchema: z.object({ changeId: z.string().describe('目标变更的 changeId（choreo_list_changes 获取）') }),
  }, async ({ changeId }): Promise<CallToolResult> => {
    try {
      const found = history.findUndoable(changeId);
      if (!found) return fail(`未找到可回退的变更 ${changeId}（可能已被撤销）。请用 choreo_list_changes 查看当前可回退的变更。`);
      const { entry } = found;
      const projectId = entry.projectId;
      const result = await withProjectLock(projectId, async () => {
        let undoneCount = 0;
        // 自顶向下撤销直到目标变更（含）
        while (true) {
          const popped = history.popUndo(projectId);
          if (!popped) break;
          undoneCount += 1;
          if (popped.id === changeId) break;
        }
        const storagePath = await ctx.getStoragePath();
        await saveManagedProject(storagePath, projectId, structuredClone(entry.before));
        return { undoneCount };
      });
      ctx.notifyProjectUpdated({
        changeId,
        projectId,
        toolName: 'choreo_rollback_to',
        description: `回退 ${result.undoneCount} 处变更至「${entry.description}」之前`,
        timestamp: Date.now(),
      });
      return ok({ projectId, undoneCount: result.undoneCount, target: entry.description }, `已回退 ${result.undoneCount} 处变更，桌面端已回到「${entry.description}」之前的状态。`);
    } catch (error) {
      return fail(`回退失败：${(error as Error).message}`);
    }
  });
}
