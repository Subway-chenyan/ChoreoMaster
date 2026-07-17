import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen,
  Plus,
  Trash2,
  Copy,
  Edit2,
  ExternalLink,
  RefreshCw,
  FolderCog,
  Search,
  Clock,
  MoreVertical,
  Check,
  X,
  GraduationCap,
  History,
  Download,
  Upload,
} from 'lucide-react';
import type {
  ProjectMeta,
  ProjectRecoverySnapshot,
  ProjectTemplateData,
  ProjectTemplateSummary,
} from '../types';

interface ProjectBrowserProps {
  currentProjectId: string | null;
  onLoadProject: (projectId: string) => void;
  onCreateProject: (name: string) => Promise<string>;
  onCreateFromPresetTemplate?: (name: string, templateId: string) => Promise<string>;
  onDeletedCurrentProject: () => void;
  onCreateFromTemplate?: (templateData: ProjectTemplateData) => Promise<string>;
  onLoadTemplate?: (templateData: ProjectTemplateData) => void;
  onImportPackage?: () => void;
  onImportChoreography?: () => void;
  onExportPackage?: () => void;
  onExportChoreography?: () => void;
  onRestoreRecovery?: (snapshotId: string) => Promise<boolean>;
}

export const ProjectBrowser: React.FC<ProjectBrowserProps> = ({
  currentProjectId,
  onLoadProject,
  onCreateProject,
  onCreateFromPresetTemplate,
  onDeletedCurrentProject,
  onCreateFromTemplate,
  onLoadTemplate,
  onImportPackage,
  onImportChoreography,
  onExportPackage,
  onExportChoreography,
  onRestoreRecovery,
}) => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isUsingTemplate, setIsUsingTemplate] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [recoverySnapshots, setRecoverySnapshots] = useState<ProjectRecoverySnapshot[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [transferMenu, setTransferMenu] = useState<'import' | 'export' | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    projectId: string | null;
  }>({ show: false, x: 0, y: 0, projectId: null });

  const isElectron = window.electronAPI?.isElectron;

  // Load projects list
  const loadProjects = useCallback(async () => {
    if (!isElectron) return;
    
    setLoading(true);
    try {
      const projectList = await window.electronAPI.project.list();
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  }, [isElectron]);

  const loadRecoverySnapshots = useCallback(async () => {
    if (!isElectron) return;
    setRecoveryLoading(true);
    try {
      setRecoverySnapshots(await window.electronAPI.project.listRecoverySnapshots());
    } catch (error) {
      console.error('Failed to load project recovery snapshots:', error);
    } finally {
      setRecoveryLoading(false);
    }
  }, [isElectron]);

  useEffect(() => {
    loadProjects();
    loadRecoverySnapshots();
  }, [loadProjects, loadRecoverySnapshots, currentProjectId]);

  useEffect(() => {
    if (!isElectron) return;
    void window.electronAPI.project.listTemplates()
      .then(setProjectTemplates)
      .catch((error) => console.error('Failed to load project templates:', error));
  }, [isElectron]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu({ show: false, x: 0, y: 0, projectId: null });
    if (contextMenu.show) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.show]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || isCreatingProject) return;
    setIsCreatingProject(true);
    try {
      const projectId = selectedTemplateId && onCreateFromPresetTemplate
        ? await onCreateFromPresetTemplate(newProjectName.trim(), selectedTemplateId)
        : await onCreateProject(newProjectName.trim());
      if (!projectId) return;
      setNewProjectName('');
      setSelectedTemplateId('');
      setShowNewProjectForm(false);
      await loadProjects();
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleDeleteProject = (projectId: string): void => {
    setPendingDeleteProjectId(projectId);
  };

  const confirmDeleteProject = async (): Promise<void> => {
    const projectId = pendingDeleteProjectId;
    if (!projectId || isDeletingProject) return;
    setIsDeletingProject(true);
    try {
      await window.electronAPI.project.delete(projectId);
      setPendingDeleteProjectId(null);
      await Promise.all([loadProjects(), loadRecoverySnapshots()]);
      if (currentProjectId === projectId) {
        onDeletedCurrentProject();
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleDuplicateProject = async (projectId: string) => {
    try {
      const { id } = await window.electronAPI.project.duplicate(projectId);
      await loadProjects();
      onLoadProject(id);
    } catch (error) {
      console.error('Failed to duplicate project:', error);
    }
  };

  const handleRenameProject = async (projectId: string, newName: string) => {
    if (!newName.trim()) return;
    
    try {
      await window.electronAPI.project.rename(projectId, newName.trim());
      setEditingProjectId(null);
      await loadProjects();
    } catch (error) {
      console.error('Failed to rename project:', error);
    }
  };

  const handleOpenInExplorer = async (projectId: string) => {
    try {
      await window.electronAPI.project.openInExplorer(projectId);
    } catch (error) {
      console.error('Failed to open in explorer:', error);
    }
  };

  const handleOpenStorageFolder = async () => {
    try {
      await window.electronAPI.project.openStorageFolder();
    } catch (error) {
      console.error('Failed to open storage folder:', error);
    }
  };

  const handleUseTemplate = async () => {
    if (isUsingTemplate) return;
    setIsUsingTemplate(true);
    try {
      const tutorialUrl = new URL('./tutorial-project.json', window.location.href);
      const resp = await fetch(tutorialUrl);
      if (!resp.ok) {
        throw new Error(`Tutorial project request failed: ${resp.status}`);
      }
      const templateData = await resp.json();

      if (isElectron && onCreateFromTemplate) {
        const projectId = await onCreateFromTemplate(templateData);
        if (!projectId) return;
        await loadProjects();
      } else if (onLoadTemplate) {
        onLoadTemplate(templateData);
      }
    } catch (error) {
      console.error('Failed to load template:', error);
    } finally {
      setIsUsingTemplate(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      projectId,
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isElectron) {
    return (
      <div className="h-full flex flex-col">
        {onLoadTemplate && (
          <div className="mb-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">快速开始</div>
            <button
              onClick={handleUseTemplate}
              disabled={isUsingTemplate}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-emerald-700/50 bg-emerald-900/20 hover:bg-emerald-900/40 disabled:opacity-50 transition-colors group"
            >
              <div className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 group-hover:bg-emerald-600/30 transition-colors">
                <GraduationCap size={18} />
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="text-sm font-medium text-emerald-300">教学示例</div>
                <div className="text-[11px] text-slate-500 truncate">5名演员 + 3块门板道具，5个队形变换</div>
              </div>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <div className="text-center">
            <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">本地项目存储仅在桌面应用中可用</p>
            <p className="text-xs mt-1 text-slate-600">使用上方教学模板快速体验</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">本地项目</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={loadProjects}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
            title="刷新列表"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleOpenStorageFolder}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
            title="打开存储文件夹"
          >
            <FolderCog size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="搜索项目..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* New Project Form */}
      {showNewProjectForm ? (
        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 mb-3">
          <input
            type="text"
            placeholder="项目名称"
            value={newProjectName}
            disabled={isCreatingProject}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateProject();
              if (e.key === 'Escape') {
                setShowNewProjectForm(false);
                setNewProjectName('');
              }
            }}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-2"
            autoFocus
          />
          {projectTemplates.length > 0 && (
            <div className="mb-2">
              <label className="mb-1 block text-[11px] text-slate-400" htmlFor="new-project-template">
                初始化模板
              </label>
              <select
                id="new-project-template"
                value={selectedTemplateId}
                disabled={isCreatingProject}
                onChange={(event) => {
                  const templateId = event.target.value;
                  setSelectedTemplateId(templateId);
                  const template = projectTemplates.find((item) => item.id === templateId);
                  if (template && !newProjectName.trim()) setNewProjectName(template.name);
                }}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="">空白项目</option>
                {projectTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              {selectedTemplateId && (
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  {projectTemplates.find((item) => item.id === selectedTemplateId)?.description}
                  {' · 首次使用时按需下载'}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCreateProject}
              disabled={isCreatingProject}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 px-3 py-1.5 rounded text-white text-xs font-medium"
            >
              {isCreatingProject ? '正在创建…' : '创建'}
            </button>
            <button
              onClick={() => {
                setShowNewProjectForm(false);
                setNewProjectName('');
                setSelectedTemplateId('');
              }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 text-xs"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewProjectForm(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors mb-3"
        >
          <Plus size={16} />
          新建项目
        </button>
      )}

      {isElectron && (
        <div className="mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTransferMenu((current) => current === 'import' ? null : 'import')}
              className="flex items-center justify-center gap-2 rounded bg-blue-900/40 px-2 py-2 text-xs text-blue-200 hover:bg-blue-900/60"
            >
              <Upload size={13} /> 导入
            </button>
            <button
              type="button"
              onClick={() => setTransferMenu((current) => current === 'export' ? null : 'export')}
              disabled={!currentProjectId}
              className="flex items-center justify-center gap-2 rounded bg-emerald-900/40 px-2 py-2 text-xs text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-40"
            >
              <Download size={13} /> 导出
            </button>
          </div>
          {transferMenu && (
            <div className="grid grid-cols-2 gap-2 rounded border border-slate-700 bg-slate-950/70 p-2">
              <button
                type="button"
                onClick={() => {
                  setTransferMenu(null);
                  void (transferMenu === 'import' ? onImportPackage?.() : onExportPackage?.());
                }}
                className="rounded bg-slate-800 px-2 py-2 text-xs text-slate-300 hover:bg-slate-700"
              >
                项目压缩包
              </button>
              <button
                type="button"
                onClick={() => {
                  setTransferMenu(null);
                  void (transferMenu === 'import' ? onImportChoreography?.() : onExportChoreography?.());
                }}
                className="rounded bg-slate-800 px-2 py-2 text-xs text-slate-300 hover:bg-slate-700"
              >
                编排 JSON
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setShowRecovery((current) => !current);
              void loadRecoverySnapshots();
            }}
            className="w-full px-2 py-2 rounded bg-amber-900/30 hover:bg-amber-900/50 text-xs text-amber-200 flex items-center justify-center gap-2"
          >
            <History size={13} /> 项目恢复（{recoverySnapshots.length}）
          </button>
          {showRecovery && (
            <div className="max-h-48 overflow-y-auto rounded border border-amber-800/40 bg-slate-950/60 p-2 space-y-1">
              {recoveryLoading ? (
                <div className="py-3 text-center text-xs text-slate-500">正在加载恢复版本…</div>
              ) : recoverySnapshots.length === 0 ? (
                <div className="py-3 text-center text-xs text-slate-500">暂无可恢复版本</div>
              ) : recoverySnapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={async () => {
                    if (!onRestoreRecovery || restoringSnapshotId) return;
                    setRestoringSnapshotId(snapshot.id);
                    try {
                      const restored = await onRestoreRecovery(snapshot.id);
                      if (restored) {
                        setShowRecovery(false);
                        await Promise.all([loadProjects(), loadRecoverySnapshots()]);
                      }
                    } finally {
                      setRestoringSnapshotId(null);
                    }
                  }}
                  disabled={restoringSnapshotId !== null}
                  className="w-full rounded px-2 py-2 text-left hover:bg-slate-800 disabled:opacity-50"
                >
                  <div className="truncate text-xs text-slate-200">{snapshot.projectName}</div>
                  <div className="text-[10px] text-slate-500">
                    {new Date(snapshot.createdAt).toLocaleString('zh-CN')} · 恢复为新项目
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Template Section */}
      {(onCreateFromTemplate || onLoadTemplate) && (
        <div className="mb-3">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">快速开始</div>
          <button
            onClick={handleUseTemplate}
            disabled={isUsingTemplate}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-emerald-700/50 bg-emerald-900/20 hover:bg-emerald-900/40 disabled:opacity-50 transition-colors group"
          >
            <div className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 group-hover:bg-emerald-600/30 transition-colors">
              <GraduationCap size={18} />
            </div>
            <div className="text-left flex-1 min-w-0">
              <div className="text-sm font-medium text-emerald-300">教学示例</div>
              <div className="text-[11px] text-slate-500 truncate">5名演员 + 3块门板道具，5个队形变换</div>
            </div>
          </button>
        </div>
      )}

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {loading ? (
          <div className="text-center py-8 text-slate-500">
            <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
            <p className="text-xs">加载中...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">{searchQuery ? '没有找到匹配的项目' : '暂无项目'}</p>
            <p className="text-xs mt-1">点击上方按钮创建新项目</p>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div
              key={project.id}
              onClick={() => onLoadProject(project.id)}
              onContextMenu={(e) => handleContextMenu(e, project.id)}
              className={`group relative p-3 rounded-lg border cursor-pointer transition-all ${
                currentProjectId === project.id
                  ? 'bg-blue-900/30 border-blue-500'
                  : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
              }`}
            >
              {/* Project Name */}
              {editingProjectId === project.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editingProjectName}
                    onChange={(e) => setEditingProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameProject(project.id, editingProjectName);
                      if (e.key === 'Escape') setEditingProjectId(null);
                    }}
                    className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameProject(project.id, editingProjectName);
                    }}
                    className="p-1 text-green-400 hover:bg-slate-700 rounded"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingProjectId(null);
                    }}
                    className="p-1 text-slate-400 hover:bg-slate-700 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`font-medium text-sm truncate ${
                      currentProjectId === project.id ? 'text-blue-300' : 'text-slate-200'
                    }`}>
                      {project.name}
                    </span>
                    <button
                      onClick={(e) => handleContextMenu(e, project.id)}
                      className="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                    <Clock size={10} />
                    <span>{formatDate(project.updatedAt)}</span>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {pendingDeleteProjectId && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-dialog-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !isDeletingProject) setPendingDeleteProjectId(null);
            }}
            className="w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 p-5 text-white shadow-2xl"
          >
            <h2 id="delete-project-dialog-title" className="text-lg font-bold">删除项目？</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              将永久删除“{projects.find((project) => project.id === pendingDeleteProjectId)?.name ?? '未命名项目'}”及其项目文件。此操作不可撤销。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDeleteProjectId(null)}
                disabled={isDeletingProject}
                autoFocus
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteProject()}
                disabled={isDeletingProject}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {isDeletingProject ? '正在删除…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.show && contextMenu.projectId && (
        <div
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 50000 }}
          className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1 min-w-[160px]"
        >
          <button
            onClick={() => {
              const project = projects.find(p => p.id === contextMenu.projectId);
              if (project) {
                setEditingProjectId(project.id);
                setEditingProjectName(project.name);
              }
              setContextMenu({ show: false, x: 0, y: 0, projectId: null });
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
          >
            <Edit2 size={12} /> 重命名
          </button>
          <button
            onClick={() => {
              if (contextMenu.projectId) handleDuplicateProject(contextMenu.projectId);
              setContextMenu({ show: false, x: 0, y: 0, projectId: null });
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
          >
            <Copy size={12} /> 复制项目
          </button>
          <button
            onClick={() => {
              if (contextMenu.projectId) handleOpenInExplorer(contextMenu.projectId);
              setContextMenu({ show: false, x: 0, y: 0, projectId: null });
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
          >
            <ExternalLink size={12} /> 在文件夹中显示
          </button>
          <div className="h-px bg-slate-700 my-1"></div>
          <button
            onClick={() => {
              if (contextMenu.projectId) handleDeleteProject(contextMenu.projectId);
              setContextMenu({ show: false, x: 0, y: 0, projectId: null });
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-slate-700 flex items-center gap-2"
          >
            <Trash2 size={12} /> 删除项目
          </button>
        </div>
      )}
    </div>
  );
};
