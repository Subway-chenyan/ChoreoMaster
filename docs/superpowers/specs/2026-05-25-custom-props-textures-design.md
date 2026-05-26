# 异形道具与多面贴图设计

## 概述

为 ChoreoMaster 添加异形道具支持（自定义多边形拉伸体）和立方体6面独立贴图功能。提供独立的道具编辑窗口，包含 Canvas 2D 多边形编辑器、PNG 透明度检测自动生成轮廓、以及实时3D预览。

## 数据模型

### 新增类型

```typescript
// 3D道具几何体类型
export type PropGeometryType = 'box' | 'extruded';

// 单面贴图数据
export interface FaceTexture {
  dataUrl: string;
  fileName?: string;
}

// 6面独立贴图映射（仅 box 类型）
export interface BoxTextures {
  front?: FaceTexture;    // +Z 面向舞台/观众
  back?: FaceTexture;     // -Z
  left?: FaceTexture;     // -X
  right?: FaceTexture;    // +X
  top?: FaceTexture;      // +Y
  bottom?: FaceTexture;   // -Y
}
```

### Performer 接口扩展

```typescript
export interface Performer {
  // ... 现有字段保留不变

  propGeometryType?: PropGeometryType;  // 几何体类型，默认 'box'
  boxTextures?: BoxTextures;             // 6面贴图（box 专用，替代 textureDataUrl）
  extrudeHeight?: number;                // 拉伸高度（extruded 专用），单位米
  // polygonPoints 已存在，继续复用
}
```

### 兼容性

- `textureDataUrl` 保留，旧道具无需迁移
- `propGeometryType` 默认 `'box'`，现有道具行为不变
- `extrudeHeight` 默认等于 `height` 字段

## 独立编辑窗口 (PropEditorModal)

大型模态框组件，布局为左右两栏。

### 窗口结构

```
┌─────────────────────────────────────────────────────┐
│  编辑道具: [道具名称]                          [✕]  │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  形状编辑    │        实时3D预览                      │
│  ──────────  │        (R3F小画布)                    │
│  [类型切换]  │                                      │
│  立方体/异形 │                                      │
│              │                                      │
│  基本属性    │                                      │
│  名称/尺寸   │                                      │
│              │                                      │
│  ──────────  │                                      │
│  贴图编辑    │                                      │
│  (根据类型   │                                      │
│   展示不同UI)│                                      │
│              │                                      │
├──────────────┴──────────────────────────────────────┤
│                    [取消]  [保存]                    │
└─────────────────────────────────────────────────────┘
```

### 左侧面板

**形状类型切换**：两个 Tab — "立方体" / "异形"

- 立方体模式：width/depth/height 输入框 + 旋转
- 异形模式：
  - 工具栏：绘制 / 选择顶点 / 删除顶点 / 清空 / 从PNG生成
  - Canvas 2D 画布（网格背景，显示多边形轮廓）
  - 拉伸高度输入框 + width/depth 比例尺（自动从轮廓计算）

**贴图编辑**（根据几何体类型不同）：

- 立方体模式：6个面卡片网格（2x3），每个卡片显示面名称 + 缩略图 + "选择贴图"/"清除"按钮，默认贴图面（front）高亮标注
- 异形模式：顶面 / 底面 / 侧面（拉伸面），每个区域可设贴图；侧面贴图自动映射到拉伸面

### 右侧3D预览

小型 R3F 画布，实时反映形状和贴图修改。可旋转查看，不支持拖拽移动。

## 2D 多边形编辑器 (ShapeEditor2D)

Canvas 元素，网格背景（单位米），居中显示道具轮廓。

### 三种编辑模式

1. **绘制模式**（铅笔图标）
   - 点击添加顶点，自动连线
   - 双击或点击首顶点闭合多边形（至少3个顶点）
   - 闭合后自动切换到选择模式

