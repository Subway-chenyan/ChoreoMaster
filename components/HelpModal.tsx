import React from 'react';
import { X, Command, MousePointer2, Copy, Type, Move } from 'lucide-react';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Command className="text-blue-500" size={20} />
                        操作指南 & 快捷键
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 grid grid-cols-2 gap-8 text-slate-600 dark:text-slate-300 text-sm">

                    {/* Section 1: General */}
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
                                <span>撤销 (Undo)</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + Z</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>重做 (Redo)</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + Shift + Z</kbd>
                            </li>
                        </ul>
                    </div>

                    {/* Section 2: Stage */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <Move size={16} /> 舞台编辑
                        </h3>
                        <ul className="space-y-2">
                            <li className="flex justify-between">
                                <span>多选演员</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + Click</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>框选演员</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Drag</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>复制选中演员</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + C</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>粘贴演员</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + V</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>舞台缩放</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + Wheel</kbd>
                            </li>
                        </ul>
                    </div>

                    {/* Section 3: Timeline */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <Copy size={16} /> 时间轴 & 队形
                        </h3>
                        <ul className="space-y-2">
                            <li className="flex justify-between">
                                <span>复制当前队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + C (选中队形)</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>粘贴队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Ctrl + V</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>重命名队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Double Click</kbd>
                            </li>
                            <li className="flex justify-between">
                                <span>删除队形</span>
                                <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 font-mono text-xs">Delete</kbd>
                            </li>
                        </ul>
                    </div>

                    {/* Section 4: Tips */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <Type size={16} /> 小贴士
                        </h3>
                        <ul className="space-y-2 list-disc pl-4 text-xs leading-relaxed">
                            <li>点击时间轴上的 <span className="text-blue-500 font-bold">GAP</span> 区域可以查看过渡动画。</li>
                            <li>在侧边栏可以直接修改演员的名字和颜色。</li>
                            <li>使用 <span className="text-purple-500 font-bold">AI 编舞</span> 功能可以快速生成复杂的队形。</li>
                            <li>拖动时间轴上的队形块可以调整开始时间和持续时间。</li>
                        </ul>
                    </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-center">
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
