// ---------------------------------------------------------------------------
// BoxTextureEditor.tsx -- 2x3 grid of face texture cards for box props.
// Allows per-face texture assignment with file upload and clear support.
// ---------------------------------------------------------------------------

import React, { useRef, useCallback } from 'react';
import { Upload, X } from 'lucide-react';
import { BoxTextures, FaceTexture } from '../../types';

// ── Public types ───────────────────────────────────────────────────────────

interface BoxTextureEditorProps {
  textures: BoxTextures;
  onChange: (textures: BoxTextures) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FACES: { key: keyof BoxTextures; label: string; isDefault?: boolean }[] = [
  { key: 'front', label: '正面 (+Z)', isDefault: true },
  { key: 'back', label: '背面 (-Z)' },
  { key: 'left', label: '左面 (-X)' },
  { key: 'right', label: '右面 (+X)' },
  { key: 'top', label: '顶面 (+Y)' },
  { key: 'bottom', label: '底面 (-Y)' },
];

// ── Component ──────────────────────────────────────────────────────────────

export const BoxTextureEditor: React.FC<BoxTextureEditorProps> = ({
  textures,
  onChange,
}) => {
  const fileInputRefs = useRef<Record<keyof BoxTextures, HTMLInputElement | null>>({
    front: null,
    back: null,
    left: null,
    right: null,
    top: null,
    bottom: null,
  });

  const handleFileSelect = useCallback(
    (faceKey: keyof BoxTextures, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset file input so the same file can be re-selected
      e.target.value = '';

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const faceTexture: FaceTexture = { dataUrl, fileName: file.name };
        onChange({ ...textures, [faceKey]: faceTexture });
      };
      reader.readAsDataURL(file);
    },
    [textures, onChange],
  );

  const handleClear = useCallback(
    (faceKey: keyof BoxTextures) => {
      const updated = { ...textures };
      delete updated[faceKey];
      onChange(updated);
    },
    [textures, onChange],
  );

  const handleTriggerFile = useCallback(
    (faceKey: keyof BoxTextures) => {
      fileInputRefs.current[faceKey]?.click();
    },
    [],
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      {FACES.map((face) => {
        const texture = textures[face.key];
        const isDefault = face.isDefault;

        return (
          <div
            key={face.key}
            className={`rounded-lg border p-2 ${
              isDefault
                ? 'border-green-500/50 bg-green-500/5'
                : 'border-slate-700 bg-slate-800/50'
            }`}
          >
            {/* Face label row */}
            <div className="flex items-center gap-1 mb-1.5">
              <span
                className={`text-xs font-medium ${
                  isDefault ? 'text-green-400' : 'text-slate-300'
                }`}
              >
                {face.label}
              </span>
              {isDefault && (
                <span className="px-1 py-0.5 text-[10px] font-medium rounded bg-green-500/20 text-green-400">
                  默认
                </span>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={(el) => { fileInputRefs.current[face.key] = el; }}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileSelect(face.key, e)}
            />

            {/* Texture slot */}
            {texture ? (
              <div className="relative group">
                <div
                  className="w-full h-16 rounded bg-slate-900 bg-cover bg-center cursor-pointer border border-slate-600"
                  style={{ backgroundImage: `url(${texture.dataUrl})` }}
                  onClick={() => handleTriggerFile(face.key)}
                  title={texture.fileName || face.label}
                />
                {/* Clear button */}
                <button
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear(face.key);
                  }}
                  title="移除贴图"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                className="w-full h-16 rounded border border-dashed border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-400 hover:border-slate-500 transition-colors"
                onClick={() => handleTriggerFile(face.key)}
              >
                <Upload size={14} />
                <span className="text-[10px]">选择贴图</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BoxTextureEditor;