2. **选择模式**（箭头图标）
   - 点击顶点选中（蓝色高亮）
   - 拖拽顶点移动（吸附到 0.1m 网格）
   - 点击线段中点插入新顶点
   - 右键顶点删除（保持至少3个顶点）

3. **PNG轮廓生成**（图片图标）
   - 文件选择器选择 PNG
   - 透明度检测提取轮廓 → Marching Squares → Douglas-Peucker 简化（20-60顶点）
   - 轮廓自动缩放到画布尺寸
   - 生成后可用选择模式微调

### 坐标系统

- 画布中心 = 道具中心 (0, 0)
- 坐标单位米，1格 = 0.5m
- `polygonPoints` 存储归一化坐标 { x: 0~1, y: 0~1 }，对应 width × depth 范围

### 验证规则

- 顶点数 ≥ 3
- 必须是简单多边形（无自交）
- 自动检测并阻止自交

## 3D 渲染

### ExtrudeGeometry（异形道具）

```typescript
const shape = new THREE.Shape();
shape.moveTo(points[0].x * width, points[0].y * depth);
for (let i = 1; i < points.length; i++) {
  shape.lineTo(points[i].x * width, points[i].y * depth);
}
shape.closePath();

const geometry = new THREE.ExtrudeGeometry(shape, {
  depth: extrudeHeight,
  bevelEnabled: false
});
```

拉伸方向沿竖直方向（Z轴），底面在地面上。UV 自动生成。

### 6面材质数组（立方体）

```typescript
const materials = [
  createMaterial(boxTextures.right),   // +X
  createMaterial(boxTextures.left),    // -X
  createMaterial(boxTextures.top),     // +Y
  createMaterial(boxTextures.bottom),  // -Y
  createMaterial(boxTextures.front),   // +Z（面向舞台）
  createMaterial(boxTextures.back),    // -Z
];
```

### 2D 视图兼容

- 立方体道具：CSS 渲染不变，front 面贴图作为 backgroundImage
- 异形道具：CSS clip-path: polygon(...) + front/侧面贴图作为背景

## PNG 透明度检测 (PngOutlineExtractor)

### 算法流程

```
加载PNG → 缩放到256px → alpha>128二值化 → Marching Squares提取等值线
→ Douglas-Peucker简化(20-60顶点) → 归一化坐标存储
```

### 特殊情况

- 完全透明图片：提示"未检测到有效轮廓"
- 多个不连通区域：取最大轮廓，提示"已选取最大区域"
- 凹形轮廓：Marching Squares 天然支持
- 内孔洞：不处理，取外轮廓

## 文件结构

### 新增文件

```
components/
  PropEditorModal.tsx           # 独立编辑窗口主组件
  prop-editor/
    ShapeEditor2D.tsx           # Canvas 2D 多边形编辑器
    BoxTextureEditor.tsx        # 立方体6面贴图编辑面板
    ExtrudedTextureEditor.tsx   # 异形拉伸体贴图编辑面板
    PropPreview3D.tsx           # 编辑器内3D预览画布
    PolygonUtils.ts             # 多边形工具（自交检测、简化等）
    PngOutlineExtractor.ts      # PNG透明度检测 + Marching Squares
```

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `types.ts` | 新增类型，扩展 Performer 接口 |
| `3d_components/Prop3D.tsx` | ExtrudeGeometry 渲染 + 6面材质数组 |
| `components/Stage.tsx` | 异形2D渲染适配 + 多面贴图 front 面显示 |
| `components/Sidebar.tsx` | 右键菜单调用新编辑窗口 |
| `components/EditorPanel3D.tsx` | 显示新几何体类型信息 |
| `App.tsx` | handleAddPerformer 支持新字段 |

## 不做的事 (YAGNI)

- 不实现孔洞检测
- 不实现3D场景内直接编辑
- 不实现顶点动画/变形
- 不改变现有绑定系统
- 不迁移旧项目的 textureDataUrl
