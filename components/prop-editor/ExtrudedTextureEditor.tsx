// ---------------------------------------------------------------------------
// ExtrudedTextureEditor.tsx -- Texture editor for extruded (custom shape)
// props with 3 slots: side face, top face, and bottom face.
// ---------------------------------------------------------------------------

import React, { useRef, useCallback } from 'react';
import { Upload, X } from 'lucide-react';
import { FaceTexture } from '../../types';

// ── Public types ───────────────────────────────────────────────────────────

interface ExtrudedTextureEditorProps {
  topTexture?: FaceTexture;
  bottomTexture?: FaceTexture;
  sideTexture?: FaceTexture;
  onTopChange: (texture?: FaceTexture) => void;
  onBottomChange: (texture?: FaceTexture) => void;
  onSideChange: (texture?: FaceTexture) => void;
}

// ── Internal TextureSlot ───────────────────────────────────────────────────

interface TextureSlotProps {
  label: string;
  isDefault?: boolean;
  texture?: FaceTexture;
  onSelect: () => void;
  onClear: () => void;
}

const TextureSlot: React.FC<TextureSlotProps> = ({
  label,
  isDefault,
  texture,
  onSelect,
  onClear,
}) => (
  <div
    className={`rounded-lg border p-2 ${
      isDefault
        ? 'border-green-500/50 bg-green-500/5'
        : 'border-slate-700 bg-slate-800/50'
    }`}
  >
    {/* Label row */}
    <div className="flex items-center gap-1 mb-1.5">
      <span
        className={`text-xs font-medium ${
          isDefault ? 'text-green-400' : 'text-slate-300'
        }`}
      >
        {label}
      </span>
      {isDefault && (
        <span className="px-1 py-0.5 text-[10px] font-medium rounded bg-green-500/20 text-green-400">
          默认
        </span>
      )}
    </div>

    {/* Texture slot */}
    {texture ? (
      <div className="relative group">
        <div
          className="w-full h-20 rounded bg-slate-900 bg-cover bg-center cursor-pointer border border-slate-600"
          style={{ backgroundImage: `url(${texture.dataUrl})` }}
          onClick={onSelect}
          title={texture.fileName || label}
        />
        {/* Clear button */}
        <button
          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title="移除贴图"
        >
          <X size={12} />
        </button>
      </div>
    ) : (
      <button
        className="w-full h-20 rounded border border-dashed border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-400 hover:border-slate-500 transition-colors"
        onClick={onSelect}
      >
        <Upload size={14} />
        <span className="text-[10px]">选择贴图</span>
      </button>
    )}
  </div>
);

// ── Slot definitions ──────────────────────────────────────────────────────

type SlotKey = 'side' | 'top' | 'bottom';

const SLOTS: { key: SlotKey; label: string; isDefault?: boolean }[] = [
  { key: 'side', label: '拉伸面 (侧面)', isDefault: true },
  { key: 'top', label: '顶面' },
  { key: 'bottom', label: '底面' },
];

// ── Component ──────────────────────────────────────────────────────────────

export const ExtrudedTextureEditor: React.FC<ExtrudedTextureEditorProps> = ({
  sideTexture,
  topTexture,
  bottomTexture,
  onSideChange,
  onTopChange,
  onBottomChange,
}) => {
  const fileInputRefs = useRef<Record<SlotKey, HTMLInputElement | null>>({
    side: null,
    top: null,
    bottom: null,
  });

  const textureMap: Record<SlotKey, FaceTexture | undefined> = {
    side: sideTexture,
    top: topTexture,
    bottom: bottomTexture,
  };

  const handleChange: Record<SlotKey, (texture?: FaceTexture) => void> = {
    side: onSideChange,
    top: onTopChange,
    bottom: onBottomChange,
  };

  const handleFileSelect = useCallback(
    (slotKey: SlotKey, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset file input so the same file can be re-selected
      e.target.value = '';

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const faceTexture: FaceTexture = { dataUrl, fileName: file.name };
        handleChange[slotKey](faceTexture);
      };
      reader.readAsDataURL(file);
    },
    [handleChange],
  );

  const handleTriggerFile = useCallback((slotKey: SlotKey) => {
    fileInputRefs.current[slotKey]?.click();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {SLOTS.map((slot) => (
        <div key={slot.key}>
          {/* Hidden file input */}
          <input
            ref={(el) => { fileInputRefs.current[slot.key] = el; }}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileSelect(slot.key, e)}
          />

          <TextureSlot
            label={slot.label}
            isDefault={slot.isDefault}
            texture={textureMap[slot.key]}
            onSelect={() => handleTriggerFile(slot.key)}
            onClear={() => handleChange[slot.key](undefined)}
          />
        </div>
      ))}
    </div>
  );
};

export default ExtrudedTextureEditor;
