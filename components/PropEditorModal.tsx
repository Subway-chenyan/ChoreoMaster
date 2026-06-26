// ---------------------------------------------------------------------------
// PropEditorModal.tsx -- Main modal that integrates ShapeEditor2D,
// BoxTextureEditor, ExtrudedTextureEditor, and PropPreview3D.
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Box as BoxIcon, Pentagon } from 'lucide-react';
import { Performer, PropGeometryType, PropCategory, PropRotationPivot, BoxTextures, FaceTexture, ExtrudedTextures } from '../types';
import { Point } from './prop-editor/PolygonUtils';
import { ShapeEditor2D } from './prop-editor/ShapeEditor2D';
import { BoxTextureEditor } from './prop-editor/BoxTextureEditor';
import { ExtrudedTextureEditor } from './prop-editor/ExtrudedTextureEditor';
import PropPreview3D from './prop-editor/PropPreview3D';
import { SelectField, StepperNumberField } from './FormControls';

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
  const [propCategory, setPropCategory] = useState<PropCategory>('prop');
  const [rotationPivot, setRotationPivot] = useState<PropRotationPivot>('center');

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
      setPropCategory(performer.propCategory || 'prop');
      setRotationPivot(performer.propCategory === 'platform' ? 'center' : performer.rotationPivot || 'center');

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
      setPropCategory('prop');
      setRotationPivot('center');
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
  const useSingleColumnFields = true;

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
      propCategory,
      rotationPivot: propCategory === 'platform' ? 'center' : rotationPivot,
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
    name, color, rotation, geometryType, propCategory, rotationPivot,
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
        className="flex h-[min(860px,calc(100dvh-24px))] w-[min(1180px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
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
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Left panel */}
          <div className="flex min-h-0 w-full flex-shrink-0 flex-col overflow-hidden border-b border-slate-700 lg:w-[380px] lg:border-b-0 lg:border-r xl:w-[420px]">
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
                <div className="mb-3">
                  <SelectField<PropCategory>
                    label="类型"
                    value={propCategory}
                    onChange={setPropCategory}
                    options={[
                      { value: 'prop', label: '道具' },
                      { value: 'platform', label: '高台' },
                    ]}
                    helperText={
                      propCategory === 'platform'
                        ? `演员站上高台时，将按当前道具高度 ${currentHeight.toFixed(1)}m 自动抬升`
                        : '普通道具不抬升演员高度'
                    }
                    helperTone={propCategory === 'platform' ? 'accent' : 'default'}
                  />
                </div>
                {propCategory === 'prop' && (
                  <div className="mb-3">
                    <SelectField<PropRotationPivot>
                      label="旋转轴"
                      value={rotationPivot}
                      onChange={setRotationPivot}
                      options={[
                        { value: 'center', label: '中心' },
                        { value: 'left', label: '左侧铰链' },
                        { value: 'right', label: '右侧铰链' },
                      ]}
                      helperText="左右轴以道具自身方向为准；切换后所有队形和路径会自动换算"
                    />
                  </div>
                )}
                <div className={`mb-2 grid gap-2 ${useSingleColumnFields ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <StepperNumberField
                    label="长度"
                    value={geometryType === 'box' ? boxWidth : extWidth}
                    min={0.1}
                    step={0.1}
                    onChange={(value) => {
                      geometryType === 'box' ? setBoxWidth(value) : setExtWidth(value);
                    }}
                  />
                  <StepperNumberField
                    label="宽度"
                    value={geometryType === 'box' ? boxDepth : extDepth}
                    min={0.1}
                    step={0.1}
                    onChange={(value) => {
                      geometryType === 'box' ? setBoxDepth(value) : setExtDepth(value);
                    }}
                  />
                  <StepperNumberField
                    label="高度"
                    value={geometryType === 'box' ? boxHeight : extHeight}
                    min={0.1}
                    step={0.1}
                    onChange={(value) => {
                      geometryType === 'box' ? setBoxHeight(value) : setExtHeight(value);
                    }}
                  />
                </div>

                {/* Rotation */}
                <div className="mb-2">
                  <StepperNumberField
                    label="旋转角度"
                    value={rotation}
                    min={0}
                    max={360}
                    step={1}
                    unit="deg"
                    onChange={setRotation}
                  />
                </div>

                {/* Color picker */}
                <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 shadow-sm shadow-slate-950/20">
                  <label className="mb-2 block text-[11px] font-medium tracking-wide text-slate-400">颜色</label>
                  <div className="flex items-center justify-center rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-3">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-14 w-20 cursor-pointer rounded-lg border border-slate-500 bg-transparent p-1"
                    />
                  </div>
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
          <div className="min-h-[260px] flex-1 min-w-0">
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
