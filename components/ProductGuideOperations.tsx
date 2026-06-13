import React from 'react';
import { Command, Copy, Lightbulb, Move } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const operationGroups = [
  {
    icon: Command,
    title: '通用操作与快捷键',
    description: '控制播放、保存与编辑历史。',
    items: [
      ['播放 / 暂停', 'Space'],
      ['保存当前项目', 'Ctrl / Cmd + S'],
      ['撤销', 'Ctrl / Cmd + Z'],
      ['重做', 'Ctrl / Cmd + Y'],
      ['另一种重做方式', 'Ctrl / Cmd + Shift + Z'],
      ['打开快捷帮助', 'F1 或 Ctrl + /'],
    ],
  },
  {
    icon: Move,
    title: '舞台编辑',
    description: '选择、移动和组织演员与道具。',
    items: [
      ['多选演员或道具', 'Ctrl / Cmd + 单击'],
      ['框选多个对象', '拖拽空白区域'],
      ['复制选中对象', 'Ctrl / Cmd + C'],
      ['粘贴演员或道具', 'Ctrl / Cmd + V'],
      ['从当前队形移除选中对象', 'Delete / Backspace'],
      ['缩放 2D 舞台', '滚轮'],
      ['平移 2D 舞台', 'Ctrl + 右键拖拽'],
      ['调整网格密度', 'Ctrl + 滚轮'],
    ],
  },
  {
    icon: Copy,
    title: '时间轴与队形',
    description: '控制关键队形的位置、时长与节奏。',
    items: [
      ['定位播放时间', '拖拽时间轴'],
      ['添加新队形', '时间轴工具栏“添加”'],
      ['选择队形', '单击队形片段'],
      ['调整开始时间', '拖拽队形片段'],
      ['调整队形时长', '拖拽片段右侧把手'],
      ['复制 / 粘贴当前队形', '未选中对象时 Ctrl / Cmd + C / V'],
      ['重命名队形', '双击名称，Enter 确认'],
      ['删除队形', '未选中对象时按 Delete'],
    ],
  },
  {
    icon: Lightbulb,
    title: '预览与导出提示',
    description: '在交付前检查方向、转场与输出设置。',
    items: [
      ['切换舞台视图', '顶栏 2D / 3D 按钮'],
      ['设置导出范围', '时间轴入点 / 出点'],
      ['导出分辨率', '1080p / 2K / 4K'],
      ['导出内容', '可同时生成 2D 与 3D 视频'],
      ['确认舞台方向', '以“舞台前沿”指示条为准'],
      ['检查空白过渡', '空白区会平滑插值队形位置'],
    ],
  },
];

export const ProductGuideOperations: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const mutedClass = isDark ? 'text-slate-400' : 'text-slate-600';
  const lineClass = isDark ? 'border-slate-800' : 'border-slate-200';

  return (
    <section id="operations" className={`scroll-mt-16 border-t ${lineClass} ${isDark ? 'bg-slate-900/35' : 'bg-white/65'}`}>
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-blue-500">详细操作</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            常用操作，一页查清。
          </h2>
          <p className={`mt-5 max-w-xl leading-7 ${mutedClass}`}>
            以下内容整合自快捷帮助。使用过程中可随时按 F1 打开精简版提示。
          </p>
        </div>

        <div className={`mt-14 grid border-t lg:grid-cols-2 ${lineClass}`}>
          {operationGroups.map(({ icon: Icon, title, description, items }, groupIndex) => (
            <article
              key={title}
              className={`border-b px-0 py-8 sm:px-7 lg:px-9 ${lineClass} ${groupIndex % 2 === 0 ? 'lg:border-r' : ''}`}
            >
              <div className="flex items-start gap-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-blue-500 ${lineClass}`}>
                  <Icon size={21} strokeWidth={1.7} />
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{title}</h3>
                  <p className={`mt-1 text-sm ${mutedClass}`}>{description}</p>
                </div>
              </div>

              <dl className={`mt-7 divide-y ${lineClass}`}>
                {items.map(([action, shortcut]) => (
                  <div key={action} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <dt className={`text-sm ${mutedClass}`}>{action}</dt>
                    <dd>
                      <kbd className={`inline-flex rounded-md border px-2.5 py-1 font-mono text-xs ${lineClass} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                        {shortcut}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
