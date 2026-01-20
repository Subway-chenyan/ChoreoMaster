# 3D 编排功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 ChoreoMaster 添加 3D 编排功能，与现有 2D 系统共享数据结构，支持 LED 背景屏幕和高度维度编辑。

**Architecture:**
- 扩展现有 `Position` 类型添加可选的 `z` 属性（高度）
- 新增 `StageConfig` 类型管理舞台尺寸和 LED 配置
- 使用 React Three Fiber (@react-three/fiber) 进行 3D 渲染
- 2D/3D 模式通过状态切换，共用同一套数据源

**Tech Stack:**
- @react-three/fiber - React Three.js 绑定
- @react-three/drei - Three.js 辅助组件库
- three - 3D 渲染引擎
- TypeScript - 类型安全

---

## Task 1: 更新类型定义

**Files:**
- Modify: `types.ts`

**Step 1: 扩展 Position 类型**

在 `types.ts` 中修改 `Position` 接口，添加可选的 `z` 属性：

```typescript
export interface Position {
  x: number;  // Percentage 0-100
  y: number;  // Percentage 0-100
  z?: number; // Optional height in meters (0 = ground)
}
```

**Step 2: 添加 StageConfig 和 LEDContent 类型**

在 `types.ts` 中添加新的类型定义（在文件末尾）：

```typescript
export interface StageConfig {
  width: number;        // Stage width in meters (default 20)
  depth: number;        // Stage depth in meters
  ledHeight?: number;   // LED wall height in meters
  ledContent?: LEDContent;
}

export interface LEDContent {
  type: 'none' | 'color' | 'image' | 'video';
  value?: string;       // Color hex or filename reference
  loop?: boolean;       // For video looping
}
```

**Step 3: 扩展 Performer 类型确认 depth 属性**

确认 `Performer` 接口有 `depth` 属性：

```typescript
export interface Performer {
  // ... existing properties
  width?: number;   // Width in meters
  height?: number;  // Height in meters
  depth?: number;   // Depth in meters (for 3D props)
  rotation?: number; // Rotation in degrees
}
```

**Step 4: Commit**

```bash
git add types.ts
git commit -m "feat(types): add z-coordinate and StageConfig for 3D support"
```

---

## Task 2: 添加 StageConfig 常量

**Files:**
- Modify: `constants.ts`

**Step 1: 导入 StageConfig 类型**

在 `constants.ts` 顶部添加导入：

```typescript
import { StageConfig } from './types';
```

**Step 2: 添加 STAGE_CONFIG 常量**

在 `constants.ts` 中添加（在 `STAGE_ASPECT_RATIO` 之后）：

```typescript
export const STAGE_CONFIG: StageConfig = {
  width: 20,           // 20 meters wide
  depth: 20 / (16/9),  // ~11.25 meters deep (16:9 aspect)
  ledHeight: 6,        // 6 meters tall LED wall
  ledContent: { type: 'none' }
};
```

**Step 3: Commit**

```bash
git add constants.ts
git commit -m "feat(constants): add default STAGE_CONFIG"
```

---

## Task 3: 创建坐标转换工具

**Files:**
- Create: `utils/coordinates.ts`

**Step 1: 创建 utils 目录（如不存在）**

```bash
mkdir -p utils
```

**Step 2: 创建坐标转换工具文件**

创建 `utils/coordinates.ts`：

```typescript
import { StageConfig } from '../constants';
import { Position } from '../types';

/** Convert 2D percentage coordinates to 3D world coordinates */
export function mapTo3D(
  pos: Position,
  config: StageConfig
): [number, number, number] {
  // x: 0-100 → -width/2 to width/2
  const x3d = ((pos.x - 50) / 50) * (config.width / 2);

  // y: 0-100 → depth/2 to -depth/2 (front of stage is positive)
  const y3d = ((50 - pos.y) / 50) * (config.depth / 2);

  // z: height in meters (vertical in Three.js)
  const z3d = pos.z || 0;

  return [x3d, z3d, y3d]; // Three.js: Y is up
}

/** Convert 3D world coordinates to 2D percentage coordinates */
export function mapTo2D(
  x3d: number,
  y3d: number,
  z3d: number,
  config: StageConfig
): Position {
  const x = ((x3d / (config.width / 2)) * 50) + 50;
  const y = 50 - ((z3d / (config.depth / 2)) * 50);

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    z: y3d
  };
}

/** Convert degrees to radians */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Convert radians to degrees */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}
```

