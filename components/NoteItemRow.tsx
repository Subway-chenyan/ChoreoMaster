import React from 'react';
import { X } from 'lucide-react';
import { NoteItem } from '../types';

interface NoteItemRowProps {
  item: NoteItem;
  onUpdate: (updates: Partial<NoteItem>) => void;
  onDelete: () => void;
}

const TYPE_OPTIONS: { value: NoteItem['type']; label: string; color: string }[] = [
  { value: 'carry', label: '携带', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { value: 'handoff', label: '交接', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { value: 'event', label: '事件', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
];

export const NoteItemRow: React.FC<NoteItemRowProps> = ({ item, onUpdate, onDelete }) => {
  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-slate-800/50 border border-slate-700/50 group min-w-0">
      <div className="flex-1 min-w-0 space-y-1.5 overflow-hidden">
        <input
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="物品/事件名称"
          className="w-full text-xs bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none min-w-0"
        />
        <div className="flex gap-1 flex-wrap">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onUpdate({ type: opt.value })}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                item.type === opt.value ? opt.color : 'border-slate-700 text-slate-500 hover:text-slate-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={item.description || ''}
          onChange={(e) => onUpdate({ description: e.target.value || undefined })}
          placeholder="补充说明（可选）"
          className="w-full text-[11px] bg-transparent border-none text-slate-400 placeholder:text-slate-600 focus:outline-none truncate min-w-0"
        />
      </div>
      <button
        onClick={onDelete}
        className="p-1 text-slate-600 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
        title="删除此项"
      >
        <X size={12} />
      </button>
    </div>
  );
};
