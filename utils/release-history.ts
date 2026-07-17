import bundledHistory from '../data/release-history.json' with { type: 'json' };

export type ReleaseKind = 'major' | 'minor' | 'patch';

export interface ReleaseChange {
  kind: ReleaseKind;
  text: string;
}

export interface ReleaseEntry {
  version: string;
  date: string;
  kind: ReleaseKind;
  title: string;
  summary: string;
  changes: ReleaseChange[];
  breakingChanges: string[];
  migrationSteps: string[];
}

export interface ReleaseHistory {
  schemaVersion: 1;
  currentVersion: string;
  releases: ReleaseEntry[];
}

export interface VisibleReleaseHistory {
  schemaVersion: 1;
  latestVisibleVersion?: string;
  releases: ReleaseEntry[];
}

export interface ProductReleaseElectronAPI {
  isElectron?: boolean;
  getAppVersion: () => Promise<string>;
}

export interface ReleaseHistoryResponse {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}

export type ReleaseHistoryFetch = (
  url: string,
  init?: RequestInit,
) => Promise<ReleaseHistoryResponse>;

export interface LoadedProductReleaseHistory {
  history: VisibleReleaseHistory;
  currentVersion: string;
}

export type ProductGuideVersionsView =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; data: LoadedProductReleaseHistory };

const PUBLISHED_RELEASES_URL = 'https://beat.cosdrama.cn/downloads/releases.json';
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function releaseKindRank(kind: ReleaseKind): number {
  switch (kind) {
    case 'patch': return 0;
    case 'minor': return 1;
    case 'major': return 2;
  }
}

function semverTuple(version: string): [bigint, bigint, bigint] {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) throw new Error(`无效 SemVer：${version}`);
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

function compareSemverParts(
  left: [bigint, bigint, bigint],
  right: [bigint, bigint, bigint],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReleaseKind(value: unknown): value is ReleaseKind {
  return value === 'major' || value === 'minor' || value === 'patch';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStrictSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

function isReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = RELEASE_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function invalidStructure(message: string): never {
  throw new Error(`版本信息结构无效：${message}`);
}

function parseStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalidStructure(`${path} 必须是字符串数组`);

  return value.map((item, index) => {
    if (!isNonEmptyString(item)) invalidStructure(`${path}[${index}] 必须是非空字符串`);
    return item;
  });
}

function parseReleaseChange(value: unknown, path: string): ReleaseChange {
  if (!isPlainObject(value)) invalidStructure(`${path} 必须是对象`);
  if (!isReleaseKind(value.kind)) invalidStructure(`${path}.kind 必须为 major、minor 或 patch`);
  if (!isNonEmptyString(value.text)) invalidStructure(`${path}.text 必须是非空字符串`);

  return { kind: value.kind, text: value.text };
}

function highestChangeKind(changes: ReleaseChange[]): ReleaseKind | undefined {
  let highest: ReleaseKind | undefined;
  for (const change of changes) {
    if (highest === undefined || releaseKindRank(change.kind) > releaseKindRank(highest)) {
      highest = change.kind;
    }
  }
  return highest;
}

function parseReleaseEntry(value: unknown, index: number): ReleaseEntry {
  const path = `releases[${index}]`;
  if (!isPlainObject(value)) invalidStructure(`${path} 必须是对象`);
  if (!isStrictSemver(value.version)) invalidStructure(`${path}.version 不是有效 SemVer`);
  if (!isReleaseDate(value.date)) invalidStructure(`${path}.date 不是有效发布日期`);
  if (!isReleaseKind(value.kind)) invalidStructure(`${path}.kind 必须为 major、minor 或 patch`);
  if (!isNonEmptyString(value.title)) invalidStructure(`${path}.title 必须是非空字符串`);
  if (!isNonEmptyString(value.summary)) invalidStructure(`${path}.summary 必须是非空字符串`);
  if (!Array.isArray(value.changes)) invalidStructure(`${path}.changes 必须是数组`);

  const changes = value.changes.map((change, changeIndex) => (
    parseReleaseChange(change, `${path}.changes[${changeIndex}]`)
  ));
  const breakingChanges = parseStringArray(value.breakingChanges, `${path}.breakingChanges`);
  const migrationSteps = parseStringArray(value.migrationSteps, `${path}.migrationSteps`);
  const actualKind = highestChangeKind(changes);

  if (actualKind !== undefined && actualKind !== value.kind) {
    invalidStructure(`${path}.kind ${value.kind} 与 changes 最高版本影响 ${actualKind} 不一致`);
  }

  if (value.kind === 'major' && (breakingChanges.length === 0 || migrationSteps.length === 0)) {
    invalidStructure(`Major 版本 ${value.version} 缺少重大变化或迁移说明`);
  }

  return {
    version: value.version,
    date: value.date,
    kind: value.kind,
    title: value.title,
    summary: value.summary,
    changes,
    breakingChanges,
    migrationSteps,
  };
}

function parseReleaseHistory(value: unknown): ReleaseHistory {
  if (!isPlainObject(value)) invalidStructure('根节点必须是对象');
  if (value.schemaVersion !== 1) invalidStructure('schemaVersion 必须为 1');
  if (!isStrictSemver(value.currentVersion)) invalidStructure('currentVersion 不是有效 SemVer');
  if (!Array.isArray(value.releases)) invalidStructure('releases 必须是数组');

  const releases = value.releases.map(parseReleaseEntry);
  if (releases.length === 0) invalidStructure('releases 至少包含一个版本');
  if (releases[0]?.version !== value.currentVersion) {
    invalidStructure('currentVersion 必须等于 releases[0].version');
  }

  const seenVersions = new Set<string>();
  for (const [index, release] of releases.entries()) {
    if (seenVersions.has(release.version)) {
      invalidStructure(`版本历史包含重复版本 ${release.version}`);
    }
    seenVersions.add(release.version);

    const previousRelease = releases[index - 1];
    if (
      previousRelease
      && compareSemverParts(semverTuple(previousRelease.version), semverTuple(release.version)) <= 0
    ) {
      invalidStructure('版本历史必须按 SemVer 严格倒序排列');
    }
  }

  return {
    schemaVersion: 1,
    currentVersion: value.currentVersion,
    releases,
  };
}

function parsePublishedReleaseHistory(value: unknown): {
  history: ReleaseHistory;
  stableVersion: string;
} {
  if (!isPlainObject(value)) invalidStructure('根节点必须是对象');
  if (value.schemaVersion !== 1) invalidStructure('schemaVersion 必须为 1');
  if (!isStrictSemver(value.currentVersion)) invalidStructure('currentVersion 不是有效 SemVer');
  if (!isStrictSemver(value.stableVersion)) invalidStructure('stableVersion 不是有效 SemVer');

  const history = parseReleaseHistory(value);
  if (!history.releases.some((release) => release.version === value.stableVersion)) {
    invalidStructure(`stableVersion ${value.stableVersion} 必须存在于 releases`);
  }

  return {
    history,
    stableVersion: value.stableVersion,
  };
}

function getDefaultElectronAPI(): ProductReleaseElectronAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI;
}

