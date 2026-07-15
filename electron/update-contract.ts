import path from 'node:path';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdateKind = 'major' | 'minor' | 'patch';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  updateKind?: UpdateKind;
  releaseNotes?: string;
  progress?: UpdateProgress;
  error?: string;
}

const UPDATE_CACHE_DIRECTORY = 'cosstage-desktop-updater';
const UPDATE_PENDING_DIRECTORY = 'pending';
const NETWORK_ERROR_PATTERN = /\b(?:network|offline|internet|timeout|timed\s*out|connection|disconnected|socket|dns|getaddrinfo)\b/i;
const NODE_NETWORK_ERROR_PATTERN = /\b(?:EAI_AGAIN|EADDRINUSE|EADDRNOTAVAIL|EAFNOSUPPORT|EALREADY|ECONNABORTED|ECONNREFUSED|ECONNRESET|EDESTADDRREQ|EHOSTDOWN|EHOSTUNREACH|EINPROGRESS|EISCONN|EMSGSIZE|ENETDOWN|ENETRESET|ENETUNREACH|ENOBUFS|ENOPROTOOPT|ENOTCONN|ENOTFOUND|EPIPE|EPROTO|EPROTONOSUPPORT|EPROTOTYPE|ESHUTDOWN|ESOCKETTIMEDOUT|ESOCKTNOSUPPORT|ETIMEDOUT)\b/i;
const CHROMIUM_NETWORK_ERROR_PATTERN = /\bERR_(?:ADDRESS_UNREACHABLE|CONNECTION_ABORTED|CONNECTION_CLOSED|CONNECTION_FAILED|CONNECTION_REFUSED|CONNECTION_RESET|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|PROXY_CONNECTION_FAILED|TIMED_OUT)\b/i;
const STRUCTURED_TRANSPORT_ERROR_PATTERNS = [
  /\bnet::ERR_[A-Z0-9_]+\b/i,
  /\bERR_(?:SSL|TLS|HTTP2?|CERT|QUIC|PROXY|SOCKET|STREAM|NETWORK)(?:_[A-Z0-9]+)*\b/i,
  /\bCERT_[A-Z0-9_]+\b/i,
];
const INTEGRITY_ERROR_PATTERNS = [
  /\b(?:sha-?512|checksum|digest)\b[\s\S]*\b(?:mismatch|invalid|failed)\b/i,
  /\b(?:mismatch|invalid|failed)\b[\s\S]*\b(?:sha-?512|checksum|digest)\b/i,
  /\bsignature\b[\s\S]*\b(?:verification\s+failed|invalid|mismatch)\b/i,
  /\b(?:invalid|mismatch)\b[\s\S]*\bsignature\b/i,
  /\b(?:download|file|package|installer)\b[\s\S]*\bcorrupt(?:ed)?\b/i,
  /\bcorrupt(?:ed)?\b[\s\S]*\b(?:download|file|package|installer)\b/i,
];

function parseVersion(version: string): [bigint, bigint, bigint] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`无效 SemVer：${version}`);
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

export function classifyUpdate(currentVersion: string, availableVersion: string): UpdateKind {
  const current = parseVersion(currentVersion);
  const available = parseVersion(availableVersion);
  const comparison = available.findIndex((value, index) => value !== current[index]);
  if (comparison < 0 || available[comparison] < current[comparison]) {
    throw new Error(`可用版本 ${availableVersion} 必须高于当前版本 ${currentVersion}`);
  }
  return comparison === 0 ? 'major' : comparison === 1 ? 'minor' : 'patch';
}

export function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .map((item): string => {
      if (typeof item !== 'object' || item === null || !('note' in item)) return '';
      if (item.note === null || item.note === undefined) return '';
      return String(item.note).trim();
    })
    .filter((note) => note.length > 0);
  return notes.length > 0 ? notes.join('\n\n') : undefined;
}

export function shouldClearUpdateCache(message: string): boolean {
  if (
    NETWORK_ERROR_PATTERN.test(message)
    || NODE_NETWORK_ERROR_PATTERN.test(message)
    || CHROMIUM_NETWORK_ERROR_PATTERN.test(message)
    || STRUCTURED_TRANSPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) return false;
  return INTEGRITY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function assertUpdateCachePendingPath(localAppData: string, pendingPath: string): string {
  const localAppDataRoot = path.resolve(localAppData);
  const cacheRoot = path.resolve(localAppDataRoot, UPDATE_CACHE_DIRECTORY);
  const resolvedPending = path.resolve(pendingPath);
  const cacheRelative = path.relative(localAppDataRoot, cacheRoot);
  const pendingRelative = path.relative(cacheRoot, resolvedPending);
  if (
    cacheRelative !== UPDATE_CACHE_DIRECTORY
    || pendingRelative !== UPDATE_PENDING_DIRECTORY
    || resolvedPending !== path.resolve(cacheRoot, UPDATE_PENDING_DIRECTORY)
  ) {
    throw new Error('更新缓存路径越界');
  }
  return resolvedPending;
}