**Step 3: Commit**

```bash
git add utils/coordinates.ts
git commit -m "feat(utils): add 2D/3D coordinate conversion utilities"
```

---

## Task 4: 安装 3D 渲染依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装核心依赖**

```bash
pnpm add @react-three/fiber @react-three/drei three
```

**Step 2: 安装类型定义**

```bash
pnpm add -D @types/three
```

**Step 3: 验证安装成功**

```bash
pnpm list @react-three/fiber @react-three/drei three
```

Expected: 输出显示已安装的版本号

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add React Three Fiber and Three.js dependencies"
```

---

## Task 5: 创建 LED 屏幕组件

**Files:**
- Create: `components/LEDTV.tsx`

**Step 1: 创建 LEDTV 组件**

创建 `components/LEDTV.tsx`：

```typescript
import React, { useRef, useEffect, useState } from 'react';
import { TextureLoader } from 'three';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { StageConfig } from '../types';

interface LEDTVProps {
  config: StageConfig;
  mediaCache?: Record<string, string>; // filename -> blob URL
}

const LEDTV: React.FC<LEDTVProps> = ({ config, mediaCache = {} }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  const height = config.ledHeight || 6;
  const width = config.width;
  const depth = config.depth;
  const content = config.ledContent;

  // Handle video content
  useEffect(() => {
    if (content?.type === 'video' && content.value && mediaCache[content.value]) {
      const video = document.createElement('video');
      video.src = mediaCache[content.value];
      video.loop = content.loop ?? true;
      video.muted = true;
      video.playsInline = true;

      const onLoadedData = () => {
        video.play().catch(console.error);
      };

      video.addEventListener('loadeddata', onLoadedData);

      const texture = new THREE.VideoTexture(video);
      setVideoTexture(texture);

      return () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.pause();
        texture.dispose();
      };
    } else {
      setVideoTexture(null);
    }
  }, [content, mediaCache]);

  // Load image texture (only when needed)
  let imageTexture: THREE.Texture | null = null;
  if (content?.type === 'image' && content.value && mediaCache[content.value]) {
    try {
      imageTexture = useTexture(mediaCache[content.value]);
    } catch (e) {
      console.error('Failed to load image texture:', e);
    }
  }

  const getTexture = () => {
    if (content?.type === 'video') return videoTexture;
    if (content?.type === 'image') return imageTexture;
    return null;
  };

  const getColor = () => {
    if (content?.type === 'color' && content.value) {
      return content.value;
    }
    return '#111111';
  };

  return (
    <mesh
      ref={meshRef}
      position={[0, height / 2, -depth / 2 - 0.1]}
      rotation={[0, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={getTexture() || undefined}
        color={getColor()}
        emissive={getTexture() ? '#ffffff' : '#222222'}
        emissiveIntensity={getTexture() ? 1 : 0.3}
        emissiveMap={getTexture() || undefined}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export default LEDTV;
```

**Step 2: Commit**

```bash
git add components/LEDTV.tsx
git commit -m "feat(components): create LEDTV component for background screen"
```

---

## Task 6: 更新 StageFloor 组件

**Files:**
- Modify: `3d_components/StageFloor.tsx`

**Step 1: 更新 StageFloor 使用动态配置**

修改 `3d_components/StageFloor.tsx`：

```typescript
import React from 'react';
import * as THREE from 'three';

interface StageFloorProps {
  width: number;
  depth: number;
}

const StageFloor: React.FC<StageFloorProps> = ({ width, depth }) => {
  return (
    <group>
      {/* Main Floor Surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.2} />
      </mesh>

      {/* Grid Helper */}
      <gridHelper
        args={[width, Math.floor(width), 0x444444, 0x222222]}
        position={[0, 0.01, 0]}
      />

      {/* Front Edge Marker (Downstage) */}
      <mesh position={[0, 0.02, depth / 2]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>

      {/* Back Edge Marker (Upstage) */}
      <mesh position={[0, 0.02, -depth / 2]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
};

export default StageFloor;
```

**Step 2: Commit**

```bash
git add 3d_components/StageFloor.tsx
git commit -m "refactor(StageFloor): accept width/depth props instead of STAGE_CONFIG"
```

---

## Task 7: 更新 Performer3D 组件

**Files:**
- Modify: `3d_components/Performer3D.tsx`

**Step 1: 更新 Performer3D 使用现有类型系统**

修改 `3d_components/Performer3D.tsx`：

```typescript
import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position } from '../types';
import { mapTo3D, degToRad } from '../utils/coordinates';

interface Performer3DProps {
  performer: Performer;
  position: Position;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const Performer3D: React.FC<Performer3DProps> = ({ performer, position, isSelected, onSelect }) => {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);

  // Stage dimensions for coordinate conversion
  const stageConfig = { width: 20, depth: 20 / (16/9) };
  const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);

  useFrame(() => {
    if (meshRef.current) {
      // Smooth position interpolation
      meshRef.current.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1);

      // Smooth rotation interpolation
      const targetRotation = new THREE.Euler(0, -degToRad(performer.rotation || 0), 0);
      const targetQ = new THREE.Quaternion().setFromEuler(targetRotation);
      meshRef.current.quaternion.slerp(targetQ, 0.1);
    }
  });

  const baseColor = new THREE.Color(performer.color);
  const displayColor = isSelected
    ? '#ffffff'
    : (hovered ? baseColor.clone().offsetHSL(0, 0, 0.1) : baseColor);

  const scale = 1;

  return (
    <group
      ref={meshRef}
      onClick={(e) => { e.stopPropagation(); onSelect(performer.id); }}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      {/* Selection Ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.6, 0.7, 32]} />
          <meshBasicMaterial color="#fbbf24" opacity={0.8} transparent />
        </mesh>
      )}

      {/* Human Representation */}
      <group position={[0, 0.9 * scale, 0]} scale={[1, scale, 1]}>
        {/* Body */}
        <mesh position={[0, -0.4, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.25, 0.25, 1, 16]} />
          <meshStandardMaterial color={displayColor} />
        </mesh>

        {/* Head */}
        <mesh position={[0, 0.25, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={displayColor} />
        </mesh>

        {/* Direction Indicator */}
        <mesh position={[0, 0.25, 0.2]}>
          <boxGeometry args={[0.05, 0.05, 0.1]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </group>

      {/* Label */}
      <Html position={[0, 2.2, 0]} center distanceFactor={10}>
        <div className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap select-none transition-opacity ${
          isSelected ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white'
        }`}>
          {performer.name}
        </div>
      </Html>
    </group>
  );
};

export default Performer3D;
```

**Step 2: Commit**

```bash
git add 3d_components/Performer3D.tsx
git commit -m "refactor(Performer3D): use existing Performer type and coordinate utils"
```

---

## Task 8: 更新 Prop3D 组件

**Files:**
- Modify: `3d_components/Prop3D.tsx`

**Step 1: 更新 Prop3D 使用现有类型系统**

修改 `3d_components/Prop3D.tsx`：

```typescript
import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position } from '../types';
import { mapTo3D, degToRad } from '../utils/coordinates';

interface Prop3DProps {
  performer: Performer; // type === 'prop'
  position: Position;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const Prop3D: React.FC<Prop3DProps> = ({ performer, position, isSelected, onSelect }) => {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);

  const stageConfig = { width: 20, depth: 20 / (16/9) };
  const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);

  const dims = {
    width: performer.width || 1,
    height: performer.height || 1,
    depth: performer.depth || 1
  };

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(
        new THREE.Vector3(targetX, targetY + dims.height / 2, targetZ),
        0.1
      );
      const targetRotation = new THREE.Euler(0, -degToRad(performer.rotation || 0), 0);
      const targetQ = new THREE.Quaternion().setFromEuler(targetRotation);
      meshRef.current.quaternion.slerp(targetQ, 0.1);
    }
  });

  return (
    <group
      ref={meshRef}
      onClick={(e) => { e.stopPropagation(); onSelect(performer.id); }}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[dims.width, dims.height, dims.depth]} />
        <meshStandardMaterial
          color={isSelected ? '#60a5fa' : performer.color}
          transparent
          opacity={hovered ? 0.9 : 1}
        />
      </mesh>

      {isSelected && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(dims.width, dims.height, dims.depth)]} />
          <lineBasicMaterial color="#fbbf24" linewidth={2} />
        </lineSegments>
      )}

      {isSelected && (
        <Html position={[0, dims.height / 2 + 0.5, 0]} center>
          <div className="bg-yellow-400 text-black px-2 py-0.5 rounded text-xs font-bold">
            {performer.name}
          </div>
        </Html>
      )}
    </group>
  );
};

export default Prop3D;
```

**Step 2: Commit**

```bash
git add 3d_components/Prop3D.tsx
git commit -m "refactor(Prop3D): use existing Performer type and coordinate utils"
```

---

## Task 9: 创建 3D 场景内容组件

**Files:**
- Create: `3d_components/Scene3D.tsx`

**Step 1: 创建 Scene3D 组件**

创建 `3d_components/Scene3D.tsx`：

```typescript
import React from 'react';
import { OrbitControls } from '@react-three/drei';
import StageFloor from './StageFloor';
import Performer3D from './Performer3D';
import Prop3D from './Prop3D';
import LEDTV from '../components/LEDTV';
import { Performer, Position, StageConfig } from '../types';

interface Scene3DProps {
  performers: Performer[];
  positions: Record<string, Position>;
  selectedIds: string[];
  onSelect: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  hiddenGroupIds?: string[];
}

const Scene3D: React.FC<Scene3DProps> = ({
  performers,
  positions,
  selectedIds,
  onSelect,
  stageConfig,
  mediaCache,
  hiddenGroupIds = []
}) => {
  // Filter performers based on group visibility
  const visiblePerformers = performers.filter(performer => {
    if (!performer.groupId) return true;
    return !hiddenGroupIds.includes(performer.groupId);
  });

  return (
    <>
      {/* Simplified lighting - no complex setup needed */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      {/* Camera Controls */}
      <OrbitControls
        makeDefault
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
        maxDistance={50}
        minDistance={5}
        target={[0, 0, 0]}
      />

      {/* LED Background Screen */}
      <LEDTV config={stageConfig} mediaCache={mediaCache} />

      {/* Stage Floor */}
      <StageFloor width={stageConfig.width} depth={stageConfig.depth} />

      {/* Render Entities */}
      {visiblePerformers.map(performer => {
        const pos = positions[performer.id];
        if (!pos) return null;

        const isSelected = selectedIds.includes(performer.id);

        if (performer.type === 'prop') {
          return (
            <Prop3D
              key={performer.id}
              performer={performer}
              position={pos}
              isSelected={isSelected}
              onSelect={onSelect}
            />
          );
        }

        return (
          <Performer3D
            key={performer.id}
            performer={performer}
            position={pos}
            isSelected={isSelected}
            onSelect={onSelect}
          />
        );
      })}

      {/* Click on background to deselect */}
      <mesh
        position={[0, 0, -stageConfig.depth / 2 - 5]}
        scale={[100, 100, 1]}
        visible={false}
        onClick={() => onSelect('')}
      >
        <planeGeometry />
      </mesh>
    </>
  );
};

export default Scene3D;
```

**Step 2: Commit**

```bash
git add 3d_components/Scene3D.tsx
git commit -m "feat(3d_components): create Scene3D component with simplified lighting"
```

---

## Task 10: 创建 3D 编辑面板组件

**Files:**
- Create: `components/EditorPanel3D.tsx`

**Step 1: 创建 EditorPanel3D 组件**

创建 `components/EditorPanel3D.tsx`：

```typescript
import React from 'react';
import { Move3d, RotateCw, Box, Trash2, Maximize2 } from 'lucide-react';
import { Performer, Position } from '../types';

interface EditorPanel3DProps {
  performer: Performer | null;
  position: Position | null;
  onUpdatePosition: (id: string, pos: Position) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onDelete: (id: string) => void;
}

const EditorPanel3D: React.FC<EditorPanel3DProps> = ({
  performer,
  position,
  onUpdatePosition,
  onUpdatePerformer,
  onDelete
}) => {
  if (!performer || !position) {
    return (
      <div className="w-72 bg-slate-900 border-l border-slate-700 flex flex-col items-center justify-center text-slate-500 h-full">
        <Box size={48} className="mb-4 opacity-50" />
        <p className="text-sm">选择对象进行编辑</p>
      </div>
    );
  }

  const handlePosChange = (axis: 'x' | 'y' | 'z', value: number) => {
    onUpdatePosition(performer.id, { ...position, [axis]: value });
  };

  const isProp = performer.type === 'prop';

  return (
    <div className="w-72 bg-slate-900 border-l border-slate-700 flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isProp ? 'bg-green-600' : 'bg-blue-600'}`}>
          {isProp ? <Box size={18} /> : <Maximize2 size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold truncate">{performer.name}</h2>
          <p className="text-xs text-slate-400 uppercase">{isProp ? '道具' : '演员'}</p>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Name */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400">名称</label>
          <input
            type="text"
            value={performer.name}
            onChange={(e) => onUpdatePerformer(performer.id, { name: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Position Controls with Height */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Move3d size={14} /> 位置 (2D + 高度)
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-center block">X %</label>
              <input
                type="number"
                step={0.1}
                value={position.x.toFixed(1)}
                onChange={(e) => handlePosChange('x', Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-center text-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-center block">Y %</label>
              <input
                type="number"
                step={0.1}
                value={position.y.toFixed(1)}
                onChange={(e) => handlePosChange('y', Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-center text-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-center block">Z 米</label>
              <input
                type="number"
                step={0.1}
                value={(position.z || 0).toFixed(1)}
                onChange={(e) => handlePosChange('z', Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-center text-white"
              />
            </div>
          </div>

          {/* Height Slider */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <label className="text-sm text-slate-300">高度 (Z轴)</label>
              <span className="text-xs text-blue-400">{(position.z || 0).toFixed(1)}m</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={position.z || 0}
              onChange={(e) => handlePosChange('z', Number(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {/* Rotation */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <RotateCw size={14} /> 旋转
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="range"
              min={-180}
              max={180}
              value={performer.rotation || 0}
              onChange={(e) => onUpdatePerformer(performer.id, { rotation: Number(e.target.value) })}
              className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-sm text-slate-300 w-12 text-right">
              {Math.round(performer.rotation || 0)}°
            </span>
          </div>
        </div>

        {/* Dimensions for Props */}
        {isProp && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Box size={14} /> 尺寸
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-slate-500 block">宽</label>
                <input
                  type="number"
                  step={0.1}
                  value={performer.width || 1}
                  onChange={(e) => onUpdatePerformer(performer.id, { width: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block">高</label>
                <input
                  type="number"
                  step={0.1}
                  value={performer.height || 1}
                  onChange={(e) => onUpdatePerformer(performer.id, { height: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block">深</label>
                <input
                  type="number"
                  step={0.1}
                  value={performer.depth || 1}
                  onChange={(e) => onUpdatePerformer(performer.id, { depth: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* Color */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400">颜色</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={performer.color}
              onChange={(e) => onUpdatePerformer(performer.id, { color: e.target.value })}
              className="h-8 w-12 bg-transparent border-0 p-0 cursor-pointer"
            />
            <input
              type="text"
              value={performer.color}
              onChange={(e) => onUpdatePerformer(performer.id, { color: e.target.value })}
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1 text-sm text-white"
            />
          </div>
        </div>

        {/* Delete Button */}
        <div className="pt-4 border-t border-slate-700">
          <button
            onClick={() => onDelete(performer.id)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded bg-red-900/30 text-red-500 hover:bg-red-900/50 transition-colors border border-red-900"
          >
            <Trash2 size={16} /> 删除对象
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditorPanel3D;
```

**Step 2: Commit**

```bash
git add components/EditorPanel3D.tsx
git commit -m "feat(components): create EditorPanel3D for height/3D editing"
```

---

## Task 11: 创建 Stage3D 主组件

**Files:**
- Create: `components/Stage3D.tsx`

**Step 1: 创建 Stage3D 组件**

创建 `components/Stage3D.tsx`：

```typescript
import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import Scene3D from '../3d_components/Scene3D';
import EditorPanel3D from './EditorPanel3D';
import { Performer, Position, StageConfig } from '../types';

interface Stage3DProps {
  performers: Performer[];
  positions: Record<string, Position>;
  selectedIds: string[];
  hiddenGroupIds?: string[];
  onSelect: (ids: string[]) => void;
  onPositionChange: (updates: { id: string; pos: Position }[]) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onRemovePerformer: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  readonly?: boolean;
}

const Stage3D: React.FC<Stage3DProps> = ({
  performers,
  positions,
  selectedIds,
  hiddenGroupIds,
  onSelect,
  onPositionChange,
  onUpdatePerformer,
  onRemovePerformer,
  stageConfig,
  mediaCache,
  readonly = false
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    if (id === '') {
      onSelect([]);
    } else {
      onSelect([id]);
    }
  };

  const handleUpdatePosition = (id: string, pos: Position) => {
    onPositionChange([{ id, pos }]);
  };

  const selectedPerformer = selectedIds.length === 1
    ? performers.find(p => p.id === selectedIds[0]) || null
    : null;
  const selectedPosition = selectedIds.length === 1
    ? positions[selectedIds[0]] || null
    : null;

  return (
    <div className="flex-1 flex bg-slate-950 relative">
      {/* 3D Canvas */}
      <div className="flex-1">
        <Canvas
          shadows
          camera={{ position: [0, 15, 20], fov: 50 }}
          gl={{ antialias: true }}
        >
          <Scene3D
            performers={performers}
            positions={positions}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            stageConfig={stageConfig}
            mediaCache={mediaCache}
            hiddenGroupIds={hiddenGroupIds}
          />
        </Canvas>
      </div>

      {/* Right Editor Panel */}
      {!readonly && (
        <EditorPanel3D
          performer={selectedPerformer}
          position={selectedPosition}
          onUpdatePosition={handleUpdatePosition}
          onUpdatePerformer={onUpdatePerformer}
          onDelete={onRemovePerformer}
        />
      )}
    </div>
  );
};

export default Stage3D;
```

**Step 2: Commit**

```bash
git add components/Stage3D.tsx
git commit -m "feat(components): create Stage3D main component"
```

---

## Task 12: 更新 Sidebar 添加 LED 配置

**Files:**
- Modify: `components/Sidebar.tsx`

**Step 1: 添加 3D 舞台设置区域**

在 `Sidebar.tsx` 中的「项目设置」标签页（`activeTab === 'project'`）的配乐区域后添加：

找到 `<div className="bg-slate-800 p-4 rounded-lg border border-slate-700 mt-4">...</div>` (配乐部分)，
在其后添加新的 LED 设置区域：

```tsx
{/* 3D 舞台设置 */}
<div className="bg-slate-800 p-4 rounded-lg border border-slate-700 mt-4">
  <div className="flex items-center gap-2 mb-3">
    <span className="text-xs font-bold text-slate-400 uppercase">3D 舞台设置</span>
  </div>

  {/* LED 高度 */}
  <div className="space-y-2 mb-3">
    <label className="text-xs text-slate-400">LED 屏幕高度</label>
    <div className="flex items-center gap-2">
      <input
        type="number"
        step={0.5}
        min={2}
        max={15}
        value={stageConfig?.ledHeight || 6}
        onChange={(e) => onStageConfigChange({ ledHeight: Number(e.target.value) })}
        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
      />
      <span className="text-xs text-slate-500">米</span>
    </div>
  </div>

  {/* LED 内容 */}
  <div className="space-y-2">
    <label className="text-xs text-slate-400">LED 屏幕内容</label>
    <div className="flex gap-2">
      <label className="flex-1 flex items-center justify-center px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs cursor-pointer transition-colors text-white">
        上传图片/视频
        <input
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={onLEDContentUpload}
        />
      </label>
      {(stageConfig?.ledContent?.type !== 'none') && (
        <button
          onClick={onClearLEDContent}
          className="px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-900 rounded text-xs text-red-400 transition-colors"
        >
          清除
        </button>
      )}
    </div>
    {stageConfig?.ledContent?.type === 'color' && (
      <div className="flex items-center gap-2 mt-2">
        <input
          type="color"
          value={stageConfig.ledContent.value || '#111'}
          onChange={(e) => onStageConfigChange({
            ledContent: { ...stageConfig.ledContent, type: 'color', value: e.target.value }
          })}
          className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
        />
        <span className="text-xs text-slate-400">纯色背景</span>
      </div>
    )}
  </div>
</div>
```

**Step 2: 更新 Sidebar Props 接口**

在 `Sidebar.tsx` 的 `SidebarProps` 接口中添加新的 props：

```typescript
interface SidebarProps {
  // ... existing props

  // 新增 3D 相关 props
  stageConfig?: StageConfig;
  onStageConfigChange: (updates: Partial<StageConfig>) => void;
  onLEDContentUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearLEDContent: () => void;
}
```

**Step 3: 在文件顶部导入 StageConfig**

```typescript
import { StageConfig } from '../types';
```

**Step 4: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat(Sidebar): add 3D stage settings panel with LED configuration"
```

---

## Task 13: 更新 App.tsx 主逻辑

**Files:**
- Modify: `App.tsx`

**Step 1: 添加新的状态**

在 `App.tsx` 的状态声明区域添加：

```typescript
// 新增：3D 模式相关状态
const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
const [stageConfig, setStageConfig] = useState<StageConfig>({
  width: 20,
  depth: 20 / (16/9),
  ledHeight: 6,
  ledContent: { type: 'none' }
});
const [mediaCache, setMediaCache] = useState<Record<string, string>>({});
```

**Step 2: 添加 LED 处理函数**

在 `App.tsx` 的函数区域添加：

```typescript
// LED 内容上传处理
const handleLEDContentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const fileName = `led_${Date.now()}_${file.name}`;

  setMediaCache(prev => ({ ...prev, [fileName]: url }));

  const type = file.type.startsWith('video') ? 'video' : 'image';
  setStageConfig(prev => ({
    ...prev,
    ledContent: { type, value: fileName, loop: true }
  }));
};

// 清除 LED 内容
const handleClearLEDContent = () => {
  setStageConfig(prev => ({
    ...prev,
    ledContent: { type: 'none' }
  }));
};

// 舞台配置更新
const handleStageConfigChange = (updates: Partial<StageConfig>) => {
  setStageConfig(prev => ({ ...prev, ...updates }));
};
```

**Step 3: 更新项目导入/导出函数**

修改 `handleExportProject` 以包含舞台配置：

在现有的 `projectData` 对象中添加 `stageConfig`：

```typescript
const projectData = {
  version: "1.2",
  createdAt: new Date().toISOString(),
  name: "ChoreoMaster Project",
  musicName,
  performers,
  performerGroups,
  frames,
  stageConfig, // 新增
};
```

修改 `handleImportProject` 以恢复舞台配置：

在 `setMusicName(json.musicName || null);` 后添加：

```typescript
// 恢复舞台配置
if (json.stageConfig) {
  setStageConfig(json.stageConfig);
  // LED 内容需要重新加载媒体文件
  if (json.stageConfig.ledContent?.value) {
    // 保持现有内容类型，但清空缓存
    setMediaCache({});
  }
}
```

**Step 4: 更新渲染部分 - 添加模式切换按钮**

在顶部工具栏中添加 2D/3D 切换按钮：

找到 `<button onClick={() => setShowHelp(true)}...` 后添加：

```tsx
<button
  onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')}
  className={`p-2 rounded-lg transition-colors ${
    viewMode === '3d'
      ? 'bg-purple-600 text-white hover:bg-purple-500'
      : theme === 'dark'
        ? 'hover:bg-slate-800 text-slate-400 hover:text-purple-400'
        : 'hover:bg-gray-100 text-gray-600 hover:text-purple-600'
  }`}
  title={viewMode === '2d' ? '切换到 3D 视图' : '切换到 2D 视图'}
>
  {viewMode === '2d' ? '🎲' : '🔲'}
</button>
```

**Step 5: 更新渲染部分 - 条件渲染 Stage**

找到 `<Stage performers={performers}...` 部分，替换为：

```tsx
{viewMode === '2d' ? (
  <Stage
    performers={performers}
    performerGroups={performerGroups}
    hiddenGroupIds={activeHiddenGroupIds}
    positions={displayedPositions}
    selectedPerformerIds={selectedPerformerIds}
    onSelectionChange={setSelectedPerformerIds}
    onPositionChange={handlePositionChange}
    onUpdatePerformer={handleUpdatePerformer}
    readonly={isPlaying}
    showLabels={showLabels}
    gridScale={gridScale}
    onZoom={handleGridZoom}
    aspectRatio={stageAspectRatio}
    maxWidthPx={stageMaxWidth}
  />
) : (
  <Stage3D
    performers={performers}
    performerGroups={performerGroups}
    hiddenGroupIds={activeHiddenGroupIds}
    positions={displayedPositions}
    selectedPerformerIds={selectedPerformerIds}
    onSelectionChange={setSelectedPerformerIds}
    onPositionChange={handlePositionChange}
    onUpdatePerformer={handleUpdatePerformer}
    onRemovePerformer={handleRemovePerformer}
    stageConfig={stageConfig}
    mediaCache={mediaCache}
    readonly={isPlaying}
  />
)}
```

**Step 6: 更新 Sidebar props**

找到 `<Sidebar` 组件调用，添加新的 props：

```tsx
<Sidebar
  performers={performers}
  performerGroups={performerGroups}
  frames={frames}
  currentFrameId={currentFrameId}
  // ... existing props
  widthPx={sidebarWidth}
  // 新增 3D 相关 props
  stageConfig={stageConfig}
  onStageConfigChange={handleStageConfigChange}
  onLEDContentUpload={handleLEDContentUpload}
  onClearLEDContent={handleClearLEDContent}
/>
```

**Step 7: 添加 Stage3D 导入**

在文件顶部添加导入：

```typescript
import Stage3D from './components/Stage3D';
import { StageConfig } from './types';
```

**Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(App): add 2D/3D mode toggle and integration"
```

---

## Task 14: 删除旧的未使用 3D 组件文件

**Files:**
- Delete: `3d_components/EditorPanel.tsx`
- Delete: `3d_components/SceneContent.tsx`

**Step 1: 删除旧的 EditorPanel.tsx**

```bash
rm 3d_components/EditorPanel.tsx
```

**Step 2: 删除旧的 SceneContent.tsx**

```bash
rm 3d_components/SceneContent.tsx
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(3d_components): remove unused old files"
```

---

## Task 15: 更新 package.json 脚本和配置

**Files:**
- Modify: `package.json`
- Check: `tsconfig.json`

**Step 1: 验证 TypeScript 配置**

检查 `tsconfig.json` 确保包含正确的 JSX 配置：

```json
{
  "compilerOptions": {
    // ... other options
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

如果需要，添加 `paths` 配置以支持绝对导入：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Step 2: 验证 vite.config.ts**

确保 `vite.config.ts` 包含正确的别名配置（如果有使用）。

**Step 3: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无类型错误（可能有关于 three.js 的警告，可忽略）

**Step 4: Commit**

```bash
git add tsconfig.json vite.config.ts
git commit -m "chore(config): ensure TypeScript config supports React Three Fiber"
```

---

## Task 16: 构建和测试

**Files:**
- Test: 全局

**Step 1: 运行开发服务器**

```bash
pnpm dev
```

Expected: 服务器启动在 http://localhost:5173，无编译错误

**Step 2: 手动测试清单**

1. 启动应用，确认 2D 视图正常工作
2. 点击顶部工具栏的 3D 切换按钮，确认切换到 3D 视图
3. 在 3D 视图中：
   - 确认舞台网格正常显示
   - 确认演员/道具正常渲染
   - 确认可以用鼠标旋转视角
   - 点击选中演员/道具，右侧编辑面板正常显示
4. 选中对象，编辑高度 (Z轴)，确认变化可见
5. 切换到侧边栏「项目设置」，确认 LED 配置区域显示
6. 上传图片到 LED 屏幕，确认显示
7. 切换回 2D 视图，确认数据共享正常
8. 导出项目，确认 JSON 包含 stageConfig
9. 重新导入项目，确认配置恢复

**Step 3: 尝试生产构建**

```bash
pnpm build
```

Expected: 构建成功，生成 dist 目录

**Step 4: 如果所有测试通过，打标签**

```bash
git tag -a v1.3.0 -m "feat: add 3D choreography support with LED wall"
git push origin v1.3.0
```

**Step 5: Commit（如有修复）**

```bash
git add .
git commit -m "fix: resolve issues found during testing"
```

---

## 完成检查清单

- [ ] Position 类型包含可选的 `z` 属性
- [ ] StageConfig 和 LEDContent 类型已定义
- [ ] 坐标转换工具函数已创建
- [ ] 3D 依赖已安装
- [ ] LEDTV 组件已创建
- [ ] StageFloor 组件已更新
- [ ] Performer3D 组件已更新
- [ ] Prop3D 组件已更新
- [ ] Scene3D 组件已创建
- [ ] EditorPanel3D 组件已创建
- [ ] Stage3D 主组件已创建
- [ ] Sidebar 添加了 LED 配置
- [ ] App.tsx 添加了模式切换
- [ ] 项目导入/导出支持舞台配置
- [ ] 开发服务器启动无错误
- [ ] 2D/3D 切换功能正常
- [ ] 高度编辑功能正常
- [ ] LED 屏幕内容上传正常
- [ ] 数据在 2D/3D 间正确共享

---

## 技术备注

### Three.js 坐标系统
- X轴：左右（左负右正）
- Y轴：上下（下负上正）
- Z轴：前后（后负前正）

### 2D 到 3D 坐标映射
- 2D `x: 0-100` → 3D `x: -width/2 到 width/2`
- 2D `y: 0-100` → 3D `z: depth/2 到 -depth/2`（舞台前方为正）
- 2D `z: 米` → 3D `y: 米`（垂直高度）

### 性能考虑
- 使用 `useFrame` 进行平滑动画插值
- 视频纹理使用 `VideoTexture` 避免 CPU 解码
- 图片纹理使用 `useTexture` hook 自动缓存

### 已知限制
- 媒体文件在导出时需要单独保存
- LED 视频在重新导入时需用户重新选择文件
- 大型场景可能需要优化（LOD、实例化等）
