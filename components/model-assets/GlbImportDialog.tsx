import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import type { GlbImportSession, ModelSize, ProjectModelAsset } from '../../types';
import ModelAsset3D from '../../3d_components/ModelAsset3D';
import { EditableNumberInput } from '../FormControls';
import { generateModelAssetPreviews } from '../../utils/model-thumbnail';

interface GlbImportDialogProps {
  session: GlbImportSession;
  onCancel: () => void;
  onSaved: (asset: ProjectModelAsset) => void;
}

const GlbImportDialog: React.FC<GlbImportDialogProps> = ({ session, onCancel, onSaved }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(session.fileName.replace(/\.glb$/i, ''));
  const [tags, setTags] = useState('道具');
  const [usage, setUsage] = useState<'prop' | 'platform'>('prop');
  const [size, setSize] = useState<ModelSize>({ width: 1, height: 1, depth: 1 });
  const [sourceSize, setSourceSize] = useState<ModelSize>({ width: 1, height: 1, depth: 1 });
  const measuredRef = useRef(false);
  const [locked, setLocked] = useState(true);
  const [rotationY, setRotationY] = useState(0);
  const [originOffset, setOriginOffset] = useState({ x: 0, y: 0, z: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewAsset = useMemo<ProjectModelAsset>(() => ({
    schemaVersion: 1,
    id: `staging-${session.sessionId}`,
    revision: 1,
    contentHash: session.sessionId,
    name,
    tags: [],
    defaultUsage: usage,
    origin: 'user',
    format: 'glb',
    intrinsicSize: { width: 1, height: 1, depth: 1 },
    bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } },
    pivot: { x: 0, y: 0, z: 0 },
    footprints: [[{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]],
    correction: { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    payload: { kind: 'glb', file: { assetPath: 'model.glb', fileName: session.fileName, runtimeUrl: session.modelUrl } },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }), [name, session, usage]);

  const updateDimension = (axis: keyof ModelSize, value: number) => {
    const safe = Math.max(0.001, value);
    if (!locked) {
      setSize((current) => ({ ...current, [axis]: safe }));
      return;
    }
    setSize((current) => {
      const ratio = safe / current[axis];
      return { width: current.width * ratio, height: current.height * ratio, depth: current.depth * ratio };
    });
  };

  const handleSourceLoaded = useCallback((nextSize: ModelSize) => {
    if (measuredRef.current) return;
    measuredRef.current = true;
    setSourceSize(nextSize);
    setSize(nextSize);
  }, []);

  const updateRotation = (nextRotation: number) => {
    const previousSwapped = Math.abs(rotationY / 90) % 2 === 1;
    const nextSwapped = Math.abs(nextRotation / 90) % 2 === 1;
    if (previousSwapped !== nextSwapped) {
      setSize((current) => ({ ...current, width: current.depth, depth: current.width }));
    }
    setRotationY(nextRotation);
  };

  const commit = async () => {
    setSaving(true);
    setError(null);
    try {
      const axesSwapped = Math.abs(rotationY / 90) % 2 === 1;
      const correction = {
        offset: originOffset,
        rotation: { x: 0, y: rotationY * Math.PI / 180, z: 0 },
        scale: {
          x: (axesSwapped ? size.depth : size.width) / sourceSize.width,
          y: size.height / sourceSize.height,
          z: (axesSwapped ? size.width : size.depth) / sourceSize.depth,
        },
      };
      const previewImages = await generateModelAssetPreviews({
        ...previewAsset,
        contentHash: `${session.sessionId}-${rotationY}-${size.width}-${size.height}-${size.depth}-${originOffset.x}-${originOffset.y}-${originOffset.z}`,
        intrinsicSize: size,
        correction,
      });
      const saved = await window.electronAPI.modelAssets.commitGlbImport(session.sessionId, {
        name,
        tags: tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
        defaultUsage: usage,
        intrinsicSize: size,
        pivot: originOffset,
        footprints: [[
          { x: -size.width / 2, y: -size.depth / 2 },
          { x: size.width / 2, y: -size.depth / 2 },
          { x: size.width / 2, y: size.depth / 2 },
          { x: -size.width / 2, y: size.depth / 2 },
        ]],
        correction,
        ...previewImages,
        textureMaxDimension: session.textureMaxDimension,
      });
      onSaved(saved as ProjectModelAsset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GLB 保存失败');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100000] grid place-items-center bg-black/75 p-6">
      <div className="flex h-[min(760px,90vh)] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-center border-b border-slate-700 px-5 py-4"><div><h2 className="text-lg font-semibold text-white">导入 GLB · {step === 1 ? '检查' : step === 2 ? '校准' : '保存'}</h2><p className="text-xs text-slate-400">{session.fileName} · {(session.sizeBytes / 1024 / 1024).toFixed(1)} MB · {session.triangleCount.toLocaleString()} 面</p></div><div className="flex-1" /><button type="button" onClick={onCancel} className="rounded px-3 py-2 text-sm text-slate-400 hover:bg-slate-800">取消</button></header>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_330px]">
          <div className="bg-slate-950"><Canvas camera={{ position: [3, 2.5, 5], fov: 48 }}><ambientLight intensity={1.2} /><directionalLight position={[5, 8, 6]} intensity={2} /><Grid args={[20, 20]} cellSize={0.25} sectionSize={1} /><group rotation={[0, rotationY * Math.PI / 180, 0]}><ModelAsset3D asset={previewAsset} width={1} height={1} depth={1} onLoaded={handleSourceLoaded} /></group><OrbitControls makeDefault /></Canvas></div>
          <aside className="overflow-y-auto border-l border-slate-700 p-5">
            {step === 1 && <div className="space-y-4 text-sm text-slate-300"><div className="rounded border border-emerald-800 bg-emerald-950/40 p-3 text-emerald-200">GLB 2.0 文件头、场景网格和内嵌资源检查通过。</div>{session.warnings.map((warning) => <div key={warning} className="rounded border border-amber-800 bg-amber-950/40 p-3 text-amber-200">{warning}</div>)}<p>坐标约定：X 向右、Y 向上、+Z 朝舞台前方。默认按 1 单位 = 1 米读取。</p></div>}
            {step === 2 && <div className="space-y-4"><label className="block text-xs text-slate-400">朝向（绕 Y 轴）<select value={rotationY} onChange={(event) => updateRotation(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2"><option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label><button type="button" onClick={() => setLocked((value) => !value)} className={`w-full rounded px-3 py-2 text-sm ${locked ? 'bg-emerald-800' : 'bg-slate-700'}`}>比例锁 {locked ? '已开启' : '已解除'}</button><div className="grid grid-cols-3 gap-2">{(['width', 'height', 'depth'] as const).map((axis) => <label key={axis} className="text-[10px] text-slate-500">{axis === 'width' ? '宽' : axis === 'height' ? '高' : '深'}<EditableNumberInput min={0.001} step={0.1} value={size[axis]} onChange={(value) => updateDimension(axis, value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-xs" /></label>)}</div><div><div className="mb-1 text-xs text-slate-400">原点偏移（米）</div><div className="grid grid-cols-3 gap-2">{(['x', 'y', 'z'] as const).map((axis) => <label key={axis} className="text-[10px] text-slate-500">{axis.toUpperCase()}<EditableNumberInput step={0.1} value={originOffset[axis]} onChange={(value) => setOriginOffset((current) => ({ ...current, [axis]: value }))} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-xs" /></label>)}</div></div><p className="text-xs leading-5 text-slate-500">模型默认水平居中并落地到 Y=0；原点偏移可用于进一步校正。尺寸单位为米。</p></div>}
            {step === 3 && <div className="space-y-4"><label className="block text-xs text-slate-400">名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" /></label><label className="block text-xs text-slate-400">标签<input value={tags} onChange={(event) => setTags(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" /></label><label className="block text-xs text-slate-400">默认用途<select value={usage} onChange={(event) => setUsage(event.target.value as 'prop' | 'platform')} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2"><option value="prop">普通道具</option><option value="platform">高台</option></select></label><div className="rounded bg-slate-800 p-3 text-xs leading-5 text-slate-300">保存后原始材质会保持不变；动画、摄像机和灯光不会进入舞台编排。</div></div>}
            {error && <div className="mt-4 rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
          </aside>
        </div>
        <footer className="flex items-center justify-between border-t border-slate-700 px-5 py-4"><button type="button" disabled={step === 1} onClick={() => setStep((step - 1) as 1 | 2 | 3)} className="rounded bg-slate-700 px-4 py-2 text-sm disabled:opacity-30">上一步</button><button type="button" disabled={saving || !name.trim()} onClick={() => step < 3 ? setStep((step + 1) as 1 | 2 | 3) : void commit()} className="rounded bg-blue-600 px-5 py-2 text-sm font-medium disabled:opacity-50">{saving ? '保存中…' : step < 3 ? '下一步' : '保存到资产库'}</button></footer>
      </div>
    </div>,
    document.body,
  );
};

export default GlbImportDialog;
