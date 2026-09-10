import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Box, Circle, Cone, Copy, Cuboid, Cylinder, Redo2, Save, Trash2, Undo2, X } from 'lucide-react';
import * as THREE from 'three';
import type {
  ModelPart,
  ModelPrimitiveKind,
  ParametricModelRecipe,
  ProjectModelAsset,
} from '../../types';
import { MAX_PARAMETRIC_MODEL_PARTS, isSimplePolygon } from '../../types';
import { calculateParametricModelMetadata, createParametricModel, disposeModelObject } from '../../utils/model-runtime';
import { renderModelPreviewImages } from '../../utils/model-thumbnail';
import { EditableNumberInput } from '../FormControls';
import TransformModeToolbar, { type ObjectTransformMode } from '../three/TransformModeToolbar';

interface ModelerWorkspaceProps {
  asset?: ProjectModelAsset | null;
  onClose: () => void;
  onSaved: (asset: ProjectModelAsset) => void;
}

function createPart(kind: ModelPrimitiveKind, index: number): ModelPart {
  const id = `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const common = {
    id,
    name: `部件 ${index + 1}`,
    position: { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    material: { color: '#64748b' },
  };
  if (kind === 'box') return { ...common, geometry: { kind, width: 1, height: 1, depth: 1 } };
  if (kind === 'cylinder') return { ...common, geometry: { kind, radius: 0.5, height: 1, segments: 32 } };
  if (kind === 'sphere') return { ...common, geometry: { kind, radius: 0.5, segments: 32 } };
  if (kind === 'cone') return { ...common, geometry: { kind, radius: 0.5, height: 1, segments: 32 } };
  return {
    ...common,
    geometry: {
      kind,
      height: 1,
      points: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }],
    },
  };
}

function createInitialRecipe(asset?: ProjectModelAsset | null): ParametricModelRecipe {
  if (asset?.payload.kind === 'parametric') {
    return structuredClone(asset.payload.recipe);
  }
  return { schemaVersion: 1, origin: { x: 0, y: 0, z: 0 }, parts: [createPart('box', 0)] };
}

function findPartObject(root: THREE.Object3D, partId: string): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.userData.modelPartId === partId) match = object;
  });
  return match;
}

function findPartIdFromObject(object: THREE.Object3D | null): string | null {
  let current = object;
  while (current) {
    if (current.userData.modelPartId) return String(current.userData.modelPartId);
    current = current.parent;
  }
  return null;
}

function findPartIdFromPointerEvent(event: ThreeEvent<PointerEvent>): string | null {
  const objects = [event.object, ...event.intersections.map((intersection) => intersection.object)];
  for (const object of objects) {
    const partId = findPartIdFromObject(object);
    if (partId) return partId;
  }
  return null;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

const ModelPreview: React.FC<{
  recipe: ParametricModelRecipe;
  selectedId: string | null;
  mode: ObjectTransformMode;
  snap: boolean;
  onSelect: (id: string) => void;
  onTransform: (partId: string, object: THREE.Object3D) => void;
}> = ({ recipe, selectedId, mode, snap, onSelect, onTransform }) => {
  const model = useMemo(() => createParametricModel(recipe), [recipe]);
  const { camera, gl } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster());
  const transformDraggingRef = useRef(false);
  const [isTransforming, setIsTransforming] = useState(false);
  useEffect(() => () => disposeModelObject(model), [model]);
  const selectedObject = selectedId ? findPartObject(model, selectedId) : null;

  const finishTransform = useCallback(() => {
    if (!transformDraggingRef.current) return;
    transformDraggingRef.current = false;
    setIsTransforming(false);
    if (selectedObject && selectedId) onTransform(selectedId, selectedObject);
  }, [onTransform, selectedId, selectedObject]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handlePointerDown = (event: PointerEvent) => {
      if (transformDraggingRef.current || event.button !== 0 || event.defaultPrevented) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObject(model, true);
      const partId = intersections.reduce<string | null>((match, intersection) => (
        match ?? findPartIdFromObject(intersection.object)
      ), null);
      if (partId) onSelect(partId);
    };
    canvas.addEventListener('pointerdown', handlePointerDown, true);
    canvas.addEventListener('pointercancel', finishTransform);
    canvas.addEventListener('lostpointercapture', finishTransform);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, true);
      canvas.removeEventListener('pointercancel', finishTransform);
      canvas.removeEventListener('lostpointercapture', finishTransform);
    };
  }, [camera, finishTransform, gl, model, onSelect]);

  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[6, 10, 8]} intensity={2} castShadow />
      <Grid args={[30, 30]} cellSize={0.25} sectionSize={1} fadeDistance={25} />
      <primitive
        object={model}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          const partId = findPartIdFromPointerEvent(event);
          if (!partId) return;
          event.stopPropagation();
          onSelect(partId);
        }}
      />
      {selectedObject && selectedId && (
        <TransformControls
          object={selectedObject}
          mode={mode}
          translationSnap={snap ? 0.1 : null}
          rotationSnap={snap ? THREE.MathUtils.degToRad(5) : null}
          scaleSnap={snap ? 0.1 : null}
          onMouseDown={() => {
            transformDraggingRef.current = true;
            setIsTransforming(true);
          }}
          onMouseUp={finishTransform}
        />
      )}
      <OrbitControls makeDefault enabled={!isTransforming} minDistance={1.5} maxDistance={40} />
    </>
  );
};

const ModelerWorkspace: React.FC<ModelerWorkspaceProps> = ({ asset, onClose, onSaved }) => {
  const initialRecipeRef = useRef(createInitialRecipe(asset));
  const [recipe, setRecipe] = useState<ParametricModelRecipe>(initialRecipeRef.current);
  const [name, setName] = useState(asset?.name ?? '新建模型');
  const [tags, setTags] = useState((asset?.tags ?? ['道具']).join('、'));
  const [usage, setUsage] = useState<'prop' | 'platform'>(asset?.defaultUsage ?? 'prop');
  const [selectedId, setSelectedId] = useState<string | null>(recipe.parts[0]?.id ?? null);
  const [mode, setMode] = useState<ObjectTransformMode>('translate');
  const [snap, setSnap] = useState(true);
  const [undoStack, setUndoStack] = useState<ParametricModelRecipe[]>([]);
  const [redoStack, setRedoStack] = useState<ParametricModelRecipe[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showLeaveGuard, setShowLeaveGuard] = useState(false);

  const selected = recipe.parts.find((part) => part.id === selectedId) ?? null;

  const commit = useCallback((next: ParametricModelRecipe) => {
    setUndoStack((stack) => [...stack.slice(-49), structuredClone(recipe)]);
    setRedoStack([]);
    setRecipe(next);
    setDirty(true);
  }, [recipe]);

  const updatePart = (partId: string, updates: Partial<ModelPart>) => {
    commit({ ...recipe, parts: recipe.parts.map((part) => part.id === partId ? { ...part, ...updates } : part) });
  };

  const addPart = (kind: ModelPrimitiveKind) => {
    if (recipe.parts.length >= MAX_PARAMETRIC_MODEL_PARTS) {
      setError(`参数化模型最多包含 ${MAX_PARAMETRIC_MODEL_PARTS} 个部件`);
      return;
    }
    const part = createPart(kind, recipe.parts.length);
    commit({ ...recipe, parts: [...recipe.parts, part] });
    setSelectedId(part.id);
  };

  const removeSelected = () => {
    if (!selected) return;
    const nextParts = recipe.parts
      .filter((part) => part.id !== selected.id)
      .map((part) => part.parentId === selected.id ? { ...part, parentId: selected.parentId } : part);
    commit({ ...recipe, parts: nextParts });
    setSelectedId(nextParts[0]?.id ?? null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy = structuredClone(selected);
    copy.id = `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    copy.name = `${copy.name} 副本`;
    copy.position.x += 0.25;
    commit({ ...recipe, parts: [...recipe.parts, copy] });
    setSelectedId(copy.id);
  };

  const updateNumber = (field: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', value: number) => {
    if (!selected) return;
    updatePart(selected.id, { [field]: { ...selected[field], [axis]: value } });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || isEditableKeyboardTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'w') {
        event.preventDefault();
        setMode('translate');
      } else if (key === 'e') {
        event.preventDefault();
        setMode('rotate');
      } else if (key === 'r') {
        event.preventDefault();
        setMode('scale');
      } else if (key === 's') {
        event.preventDefault();
        setSnap((value) => !value);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const save = async () => {
    if (!window.electronAPI?.isElectron) {
      setError('本地 3D 资产库仅桌面端可用');
      return;
    }
    if (recipe.parts.length === 0) {
      setError('模型至少需要一个部件');
      return;
    }
    const invalidExtrusion = recipe.parts.find((part) => (
      part.geometry.kind === 'extrusion' && !isSimplePolygon(part.geometry.points)
    ));
    if (invalidExtrusion) {
      setError(`${invalidExtrusion.name} 的多边形面积无效或存在自交`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const metadata = calculateParametricModelMetadata(recipe);
      const thumbnailModel = createParametricModel(recipe);
      let previewImages: Awaited<ReturnType<typeof renderModelPreviewImages>>;
      try {
        previewImages = await renderModelPreviewImages(thumbnailModel);
      } finally {
        disposeModelObject(thumbnailModel);
      }
      const saved = await window.electronAPI.modelAssets.saveParametric({
        assetId: asset?.origin === 'user' ? asset.id : undefined,
        expectedRevision: asset?.origin === 'user' ? asset.revision : undefined,
        name,
        tags: tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
        defaultUsage: usage,
        recipe,
        intrinsicSize: metadata.intrinsicSize,
        bounds: metadata.bounds,
        pivot: recipe.origin,
        footprints: metadata.footprints,
        ...previewImages,
      });
      setDirty(false);
      onSaved(saved as ProjectModelAsset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateExtrusionPoints = (part: ModelPart, value: string) => {
    if (part.geometry.kind !== 'extrusion') return;
    const points = value.split(/\n+/).flatMap((line) => {
      const [x, y] = line.split(',').map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
    });
    updatePart(part.id, { geometry: { ...part.geometry, points } });
  };

  const updateGeometryValue = (part: ModelPart, field: string, value: number) => {
    const safe = Math.max(0.001, value);
    const geometry = part.geometry;
    if (geometry.kind === 'box' && (field === 'width' || field === 'height' || field === 'depth')) {
      updatePart(part.id, { geometry: { ...geometry, [field]: safe } });
    } else if ((geometry.kind === 'cylinder' || geometry.kind === 'cone') && (field === 'radius' || field === 'height')) {
      updatePart(part.id, { geometry: { ...geometry, [field]: safe } });
    } else if (geometry.kind === 'sphere' && field === 'radius') {
      updatePart(part.id, { geometry: { ...geometry, radius: safe } });
    } else if (geometry.kind === 'extrusion' && field === 'height') {
      updatePart(part.id, { geometry: { ...geometry, height: safe } });
    }
  };

  const requestClose = () => dirty ? setShowLeaveGuard(true) : onClose();

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-slate-950 text-slate-100">
      <header className="flex h-14 items-center gap-3 border-b border-slate-700 bg-slate-900 px-4">
        <button type="button" onClick={requestClose} className="rounded p-2 hover:bg-slate-800" aria-label="关闭建模器"><X size={18} /></button>
        <input value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} className="w-56 rounded border border-slate-600 bg-slate-800 px-3 py-1.5 font-semibold" />
        <div className="h-6 w-px bg-slate-700" />
        <TransformModeToolbar
          mode={mode}
          onModeChange={(nextMode) => {
            if (nextMode !== 'navigate') setMode(nextMode);
          }}
          snap={snap}
          onSnapChange={setSnap}
          showNavigate={false}
        />
        <button type="button" disabled={undoStack.length === 0} onClick={() => {
          const previous = undoStack.at(-1); if (!previous) return;
          setRedoStack((stack) => [...stack, structuredClone(recipe)]); setRecipe(previous); setUndoStack((stack) => stack.slice(0, -1));
        }} className="rounded p-2 disabled:opacity-30 hover:bg-slate-800" title="撤销" aria-label="撤销"><Undo2 size={17} /></button>
        <button type="button" disabled={redoStack.length === 0} onClick={() => {
          const next = redoStack.at(-1); if (!next) return;
          setUndoStack((stack) => [...stack, structuredClone(recipe)]); setRecipe(next); setRedoStack((stack) => stack.slice(0, -1));
        }} className="rounded p-2 disabled:opacity-30 hover:bg-slate-800" title="重做" aria-label="重做"><Redo2 size={17} /></button>
        <div className="flex-1" />
        <button type="button" disabled={saving} onClick={save} className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500 disabled:opacity-50"><Save size={17} />{saving ? '保存中…' : '保存到资产库'}</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-700 bg-slate-900 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">部件树 · {recipe.parts.length}/{MAX_PARAMETRIC_MODEL_PARTS}</div>
          <div className="mb-3 grid grid-cols-5 gap-1">
            <button type="button" title="盒体" onClick={() => addPart('box')} className="rounded bg-slate-800 p-2 hover:bg-slate-700"><Cuboid size={17} /></button>
            <button type="button" title="圆柱" onClick={() => addPart('cylinder')} className="rounded bg-slate-800 p-2 hover:bg-slate-700"><Cylinder size={17} /></button>
            <button type="button" title="球体" onClick={() => addPart('sphere')} className="rounded bg-slate-800 p-2 hover:bg-slate-700"><Circle size={17} /></button>
            <button type="button" title="圆锥" onClick={() => addPart('cone')} className="rounded bg-slate-800 p-2 hover:bg-slate-700"><Cone size={17} /></button>
            <button type="button" title="多边形挤出" onClick={() => addPart('extrusion')} className="rounded bg-slate-800 p-2 hover:bg-slate-700"><Box size={17} /></button>
          </div>
          <div className="space-y-1">
            {recipe.parts.map((part) => (
              <button key={part.id} type="button" onClick={() => setSelectedId(part.id)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${selectedId === part.id ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
                <span className="truncate">{part.parentId ? '↳ ' : ''}{part.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={!selected} onClick={duplicateSelected} className="flex flex-1 items-center justify-center gap-1 rounded bg-slate-800 py-2 text-xs disabled:opacity-30"><Copy size={14} />复制</button>
            <button type="button" disabled={!selected} onClick={removeSelected} className="flex flex-1 items-center justify-center gap-1 rounded bg-red-950 py-2 text-xs text-red-200 disabled:opacity-30"><Trash2 size={14} />删除</button>
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 bg-slate-950">
          <Canvas shadows camera={{ position: [4, 3, 6], fov: 48 }} onPointerMissed={() => setSelectedId(null)}>
            <ModelPreview recipe={recipe} selectedId={selectedId} mode={mode} snap={snap} onSelect={setSelectedId} onTransform={(partId, object) => updatePart(partId, {
              position: { x: object.position.x, y: object.position.y, z: object.position.z },
              rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
              scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
            })} />
          </Canvas>
          <div className="pointer-events-none absolute left-4 top-4 max-w-72 rounded-lg border border-slate-700/80 bg-slate-900/85 px-3 py-2 shadow-lg backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <span className="h-2 w-2 rounded-full bg-blue-400" />
              {selected
                ? `${mode === 'translate' ? '位移' : mode === 'rotate' ? '旋转' : '缩放'} · ${selected.name}`
                : '先选择一个部件'}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-slate-400">
              {selected
                ? mode === 'translate'
                  ? '拖动红、绿、蓝轴调整部件位置'
                  : mode === 'rotate'
                    ? '拖动彩色圆环调整部件角度'
                    : '拖动方块控制部件尺寸'
                : '点击模型或左侧部件树即可选中'}
            </p>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-slate-700/80 bg-slate-900/85 px-4 py-2 text-[11px] text-slate-300 shadow-lg backdrop-blur">
            左键选择 · 拖动彩色控制轴 · 右键旋转视角 · 滚轮缩放视图
          </div>
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-900 p-4">
          <h2 className="mb-4 font-semibold">资产属性</h2>
          <label className="mb-3 block text-xs text-slate-400">标签<input value={tags} onChange={(event) => { setTags(event.target.value); setDirty(true); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-slate-100" placeholder="道具、门板" /></label>
          <label className="mb-5 block text-xs text-slate-400">默认用途<select value={usage} onChange={(event) => { setUsage(event.target.value as 'prop' | 'platform'); setDirty(true); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm"><option value="prop">普通道具</option><option value="platform">高台</option></select></label>
          <h2 className="mb-3 border-t border-slate-700 pt-4 font-semibold">整体原点（米）</h2>
          <div className="mb-5 grid grid-cols-3 gap-2">{(['x', 'y', 'z'] as const).map((axis) => <label key={axis} className="text-[10px] text-slate-500">{axis.toUpperCase()}<EditableNumberInput value={recipe.origin[axis]} onChange={(value) => commit({ ...recipe, origin: { ...recipe.origin, [axis]: value } })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-1 py-1.5 text-xs" /></label>)}</div>
          {selected && (
            <>
              <h2 className="mb-3 border-t border-slate-700 pt-4 font-semibold">部件属性</h2>
              <input value={selected.name} onChange={(event) => updatePart(selected.id, { name: event.target.value })} className="mb-3 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" />
              <label className="mb-4 block text-xs text-slate-400">父级<select value={selected.parentId ?? ''} onChange={(event) => updatePart(selected.id, { parentId: event.target.value || undefined })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm"><option value="">根级</option>{recipe.parts.filter((part) => part.id !== selected.id).map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}</select></label>
              <div className="mb-4"><div className="mb-2 text-xs font-semibold text-slate-400">几何尺寸（米）</div><div className="grid grid-cols-3 gap-2">{(selected.geometry.kind === 'box' ? ['width', 'height', 'depth'] : selected.geometry.kind === 'sphere' ? ['radius'] : selected.geometry.kind === 'extrusion' ? ['height'] : ['radius', 'height']).map((field) => <label key={field} className="text-[10px] text-slate-500">{field === 'width' ? '宽' : field === 'depth' ? '深' : field === 'height' ? '高' : '半径'}<EditableNumberInput min={0.001} step={0.1} value={Number(selected.geometry[field as keyof typeof selected.geometry])} onChange={(value) => updateGeometryValue(selected, field, value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-1 py-1.5 text-xs" /></label>)}</div></div>
              {(['position', 'rotation', 'scale'] as const).map((field) => <div key={field} className="mb-4"><div className="mb-2 text-xs font-semibold text-slate-400">{field === 'position' ? '位移' : field === 'rotation' ? '旋转（弧度）' : '缩放'}</div><div className="grid grid-cols-3 gap-2">{(['x', 'y', 'z'] as const).map((axis) => <label key={axis} className="text-[10px] text-slate-500">{axis.toUpperCase()}<EditableNumberInput value={selected[field][axis]} onChange={(value) => updateNumber(field, axis, value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-1 py-1.5 text-xs" /></label>)}</div></div>)}
              <label className="mb-4 block text-xs text-slate-400">颜色<input type="color" value={selected.material.color} onChange={(event) => updatePart(selected.id, { material: { ...selected.material, color: event.target.value } })} className="mt-1 h-9 w-full rounded bg-slate-800" /></label>
              <label className="mb-4 block text-xs text-slate-400">底图（PNG/JPEG/WebP）<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                const file = event.target.files?.[0]; if (!file) return;
                const reader = new FileReader(); reader.onload = () => updatePart(selected.id, { material: { ...selected.material, baseColorTexture: { assetPath: `textures/${selected.id}`, fileName: file.name, runtimeUrl: String(reader.result) } } }); reader.readAsDataURL(file);
              }} className="mt-1 block w-full text-xs" /></label>
              {selected.geometry.kind === 'extrusion' && <label className="block text-xs text-slate-400">挤出轮廓（每行 x,y）<textarea value={selected.geometry.points.map((point) => `${point.x},${point.y}`).join('\n')} onChange={(event) => {
                updateExtrusionPoints(selected, event.target.value);
              }} rows={6} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 font-mono text-xs" /></label>}
            </>
          )}
          {error && <div className="mt-4 rounded border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{error}</div>}
        </aside>
      </div>

      {showLeaveGuard && <div className="fixed inset-0 z-[140] grid place-items-center bg-black/70"><div className="w-[380px] rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"><h3 className="text-lg font-semibold">放弃未保存修改？</h3><p className="mt-2 text-sm text-slate-400">当前模型的修改尚未保存到资产库。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowLeaveGuard(false)} className="rounded bg-slate-700 px-4 py-2">继续编辑</button><button type="button" onClick={onClose} className="rounded bg-red-700 px-4 py-2">放弃修改</button></div></div></div>}
    </div>
  );
};

export default ModelerWorkspace;
