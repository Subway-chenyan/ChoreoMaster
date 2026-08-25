import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Circle, Square, Triangle, UserRound, X } from 'lucide-react';
import type { Performer, PerformerShape } from '../types';
import {
  DEFAULT_PERFORMER_HEIGHT,
  DEFAULT_PERFORMER_WIDTH,
} from '../electron/stage-defaults';
import { StepperNumberField } from './FormControls';

interface PerformerEditorModalProps {
  isOpen: boolean;
  performer?: Performer | null;
  onSave: (updates: Partial<Performer>) => void;
  onClose: () => void;
}

const SHAPE_OPTIONS: { value: PerformerShape; label: string; icon: typeof Circle }[] = [
  { value: 'circle', label: '圆形', icon: Circle },
  { value: 'triangle', label: '三角形', icon: Triangle },
  { value: 'square', label: '方形', icon: Square },
];

export function PerformerEditorModal({
  isOpen,
  performer,
  onSave,
  onClose,
}: PerformerEditorModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [shape, setShape] = useState<PerformerShape>('circle');
  const [size, setSize] = useState(DEFAULT_PERFORMER_WIDTH);
  const [height, setHeight] = useState(DEFAULT_PERFORMER_HEIGHT);

  useEffect(() => {
    if (!isOpen || !performer) return;
    setName(performer.name);
    setColor(performer.color);
    setShape(performer.shape);
    setSize(performer.width ?? DEFAULT_PERFORMER_WIDTH);
    setHeight(performer.height ?? DEFAULT_PERFORMER_HEIGHT);
  }, [isOpen, performer]);

  if (!isOpen || !performer) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600/15 p-2 text-blue-300">
              <UserRound size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">编辑演员</h2>
              <p className="text-xs text-slate-400">修改名称、外观、尺寸和高度</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            aria-label="关闭演员编辑面板"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-400">名称</label>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="输入演员名称"
              />
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="mb-3 text-xs font-medium tracking-wide text-slate-400">形状</div>
              <div className="grid grid-cols-3 gap-2">
                {SHAPE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const active = shape === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setShape(option.value)}
                      className={`rounded-xl border px-3 py-3 text-sm transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-500/15 text-white'
                          : 'border-slate-600 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      <div className="mb-2 flex justify-center">
                        <Icon size={18} fill={option.value !== 'triangle' && active ? 'currentColor' : 'none'} />
                      </div>
                      <div>{option.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-400">颜色</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-14 w-20 cursor-pointer rounded-lg border border-slate-500 bg-transparent p-1"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="flex-1 rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm font-mono text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StepperNumberField label="尺寸" value={size} min={0.1} step={0.1} onChange={setSize} />
              <StepperNumberField label="高度" value={height} min={0.1} step={0.1} onChange={setHeight} />
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="mb-3 text-xs font-medium tracking-wide text-slate-400">预览</div>
              <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-slate-950/70">
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    width: `${Math.max(72, size * 48)}px`,
                    height: `${Math.max(72, size * 48)}px`,
                  }}
                >
                  {shape === 'circle' && (
                    <div
                      className="h-full w-full rounded-full border-2 border-white/80"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {shape === 'square' && (
                    <div
                      className="h-full w-full border-2 border-white/80"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {shape === 'triangle' && (
                    <div
                      className="h-full w-full"
                      style={{
                        backgroundColor: color,
                        clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
                        border: '2px solid rgba(255,255,255,0.8)',
                      }}
                    />
                  )}
                  <div className="pointer-events-none absolute left-1/2 top-full mt-4 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 px-3 py-1 text-sm font-medium text-white shadow-lg">
                    {name.trim() || '演员名称'}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                尺寸会等比例调整演员在舞台上的占地显示，高度会影响 3D 视图中的人物高度与标签位置。
              </p>
            </div>
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
            onClick={() => onSave({
              name: name.trim() || performer.name,
              color,
              shape,
              width: size,
              depth: size,
              height,
            })}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            保存
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}

export default PerformerEditorModal;
