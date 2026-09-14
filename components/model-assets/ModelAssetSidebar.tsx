import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Copy, Edit3, Library, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import type { GlbImportSession, ModelAssetManifest, ModelAssetSummary } from '../../types';
import GlbImportDialog from './GlbImportDialog';
import { generateModelAssetPreviews, type ModelPreviewImages } from '../../utils/model-thumbnail';

interface ModelAssetSidebarProps {
  isOpen: boolean;
  currentProjectId?: string | null;
  stageWidth: number;
  stageDepth: number;
  onClose: () => void;
  onPlaceAsset: (asset: ModelAssetSummary, fitToStage: boolean) => void;
  onOpenModeler: (asset?: ModelAssetManifest | null) => void;
  onLibraryChanged?: () => void;
}

// 预设资产是只读内置数据，无法落盘预览图；生成结果按内容缓存，本次会话内复用。
const builtinPreviewCache = new Map<string, ModelPreviewImages>();

const previewCacheKey = (asset: ModelAssetSummary): string => `${asset.id}:${asset.contentHash}`;

const ModelAssetSidebar: React.FC<ModelAssetSidebarProps> = ({
  isOpen,
  currentProjectId,
  stageWidth,
  stageDepth,
  onClose,
  onPlaceAsset,
  onOpenModeler,
  onLibraryChanged,
}) => {
  const [assets, setAssets] = useState<ModelAssetSummary[]>([]);
  const [runtimePreviews, setRuntimePreviews] = useState<Record<string, ModelPreviewImages>>({});
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<'all' | 'builtin' | 'user'>('all');
  const [tag, setTag] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteAsset, setDeleteAsset] = useState<ModelAssetSummary | null>(null);
  const [importSession, setImportSession] = useState<GlbImportSession | null>(null);
  const [metadataEditor, setMetadataEditor] = useState<{
    asset: ModelAssetSummary;
    name: string;
    tags: string;
    usage: 'prop' | 'platform';
  } | null>(null);
  const previewUpgradeAttempted = useRef(new Set<string>());
  const builtinPreviewAttempted = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.isElectron) return;
    setLoading(true);
    try {
      let nextAssets = await window.electronAPI.modelAssets.list();
      setAssets(nextAssets);
      // 回填会话内已经生成过的预设预览图
      const cachedPreviews: Record<string, ModelPreviewImages> = {};
      for (const asset of nextAssets) {
        const cached = builtinPreviewCache.get(previewCacheKey(asset));
        if (cached) cachedPreviews[asset.id] = cached;
      }
      if (Object.keys(cachedPreviews).length > 0) {
        setRuntimePreviews((current) => ({ ...current, ...cachedPreviews }));
      }
      const legacyPreviews = nextAssets.filter((asset) => (
        asset.origin === 'user'
        && (asset.thumbnailVersion !== 1 || asset.floorplanVersion !== 1)
        && !previewUpgradeAttempted.current.has(asset.id)
      ));
      if (legacyPreviews.length > 0) {
        for (const asset of legacyPreviews) {
          previewUpgradeAttempted.current.add(asset.id);
          try {
            const manifest = await window.electronAPI.modelAssets.get(asset.id);
            const previewImages = await generateModelAssetPreviews(manifest);
            await window.electronAPI.modelAssets.updateThumbnail({
              assetId: manifest.id,
              expectedRevision: manifest.revision,
              ...previewImages,
            });
          } catch (error) {
            console.warn(`旧资产“${asset.name}”的正视图升级失败：`, error);
          }
        }
        nextAssets = await window.electronAPI.modelAssets.list();
        setAssets(nextAssets);
      }
      // 预设资产没有落盘的预览图，后台逐张生成，避免阻塞资产列表展示
      void (async () => {
        const builtinWithoutPreview = nextAssets.filter((asset) => (
          asset.origin === 'builtin'
          && !asset.thumbnailUrl
          && !builtinPreviewCache.has(previewCacheKey(asset))
          && !builtinPreviewAttempted.current.has(asset.id)
        ));
        for (const asset of builtinWithoutPreview) {
          builtinPreviewAttempted.current.add(asset.id);
          try {
            const manifest = await window.electronAPI.modelAssets.get(asset.id);
            const previewImages = await generateModelAssetPreviews(manifest);
            builtinPreviewCache.set(previewCacheKey(asset), previewImages);
            setRuntimePreviews((current) => ({ ...current, [asset.id]: previewImages }));
          } catch (error) {
            console.warn(`预设资产“${asset.name}”的预览图生成失败：`, error);
          }
        }
      })();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '资产库加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMessage(null);
    void refresh();
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!isOpen || deleteAsset || metadataEditor || importSession) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteAsset, importSession, isOpen, metadataEditor, onClose]);

  const tags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags))).sort(), [assets]);
  const filtered = useMemo(() => assets.filter((asset) => {
    const text = `${asset.name} ${asset.tags.join(' ')}`.toLowerCase();
    return text.includes(query.trim().toLowerCase())
      && (origin === 'all' || asset.origin === origin)
      && (tag === 'all' || asset.tags.includes(tag));
  }), [assets, origin, query, tag]);

  const beginUpload = async () => {
    if (!window.electronAPI?.isElectron) return;
    try {
      const session = await window.electronAPI.modelAssets.beginGlbImport();
      if (session) setImportSession(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GLB 检查失败');
    }
  };

  const duplicate = async (asset: ModelAssetSummary) => {
    try {
      const copy = await window.electronAPI.modelAssets.duplicate(asset.id);
      await refresh();
      onLibraryChanged?.();
      setMessage(`已创建“${copy.name}”`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '复制失败');
    }
  };

  const openModeler = (asset?: ModelAssetManifest | null) => {
    onClose();
    onOpenModeler(asset);
  };

  const edit = async (asset: ModelAssetSummary) => {
    try {
      const manifest = await window.electronAPI.modelAssets.get(asset.id);
      if (manifest.format !== 'parametric') {
        if (manifest.origin === 'builtin') {
          await duplicate(asset);
        } else {
          setMetadataEditor({
            asset,
            name: manifest.name,
            tags: manifest.tags.join('、'),
            usage: manifest.defaultUsage,
          });
        }
        return;
      }
      openModeler(manifest);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '资产读取失败');
    }
  };

  const needsFit = (asset: ModelAssetSummary) => (
    asset.intrinsicSize.width > stageWidth || asset.intrinsicSize.depth > stageDepth
  );

  const placeAsset = (asset: ModelAssetSummary, fitToStage: boolean) => {
    if (!currentProjectId) {
      setMessage('请先创建或打开项目');
      return;
    }
    onPlaceAsset(asset, fitToStage);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99990] overflow-y-auto bg-black/70 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-3 sm:p-6">
        <div className="flex h-[min(860px,calc(100vh-3rem))] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-700 bg-slate-800/70 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-600/15 p-2 text-blue-300"><Library size={19} /></div>
              <div>
                <h2 className="text-base font-semibold text-white">3D 资产库</h2>
                <p className="text-xs text-slate-400">选择模型后，在舞台中点击完成放置</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white" aria-label="关闭资产库">
              <X size={19} />
            </button>
          </header>

          {!window.electronAPI?.isElectron ? (
            <div className="m-5 rounded-xl border border-amber-700 bg-amber-950/40 p-5 text-sm leading-6 text-amber-200">
              本地 3D 资产库仅桌面端可用。Web 端仍可查看和编排项目中已有的方箱回退道具。
            </div>
          ) : (
            <>
              <div className="space-y-3 border-b border-slate-800 p-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => openModeler(null)} className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium hover:bg-blue-500">
                    <Plus size={15} /> 新建模型
                  </button>
                  <button type="button" onClick={() => void beginUpload()} className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-700 px-4 py-2.5 text-sm hover:bg-slate-600">
                    <Upload size={15} /> 上传 GLB
                  </button>
                  <div className="relative min-w-0 flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或标签" className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <select value={origin} onChange={(event) => setOrigin(event.target.value as typeof origin)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                    <option value="all">全部来源</option><option value="builtin">预设</option><option value="user">我的</option>
                  </select>
                  <select value={tag} onChange={(event) => setTag(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                    <option value="all">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                {message && (
                  <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                    <button type="button" onClick={() => setMessage(null)} className="float-right text-slate-500 hover:text-white">×</button>{message}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
                {loading && <div className="py-12 text-center text-sm text-slate-500">正在读取资产库…</div>}
                {!loading && filtered.length === 0 && (
                  <div className="py-16 text-center text-sm text-slate-500">
                    <Box size={32} className="mx-auto mb-3" />{assets.length === 0 ? '资产库还是空的，可以新建模型或上传 GLB' : '没有匹配的资产'}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered.map((asset) => {
                    const thumbnailSrc = runtimePreviews[asset.id]?.thumbnailDataUrl ?? asset.thumbnailUrl;
                    return (
                      <div key={asset.id} className="group overflow-hidden rounded-xl border border-slate-700 bg-slate-800/70 transition hover:border-slate-600">
                        <button type="button" onClick={() => placeAsset(asset, false)} className="block w-full text-left">
                          <div className="relative grid aspect-[4/3] place-items-center bg-gradient-to-br from-slate-800 to-slate-950">
                            {thumbnailSrc ? <img src={thumbnailSrc} alt="" className="h-full w-full object-contain" /> : <Box size={34} className="text-slate-500" />}
                            <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-slate-300">{asset.origin === 'builtin' ? '预设' : `我的 v${asset.revision}`}</span>
                          </div>
                          <div className="p-3">
                            <div className="truncate text-sm font-medium text-white">{asset.name}</div>
                            <div className="mt-1 text-[11px] text-slate-500">{asset.intrinsicSize.width.toFixed(2)} × {asset.intrinsicSize.depth.toFixed(2)} × {asset.intrinsicSize.height.toFixed(2)} m</div>
                          </div>
                        </button>
                        {needsFit(asset) && (
                          <button type="button" onClick={() => placeAsset(asset, true)} className="mx-3 mb-3 w-[calc(100%-1.5rem)] rounded-lg bg-amber-900/60 py-1.5 text-[11px] text-amber-200 hover:bg-amber-800/70">
                            超出舞台 · 等比适配后放置
                          </button>
                        )}
                        <div className="flex border-t border-slate-700">
                          <button type="button" onClick={() => void duplicate(asset)} className="flex-1 p-2 text-slate-400 hover:bg-slate-700 hover:text-white" title="复制"><Copy size={14} className="mx-auto" /></button>
                          <button type="button" onClick={() => void edit(asset)} className="flex-1 p-2 text-slate-400 hover:bg-slate-700 hover:text-white" title="编辑"><Edit3 size={14} className="mx-auto" /></button>
                          {asset.origin === 'user' && <button type="button" onClick={() => setDeleteAsset(asset)} className="flex-1 p-2 text-slate-400 hover:bg-red-950 hover:text-red-300" title="删除"><Trash2 size={14} className="mx-auto" /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {deleteAsset && createPortal(
        <div className="fixed inset-0 z-[100010] grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-[360px] rounded-xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="font-semibold text-white">删除“{deleteAsset.name}”？</h3>
            <p className="mt-2 text-sm text-slate-400">资产会移入系统回收站，既有项目中的不可变快照不会受影响。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteAsset(null)} className="rounded bg-slate-700 px-4 py-2 text-sm">取消</button>
              <button type="button" onClick={() => void window.electronAPI.modelAssets.delete(deleteAsset.id).then(async () => {
                setDeleteAsset(null); await refresh(); onLibraryChanged?.();
              }).catch((error) => setMessage(error instanceof Error ? error.message : '删除失败'))} className="rounded bg-red-700 px-4 py-2 text-sm">移到回收站</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {importSession && <GlbImportDialog session={importSession} onCancel={() => void window.electronAPI.modelAssets.cancelGlbImport(importSession.sessionId).finally(() => setImportSession(null))} onSaved={() => { setImportSession(null); void refresh(); onLibraryChanged?.(); }} />}
      {metadataEditor && createPortal(
        <div className="fixed inset-0 z-[100010] grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-[390px] rounded-xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="font-semibold text-white">编辑 GLB 资产信息</h3>
            <p className="mt-1 text-xs text-slate-500">内部网格和原始材质保持不变。</p>
            <label className="mt-4 block text-xs text-slate-400">名称<input value={metadataEditor.name} onChange={(event) => setMetadataEditor({ ...metadataEditor, name: event.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" /></label>
            <label className="mt-3 block text-xs text-slate-400">标签<input value={metadataEditor.tags} onChange={(event) => setMetadataEditor({ ...metadataEditor, tags: event.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" /></label>
            <label className="mt-3 block text-xs text-slate-400">默认用途<select value={metadataEditor.usage} onChange={(event) => setMetadataEditor({ ...metadataEditor, usage: event.target.value as 'prop' | 'platform' })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm"><option value="prop">普通道具</option><option value="platform">高台</option></select></label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setMetadataEditor(null)} className="rounded bg-slate-700 px-4 py-2 text-sm">取消</button>
              <button type="button" disabled={!metadataEditor.name.trim()} onClick={() => void window.electronAPI.modelAssets.updateMetadata({
                assetId: metadataEditor.asset.id,
                expectedRevision: metadataEditor.asset.revision,
                name: metadataEditor.name,
                tags: metadataEditor.tags.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
                defaultUsage: metadataEditor.usage,
              }).then(async () => { setMetadataEditor(null); await refresh(); onLibraryChanged?.(); }).catch((error) => setMessage(error instanceof Error ? error.message : '保存失败'))} className="rounded bg-blue-600 px-4 py-2 text-sm disabled:opacity-50">保存新版本</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>,
    document.body,
  );
};

export default ModelAssetSidebar;
