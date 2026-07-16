type SemverTuple = readonly [bigint, bigint, bigint];

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseSemver(value: string): SemverTuple | null {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return null;
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

function compare(left: SemverTuple, right: SemverTuple): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export interface UpdatePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): UpdatePreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readUpdatePreference(
  key: string,
  storage: UpdatePreferenceStorage | null = getDefaultStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeUpdatePreference(
  key: string,
  value: string,
  storage: UpdatePreferenceStorage | null = getDefaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeUpdatePreference(
  key: string,
  storage: UpdatePreferenceStorage | null = getDefaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export async function beforeInstallSafely(
  beforeInstall: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await beforeInstall();
  } catch {
    return false;
  }
}

export function shouldShowWhatsNew(currentVersion: string, lastSeenVersion: string | null): boolean {
  if (lastSeenVersion === null) return false;
  const current = parseSemver(currentVersion);
  if (!current) return false;
  const lastSeen = parseSemver(lastSeenVersion);
  return lastSeen === null || compare(current, lastSeen) > 0;
}

export function shouldPromptIgnoredUpdate(availableVersion: string, ignoredVersion: string | null): boolean {
  if (ignoredVersion === null) return true;
  const available = parseSemver(availableVersion);
  const ignored = parseSemver(ignoredVersion);
  return available === null || ignored === null || compare(available, ignored) > 0;
}

interface AutoOpenUpdateInput {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  updateKind?: 'patch' | 'minor' | 'major';
  availableVersion?: string;
  ignoredVersion?: string | null;
}

export function shouldAutoOpenUpdate({
  status,
  updateKind,
  availableVersion,
  ignoredVersion = null,
}: AutoOpenUpdateInput): boolean {
  if (status === 'downloaded' || status === 'error') return true;
  if (status !== 'available' || availableVersion === undefined) return false;
  return updateKind !== 'major' || shouldPromptIgnoredUpdate(availableVersion, ignoredVersion);
}
