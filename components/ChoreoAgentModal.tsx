import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileAudio,
  Image,
  LoaderCircle,
  Music2,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import { AIChoreoPlan, AIConfig, ChoreoAgentSession, ChoreoPropDimensions } from '../types';
import {
  createMultimodalChoreoSession,
  getMultimodalChoreoSession,
  resumeMultimodalChoreoSession,
  runMultimodalChoreoSession,
} from '../services/choreoAgentService';

interface ChoreoAgentModalProps {
  isOpen: boolean;
  aiConfig: AIConfig;
  onClose: () => void;
  onApplyPlan: (plan: AIChoreoPlan) => void;
}

type ElementRole = 'actor' | 'prop';

const PHASES = [
  { key: 'assets_ingested', label: '素材上传', detail: '校验并截取音乐片段' },
  { key: 'audio_analyzed', label: '音频解析', detail: '节奏、情绪与换形点' },
  { key: 'sketch_analyzed', label: '图片解析', detail: '形状、方向与空间关系' },
  { key: 'initial_proposal_ready', label: '意图分析', detail: '生成初步编舞方案' },
  { key: 'design_summary_ready', label: '方案完善', detail: '结合你的引导调整设计' },
  { key: 'final_structure_ready', label: '结构生成', detail: '生成可应用关键队形' },
] as const;

const PHASE_ORDER: Record<string, number> = {
  created: -1,
  assets_ingested: 0,
  audio_analyzed: 1,
  sketch_analyzed: 2,
  initial_proposal_ready: 3,
  initial_approved: 3,
  design_refined: 4,
  design_summary_ready: 4,
  final_reviewed: 4,
  final_revision_requested: 4,
  final_structure_ready: 5,
  draft_ready: 5,
  completed: 6,
};

