import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, RefreshCw, X } from 'lucide-react';
import type { Performer, ProjectModelAsset, PropCategory, PropRotationPivot } from '../types';
import { SelectField, StepperNumberField } from './FormControls';

interface PropEditorModalProps {
  isOpen: boolean;
  performer?: Performer | null;
  asset?: ProjectModelAsset;
  defaultColor?: string;
  onSave: (updates: Partial<Performer>) => void;
  onClose: () => void;
  onUpdateAssetVersion?: () => void;
}

const PROP_CATEGORY_OPTIONS: { value: PropCategory; label: string }[] = [
  { value: 'prop', label: '普通道具' },
  { value: 'platform', label: '高台' },
];

const ROTATION_PIVOT_OPTIONS: { value: PropRotationPivot; label: string }[] = [
  { value: 'center', label: '中心锚点' },
  { value: 'left', label: '左侧锚点' },
  { value: 'right', label: '右侧锚点' },
];

export function PropEditorModal({
  isOpen,
  performer,
  asset,
  defaultColor = '#3B82F6',
  onSave,
  onClose,
  onUpdateAssetVersion,
}: PropEditorModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(defaultColor);
  const [width, setWidth] = useState(0.5);
  const [depth, setDepth] = useState(0.5);
  const [height, setHeight] = useState(0.5);
  const [category, setCategory] = useState<PropCategory>('prop');
  const [aspectLocked, setAspectLocked] = useState(false);
  const [rotationPivot, setRotationPivot] = useState<PropRotationPivot>('center');

  useEffect(() => {
    if (!isOpen) return;
    setName(performer?.name ?? '');
    setColor(performer?.color ?? defaultColor);
    setWidth(performer?.width ?? 0.5);
    setDepth(performer?.depth ?? 0.5);
    setHeight(performer?.height ?? 0.5);
    setCategory(performer?.propCategory ?? 'prop');
    setAspectLocked(performer?.modelAspectLocked ?? false);
    setRotationPivot(performer?.rotationPivot ?? 'center');
  }, [defaultColor, isOpen, performer]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isEditing = Boolean(performer);
  const updateDimension = (field: 'width' | 'depth' | 'height', value: number) => {
    if (!aspectLocked) {
      if (field === 'width') setWidth(value);
      if (field === 'depth') setDepth(value);
      if (field === 'height') setHeight(value);
      return;
    }
    const current = field === 'width' ? width : field === 'depth' ? depth : height;
    const ratio = value / Math.max(0.01, current);
    setWidth((size) => size * ratio);
    setDepth((size) => size * ratio);
    setHeight((size) => size * ratio);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100010] overflow-y-auto bg-black/65 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
        <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/60 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-600/15 p-2 text-blue-300">
                <Box size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">{isEditing ? '编辑道具' : '添加道具'}</h2>
                <p className="text-xs text-slate-400">集中调整道具名称、尺寸和舞台行为</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              aria-label="关闭道具参数弹窗"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                <label className="mb-2 block text-xs font-medium tracking-wide text-slate-400">名称</label>
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="输入道具名称"
                />
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                <label className="mb-2 block text-xs font-medium tracking-wide text-slate-400">颜色</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-14 w-20 cursor-pointer rounded-lg border border-slate-500 bg-transparent p-1"
                    title="道具颜色"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm font-mono text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {asset && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                  <div className="text-xs font-medium text-blue-200">模型资产</div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white">{asset.name}</div>
                      <div className="mt-1 text-[11px] text-blue-200/70">
                        {asset.sourceRevision ? `资产库版本 v${asset.sourceRevision}` : '项目内资产快照'}
                      </div>
                    </div>
                    {asset.sourceAssetId && onUpdateAssetVersion && (
                      <button
                        type="button"
                        onClick={onUpdateAssetVersion}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-400/30 bg-blue-600/20 px-3 py-2 text-xs text-blue-100 transition hover:bg-blue-600/35"
                      >
                        <RefreshCw size={13} /> 更新版本
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StepperNumberField label="长度" value={width} min={0.1} step={0.1} onChange={(value) => updateDimension('width', value)} />
                <StepperNumberField label="宽度" value={depth} min={0.1} step={0.1} onChange={(value) => updateDimension('depth', value)} />
                <StepperNumberField label="高度" value={height} min={0.1} step={0.1} onChange={(value) => updateDimension('height', value)} />
              </div>

              <SelectField<PropCategory>
                label="类型"
                value={category}
                onChange={setCategory}
                options={PROP_CATEGORY_OPTIONS}
                helperText={category === 'platform'
                  ? `演员与高台占地碰撞时，将按 ${height.toFixed(1)}m 高度抬升`
                  : '普通道具不会抬升演员高度'}
                helperTone={category === 'platform' ? 'accent' : 'default'}
              />

              <SelectField<PropRotationPivot>
                label="旋转锚点"
                value={rotationPivot}
                onChange={setRotationPivot}
                options={ROTATION_PIVOT_OPTIONS}
                helperText="门板等道具可选择左右侧锚点，旋转时会围绕对应边缘转动。"
              />

              <button
                type="button"
                onClick={() => setAspectLocked((locked) => !locked)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${aspectLocked
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
                  : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'}`}
              >
                <span>
                  <span className="block text-sm font-medium">锁定模型比例</span>
                  <span className="mt-1 block text-[11px] opacity-70">调整任一尺寸时保持长宽高比例</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${aspectLocked ? 'bg-emerald-500/20' : 'bg-slate-700'}`}>
                  {aspectLocked ? '已开启' : '已关闭'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-700 bg-slate-800/60 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-600"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => onSave({
                name: name.trim(),
                color,
                shape: 'square',
                type: 'prop',
                width,
                depth,
                height,
                propCategory: category,
                modelAspectLocked: aspectLocked,
                rotationPivot,
              })}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isEditing ? '保存修改' : '添加道具'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default PropEditorModal;
