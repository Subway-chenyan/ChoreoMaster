// ---------------------------------------------------------------------------
// PropEditorModal.tsx -- Main modal that integrates ShapeEditor2D,
// BoxTextureEditor, ExtrudedTextureEditor, and PropPreview3D.
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Box as BoxIcon, Pentagon } from 'lucide-react';
import { Performer, PropGeometryType, BoxTextures, FaceTexture, ExtrudedTextures } from '../types';
import { Point } from './prop-editor/PolygonUtils';
import { ShapeEditor2D } from './prop-editor/ShapeEditor2D';
import { BoxTextureEditor } from './prop-editor/BoxTextureEditor';
import { ExtrudedTextureEditor } from './prop-editor/ExtrudedTextureEditor';
import PropPreview3D from './prop-editor/PropPreview3D';

// ── Public types ───────────────────────────────────────────────────────────

interface PropEditorModalProps {
  isOpen: boolean;
  performer?: Performer | null;
  onSave: (updates: Partial<Performer>) => void;
  onClose: () => void;
  mode?: 'create' | 'edit';
}

// ── Component ──────────────────────────────────────────────────────────────

export const PropEditorModal: React.FC<PropEditorModalProps> = ({
  isOpen,
  performer,
  onSave,
  onClose,
  mode = 'edit',
}) => {
  // ── Common state ──────────────────────────────────────────────────────────

  const [name, setName] = useState('');
  const [color, setColor] = useState('#475569');
  const [rotation, setRotation] = useState(0);
  const [geometryType, setGeometryType] = useState<PropGeometryType>('box');

  // ── Box state ─────────────────────────────────────────────────────────────

  const [boxWidth, setBoxWidth] = useState(1);
  const [boxDepth, setBoxDepth] = useState(1);
  const [boxHeight, setBoxHeight] = useState(1);
  const [boxTextures, setBoxTextures] = useState<BoxTextures>({});

  // ── Extruded state ───────────────────────────────────────────────────────

  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [extWidth, setExtWidth] = useState(2);
  const [extDepth, setExtDepth] = useState(2);
  const [extHeight, setExtHeight] = useState(1);
  const [sideTexture, setSideTexture] = useState<FaceTexture>();
  const [topTexture, setTopTexture] = useState<FaceTexture>();
  const [bottomTexture, setBottomTexture] = useState<FaceTexture>();

  // ── Populate from performer when modal opens ──────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    if (performer) {
      // Editing existing prop
      setName(performer.name || '');
      setColor(performer.color || '#475569');
      setRotation(performer.rotation || 0);
      setGeometryType(performer.propGeometryType || 'box');

      if (performer.propGeometryType === 'extruded') {
        setBoxWidth(1);
        setBoxDepth(1);
        setBoxHeight(1);
        setBoxTextures({});
        setExtWidth(performer.width ?? 2);
        setExtDepth(performer.depth ?? 2);
        setExtHeight(performer.extrudeHeight ?? performer.height ?? 1);
        setPolygonPoints(performer.polygonPoints || []);
        const extTextures = performer.extrudedTextures;
        setSideTexture(extTextures?.side);
        setTopTexture(extTextures?.top);
        setBottomTexture(extTextures?.bottom);
      } else {
        setBoxWidth(performer.width ?? 1);
        setBoxDepth(performer.depth ?? 1);
        setBoxHeight(performer.height ?? 1);
        setBoxTextures(performer.boxTextures || {});
        setPolygonPoints([]);
        setExtWidth(2);
        setExtDepth(2);
        setExtHeight(1);
      }
    } else {
      // Creating new prop -- reset to defaults
      setName('');
      setColor('#475569');
      setRotation(0);
      setGeometryType('box');
      setBoxWidth(1);
      setBoxDepth(1);
      setBoxHeight(1);
      setBoxTextures({});
      setPolygonPoints([]);
      setExtWidth(2);
      setExtDepth(2);
      setExtHeight(1);
      setSideTexture(undefined);
      setTopTexture(undefined);
      setBottomTexture(undefined);
    }
  }, [isOpen, performer]);

  // ── Derived values for preview ────────────────────────────────────────────

  const currentWidth = geometryType === 'box' ? boxWidth : extWidth;
  const currentDepth = geometryType === 'box' ? boxDepth : extDepth;
  const currentHeight = geometryType === 'box' ? boxHeight : extHeight;

  // ── Handle shape size changes from ShapeEditor2D ──────────────────────────

  const handleShapeSizeChange = useCallback((width: number, depth: number) => {
    setExtWidth(width);
    setExtDepth(depth);
  }, []);

  // ── Save handler ──────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    const updates: Partial<Performer> = {
      name,
      color,
      rotation,
      propGeometryType: geometryType,
    };

    if (geometryType === 'box') {
      updates.width = boxWidth;
      updates.depth = boxDepth;
      updates.height = boxHeight;
      updates.boxTextures = Object.keys(boxTextures).length > 0 ? boxTextures : undefined;
      updates.polygonPoints = undefined;
      updates.extrudeHeight = undefined;
      updates.extrudedTextures = undefined;
    } else {
      updates.width = extWidth;
      updates.depth = extDepth;
      updates.height = extHeight;
      updates.extrudeHeight = extHeight;
      updates.polygonPoints = polygonPoints.length > 0 ? polygonPoints : undefined;
      updates.boxTextures = undefined;
      updates.extrudedTextures = (sideTexture || topTexture || bottomTexture)
        ? { side: sideTexture, top: topTexture, bottom: bottomTexture }
        : undefined;
    }

    onSave(updates);
  }, [
    name, color, rotation, geometryType,
    boxWidth, boxDepth, boxHeight, boxTextures,
    extWidth, extDepth, extHeight, polygonPoints,
    sideTexture, topTexture, bottomTexture,
    onSave,
  ]);

  // ── Geometry type tab styling ────────────────────────────────────────────

  const geoTabClass = (type: PropGeometryType) =>
    `flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
      geometryType === type
        ? 'border-blue-400 text-blue-400'
        : 'border-transparent text-slate-400 hover:text-slate-300'
    }`;

  // ── Render ───────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 900, height: 620 }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-800/50">
          <h2 className="text-base font-semibold text-white">
            {mode === 'create' ? '创建' : '编辑'}道具: {name || '未命名'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* Left panel */}
          <div className="w-80 flex-shrink-0 flex flex-col border-r border-slate-700 overflow-hidden">
            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto">

              {/* Name input */}
              <div className="px-4 py-3 border-b border-slate-700">
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  名称
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入道具名称..."
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-md text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Geometry type tabs */}
              <div className="flex border-b border-slate-700">
                <button
                  className={geoTabClass('box')}
                  onClick={() => setGeometryType('box')}
                >
                  <BoxIcon size={16} />
                  <span>立方体</span>
                </button>
                <button
                  className={geoTabClass('extruded')}
                  onClick={() => setGeometryType('extruded')}
                >
                  <Pentagon size={16} />
                  <span>异形</span>
                </button>
              </div>

              {/* Properties */}
              <div className="px-4 py-3 border-b border-slate-700">
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  属性
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">
                      长 (m)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={
                        geometryType === 'box' ? boxWidth : extWidth
                      }
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0) {
                          geometryType === 'box'
                            ? setBoxWidth(v)
                            : setExtWidth(v);
                        }
                      }}
                      className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">
                      宽 (m)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={
                        geometryType === 'box' ? boxDepth : extDepth
                      }
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0) {
                          geometryType === 'box'
                            ? setBoxDepth(v)
                            : setExtDepth(v);
                        }
                      }}
                      className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">
                      高 (m)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={
                        geometryType === 'box' ? boxHeight : extHeight
                      }
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0) {
                          geometryType === 'box'
                            ? setBoxHeight(v)
                            : setExtHeight(v);
                        }
                      }}
                      className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Rotation */}
                <div className="mb-2">
                  <label className="block text-[10px] text-slate-500 mb-0.5">
                    旋转角度
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={360}
                    step={1}
                    value={rotation}
                    onChange={(e) => setRotation(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Color picker */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500">颜色</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-8 h-6 rounded border border-slate-600 bg-transparent cursor-pointer"
                  />
                  <span className="text-xs text-slate-400 font-mono">{color}</span>
                </div>
              </div>

              {/* ShapeEditor2D -- only in extruded mode */}
              {geometryType === 'extruded' && (
                <div className="border-b border-slate-700" style={{ height: 220 }}>
                  <ShapeEditor2D
                    points={polygonPoints}
                    onChange={setPolygonPoints}
                    propWidth={extWidth}
                    propDepth={extDepth}
                    onSizeChange={handleShapeSizeChange}
                  />
                </div>
              )}

              {/* Texture editor */}
              <div className="px-4 py-3">
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  贴图
                </label>
                {geometryType === 'box' ? (
                  <BoxTextureEditor
                    textures={boxTextures}
                    onChange={setBoxTextures}
                  />
                ) : (
                  <ExtrudedTextureEditor
                    sideTexture={sideTexture}
                    topTexture={topTexture}
                    bottomTexture={bottomTexture}
                    onSideChange={setSideTexture}
                    onTopChange={setTopTexture}
                    onBottomChange={setBottomTexture}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right panel -- PropPreview3D */}
          <div className="flex-1 min-w-0">
            <PropPreview3D
              performer={{
                name,
                color,
                rotation,
                width: currentWidth,
                height: currentHeight,
                depth: currentDepth,
                extrudeHeight: extHeight,
              }}
              propGeometryType={geometryType}
              boxTextures={boxTextures}
              sideTexture={sideTexture}
              topTexture={topTexture}
              bottomTexture={bottomTexture}
              polygonPoints={polygonPoints}
            />
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-700 bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PropEditorModal;
