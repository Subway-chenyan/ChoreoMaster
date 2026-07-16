import React from 'react';
import { UpdateModal } from './UpdateModal';

interface MajorUpdateDialogProps {
  version: string;
  releaseNotes?: string;
  onConfirm: () => void;
  onLater: () => void;
}

export const MajorUpdateDialog: React.FC<MajorUpdateDialogProps> = ({
  version,
  releaseNotes,
  onConfirm,
  onLater,
}) => (
  <UpdateModal
    titleId="major-update-title"
    descriptionId="major-update-description"
    onClose={onLater}
    className="w-full max-w-xl rounded-2xl border border-amber-500/40 bg-slate-950 p-6 text-slate-100 shadow-2xl"
  >
    <h2 id="major-update-title" className="text-2xl font-semibold">
      重大版本更新 {version}
    </h2>
    <div
      id="major-update-description"
      className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-300"
      style={{ scrollbarGutter: 'stable' }}
    >
      {releaseNotes || '请在升级前查看版本迁移说明。'}
    </div>
    <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
      建议确认当前项目已经保存，并保留重要项目备份。
    </p>
    <div className="mt-6 flex justify-end gap-3">
      <button
        data-update-modal-initial-focus
        type="button"
        onClick={onLater}
        className="rounded-lg border border-slate-700 px-4 py-2 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        稍后提醒
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
      >
        确认并下载
      </button>
    </div>
  </UpdateModal>
);
