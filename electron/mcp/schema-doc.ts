// choreo_get_schema 工具返回的静态数据结构文档（中文）。
// 供 MCP 客户端的模型理解 CosStage 项目数据格式，是编排生成的"说明书"。
export const CHOREO_SCHEMA_DOC = `# CosStage 项目数据结构说明

## 坐标系（关键）
- 演员站位 Position: { x, y, z? }
  - x: 舞台横向百分比 0-100（0=左侧，100=右侧，50=中央；配置侧台时可超出 0-100 表示进入侧台）
  - y: 舞台纵深百分比 0-100（0=台后/背景方向，100=台口/观众方向，50=中央）
  - z: 可选，离地高度（米），默认 0
- 所有帧内 positions 均使用此百分比坐标系；常用范围 2-98（越界会被自动钳制）
- 朝向 rotation：角度（度），0=面向观众，逆时针为正
- 时间：startTime / duration 均为毫秒（ms）

## ProjectDocument（project.json 顶层结构）
- version: '3.0'
- name: 项目名
- musicName / musicAsset: 音频名与相对路径（MCP 不管理音频资产）
- performerGroups: PerformerGroup[] 分组
- performers: Performer[] 实体列表（演员与道具统一模型）
- frames: Frame[] 队形关键帧
- transitions: TransitionSegment[] 帧间转场
- audioMarkers: AudioMarker[] 音频标记 { id, label, timeMs, color }
- stageConfig: 舞台配置
- performerNotes: 演员备注

## PerformerGroup
{ id, name, color(hex), collapsed, type?: 'performer' | 'prop', locked? }

## Performer（演员与道具统一实体）
{ id, name, color(hex), label(舞台单字标签), shape: 'circle'|'square'|'triangle',
  groupId?, type?: 'performer'|'prop',
  width?, height?, depth?（米，真实尺寸，道具必填）, rotation?,
  modelAssetId?, modelAspectLocked?, propCategory?: 'prop'|'platform',
  propShape?, rotationPivot?: 'center'|'left'|'right', locked? }
- 演员: type='performer'（缺省即演员），shape 通常 'circle'
- 道具: type='prop'，shape 通常 'square'，需给 width/height/depth（如门板 1.8 x 2.5 x 0.15）

## Frame（队形关键帧）
{ id, name, startTime(ms), duration(ms),
  positions: { [实体id]: {x,y,z?} },
  rotations?: { [实体id]: 度 },
  notes?, hiddenGroupIds? }
- frames 按 startTime 排序；前一帧结束（startTime+duration）到下一帧 startTime 之间为转场窗口

## TransitionSegment（转场）
{ id, fromFrameId, toFrameId, duration?(ms),
  objectMotions: { [实体id]: { pathType?: 'linear'|'bezier',
    controlPoints?: [{x,y,z?}](最多2个，百分比坐标),
    rotationMode?: 'fixed'|'lerp', startRotation?, endRotation? } } }
- 未配置 objectMotions 的实体默认直线线性移动

## StageConfig
{ width(米,默认20), depth(米,默认11.25), wingWidth?(米,侧台), ledWidth?, ledHeight?,
  ledBottomHeight?, ledContent?: {type:'none'|'color'|'image'|'video', value?, loop?},
  showStageLines?, ledDistanceFromBack? }

## AIChoreoPlan（choreo_apply_plan 的 plan 参数格式）
tempId 为客户端自拟的临时标识，应用时会自动映射为真实 id；已有实体/帧直接用真实 id。
{
  intent: 'initialize_project'|'create_entities'|'generate_formation'|'generate_motion_frames',
  summary: string, warnings: string[],
  groupsToCreate: [{ tempId, name, color, type?: 'performer'|'prop' }],
  entitiesToCreate: [{ tempId, type: 'performer'|'prop', name, color, label?,
    shape?, groupTempId?, width?, height?, depth?, rotation?, modelAssetId?, propCategory? }],
  framesToCreate: [{ tempId, name, startTime(ms), duration(ms),
    positions: { [tempId或实体id]: {x,y,z?} }, notes? }],
  positionUpdates: [{ frameId(真实id), positions: { [tempId或实体id]: {x,y,z?} } }]
}
- 新建实体若在某帧未给出位置，将自动网格排布占位
- overwrite=true 时清空既有分组/实体/帧后重建（默认追加合并）

## 常用队形坐标速查（x 左→右，y 台后→台口）
- 一字横排（台前）: y≈75，x 从 20 到 80 等距
- 一字横排（台后）: y≈25
- V 字: 中间靠台口、两侧靠台后
- 圆形: 围绕 (50,50) 半径 25-35 的圆周等分
- 三角形: 顶点 (50,30)，底边 y≈70
- 两侧聚集: 左 (25,50) 右 (75,50) 两簇

## 工具使用要点
- 修改类工具默认作用于桌面端当前打开的项目（活动项目），也可显式传 projectId
- 实体/帧的定位支持 id 或名称（名称需唯一，建议优先用 choreo_get_project 获取真实 id）
- 每次 MCP 修改都会记入历史，可用 choreo_undo / choreo_redo / choreo_rollback_to 回退
- 修改会实时同步到桌面端渲染（若桌面端正打开该项目）`;
