// ---------------------------------------------------------------------------
// ShapeEditor2D.tsx -- Canvas-based polygon editor with draw / select / delete
// modes, PNG import, and grid rendering.
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Point,
  isSimplePolygon,
  closestPointOnSegment,
  normalizePoints,
  denormalizePoints,
} from './PolygonUtils';
import { extractOutlineFromPng } from './PngOutlineExtractor';
import { Pencil, MousePointer2, Trash2, Image, Eraser } from 'lucide-react';

// ── Public types ───────────────────────────────────────────────────────────

export type EditorMode = 'draw' | 'select' | 'delete';

interface ShapeEditor2DProps {
  points: Point[];
  onChange: (points: Point[]) => void;
  propWidth: number;
  propDepth: number;
  onSizeChange?: (width: number, depth: number) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const GRID_SIZE = 0.5;   // meters per grid line
const SNAP_SIZE = 0.1;   // snap to 0.1 m grid
const PADDING = 30;       // canvas padding in CSS pixels
const VERTEX_RADIUS = 5;
const VERTEX_RADIUS_HOVER = 7;
const EDGE_INSERT_RADIUS = 4;
const CLOSE_THRESHOLD = 12; // px distance to first vertex to close polygon

// ── Helpers ────────────────────────────────────────────────────────────────

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Component ──────────────────────────────────────────────────────────────

export const ShapeEditor2D: React.FC<ShapeEditor2DProps> = ({
  points,
  onChange,
  propWidth,
  propDepth,
  onSizeChange,
}) => {
  const [mode, setMode] = useState<EditorMode>('select');
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null);
  const [hoveredEdgeMid, setHoveredEdgeMid] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [containerSize, setContainerSize] = useState({ width: 400, height: 300 });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived geometry helpers (pure) ─────────────────────────────────────

  const getScale = useCallback(() => {
    const availW = containerSize.width - PADDING * 2;
    const availH = containerSize.height - PADDING * 2;
    if (availW <= 0 || availH <= 0) return 1;
    return Math.min(availW / propWidth, availH / propDepth);
  }, [containerSize.width, containerSize.height, propWidth, propDepth]);

  const metersToCanvas = useCallback(
    (p: Point): Point => {
      const scale = getScale();
      return {
        x: containerSize.width / 2 + p.x * scale,
        y: containerSize.height / 2 - p.y * scale, // flip y
      };
    },
    [getScale, containerSize.width, containerSize.height],
  );

  const canvasToMeters = useCallback(
    (cx: number, cy: number): Point => {
      const scale = getScale();
      return {
        x: snap((cx - containerSize.width / 2) / scale, SNAP_SIZE),
        y: snap(-(cy - containerSize.height / 2) / scale, SNAP_SIZE),
      };
    },
    [getScale, containerSize.width, containerSize.height],
  );

  // ── ResizeObserver ──────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Denormalize current points to meter coords ──────────────────────────

  const meterPoints = useCallback((): Point[] => {
    return denormalizePoints(points, propWidth, propDepth);
  }, [points, propWidth, propDepth]);

  // ── Canvas rendering ────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = containerSize;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    const scale = getScale();
    const centerX = width / 2;
    const centerY = height / 2;

    // ── Grid ──
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;

