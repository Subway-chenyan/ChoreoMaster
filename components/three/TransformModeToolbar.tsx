import React from 'react';
import { Magnet, MousePointer2, Move3d, Rotate3d, Scaling } from 'lucide-react';

export type ObjectTransformMode = 'translate' | 'rotate' | 'scale';
export type StageTransformMode = 'navigate' | ObjectTransformMode;

const TRANSFORM_TOOLS: Array<{
  mode: StageTransformMode;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { mode: 'navigate', label: '观察', shortcut: 'Q', icon: MousePointer2 },
  { mode: 'translate', label: '位移', shortcut: 'W', icon: Move3d },
  { mode: 'rotate', label: '旋转', shortcut: 'E', icon: Rotate3d },
  { mode: 'scale', label: '缩放', shortcut: 'R', icon: Scaling },
];

interface TransformModeToolbarProps {
  mode: StageTransformMode;
  onModeChange: (mode: StageTransformMode) => void;
  snap: boolean;
  onSnapChange: (enabled: boolean) => void;
  showNavigate?: boolean;
  editingDisabled?: boolean;
  theme?: 'dark' | 'light';
  className?: string;
}

const TransformModeToolbar: React.FC<TransformModeToolbarProps> = ({
  mode,
  onModeChange,
  snap,
  onSnapChange,
  showNavigate = true,
  editingDisabled = false,
  theme = 'dark',
  className = '',
}) => {
  const isDark = theme === 'dark';
  return (
    <div
      className={`flex min-w-max items-center gap-1 ${className}`}
      role="toolbar"
      aria-label="3D 变换工具"
    >
      {TRANSFORM_TOOLS.filter((tool) => showNavigate || tool.mode !== 'navigate').map((tool) => {
        const Icon = tool.icon;
        const disabled = editingDisabled && tool.mode !== 'navigate';
        const active = mode === tool.mode;
        return (
          <button
            key={tool.mode}
            type="button"
            onClick={() => onModeChange(tool.mode)}
            disabled={disabled}
            aria-pressed={active}
            aria-label={`${tool.label}工具，快捷键 ${tool.shortcut}`}
            title={`${tool.label}工具 (${tool.shortcut})`}
            className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              active
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-950/30'
                : isDark
                  ? 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
            }`}
          >
            <Icon size={16} />
            <span>{tool.label}</span>
            <kbd className={`min-w-5 rounded border px-1 py-0.5 text-center font-mono text-[9px] leading-none ${
              active
                ? 'border-blue-300/50 bg-blue-500/50 text-blue-50'
                : isDark
                  ? 'border-slate-600 bg-slate-800 text-slate-400'
                  : 'border-gray-300 bg-white text-gray-500'
            }`}>{tool.shortcut}</kbd>
          </button>
        );
      })}
      <div className={`mx-1 h-6 w-px ${isDark ? 'bg-slate-700' : 'bg-gray-300'}`} />
      <button
        type="button"
        onClick={() => onSnapChange(!snap)}
        disabled={editingDisabled}
        aria-pressed={snap}
        aria-label={`吸附${snap ? '已开启' : '已关闭'}，快捷键 S`}
        title={`吸附${snap ? '已开启' : '已关闭'} (S)`}
        className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
          snap
            ? 'bg-emerald-600/20 text-emerald-300'
            : isDark
              ? 'text-slate-300 hover:bg-slate-700 hover:text-white'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
        }`}
      >
        <Magnet size={15} />
        <span>吸附</span>
        <kbd className={`min-w-5 rounded border px-1 py-0.5 text-center font-mono text-[9px] leading-none ${
          isDark ? 'border-slate-600 bg-slate-800 text-slate-400' : 'border-gray-300 bg-white text-gray-500'
        }`}>S</kbd>
      </button>
    </div>
  );
};

export default TransformModeToolbar;
