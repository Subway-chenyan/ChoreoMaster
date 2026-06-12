# 3D 舞台视频导出实现计划

## 概述

为3D舞台添加视频导出功能，支持两个固定机位（评委视角、45°俯视），输出最高4K MP4视频，要求与编辑器可视视图完全一致（包括道具高度、贴图、LED背景图片/视频）。

## 架构设计

### 核心思路

创建一个**离线 Three.js 渲染器**（`OfflineRenderer3D`），不依赖 R3F/React，直接使用 Three.js API 构建与 `Scene3D` 完全一致的场景图，逐帧渲染到 canvas，通过现有 WebCodecs + mp4-muxer 管线编码输出 MP4。

选择离线渲染器而非隐藏 R3F Canvas 的原因：
1. **确定性帧步进**：R3F 的 `useFrame` 使用 `lerp(0.1)` 平滑插值，导致导出帧之间有动画延迟；离线渲染器可直接设置精确位置
2. **性能**：无 React 协调开销，无 DOM 操作，纯 Three.js 渲染循环
3. **LED 视频同步**：可精确 seek 视频到每帧对应时间点
4. **内存效率**：单个 renderer 实例，无 React fiber 树

### 相机定义

基于 Stage3D 的坐标系统（舞台中心在原点，X 左右，Y 上，Z 前后）：

| 机位 | 位置 | lookAt | 说明 |
|------|------|--------|------|
| 评委视角 | `[0, 1.7, depth/2 + 6]` | `[0, 1.2, 0]` | 舞台前方正中，眼高1.7m，距前缘6m，微微仰视 |
| 45°俯视 | `[0, depth/2 + 12, depth/2 + 12]` | `[0, 0, 0]` | 舞台侧前方，45°俯角，全景视角 |

两个机位 FOV 均为 50°（与编辑器一致）。

## 文件清单

### 新增文件

1. **`utils/OfflineRenderer3D.ts`** — 离线3D渲染器核心
   - `createOfflineScene()` — 构建场景图（灯光、地板、LED墙、演员、道具）
   - `updateSceneAtTime()` — 根据时间点更新所有对象位置/旋转
   - `setupLEDMaterial()` — 处理 LED 背景（纯色/图片/视频）
   - `renderFrame()` — 渲染单帧到 canvas
   - `dispose()` — 清理资源

### 修改文件

2. **`App.tsx`**
   - 新增状态：`exportCameraAngle: 'judge' | 'overhead'`
   - 新增函数：`handleExportVideo3D()` — 3D导出主流程
   - 修改 `handleExportVideo()` — 根据 `viewMode` 分发到 2D 或 3D 导出
   - 新增 props 传递给 Timeline

3. **`components/Timeline.tsx`**
   - TimelineProps 接口新增：`exportCameraAngle`, `onSetExportCameraAngle`, `viewMode`
   - UI 新增：机位选择器（评委视角 / 45°俯视），仅在 3D 模式下显示
   - 导出按钮文案：3D 模式下显示"导出3D视频"

## 详细实现

### 1. `utils/OfflineRenderer3D.ts`

```typescript
interface OfflineSceneConfig {
  width: number;    // canvas 宽度
  height: number;   // canvas 高度
  stageConfig: StageConfig;
  performers: Performer[];
  cameraAngle: 'judge' | 'overhead';
}

// 创建离线场景
export function createOfflineScene(config: OfflineSceneConfig): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  updateAtTime: (timeMs: number, positions: Record<string, Position>) => void;
  dispose: () => void;
}
```

场景构建（与 Scene3D 对齐）：
- `ambientLight` intensity=0.6
- `directionalLight` position=[10,20,10] intensity=0.8
- `StageFloor`：深色平面 + 网格 + 前后边缘线
- `LEDTV`：平面 + 纯色/图片/视频材质
- 演员：cylinder(body) + sphere(head) + box(nose)，带颜色
- 道具：box 或 extruded geometry，带贴图

LED 视频处理：
- 创建独立 `<video>` 元素（不附加到 DOM）
- 每帧 seek 到 `getTimelineVideoTime(video, timeSec, loop)`
- 等待 `seeked` 事件后更新 `VideoTexture`

### 2. App.tsx 修改

新增 `handleExportVideo3D` 函数，复用现有 WebCodecs 管线：

```
1. 校验入点/出点
2. 创建离线渲染器 createOfflineScene()
3. 预加载道具贴图
4. 循环每帧：
   a. computePositionsAtTime(t) 获取插值位置
   b. updateAtTime(t, positions) 更新场景
   c. renderer.render(scene, camera) 渲染
   d. createFrameFromCanvas() 创建 VideoFrame
   e. videoEncoder.encode() 编码
5. 编码音频（复用现有逻辑）
6. muxer.finalize() 输出 MP4
7. dispose() 清理
```

### 3. Timeline UI 修改

在现有导出控件区域添加机位选择器：
- 下拉框或两个切换按钮："评委视角" / "45°俯视"
- 仅当 `viewMode === '3d'` 时显示
- 2D 模式下保持现有行为不变

## 关键细节

### 与编辑器视图一致性

| 元素 | 实现方式 |
|------|---------|
| 灯光 | 与 Scene3D 相同参数（ambient 0.6, directional [10,20,10] 0.8） |
| 地板 | meshStandardMaterial #1a1a1a, roughness 0.8, metalness 0.2 |
| 网格 | gridHelper, divisions = round(4 * gridScale) |
| 前后线 | 红色 boxGeometry 前缘，蓝色后缘 |
| LED 墙 | planeGeometry, meshBasicMaterial, toneMapped=false |
| 演员 | cylinder(0.25,1) + sphere(0.2) + box(0.05,0.05,0.1) |
| 道具 box | boxGeometry + 6面材质（含贴图） |
| 道具 extruded | ExtrudeGeometry + 3组材质（侧面/顶面/底面） |
| 演员高度 | position.z → Three.js Y 轴 |

### 坐标转换

复用 `mapTo3D()` 函数，与编辑器完全一致：
- X% → [-width/2, width/2]
- Y% → [-depth/2, depth/2]（Y=0 后方，Y=100 前方 → +Z 后方，-Z 前方）
- Z(m) → Y 轴高度

### 性能考量

- 4K 渲染每帧约 8.3M 像素，WebGL 渲染应足够快
- VideoEncoder 队列管理复用现有 `waitForEncoderQueueBelow` 逻辑
- 每 30 帧 yield 一次避免 UI 冻结（复用现有模式）
- 资源清理：renderer.dispose() + 几何体/材质/纹理 dispose()

### 错误处理

- WebGL 不可用时 alert 提示
- WebCodecs 不可用时回退到 MediaRecorder（实时渲染）
- LED 视频加载失败时降级为纯色背景

## 实现顺序

1. 创建 `utils/OfflineRenderer3D.ts`（离线渲染器核心）
2. 在 `App.tsx` 中添加 `handleExportVideo3D` 函数
3. 在 `Timeline.tsx` 中添加机位选择 UI
4. 在 `App.tsx` 中连接 UI 状态和导出函数
5. 测试：验证导出视频与编辑器视图一致性
