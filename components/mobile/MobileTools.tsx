import React from 'react';
import { Copy, Hand, MousePointer2, SlidersHorizontal, Users } from 'lucide-react';
export type MobileTool = 'select' | 'multi' | 'pan';
export function MobileTools({
  mode,
  onMode,
  onActors,
  onStage,
}: {
  mode: MobileTool;
  onMode: (mode: MobileTool) => void;
  onActors: () => void;
  onStage: () => void;
}) {
  return (
    <nav className="mobile-tools" aria-label="舞台工具">
      {(
        [
          { mode: 'select', label: '移动', Icon: MousePointer2 },
          { mode: 'multi', label: '多选', Icon: Copy },
          { mode: 'pan', label: '平移', Icon: Hand },
        ] as const
      ).map(({ mode: value, label, Icon }) => (
        <button
          key={value}
          aria-pressed={mode === value}
          className={mode === value ? 'active' : ''}
          onClick={() => onMode(value)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
      <i />
      <button onClick={onActors}>
        <Users size={20} />
        <span>演员</span>
      </button>
      <button onClick={onStage}>
        <SlidersHorizontal size={20} />
        <span>舞台</span>
      </button>
    </nav>
  );
}
