import React, { useState, useMemo } from 'react';
import { X, Plus, StickyNote, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Performer, PerformerNote, NoteItem, Frame } from '../types';
import { NoteItemRow } from './NoteItemRow';

interface PerformerNoteDrawerProps {
  open: boolean;
  performer: Performer | null;
  notes: PerformerNote[];
  currentFrameId: string;
  frames: Frame[];
  onClose: () => void;
  onAddNote: (performerId: string, frameId?: string) => string;
  onUpdateNote: (noteId: string, updates: Partial<PerformerNote>) => void;
  onDeleteNote: (noteId: string) => void;
  onAddNoteItem: (noteId: string, item: Omit<NoteItem, 'id'>) => void;
  onUpdateNoteItem: (noteId: string, itemId: string, updates: Partial<NoteItem>) => void;
  onDeleteNoteItem: (noteId: string, itemId: string) => void;
}

export const PerformerNoteDrawer: React.FC<PerformerNoteDrawerProps> = ({
  open,
  performer,
  notes,
  currentFrameId,
  frames,
  onClose,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onAddNoteItem,
  onUpdateNoteItem,
  onDeleteNoteItem,
}) => {
  const [activeTab, setActiveTab] = useState<'global' | 'frame'>('global');

  const globalNotes = useMemo(
    () => notes.filter(n => !n.frameId),
    [notes]
  );

  // All frame-level notes grouped by frame, ordered by frame startTime
  const frameGroups = useMemo(() => {
    const frameNoteMap = new Map<string, PerformerNote[]>();
    for (const n of notes) {
      if (n.frameId) {
        const arr = frameNoteMap.get(n.frameId) || [];
        arr.push(n);
        frameNoteMap.set(n.frameId, arr);
      }
    }
    // Sort frames by startTime, current frame first
    const sortedFrames = [...frames].sort((a, b) => {
      if (a.id === currentFrameId) return -1;
      if (b.id === currentFrameId) return 1;
      return a.startTime - b.startTime;
    });
    return sortedFrames
      .filter(f => frameNoteMap.has(f.id))
      .map(f => ({
        frame: f,
        notes: frameNoteMap.get(f.id)!,
        isCurrent: f.id === currentFrameId,
      }));
  }, [notes, frames, currentFrameId]);

  const totalFrameNotes = useMemo(
    () => notes.filter(n => n.frameId).length,
    [notes]
  );

  if (!open || !performer) return null;

  const handleAddNote = () => {
    onAddNote(performer.id, activeTab === 'frame' ? currentFrameId : undefined);
  };

  const handleAddItem = (noteId: string) => {
    onAddNoteItem(noteId, { name: '', type: 'carry' });
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative ml-auto w-[360px] max-w-[calc(100vw-40px)] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: performer.color }} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-200 truncate">{performer.name}</h3>
            <p className="text-[10px] text-slate-500">演员笔记</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 shrink-0">
          <button
            onClick={() => setActiveTab('global')}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === 'global'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            全局笔记
            {globalNotes.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                {globalNotes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('frame')}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === 'frame'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            帧级笔记
            {totalFrameNotes > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                {totalFrameNotes}
              </span>
            )}
          </button>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'global' ? (
            // --- Global notes ---
            globalNotes.length === 0 ? (
              <EmptyState message="暂无全局笔记" hint="点击下方按钮添加第一条笔记" />
            ) : (
              globalNotes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onUpdate={(updates) => onUpdateNote(note.id, updates)}
                  onDelete={() => onDeleteNote(note.id)}
                  onAddItem={() => handleAddItem(note.id)}
                  onUpdateItem={(itemId, updates) => onUpdateNoteItem(note.id, itemId, updates)}
                  onDeleteItem={(itemId) => onDeleteNoteItem(note.id, itemId)}
                />
              ))
            )
          ) : (
            // --- Frame notes grouped by frame ---
            frameGroups.length === 0 ? (
              <EmptyState message="暂无帧级笔记" hint="点击下方按钮为当前帧添加笔记" />
            ) : (
              frameGroups.map(group => (
                <FrameGroup
                  key={group.frame.id}
                  frame={group.frame}
                  notes={group.notes}
                  isCurrent={group.isCurrent}
                  defaultExpanded={group.isCurrent}
                  onUpdateNote={onUpdateNote}
                  onDeleteNote={onDeleteNote}
                  onAddItem={handleAddItem}
                  onUpdateNoteItem={onUpdateNoteItem}
                  onDeleteNoteItem={onDeleteNoteItem}
                />
              ))
            )
          )}
        </div>

        {/* Add button */}
        <div className="p-4 border-t border-slate-700 shrink-0">
          <button
            onClick={handleAddNote}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <Plus size={14} /> {activeTab === 'frame' ? '为当前帧添加笔记' : '添加笔记'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- EmptyState sub-component ---

const EmptyState: React.FC<{ message: string; hint: string }> = ({ message, hint }) => (
  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
    <StickyNote size={32} className="mb-3 opacity-50" />
    <p className="text-sm">{message}</p>
    <p className="text-xs mt-1">{hint}</p>
  </div>
);

// --- FrameGroup sub-component ---

interface FrameGroupProps {
  frame: Frame;
  notes: PerformerNote[];
  isCurrent: boolean;
  defaultExpanded: boolean;
  onUpdateNote: (noteId: string, updates: Partial<PerformerNote>) => void;
  onDeleteNote: (noteId: string) => void;
  onAddItem: (noteId: string) => void;
  onUpdateNoteItem: (noteId: string, itemId: string, updates: Partial<NoteItem>) => void;
  onDeleteNoteItem: (noteId: string, itemId: string) => void;
}

const FrameGroup: React.FC<FrameGroupProps> = ({
  frame,
  notes,
  isCurrent,
  defaultExpanded,
  onUpdateNote,
  onDeleteNote,
  onAddItem,
  onUpdateNoteItem,
  onDeleteNoteItem,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`rounded-lg border overflow-hidden transition-colors ${
      isCurrent
        ? 'border-blue-500/50 bg-blue-500/5'
        : 'border-slate-700 bg-slate-800/20'
    }`}>
      {/* Frame header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/40 transition-colors"
      >
        {expanded ? <ChevronDown size={12} className="text-slate-500 shrink-0" /> : <ChevronRight size={12} className="text-slate-500 shrink-0" />}
        <span className={`text-xs font-medium truncate ${isCurrent ? 'text-blue-400' : 'text-slate-400'}`}>
          {frame.name}
        </span>
        {isCurrent && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
            当前帧
          </span>
        )}
        <span className="text-[10px] text-slate-600 ml-auto shrink-0">
          {notes.length} 条
        </span>
      </button>

      {/* Notes (collapsed/expanded) */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={(updates) => onUpdateNote(note.id, updates)}
              onDelete={() => onDeleteNote(note.id)}
              onAddItem={() => onAddItem(note.id)}
              onUpdateItem={(itemId, updates) => onUpdateNoteItem(note.id, itemId, updates)}
              onDeleteItem={(itemId) => onDeleteNoteItem(note.id, itemId)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- NoteCard sub-component ---

interface NoteCardProps {
  note: PerformerNote;
  onUpdate: (updates: Partial<PerformerNote>) => void;
  onDelete: () => void;
  onAddItem: () => void;
  onUpdateItem: (itemId: string, updates: Partial<NoteItem>) => void;
  onDeleteItem: (itemId: string) => void;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onUpdate, onDelete, onAddItem, onUpdateItem, onDeleteItem }) => {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/30 overflow-hidden min-w-0">
      {/* Header with delete */}
      <div className="flex items-start gap-2 px-3 pt-3 min-w-0">
        <textarea
          value={note.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder="输入笔记内容..."
          rows={2}
          className="flex-1 text-xs bg-transparent text-slate-300 placeholder:text-slate-600 resize-none focus:outline-none min-h-[40px] max-h-[120px] overflow-y-auto min-w-0"
        />
        <button
          onClick={onDelete}
          className="p-1 text-slate-600 hover:text-red-400 rounded shrink-0"
          title="删除笔记"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Items list */}
      {note.items.length > 0 && (
        <div className="px-3 pb-2 space-y-1.5 min-w-0">
          {note.items.map(item => (
            <NoteItemRow
              key={item.id}
              item={item}
              onUpdate={(updates) => onUpdateItem(item.id, updates)}
              onDelete={() => onDeleteItem(item.id)}
            />
          ))}
        </div>
      )}

      {/* Add item button */}
      <div className="px-3 pb-3">
        <button
          onClick={onAddItem}
          className="text-[10px] text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          <Plus size={10} /> 添加道具/事件
        </button>
      </div>
    </div>
  );
};
