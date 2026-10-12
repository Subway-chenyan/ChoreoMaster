import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { editHistory } from './editor-model';
import { saveMobileProject } from './project-store';
import type { ProjectDocument } from '../types';
import type { PortableProject } from './project-package';

// 每次已提交编辑立即排队持久化；拖动的临时预览留在界面组件中。
export function useProjectEditor(id: string, initial: PortableProject) {
  const [history, dispatch] = useReducer(editHistory, { past: [], present: initial.document, future: [] });
  const [assets, setAssets] = useState(initial.assets);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ document: initial.document, assets: initial.assets });
  const revision = useRef(0);
  latest.current = { document: history.present, assets };
  const persist = useCallback(
    (document: ProjectDocument, changedAssets?: Record<string, Blob>) => {
      const request = ++revision.current;
      setSaveStatus('saving');
      const next = chain.current
        .catch(() => undefined)
        .then(() => saveMobileProject(id, document, changedAssets));
      chain.current = next;
      void next.then(
        () => {
          if (revision.current === request) {
            setSaveStatus('saved');
            setSaveError('');
          }
        },
        (error: unknown) => {
          if (revision.current === request) {
            setSaveStatus('error');
            setSaveError(error instanceof Error ? error.message : '本机保存失败');
          }
        }
      );
      return next;
    },
    [id]
  );
  const persistedAssets = useRef(initial.assets);
  useEffect(() => {
    const changed = persistedAssets.current !== assets;
    void persist(history.present, changed ? assets : undefined)
      .then(() => {
        if (changed) persistedAssets.current = assets;
      })
      .catch(() => undefined);
  }, [history.present, assets, persist]);
  const flush = useCallback(() => persist(latest.current.document, latest.current.assets), [persist]);
  useEffect(() => {
    const leaving = () => {
      if (document.visibilityState === 'hidden') void flush().catch(() => undefined);
    };
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (saveStatus !== 'saved') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', leaving);
    window.addEventListener('beforeunload', preventLoss);
    return () => {
      document.removeEventListener('visibilitychange', leaving);
      window.removeEventListener('beforeunload', preventLoss);
    };
  }, [flush, saveStatus]);
  return { history, document: history.present, dispatch, assets, setAssets, saveStatus, saveError, flush };
}
