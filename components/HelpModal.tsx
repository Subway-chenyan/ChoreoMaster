import React from 'react';
import { X, Command, MousePointer2, Copy, Type, Move } from 'lucide-react';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 w-[calc(100%-1rem)] sm:w-full max-w-2xl max-h-[85vh] sm:max-h-[80vh] rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col mx-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                    <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Command className="text-blue-500" size={18} />
                        操作指南 & 快捷键
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors p-1 -mr-1">
                        <X size={22} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 text-slate-600 dark:text-slate-300 text-sm">

                    {/* Section 1: 通用与快捷键 */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <MousePointer2 size={16} /> 通用操作
                        </h3>
                        <ul className="space-y-2">
                            <li className="flex justify-between">
                                <span>播放 / 暂停</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Space</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>保存项目（桌面端）</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + S</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>撤销</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + Z</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>重做</span>
                                <div className="flex gap-1">
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + Y</kbd>
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + Shift + Z</kbd>
                                </div>
                            </li>
                            <li className="flex justify-between">
                                <span>打开帮助</span>
                                <div className="flex gap-1">
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">F1</kbd>
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + /</kbd>
                                </div>
                            </li>
                        </ul>
                    </div>

                    {/* Section 2: 舞台编辑 */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <Move size={16} /> 舞台编辑
                        </h3>
                        <ul className="space-y-2">
                            <li className="flex justify-between">
                                <span>多选演员/道具</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + Click</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>框选演员/道具</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Drag</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>复制选中演员/道具</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + C</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>粘贴演员/道具</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + V</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>删除选中演员/道具（仅当前队形）</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Delete / Backspace</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>缩放 2D 舞台</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">滚轮</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>平移 2D 舞台</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + 右键拖拽</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>调整网格密度</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + 滚轮</kbd>
                            </li>
                        </ul>
                    </div>

                    {/* Section 3: 时间轴与队形 */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <Copy size={16} /> 时间轴 & 队形
                        </h3>
                        <ul className="space-y-2">
                            <li className="flex justify-between">
                                <span>划擦定位</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">拖拽时间轴</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>添加队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">工具栏按钮</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>选择队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">单击帧块</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>拖动队形位置 / 调整时长</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">拖拽帧块 / 右侧把手</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>复制当前队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + C（未选中演员）</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>粘贴队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl/⌘ + V（未选中演员）</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>重命名队形</span>
                                <div className="flex gap-1">
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">双击</kbd>
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Enter/Esc</kbd>
                                </div>
                            </li>
                            <li className="flex justify-between">
                                <span>删除队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Delete（未选中演员）</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>导出视频</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">导出设置面板</kbd>
                            </li>
                        </ul>
                    </div>

                    {/* Section 4: 导出与提示 */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <Type size={16} /> 小贴士
                        </h3>
                        <ul className="space-y-2 list-disc pl-4 text-xs leading-relaxed">
                            <li>导出支持 2D/3D，可选 1080p/2K/4K，导出时显示进度。</li>
                            <li>舞台底部“舞台前沿”指示条用于标记前沿方向。</li>
                            <li>时间轴的空白过渡区间会进行平滑插值，便于观察队形变换。</li>
                        </ul>
                    </div>

                </div>

                {/* Footer */}
                <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-center">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
                    >
                        明白了
                    </button>
                </div>
            </div>
        </div>
    );
};
