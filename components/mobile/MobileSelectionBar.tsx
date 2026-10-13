import React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, SlidersHorizontal, X } from 'lucide-react';
import type { MobileTool } from './MobileTools';

export function MobileSelectionBar({
  count,
  movable,
  mode,
  step,
  onStep,
  onNudge,
  onClear,
  onEdit,
  onMove,
}: {
  count: number;
  movable: boolean;
  mode: MobileTool;
  step: number;
  onStep: () => void;
  onNudge: (x: number, y: number) => void;
  onClear: () => void;
  onEdit: () => void;
  onMove: () => void;
}) {
  return (
    <div className="mobile-selection" aria-label="所选演员快捷操作">
      <button className="mobile-selection__summary" aria-label="编辑所选演员" onClick={onEdit}>
        <SlidersHorizontal size={16} />
        <span>已选 {count} 人</span>
      </button>
      {mode === 'select' ? (
        <>
          <button
            className="mobile-selection__step"
            aria-label={`微调步长 ${step} 米，点击切换`}
            onClick={onStep}
          >
            {step}
            <small>米</small>
          </button>
          <div className="mobile-selection__arrows" role="group" aria-label="精确调整位置">
            {(
              [
                { x: -1, y: 0, label: '向左微调', Icon: ArrowLeft },
                { x: 0, y: -1, label: '向上微调', Icon: ArrowUp },
                { x: 0, y: 1, label: '向下微调', Icon: ArrowDown },
                { x: 1, y: 0, label: '向右微调', Icon: ArrowRight },
              ] as const
            ).map(({ x, y, label, Icon }) => (
              <button
                key={label}
                className="mobile-icon"
                aria-label={label}
                disabled={!movable}
                onClick={() => onNudge(x * step, y * step)}
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <button className="mobile-selection__move" onClick={onMove}>
          <Check size={17} />
          {mode === 'multi' ? '完成多选' : '移动所选'}
        </button>
      )}
      <button className="mobile-icon" aria-label="清空选择" onClick={onClear}>
        <X size={18} />
      </button>
    </div>
  );
}