    // Vertical grid lines
    const halfW = (width / 2) / scale;
    const startMX = -Math.ceil(halfW / GRID_SIZE) * GRID_SIZE;
    for (let mx = startMX; mx <= halfW + GRID_SIZE; mx += GRID_SIZE) {
      const cx = centerX + mx * scale;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, height);
      ctx.stroke();
    }

    // Horizontal grid lines
    const halfH = (height / 2) / scale;
    const startMY = -Math.ceil(halfH / GRID_SIZE) * GRID_SIZE;
    for (let my = startMY; my <= halfH + GRID_SIZE; my += GRID_SIZE) {
      const cy = centerY - my * scale;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(width, cy);
      ctx.stroke();
    }

    // Center crosshair
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // ── Draw existing polygon (when not in drawing mode) ──
    const mp = meterPoints();

    if (mode !== 'draw' && mp.length >= 3) {
      const cp = mp.map(metersToCanvas);

      // Fill
      ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let i = 1; i < cp.length; i++) {
        ctx.lineTo(cp[i].x, cp[i].y);
      }
      ctx.closePath();
      ctx.fill();

      // Outline
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let i = 1; i < cp.length; i++) {
        ctx.lineTo(cp[i].x, cp[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Edge midpoints (select mode)
      if (mode === 'select' && selectedVertex === null) {
        for (let i = 0; i < cp.length; i++) {
          const j = (i + 1) % cp.length;
          const mid: Point = {
            x: (cp[i].x + cp[j].x) / 2,
            y: (cp[i].y + cp[j].y) / 2,
          };
          const isHovered = hoveredEdgeMid === i;
          ctx.fillStyle = isHovered ? '#22c55e' : 'rgba(34, 197, 94, 0.4)';
          ctx.beginPath();
          ctx.arc(mid.x, mid.y, isHovered ? EDGE_INSERT_RADIUS + 1 : EDGE_INSERT_RADIUS, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Vertices
      for (let i = 0; i < cp.length; i++) {
        const isSelected = selectedVertex === i;
        const isHovered = hoveredVertex === i;
        const r = isSelected || isHovered ? VERTEX_RADIUS_HOVER : VERTEX_RADIUS;

        ctx.fillStyle = isSelected ? '#f59e0b' : isHovered ? '#fbbf24' : '#3b82f6';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cp[i].x, cp[i].y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // ── Drawing mode: render in-progress points ──
    if (mode === 'draw' && drawingPoints.length > 0) {
      const cp = drawingPoints.map(metersToCanvas);

      // Lines
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let i = 1; i < cp.length; i++) {
        ctx.lineTo(cp[i].x, cp[i].y);
      }
      ctx.stroke();

      // Vertices
      for (let i = 0; i < cp.length; i++) {
        ctx.fillStyle = '#3b82f6';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cp[i].x, cp[i].y, VERTEX_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Green dashed circle on first vertex when 3+ points
      if (drawingPoints.length >= 3) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cp[0].x, cp[0].y, VERTEX_RADIUS + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [
    mode,
    drawingPoints,
    meterPoints,
    metersToCanvas,
    containerSize,
    getScale,
    selectedVertex,
    hoveredVertex,
    hoveredEdgeMid,
  ]);

  // Redraw on every relevant change
  useEffect(() => {
    draw();
  }, [draw]);

  // ── Find nearest vertex index to a canvas position ──────────────────────

  const findNearestVertex = useCallback(
    (cx: number, cy: number, threshold = 12): number | null => {
      const mp = meterPoints();
      if (mp.length === 0) return null;

      let best = null;
      let bestDist = threshold;

      for (let i = 0; i < mp.length; i++) {
        const cp = metersToCanvas(mp[i]);
        const d = dist({ x: cx, y: cy }, cp);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }

      return best;
    },
    [meterPoints, metersToCanvas],
  );

  // ── Find nearest edge midpoint to a canvas position ──────────────────────

  const findNearestEdgeMid = useCallback(
    (cx: number, cy: number, threshold = 12): number | null => {
      const mp = meterPoints();
      if (mp.length < 3) return null;

      let best = null;
      let bestDist = threshold;

      for (let i = 0; i < mp.length; i++) {
        const j = (i + 1) % mp.length;
        const midM: Point = {
          x: (mp[i].x + mp[j].x) / 2,
          y: (mp[i].y + mp[j].y) / 2,
        };
        const cp = metersToCanvas(midM);
        const d = dist({ x: cx, y: cy }, cp);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }

      return best;
    },
    [meterPoints, metersToCanvas],
  );

  // ── Mode switching ──────────────────────────────────────────────────────

  const handleModeChange = useCallback(
    (newMode: EditorMode) => {
      setMode(newMode);
      setSelectedVertex(null);
      setHoveredVertex(null);
      setHoveredEdgeMid(null);
      if (newMode === 'draw') {
        setDrawingPoints([]);
        setStatus('点击画布添加顶点');
      } else {
        setDrawingPoints([]);
        setStatus('');
      }
    },
    [],
  );

  // ── Draw mode: close polygon ────────────────────────────────────────────

  const closeDrawing = useCallback(() => {
    if (drawingPoints.length < 3) {
      setStatus('至少需要 3 个顶点才能闭合多边形');
      return;
    }

    if (!isSimplePolygon(drawingPoints)) {
      setStatus('多边形自相交，请调整顶点位置');
      return;
    }

    const normalized = normalizePoints(drawingPoints);
    onChange(normalized);
    setDrawingPoints([]);
    setStatus(`多边形已创建 (${normalized.length} 个顶点)`);
    setMode('select');
  }, [drawingPoints, onChange]);

  // ── Mouse / pointer helpers ─────────────────────────────────────────────

  const getCanvasPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  // ── Canvas event handlers ───────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);

      if (mode === 'draw') {
        const meter = canvasToMeters(pos.x, pos.y);

        // Check if clicking on first vertex to close
        if (drawingPoints.length >= 3) {
          const firstCanvas = metersToCanvas(drawingPoints[0]);
          if (dist(pos, firstCanvas) < CLOSE_THRESHOLD) {
            closeDrawing();
            return;
          }
        }

        // Add point
        setDrawingPoints((prev) => [...prev, meter]);
        setStatus(`已添加顶点 (${drawingPoints.length + 1} 个)`);
      } else if (mode === 'select') {
        const vi = findNearestVertex(pos.x, pos.y);
        if (vi !== null) {
          setSelectedVertex(vi);
          return;
        }

        // Check edge midpoint for insertion
        if (selectedVertex === null) {
          const ei = findNearestEdgeMid(pos.x, pos.y);
          if (ei !== null) {
            const mp = meterPoints();
            const j = (ei + 1) % mp.length;
            const newPoint: Point = {
              x: (mp[ei].x + mp[j].x) / 2,
              y: (mp[ei].y + mp[j].y) / 2,
            };
            const newPoints = [...mp];
            newPoints.splice(j, 0, newPoint);

            if (!isSimplePolygon(newPoints)) {
              setStatus('在此处插入顶点会导致多边形自相交');
              return;
            }

            onChange(normalizePoints(newPoints));
            setSelectedVertex(j);
            setStatus(`已插入顶点 (共 ${newPoints.length} 个)`);
            return;
          }
        }

        setSelectedVertex(null);
      } else if (mode === 'delete') {
        const vi = findNearestVertex(pos.x, pos.y);
        if (vi !== null) {
          const mp = meterPoints();
          if (mp.length <= 3) {
            setStatus('多边形至少需要 3 个顶点');
            return;
          }

          const newPoints = mp.filter((_, i) => i !== vi);
          if (!isSimplePolygon(newPoints)) {
            setStatus('删除此顶点会导致多边形自相交');
            return;
          }

          onChange(normalizePoints(newPoints));
          setStatus(`已删除顶点 (剩余 ${newPoints.length} 个)`);
        }
      }
    },
    [
      mode,
      getCanvasPos,
      canvasToMeters,
      drawingPoints,
      metersToCanvas,
      closeDrawing,
      findNearestVertex,
      findNearestEdgeMid,
      meterPoints,
      onChange,
      selectedVertex,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);

      if (mode === 'select') {
        // Drag selected vertex
        if (selectedVertex !== null && e.buttons === 1) {
          const meter = canvasToMeters(pos.x, pos.y);
          const mp = meterPoints();
          const newPoints = mp.map((p, i) => (i === selectedVertex ? meter : p));

          if (!isSimplePolygon(newPoints)) {
            return; // Don't apply self-intersecting changes
          }

          onChange(normalizePoints(newPoints));
          return;
        }

        // Hover detection for vertices
        const vi = findNearestVertex(pos.x, pos.y);
        setHoveredVertex(vi);

        // Hover detection for edge midpoints (only when no vertex hovered or selected)
        if (vi === null && selectedVertex === null) {
          setHoveredEdgeMid(findNearestEdgeMid(pos.x, pos.y));
        } else {
          setHoveredEdgeMid(null);
        }
      } else if (mode === 'delete') {
        setHoveredVertex(findNearestVertex(pos.x, pos.y));
      }
    },
    [
      mode,
      getCanvasPos,
      selectedVertex,
      canvasToMeters,
      meterPoints,
      onChange,
      findNearestVertex,
      findNearestEdgeMid,
    ],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === 'draw') {
        // Remove the point added by the second click of the double-click,
        // then close the polygon.
        setDrawingPoints((prev) => {
          const trimmed = prev.length > 3 ? prev.slice(0, -1) : prev;
          // Use setTimeout to close after state update
          setTimeout(() => {
            if (trimmed.length >= 3 && isSimplePolygon(trimmed)) {
              const normalized = normalizePoints(trimmed);
              onChange(normalized);
              setDrawingPoints([]);
              setStatus(`多边形已创建 (${normalized.length} 个顶点)`);
              setMode('select');
            } else if (trimmed.length >= 3) {
              setStatus('多边形自相交，请调整顶点位置');
            }
          }, 0);
          return trimmed;
        });
      }
    },
    [mode, onChange],
  );

  // ── PNG import ──────────────────────────────────────────────────────────

  const handlePngImport = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so re-importing the same file works
      e.target.value = '';

      setStatus('正在提取轮廓...');
      try {
        const result = await extractOutlineFromPng(file);
        const aspect = result.width / result.height;

        let newWidth: number;
        let newDepth: number;
        if (aspect >= 1) {
          newWidth = Math.min(Math.max(2 * aspect, 0.5), 6);
          newDepth = 2;
        } else {
          newWidth = 2;
          newDepth = Math.min(Math.max(2 / aspect, 0.5), 6);
        }

        onChange(result.normalizedPoints);
        onSizeChange?.(newWidth, newDepth);
        setStatus(`轮廓已生成 (${result.normalizedPoints.length} 个顶点)`);
        handleModeChange('select');
      } catch (err) {
        setStatus(`轮廓提取失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [onChange, onSizeChange, handleModeChange],
  );

  // ── Clear button ────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    onChange([]);
    setDrawingPoints([]);
    setSelectedVertex(null);
    setStatus('已清除多边形');
  }, [onChange]);

  // ── Mode button styles ──────────────────────────────────────────────────

  const modeButtonClass = (m: EditorMode) =>
    `flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
      mode === m
        ? 'bg-blue-600 text-white'
        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
    }`;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-slate-800 border-b border-slate-700">
        <button
          className={modeButtonClass('select')}
          onClick={() => handleModeChange('select')}
          title="选择模式"
        >
          <MousePointer2 size={14} />
          <span>选择</span>
        </button>
        <button
          className={modeButtonClass('draw')}
          onClick={() => handleModeChange('draw')}
          title="绘制模式"
        >
          <Pencil size={14} />
          <span>绘制</span>
        </button>
        <button
          className={modeButtonClass('delete')}
          onClick={() => handleModeChange('delete')}
          title="删除顶点"
        >
          <Trash2 size={14} />
          <span>删除</span>
        </button>

        <div className="w-px h-5 bg-slate-600 mx-1" />

        <button
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
          onClick={handlePngImport}
          title="从 PNG 图片导入轮廓"
        >
          <Image size={14} />
          <span>PNG</span>
        </button>

        <button
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
          onClick={handleClear}
          title="清除多边形"
        >
          <Eraser size={14} />
          <span>清除</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex-1" />

        <span className="text-xs text-slate-400">
          {meterPoints().length} 个顶点
        </span>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onDoubleClick={handleDoubleClick}
          onMouseLeave={() => {
            setHoveredVertex(null);
            setHoveredEdgeMid(null);
          }}
          className="block cursor-crosshair"
        />
      </div>

      {/* Status bar */}
      {status && (
        <div className="px-3 py-1 text-xs text-slate-300 bg-slate-800 border-t border-slate-700 truncate">
          {status}
        </div>
      )}
    </div>
  );
};

export default ShapeEditor2D;
