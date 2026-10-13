import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  FolderOpen,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { createMobileDocument, addActor } from '../../mobile/editor-model';
import {
  deleteMobileProject,
  listMobileProjects,
  loadMobileProject,
  newId,
  saveMobileProject,
  type MobileProjectMeta,
} from '../../mobile/project-store';
import {
  getMissingAssets,
  readRehearsalPackage,
  rehearsalWarnings,
  parseMobileDocument,
  readProjectPackage,
  type PortableProject,
  MAX_MOBILE_PACKAGE_BYTES,
} from '../../mobile/project-package';
import { onAndroidBack, minimizeAndroidApp } from '../../mobile/native';
import { MobileSheet } from './MobileSheet';
import './mobile.css';
const MobileRehearsal = lazy(() => import('./MobileRehearsal'));
const MobileEditor = lazy(() => import('./MobileEditor'));
export const ACTOR_COLORS = ['#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fbbf24', '#fb923c'];

export default function MobileApp() {
  const [projects, setProjects] = useState<MobileProjectMeta[]>([]);
  const [active, setActive] = useState<{ id: string; project: PortableProject } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [name, setName] = useState('新的编排');
  const [actorCount, setActorCount] = useState(8);
  const rehearsalInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    try {
      setProjects(await listMobileProjects());
    } catch {
      setError('无法打开本机项目库，请检查存储空间或浏览器隐私设置。');
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (active) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void onAndroidBack(() => {
      if (busy) return;
      if (createOpen || deleteId) {
        setCreateOpen(false);
        setDeleteId(null);
      } else void minimizeAndroidApp();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else remove = cleanup;
    });
    return () => {
      disposed = true;
      remove?.();
    };
  }, [active, busy, createOpen, deleteId]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      let document = createMobileDocument(name, newId);
      for (let i = 0; i < actorCount; i++)
        document = addActor(document, {
          id: newId(),
          name: `演员 ${i + 1}`,
          label: `${i + 1}`,
          shape: 'circle',
          color: ACTOR_COLORS[Math.floor(i / 4) % ACTOR_COLORS.length],
          type: 'performer',
        });
      const id = newId();
      await saveMobileProject(id, document, {});
      setCreateOpen(false);
      setActive({ id, project: { document, assets: {}, warnings: [] } });
      void navigator.storage?.persist?.().catch(() => undefined);
    });
  const importFile = (file?: File, rehearsal = false) =>
    run(async () => {
      if (!file) return;
      if (file.size > MAX_MOBILE_PACKAGE_BYTES) throw new Error('移动端导入文件不能超过 64 MB');
      let project: PortableProject;
      if (file.name.toLowerCase().endsWith('.json')) {
        const document = parseMobileDocument(
          JSON.parse(await file.text()),
          file.name.replace(/\.json$/i, '')
        );
        project = {
          document,
          assets: {},
          warnings: ['已导入编排 JSON。音乐和素材需要完整项目包。', ...getMissingAssets(document, {})],
        };
      } else
        project = await (rehearsal ? readRehearsalPackage : readProjectPackage)(
          file,
          file.name.replace(/\.(zip|choreo)$/i, '')
        );
      if (rehearsal) {
        project.mode = 'rehearsal';
        project.warnings = rehearsalWarnings(project.document, project.assets);
      }
      const id = newId();
      await saveMobileProject(id, project.document, project.assets, project.mode);
      setActive({ id, project });
    });
  if (active)
    return (
      <Suspense fallback={<div className="mobile-loading">正在打开舞台…</div>}>
        {active.project.mode === 'rehearsal' ? (
          <MobileRehearsal
            project={active.project}
            onExit={() => {
              setActive(null);
              void refresh();
            }}
          />
        ) : (
          <MobileEditor
            key={active.id}
            id={active.id}
            initial={active.project}
            onExit={() => {
              setActive(null);
              void refresh();
            }}
          />
        )}
      </Suspense>
    );
  return (
    <main className="mobile-app mobile-library">
      <header className="mobile-brand">
        <span className="mobile-brand__mark">
          <Smartphone size={22} />
        </span>
        <strong>
          CosStage <small>随身舞台</small>
        </strong>
        <span className="mobile-local">
          <Check size={13} /> 本机项目
        </span>
      </header>
      <section className="mobile-library__intro">
        <p className="mobile-eyebrow">从灵感，到每一个站位</p>
        <h1>
          我的编排<span>。</span>
        </h1>
        <p>排练现场随时调整，带回电脑继续创作。</p>
      </section>
      <div className="mobile-library__actions">
        <button className="mobile-primary" onClick={() => setCreateOpen(true)} disabled={busy}>
          <Plus size={20} /> 新建编排
        </button>
        <button className="mobile-secondary" onClick={() => input.current?.click()} disabled={busy}>
          <ArrowDownToLine size={20} /> 导入项目
        </button>
      </div>
      <button
        className="mobile-rehearsal-import mobile-secondary"
        disabled={busy}
        onClick={() => rehearsalInput.current?.click()}
      >
        <Smartphone size={20} />
        <span>
          <strong>团员排练 · 导入编排包</strong>
          <small>只读查看队形与备注，仅载入编排和音乐</small>
        </span>
        <ChevronRight size={20} />
      </button>
      <input
        ref={rehearsalInput}
        className="sr-only"
        type="file"
        accept=".zip,.choreo,.json,application/zip,application/json"
        aria-label="导入团员排练包"
        onChange={(event) => {
          void importFile(event.target.files?.[0], true);
          event.target.value = '';
        }}
      />
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".zip,.choreo,.json,application/zip,application/json"
        aria-label="导入桌面项目包"
        onChange={(event) => {
          void importFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {error && (
        <div className="mobile-error" role="alert">
          {error}
          <button onClick={() => setError('')}>关闭</button>
        </div>
      )}
      {busy && (
        <p role="status" className="mobile-muted">
          正在读取项目，请稍候…
        </p>
      )}
      <div className="mobile-section-heading">
        <h2>最近编辑</h2>
        <span>{projects.length} 个项目</span>
      </div>
      <section className="mobile-project-list" aria-label="本机项目列表">
        {projects.map((project, index) => (
          <article className="mobile-project-card" key={project.id}>
            <button
              className="mobile-project-card__open"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setActive({ id: project.id, project: await loadMobileProject(project.id) })
                )
              }
            >
              <span
                className="mobile-project-art"
                style={
                  { '--project-color': ACTOR_COLORS[index % ACTOR_COLORS.length] } as React.CSSProperties
                }
              >
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="mobile-project-card__info">
                <strong>{project.name}</strong>
                <span>
                  {project.mode === 'rehearsal' ? '只读排练 · ' : ''}
                  {project.actors} 位演员 · {project.formations} 个队形
                </span>
                <small>
                  {new Date(project.updatedAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              className="mobile-project-card__delete mobile-icon"
              aria-label={`删除项目 ${project.name}`}
              disabled={busy}
              onClick={() => setDeleteId(project.id)}
            >
              <Trash2 size={17} />
            </button>
          </article>
        ))}
        {projects.length === 0 && (
          <div className="mobile-empty">
            <FolderOpen size={36} />
            <h3>第一场演出，从这里开始</h3>
            <p>
              新建编排，或从电脑导入完整项目包。
              <br />
              编辑内容会自动保存在本机。
            </p>
          </div>
        )}
      </section>
      <aside className="mobile-transfer-note">
        <ArrowUpRight size={22} />
        <div>
          <strong>一份项目，两端接力</strong>
          <p>电脑导出 .zip 项目包，在这里导入。修改后用“分享项目包”带回电脑，音乐和素材一起走。</p>
          <small>离线可用 · 导入上限 64 MB · 卸载前请导出备份</small>
        </div>
      </aside>
      {createOpen && (
        <MobileSheet
          title="新建编排"
          onClose={() => {
            if (!busy) setCreateOpen(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="mobile-form"
          >
            <label>
              编排名
              <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              初始演员人数
              <input
                type="number"
                min={0}
                max={80}
                value={actorCount}
                onChange={(e) => setActorCount(Math.max(0, Math.min(80, Number(e.target.value) || 0)))}
              />
            </label>
            <p className="mobile-muted">默认舞台 14 × 8 米，可在舞台设置中修改。</p>
            <button disabled={busy || !name.trim()} className="mobile-primary">
              {busy ? '正在创建…' : '进入舞台'}
            </button>
          </form>
        </MobileSheet>
      )}
      {deleteId && (
        <MobileSheet
          title="删除本机项目？"
          onClose={() => {
            if (!busy) setDeleteId(null);
          }}
        >
          <p>项目和本机素材将被删除，无法撤销。电脑上的原项目不受影响，请确认已导出需要的备份。</p>
          <div className="mobile-button-row">
            <button className="mobile-secondary" onClick={() => setDeleteId(null)}>
              保留项目
            </button>
            <button
              className="mobile-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await deleteMobileProject(deleteId);
                  setDeleteId(null);
                  await refresh();
                })
              }
            >
              删除项目
            </button>
          </div>
        </MobileSheet>
      )}
    </main>
  );
}
