import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Power,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import type { McpChangeSummary, McpStatus } from '../types';

interface McpSettingsPanelProps {
  projectId: string | null;
  // MCP 修改已实时应用后触发，用于刷新修改记录列表
  refreshToken?: number;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const TOOL_LABELS: Record<string, string> = {
  choreo_create_project: '新建项目',
  choreo_update_frames: '修改队形',
  choreo_update_entities: '修改演员/道具',
  choreo_update_groups: '修改分组',
  choreo_update_stage: '修改舞台',
  choreo_update_transition: '修改转场',
  choreo_apply_plan: '应用编排计划',
  ui_rollback: '界面回退',
  ui_undo: '界面撤销',
};

// 接入示例代码（可直接复制到 MCP 客户端配置）
const CLIENT_CONFIG_EXAMPLE = `{
  "mcpServers": {
    "cosstage": {
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}`;

const PROMPT_EXAMPLES = [
  '基于当前项目的演员，编一套从一字排开到圆形再到 V 字的队形',
  '把「开场」这一帧的演员改成三角形站位',
  '新增 2 个门板道具，放在舞台后方两侧',
];

export const McpSettingsPanel: React.FC<McpSettingsPanelProps> = ({ projectId, refreshToken }) => {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [changes, setChanges] = useState<McpChangeSummary[]>([]);
  const [toggling, setToggling] = useState(false);
  const [busyChangeId, setBusyChangeId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const api = typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? window.electronAPI.mcp
    : undefined;

  const refreshStatus = useCallback(async () => {
    if (!api) return;
    try {
      setStatus(await api.getStatus());
    } catch (error) {
      console.error('读取 MCP 状态失败:', error);
    }
  }, [api]);

  const refreshChanges = useCallback(async () => {
    if (!api) return;
    try {
      setChanges(await api.listChanges(projectId ?? undefined));
    } catch (error) {
      console.error('读取 MCP 修改记录失败:', error);
    }
  }, [api, projectId]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => { void refreshChanges(); }, [refreshChanges, refreshToken]);

  const handleToggle = async () => {
    if (!api || !status) return;
    setToggling(true);
    setMessage(null);
    try {
      const next = await api.setEnabled(!status.running);
      setStatus(next);
      if (next.error) setMessage(`启动失败：${next.error}`);
      else setMessage(next.running ? 'MCP 服务已开启' : 'MCP 服务已关闭');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setToggling(false);
    }
  };

  const handleRollback = async (changeId: string) => {
    if (!api) return;
    setBusyChangeId(changeId);
    setMessage(null);
    try {
      const result = await api.rollbackTo(changeId);
      setMessage(`已回退 ${result.undoneCount} 处修改（至「${result.description}」之前）`);
      await refreshChanges();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '回退失败');
    } finally {
      setBusyChangeId(null);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLIENT_CONFIG_EXAMPLE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage('复制失败，请手动选择文本复制');
    }
  };

  const running = status?.running ?? false;
  const url = status?.url ?? 'http://127.0.0.1:8765/mcp';
  const visibleChanges = useMemo(() => changes.slice(0, 20), [changes]);

  if (!api) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4">
        <div className="flex items-center gap-2 text-slate-400">
          <Bot size={14} />
          <span className="text-xs font-bold uppercase">MCP 服务</span>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          仅在桌面端应用中可用。当前为浏览器预览模式，MCP 服务不可用。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 开关卡片 */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400">
            <Bot size={14} />
            <span className="text-xs font-bold uppercase">MCP 服务</span>
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              running
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-slate-700/60 text-slate-400'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {running ? '运行中' : '已关闭'}
          </span>
        </div>

        <button
          onClick={handleToggle}
          disabled={toggling || !status}
          className={`flex w-full items-center justify-center gap-2 rounded-md py-2 text-xs font-bold transition-colors disabled:opacity-60 ${
            running
              ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
          }`}
        >
          {toggling ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
          {toggling ? '正在切换...' : running ? '关闭 MCP 服务' : '开启 MCP 服务'}
        </button>

        {running && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            <code className="flex-1 truncate font-mono text-[10px] text-cyan-300">{url}</code>
          </div>
        )}

        {message && (
          <div className="mt-2 rounded border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-[11px] leading-5 text-slate-300">
            {message}
          </div>
        )}

        <p className="mt-2.5 text-[10px] leading-4 text-slate-600">
          开启后，外部 AI 工具可通过 MCP 直接创建和修改本项目，修改会实时同步到舞台并记录在下方历史中。
        </p>
      </div>

      {/* 接入指南卡片 */}
      <div className="rounded-lg border border-cyan-500/20 bg-slate-900">
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-xs font-bold text-slate-200">
            {guideOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            如何接入 AI 工具
          </span>
          <span className="text-[10px] text-cyan-400">查看示例</span>
        </button>

        {guideOpen && (
          <div className="space-y-3 border-t border-slate-800 px-4 pb-4 pt-3">
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase text-slate-500">1. 复制配置到你的 MCP 客户端</div>
              <div className="relative">
                <pre className="overflow-x-auto rounded border border-slate-700/60 bg-slate-950 p-2.5 font-mono text-[10px] leading-4 text-slate-300">
{CLIENT_CONFIG_EXAMPLE}
                </pre>
                <button
                  onClick={handleCopy}
                  className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-slate-800 px-1.5 py-1 text-[9px] text-slate-300 hover:bg-slate-700"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-slate-600">
                支持 Claude Desktop / Cursor / Cline 等标准 MCP 客户端；不支持的客户端可用
                <code className="mx-1 rounded bg-slate-800 px-1 text-cyan-300">npx mcp-remote</code>
                桥接。
              </p>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase text-slate-500">2. 对 AI 说这些话</div>
              <ul className="space-y-1.5">
                {PROMPT_EXAMPLES.map((example) => (
                  <li key={example} className="flex gap-1.5 text-[11px] leading-5 text-slate-400">
                    <span className="text-cyan-500">·</span>
                    <span>{example}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2.5 py-2">
              <div className="text-[10px] font-bold uppercase text-slate-500">调试</div>
              <code className="mt-1 block font-mono text-[10px] text-slate-400">
                npx @modelcontextprotocol/inspector
              </code>
            </div>
          </div>
        )}
      </div>

      {/* 修改记录 + 回退 */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-xs font-bold text-slate-200">
            {historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            MCP 修改记录
          </span>
          <span className="text-[10px] text-slate-500">{changes.length} 条</span>
        </button>

        {historyOpen && (
          <div className="border-t border-slate-800 px-3 pb-3 pt-2">
            {!projectId && (
              <p className="px-1 py-2 text-[11px] text-slate-500">打开一个项目后可查看其 MCP 修改记录。</p>
            )}
            {projectId && visibleChanges.length === 0 && (
              <p className="px-1 py-2 text-[11px] text-slate-500">
                暂无 MCP 修改。开启服务并通过 AI 工具修改项目后，记录会出现在这里。
              </p>
            )}
            {visibleChanges.length > 0 && (
              <ul className="space-y-1">
                {visibleChanges.map((change, index) => (
                  <li
                    key={change.id}
                    className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-slate-700/40"
                  >
                    <span className="mt-0.5 font-mono text-[9px] text-slate-600">{formatTime(change.timestamp)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-slate-300">
                        <span className="mr-1 text-[9px] font-bold text-cyan-500">
                          {TOOL_LABELS[change.toolName] ?? change.toolName}
                        </span>
                        {change.description}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRollback(change.id)}
                      disabled={busyChangeId !== null}
                      title={index === 0 ? '回退这一处修改' : '回退到此处之前（含之后所有修改）'}
                      className="flex shrink-0 items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[9px] text-slate-400 hover:border-cyan-500/60 hover:text-cyan-400 disabled:opacity-50"
                    >
                      {busyChangeId === change.id ? <Loader2 size={9} className="animate-spin" /> : <Undo2 size={9} />}
                      回退
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {visibleChanges.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-slate-600">
                <RotateCcw size={10} />
                回退会恢复该修改之前的项目状态，并实时同步到舞台
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
