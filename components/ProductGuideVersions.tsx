import React, { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  bundledProductReleaseHistory,
  loadProductReleaseHistory,
  ordinaryReleaseChangeText,
  productGuideVersionsView,
  shouldStripDedicatedMajorSections,
  type LoadedProductReleaseHistory,
  type ReleaseKind,
} from '../utils/release-history';

const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
};

interface ReleaseListProps {
  title: string;
  items: string[];
  tone: 'danger' | 'warning';
  isDark: boolean;
}

const ReleaseList: React.FC<ReleaseListProps> = ({ title, items, tone, isDark }) => {
  const toneClass = tone === 'danger'
    ? 'border-red-500/40 bg-red-500/10'
    : 'border-amber-500/40 bg-amber-500/10';
  const textClass = isDark ? 'text-slate-200' : 'text-slate-700';

  return (
    <div className={`mt-5 rounded-xl border p-4 ${toneClass}`}>
      <h4 className="font-semibold">{title}</h4>
      <ul className={`mt-2 list-disc space-y-2 pl-5 text-sm leading-6 ${textClass}`}>
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
};

export const ProductGuideVersions: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [data, setData] = useState<LoadedProductReleaseHistory | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isBundledFallback, setIsBundledFallback] = useState(false);

  useEffect(() => {
    let active = true;
    void loadProductReleaseHistory()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (!active) return;
        try {
          setData(bundledProductReleaseHistory());
          setIsBundledFallback(true);
        } catch {
          setHasError(true);
        }
      });
    return () => { active = false; };
  }, []);

  const view = productGuideVersionsView(data, hasError);
  const lineClass = isDark ? 'border-slate-800' : 'border-slate-200';
  const panelClass = isDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-white/80';
  const mutedClass = isDark ? 'text-slate-400' : 'text-slate-600';

  return (
    <section
      id="versions"
      aria-label="版本更新"
      className={`scroll-mt-16 border-t ${lineClass}`}
    >
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <p className="text-sm font-semibold text-blue-500">版本更新</p>

        {view.status === 'loading' && (
          <p className={`mt-4 text-sm ${mutedClass}`} role="status" aria-live="polite">
            正在加载版本信息…
          </p>
        )}

        {view.status === 'error' && (
          <p className="mt-4 text-sm text-red-500" role="alert">
            版本信息暂时无法加载，请稍后重试
          </p>
        )}

        {view.status === 'success' && (
          <>
            {isBundledFallback && (
              <p
                className={`mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm ${isDark ? 'text-amber-200' : 'text-amber-800'}`}
                role="status"
              >
                线上发布记录暂时不可用，当前展示随此版本内置的离线记录。
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2
                  id="product-guide-versions-title"
                  className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl"
                >
                  当前版本 {view.data.currentVersion}
                </h2>
                {view.data.history.latestVisibleVersion && (
                  <p className={`mt-3 text-sm ${mutedClass}`}>
                    版本历史最新记录 {view.data.history.latestVisibleVersion}
                  </p>
                )}
              </div>
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-500">
                {isBundledFallback ? '离线记录' : '稳定 / 已安装'}
              </span>
            </div>

            {view.data.history.releases.length === 0 ? (
              <p className={`mt-10 text-sm ${mutedClass}`}>当前安装版本暂无可展示的更新记录。</p>
            ) : (
              <div className="mt-10 space-y-4">
                {view.data.history.releases.map((release) => {
                  const changeTexts = release.changes
                    .map((change) => ordinaryReleaseChangeText(
                      change.text,
                      shouldStripDedicatedMajorSections(release, change),
                    ))
                    .filter((text) => text.length > 0);
                  return (
                    <details
                      key={release.version}
                      open={release.version === view.data.currentVersion}
                      className={`rounded-2xl border p-6 ${panelClass}`}
                    >
                      <summary className="focus-ring cursor-pointer rounded-lg font-semibold">
                        <span className="text-blue-500">{release.version}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{RELEASE_KIND_LABELS[release.kind]}</span>
                        <span aria-hidden="true"> · </span>
                        <time dateTime={release.date}>{release.date}</time>
                      </summary>
                      <h3 className="mt-5 text-lg font-semibold">{release.title}</h3>
                      <p className={`mt-2 text-sm leading-6 ${mutedClass}`}>{release.summary}</p>
                      {changeTexts.length > 0 && (
                        <ul className={`mt-4 list-disc space-y-2 pl-5 text-sm leading-6 ${mutedClass}`}>
                          {changeTexts.map((text, index) => (
                            <li key={`${release.version}-change-${index}`} className="whitespace-pre-line">
                              {text}
                            </li>
                          ))}
                        </ul>
                      )}
                      {release.breakingChanges.length > 0 && (
                        <ReleaseList
                          title="重大变化"
                          items={release.breakingChanges}
                          tone="danger"
                          isDark={isDark}
                        />
                      )}
                      {release.migrationSteps.length > 0 && (
                        <ReleaseList
                          title="迁移说明"
                          items={release.migrationSteps}
                          tone="warning"
                          isDark={isDark}
                        />
                      )}
                    </details>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