const formatTime = (milliseconds: number) => {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const ChoreoAgentModal: React.FC<ChoreoAgentModalProps> = ({
  isOpen,
  aiConfig,
  onClose,
  onApplyPlan,
}) => {
  const [prompt, setPrompt] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [sketch, setSketch] = useState<File | null>(null);
  const [useRange, setUseRange] = useState(true);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(30);
  const [session, setSession] = useState<ChoreoAgentSession | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [roles, setRoles] = useState<Record<string, ElementRole>>({});
  const [propDimensions, setPropDimensions] = useState<Record<string, ChoreoPropDimensions>>({});
  const [orientation, setOrientation] = useState<'top_is_back' | 'bottom_is_back' | 'left_is_back' | 'right_is_back'>('top_is_back');
  const audioInputRef = useRef<HTMLInputElement>(null);
  const sketchInputRef = useRef<HTMLInputElement>(null);

  const sketchPreview = useMemo(
    () => (sketch ? URL.createObjectURL(sketch) : null),
    [sketch],
  );

  useEffect(() => () => {
    if (sketchPreview) URL.revokeObjectURL(sketchPreview);
  }, [sketchPreview]);

  useEffect(() => {
    if (!session?.sketchAnalysis?.elements.length) return;
    setRoles(Object.fromEntries(session.sketchAnalysis.elements.map((element) => [
      element.id,
      element.possibleRole === 'prop'
        || element.shape === 'rectangle'
        || element.shape === 'square'
        ? 'prop'
        : 'actor',
    ])));
    setPropDimensions(Object.fromEntries(
      session.sketchAnalysis.elements.map((element) => [
        element.id,
        { width: 1, depth: 0.3, height: 2 },
      ]),
    ));
    if (session.sketchAnalysis.stageOrientation !== 'unknown') {
      setOrientation(session.sketchAnalysis.stageOrientation);
    }
  }, [session?.sketchAnalysis]);

  const reset = () => {
    setPrompt('');
    setAudio(null);
    setSketch(null);
    setSession(null);
    setError(null);
    setFeedback('');
    setRoles({});
    setPropDimensions({});
    setIsRunning(false);
  };

  const close = () => {
    if (isRunning) return;
    onClose();
  };

  const executeWithPolling = async (
    sessionId: string,
    execute: () => Promise<ChoreoAgentSession>,
  ) => {
    setIsRunning(true);
    setError(null);
    const timer = window.setInterval(async () => {
      try {
        setSession(await getMultimodalChoreoSession(sessionId, aiConfig));
      } catch {
        // The foreground request owns error reporting.
      }
    }, 700);
    try {
      const result = await execute();
      setSession(result);
      setFeedback('');
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent 执行失败，请重试。');
      throw cause;
    } finally {
      window.clearInterval(timer);
      setIsRunning(false);
    }
  };

  const start = async () => {
    if (!prompt.trim() || !audio || !sketch) return;
    if (useRange && endSeconds <= startSeconds) {
      setError('结束时间必须晚于开始时间。');
      return;
    }
    setIsRunning(true);
    setError(null);
    try {
      const created = await createMultimodalChoreoSession({
        prompt: prompt.trim(),
        audio,
        sketch,
        segmentStartMs: useRange ? startSeconds * 1000 : 0,
        segmentEndMs: useRange ? endSeconds * 1000 : 30000,
      }, aiConfig);
      setSession(created);
      await executeWithPolling(
        created.id,
        () => runMultimodalChoreoSession(created.id, aiConfig),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法启动 Agent。');
      setIsRunning(false);
    }
  };

  const submitMapping = async () => {
    if (!session?.sketchAnalysis) return;
    const actorElementIds = Object.entries(roles).filter(([, role]) => role === 'actor').map(([id]) => id);
    const propElementIds = Object.entries(roles).filter(([, role]) => role === 'prop').map(([id]) => id);
    await executeWithPolling(
      session.id,
      () => resumeMultimodalChoreoSession(session.id, {
        action: 'edit',
        feedback,
        mapping: {
          actorElementIds,
          propElementIds,
          propDimensions: Object.fromEntries(
            propElementIds.map((id) => [
              id,
              propDimensions[id] || { width: 1, depth: 0.3, height: 2 },
            ]),
          ),
          stageOrientation: orientation,
        },
      }, aiConfig),
    ).catch(() => undefined);
  };

  const submitFinalDecision = async (action: 'approve' | 'edit') => {
    if (!session) return;
    if (action === 'edit' && !feedback.trim()) {
      setError('请填写希望 Agent 调整的内容。');
      return;
    }
    await executeWithPolling(
      session.id,
      () => resumeMultimodalChoreoSession(session.id, { action, feedback }, aiConfig),
    ).catch(() => undefined);
  };

  const applyDraft = () => {
    if (!session?.draft) return;
    onApplyPlan(session.draft.plan);
    reset();
    onClose();
  };

  if (!isOpen) return null;

  const isInitialReview = session?.interrupt?.type === 'initial_approval';
  const isFinalReview = session?.interrupt?.type === 'final_approval';
  const isCompleted = session?.status === 'completed' && session.draft;
  const currentPhase = PHASE_ORDER[session?.phase || 'created'] ?? -1;

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="flex h-[min(820px,calc(100dvh-32px))] w-[min(1180px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-5">
          <div className="flex items-center gap-3">
            {isCompleted && !isRunning && (
              <button
                onClick={reset}
                className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                title="开始新任务"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-300">
              <WandSparkles size={19} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">智能队形编排 Agent</h2>
              <p className="text-xs text-slate-500">音乐节奏、草图空间与创作意图协同分析</p>
            </div>
          </div>
          <button
            onClick={close}
            disabled={isRunning}
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title={isRunning ? '任务运行中' : '关闭'}
          >
            <X size={19} />
          </button>
        </header>

        {!session ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] max-lg:grid-cols-1">
            <main className="overflow-y-auto p-6">
              <div className="mx-auto max-w-2xl space-y-6">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">你希望设计怎样的队形？</label>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="min-h-32 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-500"
                    placeholder="例如：开场保持克制和疏离，中段跟随节奏向两侧展开，最后围绕中央门板形成聚合队形。"
                  />
                  <div className="mt-2 text-right text-[11px] text-slate-600">{prompt.length} 字</div>
                </div>

                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    className="group flex min-h-32 flex-col justify-between rounded-md border border-dashed border-slate-700 bg-slate-950/60 p-4 text-left transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/5"
                  >
                    <div className="flex items-center justify-between">
                      <FileAudio size={22} className="text-cyan-400" />
                      <Upload size={16} className="text-slate-600 group-hover:text-cyan-400" />
                    </div>
                    <div>
                      <div className="truncate text-sm font-medium text-slate-200">{audio?.name || '选择音乐文件'}</div>
                      <div className="mt-1 text-xs text-slate-500">{audio ? formatSize(audio.size) : 'MP3、M4A、WAV 等音频格式'}</div>
                    </div>
                  </button>
                  <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => setAudio(event.target.files?.[0] || null)} />

                  <button
                    type="button"
                    onClick={() => sketchInputRef.current?.click()}
                    className="group relative flex min-h-32 flex-col justify-between overflow-hidden rounded-md border border-dashed border-slate-700 bg-slate-950/60 p-4 text-left transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/5"
                  >
                    {sketchPreview && <img src={sketchPreview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />}
                    <div className="relative flex items-center justify-between">
                      <Image size={22} className="text-cyan-400" />
                      <Upload size={16} className="text-slate-600 group-hover:text-cyan-400" />
                    </div>
                    <div className="relative">
                      <div className="truncate text-sm font-medium text-slate-200">{sketch?.name || '选择队形草图'}</div>
                      <div className="mt-1 text-xs text-slate-500">{sketch ? formatSize(sketch.size) : '最多一张 JPG、PNG 或 WebP'}</div>
                    </div>
                  </button>
                  <input ref={sketchInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setSketch(event.target.files?.[0] || null)} />
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-4">
                  <label className="flex cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium text-slate-200">指定音乐分析范围</span>
                      <span className="mt-1 block text-xs text-slate-500">关闭时默认分析音乐前 30 秒</span>
                    </span>
                    <input type="checkbox" checked={useRange} onChange={(event) => setUseRange(event.target.checked)} className="h-4 w-4 accent-cyan-500" />
                  </label>
                  {useRange && (
                    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                      <label className="space-y-2">
                        <span className="text-xs text-slate-500">开始时间（秒）</span>
                        <input type="number" min={0} value={startSeconds} onChange={(event) => setStartSeconds(Math.max(0, Number(event.target.value)))} className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500" />
                      </label>
                      <ChevronRight size={16} className="mb-2.5 text-slate-600" />
                      <label className="space-y-2">
                        <span className="text-xs text-slate-500">结束时间（秒）</span>
                        <input type="number" min={1} value={endSeconds} onChange={(event) => setEndSeconds(Math.max(1, Number(event.target.value)))} className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500" />
                      </label>
                    </div>
                  )}
                </div>

                {error && <ErrorBanner message={error} />}
                <button
                  onClick={start}
                  disabled={isRunning || !prompt.trim() || !audio || !sketch}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600 lg:hidden"
                >
                  {isRunning ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}
                  开始设计
                </button>
              </div>
            </main>
            <aside className="flex flex-col justify-between border-l border-slate-800 bg-slate-950/40 p-6 max-lg:hidden">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Agent 将如何工作</p>
                <div className="mt-5 space-y-5">
                  {[
                    ['01', '理解素材', '解析音乐节奏、情绪和草图空间关系'],
                    ['02', '提出方案', '给出关键队形与换形时机'],
                    ['03', '与你确认', '遇到语义歧义时暂停并请求引导'],
                    ['04', '生成草稿', '确认总结后创建独立编排结构'],
                  ].map(([index, title, detail]) => (
                    <div key={index} className="flex gap-3">
                      <span className="font-mono text-xs text-cyan-500">{index}</span>
                      <div>
                        <div className="text-sm text-slate-300">{title}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-600">{detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={start}
                disabled={isRunning || !prompt.trim() || !audio || !sketch}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
              >
                {isRunning ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}
                开始设计
              </button>
            </aside>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[290px_minmax(0,1fr)] max-md:grid-cols-1">
            <aside className="overflow-y-auto border-r border-slate-800 bg-slate-950/35 p-5 max-md:hidden">
              <div className="mb-5 flex items-center gap-2 text-xs text-slate-500">
                {isRunning ? <LoaderCircle size={14} className="animate-spin text-cyan-400" /> : <Clock3 size={14} />}
                {isRunning ? 'Agent 正在工作' : isCompleted ? '设计已完成' : '等待你的确认'}
              </div>
              <div className="space-y-1">
                {PHASES.map((phase, index) => {
                  const done = currentPhase > index || session.status === 'completed';
                  const active = currentPhase === index && isRunning;
                  return (
                    <div key={phase.key} className={`flex gap-3 rounded-md px-3 py-3 ${active ? 'bg-cyan-500/8' : ''}`}>
                      <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? 'border-cyan-500 bg-cyan-500 text-slate-950' : active ? 'border-cyan-400 text-cyan-300' : 'border-slate-700 text-slate-600'}`}>
                        {done ? <Check size={12} strokeWidth={3} /> : active ? <LoaderCircle size={12} className="animate-spin" /> : <span className="text-[9px]">{index + 1}</span>}
                      </div>
                      <div>
                        <div className={`text-xs font-medium ${done || active ? 'text-slate-200' : 'text-slate-600'}`}>{phase.label}</div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-600">{phase.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {session.audioAnalysis && (
                <div className="mt-6 border-t border-slate-800 pt-5">
                  <div className="flex items-center gap-2 text-xs text-slate-500"><Music2 size={14} /> 音乐摘要</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Metric label="BPM" value={String(Math.round(session.audioAnalysis.estimatedBpm))} />
                    <Metric label="换形点" value={String(session.audioAnalysis.formationChangeCandidates.length)} />
                  </div>
                </div>
              )}
            </aside>

            <main className="min-h-0 overflow-y-auto p-6">
              <div className="mx-auto max-w-3xl">
                {isRunning && !isInitialReview && !isFinalReview && !isCompleted && (
                  <RunningPanel phase={session.phase} />
                )}

                {isInitialReview && session.initialProposal && session.sketchAnalysis && (
                  <div className="space-y-5">
                    <SectionHeading eyebrow="需要你的判断" title="确认草图语义与初步方案" description={session.interrupt?.message || ''} />
                    <div className="rounded-md border border-slate-700 bg-slate-950/45 p-4">
                      <div className="text-sm leading-6 text-slate-300">{session.initialProposal.summary}</div>
                      <div className="mt-4 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                        {session.initialProposal.formations.map((formation) => (
                          <div key={formation.id} className="border-l-2 border-cyan-500/60 pl-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-slate-200">{formation.name}</span>
                              <span className="font-mono text-[11px] text-cyan-400">{formatTime(formation.timeMs)}</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{formation.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-end justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-medium text-slate-200">草图元素映射</h3>
                          <p className="mt-1 text-xs text-slate-500">逐项确认是演员还是道具，避免错误生成。</p>
                        </div>
                        <span className="text-xs text-slate-600">{session.sketchAnalysis.elements.length} 个元素</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                        {session.sketchAnalysis.elements.map((element) => (
                          <div key={element.id} className="rounded-md border border-slate-800 bg-slate-950/45 px-3 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-slate-300">{element.label || element.id}</div>
                                <div className="mt-1 text-[10px] text-slate-600">{element.shape} · 置信度 {Math.round(element.confidence * 100)}%</div>
                              </div>
                              <div className="flex rounded-md border border-slate-700 bg-slate-900 p-0.5">
                                {(['actor', 'prop'] as ElementRole[]).map((role) => (
                                  <button key={role} onClick={() => setRoles((current) => ({ ...current, [element.id]: role }))} className={`rounded px-2 py-1 text-[11px] ${roles[element.id] === role ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 hover:text-slate-200'}`}>
                                    {role === 'actor' ? '演员' : '道具'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {roles[element.id] === 'prop' && (
                              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
                                {[
                                  ['width', '长', 'X 轴'],
                                  ['depth', '宽', 'Y 轴'],
                                  ['height', '高', '立面'],
                                ].map(([key, label, hint]) => (
                                  <label key={key} className="block">
                                    <span className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                                      <span>{label}（m）</span>
                                      <span className="text-slate-700">{hint}</span>
                                    </span>
                                    <input
                                      type="number"
                                      min={0.05}
                                      max={20}
                                      step={0.05}
                                      value={propDimensions[element.id]?.[key as keyof ChoreoPropDimensions] ?? 1}
                                      onChange={(event) => {
                                        const value = Math.min(20, Math.max(0.05, Number(event.target.value) || 0.05));
                                        setPropDimensions((current) => ({
                                          ...current,
                                          [element.id]: {
                                            ...(current[element.id] || { width: 1, depth: 0.3, height: 2 }),
                                            [key]: value,
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
                                    />
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-medium text-slate-300">舞台方向</label>
                      <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
                        {[
                          ['top_is_back', '上方为后'],
                          ['bottom_is_back', '下方为后'],
                          ['left_is_back', '左侧为后'],
                          ['right_is_back', '右侧为后'],
                        ].map(([value, label]) => (
                          <button key={value} onClick={() => setOrientation(value as typeof orientation)} className={`rounded-md border px-3 py-2 text-xs ${orientation === value ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <FeedbackInput value={feedback} onChange={setFeedback} placeholder="补充你的偏好，例如：门板保持不动，演员移动需要更克制。" />
                    {error && <ErrorBanner message={error} />}
                    <div className="flex justify-end">
                      <button onClick={submitMapping} disabled={isRunning} className="flex items-center gap-2 rounded-md bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
                        确认并完善方案 <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {isFinalReview && session.designSummary && (
                  <div className="space-y-5">
                    <SectionHeading eyebrow="最终确认" title="设计总结已经准备好" description={session.interrupt?.message || ''} />
                    <div className="rounded-md border border-slate-700 bg-slate-950/45 p-5">
                      <p className="text-sm leading-7 text-slate-300">{session.designSummary.summary}</p>
                      <div className="mt-5 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                        <Rationale icon={<Music2 size={15} />} title="音乐依据" text={session.designSummary.musicRationale} />
                        <Rationale icon={<Image size={15} />} title="草图依据" text={session.designSummary.sketchRationale} />
                      </div>
                      <div className="mt-5 border-t border-slate-800 pt-4">
                        <div className="text-xs font-medium text-slate-400">队形序列</div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {session.designSummary.formationSequence.map((name, index) => (
                            <React.Fragment key={`${name}-${index}`}>
                              {index > 0 && <ChevronRight size={13} className="text-slate-700" />}
                              <span className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">{name}</span>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                    <FeedbackInput value={feedback} onChange={setFeedback} placeholder="仍需调整时，在这里告诉 Agent。直接批准则无需填写。" />
                    {error && <ErrorBanner message={error} />}
                    <div className="flex justify-end gap-3">
                      <button onClick={() => submitFinalDecision('edit')} disabled={isRunning} className="rounded-md border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50">继续调整</button>
                      <button onClick={() => submitFinalDecision('approve')} disabled={isRunning} className="flex items-center gap-2 rounded-md bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
                        批准并生成结构 <Sparkles size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {isCompleted && session.draft && (
                  <div className="space-y-6">
                    <SectionHeading eyebrow="编排草稿" title="队形设计完成" description="结构已经通过范围、坐标和演员/道具映射校验，应用后才会写入当前项目。" />
                    <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-5">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 size={22} className="mt-0.5 text-cyan-400" />
                        <div>
                          <div className="text-sm font-medium text-white">{session.draft.plan.summary}</div>
                          <div className="mt-4 grid grid-cols-3 gap-3">
                            <Metric label="演员与道具" value={String(session.draft.validation.entityCount)} />
                            <Metric label="关键队形" value={String(session.draft.validation.frameCount)} />
                            <Metric label="音乐范围" value={`${formatTime(session.draft.validation.segmentStartMs)}–${formatTime(session.draft.validation.segmentEndMs)}`} />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="mb-3 text-xs font-medium text-slate-400">关键队形</div>
                      <div className="divide-y divide-slate-800 rounded-md border border-slate-800">
                        {session.draft.plan.framesToCreate.map((frame, index) => (
                          <div key={frame.tempId} className="flex items-center justify-between gap-4 px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-cyan-500">{String(index + 1).padStart(2, '0')}</span>
                              <div>
                                <div className="text-sm text-slate-300">{frame.name}</div>
                                {frame.notes && <div className="mt-1 text-xs text-slate-600">{frame.notes}</div>}
                              </div>
                            </div>
                            <span className="font-mono text-xs text-slate-500">{formatTime(frame.startTime)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-3">
                      <button onClick={reset} className="rounded-md border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800">重新设计</button>
                      <button onClick={applyDraft} className="flex items-center gap-2 rounded-md bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                        应用到当前项目 <Check size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {error && !isInitialReview && !isFinalReview && <ErrorBanner message={error} />}
              </div>
            </main>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

const SectionHeading = ({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) => (
  <div>
    <div className="text-xs font-semibold uppercase text-cyan-400">{eyebrow}</div>
    <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
  </div>
);

const RunningPanel = ({ phase }: { phase: string }) => {
  const nextStep: Record<string, { label: string; detail: string }> = {
    created: { label: '素材上传', detail: '校验文件并截取指定音乐片段' },
    assets_ingested: { label: '音频解析', detail: '分析节奏、情绪、动态与候选换形点' },
    audio_analyzed: { label: '图片解析', detail: '识别草图形状、空间关系和舞台方向' },
    sketch_analyzed: { label: '意图分析', detail: '结合你的要求生成初步编舞方案' },
    initial_approved: { label: '方案完善', detail: '根据演员、道具和舞台方向映射调整设计' },
    design_refined: { label: '设计总结', detail: '整理音乐依据、草图依据与队形序列' },
    final_revision_requested: { label: '方案调整', detail: '根据你的反馈重新完善编舞方案' },
    final_reviewed: { label: '结构生成', detail: '生成可应用的演员、道具和关键队形数据' },
    final_structure_ready: { label: '结构校验', detail: '检查时间范围、坐标与实体映射完整性' },
  };
  const active = nextStep[phase] || { label: 'Agent 处理中', detail: '正在推进当前编舞设计任务' };
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/5">
        <LoaderCircle size={32} className="animate-spin text-cyan-400" />
        <div className="absolute inset-2 rounded-full border border-slate-800" />
      </div>
      <div className="mt-6 text-lg font-medium text-white">{active.label}中...</div>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{active.detail}，完成后会自动进入下一阶段。</p>
    </div>
  );
};

const FeedbackInput = ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => (
  <label className="block">
    <span className="mb-2 block text-xs font-medium text-slate-300">补充说明</span>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-500" />
  </label>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
    <div className="text-[10px] uppercase text-slate-600">{label}</div>
    <div className="mt-1 text-sm font-medium text-slate-200">{value}</div>
  </div>
);

const Rationale = ({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) => (
  <div>
    <div className="flex items-center gap-2 text-xs font-medium text-slate-400">{icon}{title}</div>
    <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
  </div>
);

const ErrorBanner = ({ message }: { message: string }) => (
  <div className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-xs leading-5 text-red-300">
    <AlertCircle size={15} className="mt-0.5 shrink-0" />
    {message}
  </div>
);
