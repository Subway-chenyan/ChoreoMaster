import React from 'react';
import packageManifest from '../package.json' with { type: 'json' };

export const APP_VERSION = packageManifest.version;

export const AppVersionBadge: React.FC = () => (
  <span
    aria-label={`CosStage 版本 ${APP_VERSION}`}
    title={`当前版本 ${APP_VERSION}`}
    className="shrink-0 rounded-md border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-blue-500 sm:text-xs"
  >v{APP_VERSION}</span>
);
