import React from 'react';
import type { ReleaseEntry } from '../utils/release-history';
import { UpdateModal } from './UpdateModal';

interface WhatsNewDialogProps {
  release: ReleaseEntry;
  onAcknowledge: () => void;
}

export const WhatsNewDialog: React.FC<WhatsNewDialogProps> = ({ release, onAcknowledge }) => (
  <UpdateModal
    titleId="whats-new-title"
    descriptionId="whats-new-summary"
    onClose={onAcknowledge}
    className="w-full max-w-xl rounded-2xl border border-blue-500/40 bg-slate-950 p-6 text-slate-100 shadow-2xl"
  >
    <h2 id="whats-new-title" className="text-2xl font-semibold">
      本次更新 · {release.version}
    </h2>
    <p id="whats-new-summary" className="mt-3 text-sm text-slate-300">
      {release.summary}
    </p>
    <ul
      className="mt-4 max-h-56 list-disc space-y-2 overflow-y-auto pl-5 text-sm text-slate-300"
      style={{ scrollbarGutter: 'stable' }}
    >
      {release.changes.map((change) => (
        <li key={`${release.version}-${change.kind}-${change.text}`}>{change.text}</li>
      ))}
    </ul>
    {release.breakingChanges.length > 0 && (
      <div className="mt-4 text-sm text-red-300">
        <p className="font-medium">重大变化：</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {release.breakingChanges.map((change) => <li key={change}>{change}</li>)}
        </ul>
      </div>
    )}
    {release.migrationSteps.length > 0 && (
      <div className="mt-3 text-sm text-amber-200">
        <p className="font-medium">迁移说明：</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {release.migrationSteps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
    )}
    <div className="mt-6 flex justify-end">
      <button
        data-update-modal-initial-focus
        type="button"
        onClick={onAcknowledge}
        className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
      >
        我知道了
      </button>
    </div>
  </UpdateModal>
);
