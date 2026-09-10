import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Copy, Edit3, Library, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { GlbImportSession, ModelAssetManifest, ModelAssetSummary, Performer, ProjectModelAsset } from '../../types';
import GlbImportDialog from './GlbImportDialog';
import { EditableNumberInput } from '../FormControls';
import { generateModelAssetPreviews } from '../../utils/model-thumbnail';

interface ModelAssetSidebarProps {
  performers: Performer[];
  projectAssets: Record<string, ProjectModelAsset>;
  selectedIds: string[];
  currentProjectId?: string | null;
  stageWidth: number;
  stageDepth: number;
  onSelectionChange: (ids: string[]) => void;
  onRemovePerformer: (id: string) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onPlaceAsset: (asset: ModelAssetSummary, fitToStage: boolean) => void;
  onOpenModeler: (asset?: ModelAssetManifest | null) => void;
  onLibraryChanged?: () => void;
  onUpdateAssetVersion?: (performerId: string) => void;
}

const ModelAssetSidebar: React.FC<ModelAssetSidebarProps> = ({
  performers,
  projectAssets,
  selectedIds,
  currentProjectId,
  stageWidth,
  stageDepth,
  onSelectionChange,
  onRemovePerformer,
  onUpdatePerformer,
  onPlaceAsset,
  onOpenModeler,
  onLibraryChanged,
  onUpdateAssetVersion,
}) => {
  const [view, setView] = useState<'library' | 'project'>(() => window.electronAPI?.isElectron ? 'library' : 'project');
  const [assets, setAssets] = useState<ModelAssetSummary[]>([]);
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

  const refresh = async () => {
    if (!window.electronAPI?.isElectron) return;
    setLoading(true);
    try {
      let nextAssets = await window.electronAPI.modelAssets.list();
      setAssets(nextAssets);
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '资产库加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const tags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags))).sort(), [assets]);
  const filtered = useMemo(() => assets.filter((asset) => {
    const text = `${asset.name} ${asset.tags.join(' ')}`.toLowerCase();
    return text.includes(query.trim().toLowerCase())
      && (origin === 'all' || asset.origin === origin)
      && (tag === 'all' || asset.tags.includes(tag));
  }), [assets, origin, query, tag]);
  const props = performers.filter((performer) => performer.type === 'prop');

  const beginUpload = async () => {
    if (!window.electronAPI?.isElectron) return;
    try {
      const session = await window.electronAPI.modelAssets.beginGlbImport();
      if (session) setImportSession(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GLB 检查失败');
    }
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
      onOpenModeler(manifest);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '资产读取失败');
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

  const needsFit = (asset: ModelAssetSummary) => (
    asset.intrinsicSize.width > stageWidth || asset.intrinsicSize.depth > stageDepth
  );

  const updateDimension = (performer: Performer, field: 'width' | 'height' | 'depth', value: number) => {
    const safe = Math.max(0.01, value);
    const current = performer[field] ?? 1;
    if (!performer.modelAspectLocked) {
      onUpdatePerformer(performer.id, { [field]: safe });
      return;
    }
    const ratio = safe / current;
    onUpdatePerformer(performer.id, {
      width: (performer.width ?? 1) * ratio,
      height: (performer.height ?? 1) * ratio,
      depth: (performer.depth ?? 1) * ratio,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-2 border-b border-slate-800 p-2">
        <button type="button" disabled={!window.electronAPI?.isElectron} onClick={() => setView('library')} className={`rounded-l px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${view === 'library' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>资产库</button>
        <button type="button" onClick={() => setView('project')} className={`rounded-r px-3 py-2 text-xs font-medium ${view === 'project' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>当前项目 · {props.length}</button>
      </div>

      {!window.electronAPI?.isElectron && view === 'library' ? (
        <div className="m-4 rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-sm leading-6 text-amber-200">本地 3D 资产库仅桌面端可用。Web 端仍可查看和编排项目中已有的方箱回退道具。</div>
      ) : view === 'library' ? (
        <>
          <div className="space-y-2 border-b border-slate-800 p-3">
            <div className="flex gap-2"><button type="button" onClick={() => onOpenModeler(null)} className="flex flex-1 items-center justify-center gap-1 rounded bg-blue-600 py-2 text-xs font-medium hover:bg-blue-500"><Plus size={14} />新建模型</button><button type="button" onClick={() => void beginUpload()} className="flex flex-1 items-center justify-center gap-1 rounded bg-slate-700 py-2 text-xs hover:bg-slate-600"><Upload size={14} />上传 GLB</button></div>
            <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或标签" className="w-full rounded border border-slate-700 bg-slate-950 py-2 pl-8 pr-2 text-xs" /></div>
            <div className="grid grid-cols-2 gap-2"><select value={origin} onChange={(event) => setOrigin(event.target.value as typeof origin)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs"><option value="all">全部来源</option><option value="builtin">预设</option><option value="user">我的</option></select><select value={tag} onChange={(event) => setTag(event.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs"><option value="all">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && <div className="py-10 text-center text-xs text-slate-500">正在读取资产库…</div>}
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((asset) => <div key={asset.id} className="group overflow-hidden rounded-lg border border-slate-700 bg-slate-800/70"><button type="button" onClick={() => currentProjectId ? onPlaceAsset(asset, false) : setMessage('请先创建或打开项目')} className="block w-full text-left"><div className="relative grid aspect-[4/3] place-items-center bg-gradient-to-br from-slate-800 to-slate-950">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <Box size={30} className="text-slate-500" />}<span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-slate-300">{asset.origin === 'builtin' ? '预设' : `我的 v${asset.revision}`}</span></div><div className="p-2"><div className="truncate text-xs font-medium text-white">{asset.name}</div><div className="mt-1 text-[10px] text-slate-500">{asset.intrinsicSize.width.toFixed(2)} × {asset.intrinsicSize.depth.toFixed(2)} × {asset.intrinsicSize.height.toFixed(2)} m</div></div></button>{needsFit(asset) && <button type="button" onClick={() => onPlaceAsset(asset, true)} className="mx-2 mb-2 w-[calc(100%-1rem)] rounded bg-amber-900/60 py-1 text-[10px] text-amber-200">超出舞台 · 等比适配后放置</button>}<div className="flex border-t border-slate-700"><button type="button" onClick={() => void duplicate(asset)} className="flex-1 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white" title="复制"><Copy size={13} className="mx-auto" /></button><button type="button" onClick={() => void edit(asset)} className="flex-1 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white" title="编辑"><Edit3 size={13} className="mx-auto" /></button>{asset.origin === 'user' && <button type="button" onClick={() => setDeleteAsset(asset)} className="flex-1 p-1.5 text-slate-400 hover:bg-red-950 hover:text-red-300" title="删除"><Trash2 size={13} className="mx-auto" /></button>}</div></div>)}
            </div>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {props.length === 0 && <div className="py-12 text-center text-xs text-slate-500"><Library size={28} className="mx-auto mb-2" />从资产库选择模型后，在舞台中点击放置</div>}
          <div className="space-y-2">{props.map((performer) => {
            const asset = performer.modelAssetId ? projectAssets[performer.modelAssetId] : undefined;
            return <div key={performer.id} onClick={() => onSelectionChange([performer.id])} className={`rounded-lg border p-3 ${selectedIds.includes(performer.id) ? 'border-blue-500 bg-blue-950/30' : 'border-slate-700 bg-slate-800/70'}`}><div className="flex items-center gap-2"><Box size={16} style={{ color: performer.color }} /><input value={performer.name} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdatePerformer(performer.id, { name: event.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" /><button type="button" onClick={(event) => { event.stopPropagation(); onRemovePerformer(performer.id); }} className="text-slate-500 hover:text-red-300"><Trash2 size={14} /></button></div><div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>{asset?.name ?? '方箱回退'}{asset?.sourceRevision ? ` · v${asset.sourceRevision}` : ''}</span><select value={performer.propCategory ?? 'prop'} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdatePerformer(performer.id, { propCategory: event.target.value as 'prop' | 'platform' })} className="rounded bg-slate-700 px-1 py-0.5"><option value="prop">道具</option><option value="platform">高台</option></select></div><div className="mt-2 grid grid-cols-3 gap-1">{(['width', 'depth', 'height'] as const).map((field) => <label key={field} className="text-[9px] text-slate-500">{field === 'width' ? '宽' : field === 'depth' ? '深' : '高'}<EditableNumberInput min={0.01} step={0.1} value={performer[field] ?? 1} onClick={(event) => event.stopPropagation()} onChange={(value) => updateDimension(performer, field, value)} className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[10px]" /></label>)}</div><div className="mt-2 flex gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); onUpdatePerformer(performer.id, { modelAspectLocked: !performer.modelAspectLocked }); }} className={`rounded px-2 py-1 text-[10px] ${performer.modelAspectLocked ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-700 text-slate-300'}`}>比例锁 {performer.modelAspectLocked ? '开' : '关'}</button><select value={performer.rotationPivot ?? 'center'} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdatePerformer(performer.id, { rotationPivot: event.target.value as 'center' | 'left' | 'right' })} className="rounded bg-slate-700 px-1 text-[10px]"><option value="center">中心锚点</option><option value="left">左侧锚点</option><option value="right">右侧锚点</option></select>{asset?.sourceAssetId && <button type="button" onClick={(event) => { event.stopPropagation(); onUpdateAssetVersion?.(performer.id); }} className="ml-auto rounded bg-blue-900 px-2 py-1 text-[10px] text-blue-200">更新版本</button>}</div></div>;
          })}</div>
        </div>
      )}

      {message && <div className="border-t border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"><button type="button" onClick={() => setMessage(null)} className="float-right text-slate-500">×</button>{message}</div>}
      {deleteAsset && createPortal(<div className="fixed inset-0 z-[100010] grid place-items-center bg-black/70"><div className="w-[360px] rounded-xl border border-slate-700 bg-slate-900 p-5"><h3 className="font-semibold text-white">删除“{deleteAsset.name}”？</h3><p className="mt-2 text-sm text-slate-400">资产会移入系统回收站，既有项目中的不可变快照不会受影响。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeleteAsset(null)} className="rounded bg-slate-700 px-4 py-2 text-sm">取消</button><button type="button" onClick={() => void window.electronAPI.modelAssets.delete(deleteAsset.id).then(async () => { setDeleteAsset(null); await refresh(); onLibraryChanged?.(); }).catch((error) => setMessage(error instanceof Error ? error.message : '删除失败'))} className="rounded bg-red-700 px-4 py-2 text-sm">移到回收站</button></div></div></div>, document.body)}
      {importSession && <GlbImportDialog session={importSession} onCancel={() => void window.electronAPI.modelAssets.cancelGlbImport(importSession.sessionId).finally(() => setImportSession(null))} onSaved={() => { setImportSession(null); void refresh(); onLibraryChanged?.(); }} />}
      {metadataEditor && createPortal(<div className="fixed inset-0 z-[100010] grid place-items-center bg-black/70"><div className="w-[390px] rounded-xl border border-slate-700 bg-slate-900 p-5"><h3 className="font-semibold text-white">编辑 GLB 资产信息</h3><p className="mt-1 text-xs text-slate-500">内部网格和原始材质保持不变。</p><label className="mt-4 block text-xs text-slate-400">名称<input value={metadataEditor.name} onChange={(event) => setMetadataEditor({ ...metadataEditor, name: event.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" /></label><label className="mt-3 block text-xs text-slate-400">标签<input value={metadataEditor.tags} onChange={(event) => setMetadataEditor({ ...metadataEditor, tags: event.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm" /></label><label className="mt-3 block text-xs text-slate-400">默认用途<select value={metadataEditor.usage} onChange={(event) => setMetadataEditor({ ...metadataEditor, usage: event.target.value as 'prop' | 'platform' })} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm"><option value="prop">普通道具</option><option value="platform">高台</option></select></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setMetadataEditor(null)} className="rounded bg-slate-700 px-4 py-2 text-sm">取消</button><button type="button" disabled={!metadataEditor.name.trim()} onClick={() => void window.electronAPI.modelAssets.updateMetadata({ assetId: metadataEditor.asset.id, expectedRevision: metadataEditor.asset.revision, name: metadataEditor.name, tags: metadataEditor.tags.split(/[、,，]/).map((item) => item.trim()).filter(Boolean), defaultUsage: metadataEditor.usage }).then(async () => { setMetadataEditor(null); await refresh(); onLibraryChanged?.(); }).catch((error) => setMessage(error instanceof Error ? error.message : '保存失败'))} className="rounded bg-blue-600 px-4 py-2 text-sm disabled:opacity-50">保存新版本</button></div></div></div>, document.body)}
    </div>
  );
};

export default ModelAssetSidebar;
