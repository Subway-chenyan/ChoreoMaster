import React, { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Clapperboard,
  Cuboid,
  Download,
  FolderKanban,
  Grid3X3,
  Layers3,
  Music2,
  Play,
  Sparkles,
  Users,
  WandSparkles,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { ProductGuideOperations } from './ProductGuideOperations';

interface ProductGuideProps {
  onClose: () => void;
}

const features = [
  {
    icon: Users,
    title: '演员与道具统一管理',
    description: '创建演员、舞台道具与分组，统一调整名称、颜色、造型、尺寸和显隐状态。',
  },
  {
    icon: Grid3X3,
    title: '可视化队形编排',
    description: '在舞台网格中拖拽、框选、多选和复制对象，快速完成每个关键队形。',
  },
  {
    icon: Layers3,
    title: '时间轴与平滑过渡',
    description: '按音乐节奏安排队形片段、时长与转场，实时预览演出运动轨迹。',
  },
  {
    icon: Cuboid,
    title: '2D 与 3D 双视图',
    description: '在平面编排与立体舞台之间切换，从导演、评审和空间关系等角度检查作品。',
  },
  {
    icon: WandSparkles,
    title: '预设与 AI 编舞',
    description: '调用常用几何队形，也可通过编舞 Agent 生成并应用结构化编排方案。',
  },
  {
    icon: Clapperboard,
    title: '专业视频输出',
    description: '设置入点、出点、画质与镜头，导出 1080p、2K 或 4K 的 2D/3D 演示视频。',
  },
];

const steps = [
  ['01', '建立项目', '从项目库新建作品，或导入项目包与历史工程。'],
  ['02', '准备舞台', '设置舞台宽深、侧台、LED 尺寸与背景内容，并导入音乐。'],
  ['03', '组织元素', '添加演员和道具，按角色、区域或功能建立分组。'],
  ['04', '编排队形', '添加关键队形，在舞台中排位，并在时间轴上调整节奏与转场。'],
  ['05', '预览交付', '切换 2D/3D 检查空间关系，设定输出区间后导出视频或项目包。'],
];

const stepIcons = [FolderKanban, Box, Users, Sparkles, Download];

const stageDots = [
  ['18%', '28%'],
  ['34%', '42%'],
  ['50%', '24%'],
  ['66%', '42%'],
  ['82%', '28%'],
  ['26%', '70%'],
  ['50%', '62%'],
  ['74%', '70%'],
];

export const ProductGuide: React.FC<ProductGuideProps> = ({ onClose }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const pageClass = isDark
    ? 'bg-slate-950 text-slate-100'
    : 'bg-slate-50 text-slate-950';
  const mutedClass = isDark ? 'text-slate-400' : 'text-slate-600';
  const lineClass = isDark ? 'border-slate-800' : 'border-slate-200';
  const panelClass = isDark
    ? 'border-slate-800 bg-slate-900/70'
    : 'border-slate-200 bg-white/80';
  const scrollToSection = (sectionId: string) => {
    const container = scrollContainerRef.current;
    const section = document.getElementById(sectionId);
    if (!container || !section) return;
    container.scrollTop = Math.max(0, section.offsetTop - 64);
  };

  return (
    <div ref={scrollContainerRef} className={`product-guide fixed inset-0 z-[50000] overflow-y-auto ${pageClass}`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur-xl ${lineClass} ${isDark ? 'bg-slate-950/88' : 'bg-slate-50/88'}`}>
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={onClose}
            className={`focus-ring flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}
          >
            <ArrowLeft size={17} />
            返回编辑器
          </button>
          <div className={`h-5 w-px ${isDark ? 'bg-slate-800' : 'bg-slate-300'}`} />
          <button
            type="button"
            onClick={() => scrollToSection('overview')}
            className="mr-auto text-sm font-semibold tracking-tight"
          >
            CosStage
          </button>
          <nav className="product-guide__nav flex items-center gap-1 overflow-x-auto text-sm">
            <button type="button" onClick={() => scrollToSection('overview')} className={`whitespace-nowrap rounded-lg px-3 py-2 transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}>
              产品介绍
            </button>
            <button type="button" onClick={() => scrollToSection('features')} className={`whitespace-nowrap rounded-lg px-3 py-2 transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}>
              功能速览
            </button>
            <button type="button" onClick={() => scrollToSection('guide')} className={`whitespace-nowrap rounded-lg px-3 py-2 transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}>
              使用说明
            </button>
            <button type="button" onClick={() => scrollToSection('operations')} className={`whitespace-nowrap rounded-lg px-3 py-2 transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}>
              详细操作
            </button>
            <button type="button" onClick={() => scrollToSection('terms')} className={`whitespace-nowrap rounded-lg px-3 py-2 transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}>
              权益声明
            </button>
          </nav>
        </div>
      </header>

      <main>
        <section id="overview" className="scroll-mt-20 overflow-hidden">
          <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-20">
            <div className="product-guide__reveal max-w-2xl">
              <p className="mb-5 text-sm font-semibold text-blue-500">从灵感到可交付舞台方案</p>
              <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
                让每一次走位，
                <span className="block text-blue-500">都清晰可见。</span>
              </h1>
              <p className={`mt-7 max-w-xl text-base leading-8 sm:text-lg ${mutedClass}`}>
                CosStage 将队形设计、时间编排、舞台预演与视频输出整合在同一个工作区，
                帮助编舞、导演与舞台团队更快达成共识。
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="focus-ring inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:translate-y-px"
                >
                  开始编排
                  <ArrowRight size={17} />
                </button>
                <a
                  href="https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe"
                  download="CosStage-Setup-x64.exe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`focus-ring inline-flex items-center gap-2 rounded-lg border px-5 py-3 text-sm font-semibold transition active:translate-y-px ${lineClass} ${isDark ? 'hover:bg-slate-900' : 'hover:bg-white'}`}
                >
                  <Download size={17} />
                  下载桌面端
                </a>
                <button
                  type="button"
                  onClick={() => scrollToSection('guide')}
                  className={`focus-ring inline-flex items-center gap-2 rounded-lg border px-5 py-3 text-sm font-semibold transition active:translate-y-px ${lineClass} ${isDark ? 'hover:bg-slate-900' : 'hover:bg-white'}`}
                >
                  查看使用流程
                </button>
              </div>
            </div>

            <div className="product-guide__reveal product-guide__reveal--delay relative mx-auto w-full max-w-2xl">
              <div className="absolute -inset-16 bg-blue-500/10 blur-3xl" />
              <div className={`relative overflow-hidden rounded-2xl border p-3 shadow-2xl ${panelClass} ${isDark ? 'shadow-black/40' : 'shadow-slate-300/60'}`}>
                <div className={`flex items-center justify-between border-b px-3 pb-3 text-xs ${lineClass} ${mutedClass}`}>
                  <span>主舞台 · 评审视角</span>
                  <span className="flex items-center gap-2"><Play size={13} /> 00:24 / 03:18</span>
                </div>
                <div className={`relative mt-3 aspect-[16/10] overflow-hidden rounded-xl border ${lineClass} ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
                  <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,#3b82f633_1px,transparent_1px),linear-gradient(to_bottom,#3b82f633_1px,transparent_1px)] [background-size:10%_10%]" />
                  <div className="absolute inset-x-[8%] top-[12%] h-px bg-blue-400/50" />
                  <div className="absolute inset-x-[8%] bottom-[12%] h-1 rounded-full bg-blue-500/70" />
                  {stageDots.map(([left, top], index) => (
                    <div
                      key={`${left}-${top}`}
                      className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-300 bg-blue-600 shadow-[0_0_24px_rgba(59,130,246,0.5)]"
                      style={{ left, top }}
                    >
                      <span className="flex h-full items-center justify-center text-[8px] font-bold text-white">{index + 1}</span>
                    </div>
                  ))}
                  <div className={`absolute bottom-6 left-6 rounded-lg border px-3 py-2 text-xs backdrop-blur ${panelClass}`}>
                    <span className="text-blue-500">队形 06</span>
                    <span className={`ml-2 ${mutedClass}`}>展开 · 8 人</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 text-xs">
                  {['关键队形', '平滑转场', '多视角预演'].map((label, index) => (
                    <div key={label} className={`rounded-lg border px-3 py-3 ${lineClass} ${isDark ? 'bg-slate-950/70' : 'bg-slate-50'}`}>
                      <span className="block text-lg font-semibold text-blue-500">{['12', '2.4s', '2D/3D'][index]}</span>
                      <span className={mutedClass}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className={`scroll-mt-16 border-y ${lineClass} ${isDark ? 'bg-slate-900/35' : 'bg-white/65'}`}>
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-blue-500">功能速览</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">围绕真实排练流程构建。</h2>
              <p className={`mt-5 max-w-xl leading-7 ${mutedClass}`}>
                从第一个站位到最终演示视频，每个环节都在同一份项目数据上连续完成。
              </p>
            </div>
            <div className={`mt-14 grid border-t md:grid-cols-2 lg:grid-cols-3 ${lineClass}`}>
              {features.map(({ icon: Icon, title, description }, index) => (
                <article
                  key={title}
                  className={`group border-b p-7 transition-colors lg:min-h-64 ${lineClass} ${index % 3 !== 2 ? 'lg:border-r' : ''} ${isDark ? 'hover:bg-slate-900' : 'hover:bg-slate-50'}`}
                >
                  <Icon className="text-blue-500 transition-transform group-hover:-translate-y-1" size={25} strokeWidth={1.7} />
                  <h3 className="mt-10 text-xl font-semibold tracking-tight">{title}</h3>
                  <p className={`mt-3 text-sm leading-7 ${mutedClass}`}>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="guide" className="scroll-mt-16">
          <div className="mx-auto grid max-w-7xl gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[0.7fr_1.3fr] lg:px-8">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-sm font-semibold text-blue-500">使用说明</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">五步完成一套编排。</h2>
              <p className={`mt-5 max-w-md leading-7 ${mutedClass}`}>
                先建立结构，再校准节奏，最后从多个视角检查。这样比一开始追求细节更高效。
              </p>
              <div className={`mt-8 rounded-xl border p-5 ${panelClass}`}>
                <Music2 className="text-blue-500" size={22} />
                <p className="mt-4 font-semibold">一个实用建议</p>
                <p className={`mt-2 text-sm leading-6 ${mutedClass}`}>
                  导入音乐后先标记主要段落，再创建关键队形。时间轴会帮助你把空间变化和音乐结构对齐。
                </p>
              </div>
            </div>

            <ol className={`border-t ${lineClass}`}>
              {steps.map(([number, title, description], index) => {
                const StepIcon = stepIcons[index];
                return (
                  <li key={number} className={`grid gap-5 border-b py-8 sm:grid-cols-[64px_1fr_auto] sm:items-center ${lineClass}`}>
                    <span className="font-mono text-sm text-blue-500">{number}</span>
                    <div>
                      <h3 className="text-xl font-semibold">{title}</h3>
                      <p className={`mt-2 text-sm leading-6 ${mutedClass}`}>{description}</p>
                    </div>
                    <StepIcon className="hidden text-blue-500 sm:block" size={24} strokeWidth={1.6} />
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <ProductGuideOperations />

        <section id="terms" className={`scroll-mt-16 border-t ${lineClass}`}>
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold text-blue-500">权益声明</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">使用与展示规范。</h2>
              <p className={`mt-5 leading-7 ${mutedClass}`}>
                为避免在录屏、直播或商业展示中因文字/素材不当导致误解，建议在使用前阅读并遵守以下要点。
              </p>
            </div>

            <div className={`mt-10 grid gap-6 lg:grid-cols-2`}>
              <div className={`rounded-2xl border p-7 ${panelClass}`}>
                <p className="text-lg font-semibold">允许商业展示（需标注来源）</p>
                <ul className={`mt-4 list-disc space-y-2 pl-5 text-sm leading-7 ${mutedClass}`}>
                  <li>允许在商业活动中录屏、直播、授课或展会演示使用 CosStage。</li>
                  <li>对外发布或公开展示相关视频/截图时，请以合理方式标注来源（例如注明“使用 CosStage”）。</li>
                </ul>
              </div>

              <div className={`rounded-2xl border p-7 ${panelClass}`}>
                <p className="text-lg font-semibold">禁止转卖与内容责任</p>
                <ul className={`mt-4 list-disc space-y-2 pl-5 text-sm leading-7 ${mutedClass}`}>
                  <li>禁止对 CosStage 软件本体（安装包、可执行文件、镜像等）进行转卖或售卖。</li>
                  <li>你对在软件中输入、导入、展示或导出的内容自行负责，并应确保合法合规且不侵权。</li>
                  <li>不得制作、传播违法违规内容，不得暗示 CosStage 官方对你的内容或活动进行背书。</li>
                </ul>
              </div>
            </div>

            <p className={`mt-8 text-xs leading-6 ${mutedClass}`}>
              CosStage 按“现状”（AS IS）提供，不作任何明示或默示保证；在法律允许的最大范围内，我们不对因使用或无法使用本软件产生的任何损失承担责任。
            </p>
          </div>
        </section>

        <section className={`border-t ${lineClass}`}>
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center lg:px-8">
            <div>
              <p className="text-2xl font-semibold tracking-tight">准备好把脑海中的舞台变成清晰方案了吗？</p>
              <p className={`mt-2 text-sm ${mutedClass}`}>返回工作区，你刚才的编辑状态仍然完整保留。</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 active:translate-y-px"
            >
              进入编辑器
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
