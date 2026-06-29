import React, { useEffect, useMemo, useState } from 'react';
import { calculateStageDimensionsFromImage } from '../utils/stage-config';

interface StageBackgroundDialogProps {
  isOpen: boolean;
  fileName: string;
  previewUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  initialTotalWidth: number;
  wingWidth: number;
  onConfirm: (totalWidth: number) => void;
  onCancel: () => void;
}

export const StageBackgroundDialog: React.FC<StageBackgroundDialogProps> = ({
  isOpen,
  fileName,
  previewUrl,
  pixelWidth,
  pixelHeight,
  initialTotalWidth,
  wingWidth,
  onConfirm,
  onCancel,
}) => {
  const [widthDraft, setWidthDraft] = useState(String(initialTotalWidth));

  useEffect(() => {
    if (isOpen) setWidthDraft(String(Number(initialTotalWidth.toFixed(2))));
  }, [initialTotalWidth, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  const totalWidth = Number(widthDraft);
  const dimensions = useMemo(() => (
    widthDraft.trim()
      ? calculateStageDimensionsFromImage(totalWidth, wingWidth, pixelWidth, pixelHeight)
      : null
  ), [pixelHeight, pixelWidth, totalWidth, widthDraft, wingWidth]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-background-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="取消上传舞台底图"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 id="stage-background-dialog-title" className="text-base font-semibold text-white">
          设置舞台底图真实尺寸
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          输入图片覆盖区域的真实总宽，包含主舞台和左右备台。
        </p>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
          <img src={previewUrl} alt={fileName} className="max-h-52 w-full object-contain" />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-slate-500">
          <span className="truncate pr-3">{fileName}</span>
          <span>{pixelWidth} × {pixelHeight}px</span>
        </div>

        <label className="mt-4 block text-xs text-slate-300">
          图片对应真实总宽（米）
          <input
            autoFocus
            type="number"
            min={Math.max(1, wingWidth * 2 + 0.1)}
            step={0.1}
            value={widthDraft}
            onChange={(event) => setWidthDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && dimensions) onConfirm(totalWidth);
            }}
            className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
          />
        </label>

        {dimensions ? (
          <div className="mt-3 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-300">
            将设置主舞台为 {dimensions.width.toFixed(2)}m × {dimensions.depth.toFixed(2)}m，
            两侧备台各 {wingWidth.toFixed(2)}m。
          </div>
        ) : (
          <p className="mt-3 text-xs text-red-400">
            总宽必须大于两侧备台宽度之和，且图片尺寸必须有效。
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!dimensions}
            onClick={() => dimensions && onConfirm(totalWidth)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            应用底图
          </button>
        </div>
      </div>
    </div>
  );
};

export default StageBackgroundDialog;