function defaultFetch(url: string, init?: RequestInit): Promise<ReleaseHistoryResponse> {
  return fetch(url, init);
}

export function ordinaryReleaseChangeText(
  text: string,
  stripDedicatedMajorSections: boolean,
): string {
  if (!stripDedicatedMajorSections) return text;

  return text
    .replace(
      /(?:^|\r?\n)##[ \t]+(?:重大变化|迁移说明)[ \t]*(?:\r?\n|$)[\s\S]*?(?=\r?\n##[ \t]+|$)/g,
      '',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function shouldStripDedicatedMajorSections(
  release: ReleaseEntry,
  change: ReleaseChange,
): boolean {
  return release.kind === 'major'
    && change.kind === 'major'
    && release.breakingChanges.length > 0
    && release.migrationSteps.length > 0;
}

export function productGuideVersionsView(
  data: LoadedProductReleaseHistory | null,
  hasError: boolean,
): ProductGuideVersionsView {
  if (data) return { status: 'success', data };
  return hasError ? { status: 'error' } : { status: 'loading' };
}

export function visibleReleases(history: ReleaseHistory, maxVersion?: string): ReleaseEntry[] {
  if (maxVersion === undefined) return history.releases.slice();

  const maximum = semverTuple(maxVersion);
  return history.releases.filter((release) => (
    compareSemverParts(semverTuple(release.version), maximum) <= 0
  ));
}

export function bundledProductReleaseHistory(
  currentVersion: string = bundledHistory.currentVersion,
): LoadedProductReleaseHistory {
  const history = parseReleaseHistory(bundledHistory);
  const releases = visibleReleases(history, currentVersion);
  return {
    history: {
      schemaVersion: history.schemaVersion,
      latestVisibleVersion: releases[0]?.version,
      releases,
    },
    currentVersion,
  };
}

export async function loadProductReleaseHistory(
  electronAPI: ProductReleaseElectronAPI | undefined = getDefaultElectronAPI(),
  fetchImpl: ReleaseHistoryFetch = defaultFetch,
): Promise<LoadedProductReleaseHistory> {
  if (electronAPI?.isElectron === true) {
    const currentVersion = await electronAPI.getAppVersion();
    return bundledProductReleaseHistory(currentVersion);
  }

  let response: ReleaseHistoryResponse;
  try {
    response = await fetchImpl(PUBLISHED_RELEASES_URL, { cache: 'no-store' });
  } catch {
    throw new Error('版本信息请求失败：无法连接发布服务器');
  }
  if (!response.ok) throw new Error(`版本信息请求失败：HTTP ${response.status}`);

  let rawHistory: unknown;
  try {
    rawHistory = await response.json();
  } catch {
    throw new Error('版本信息解析失败：公网数据不是合法 JSON');
  }

  const published = parsePublishedReleaseHistory(rawHistory);
  return {
    history: {
      schemaVersion: published.history.schemaVersion,
      latestVisibleVersion: published.history.currentVersion,
      releases: published.history.releases,
    },
    currentVersion: published.stableVersion,
  };
}
