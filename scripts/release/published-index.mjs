import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { compareSemver, validateReleaseHistory } from './release-model.mjs';

const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INSTALLER_BASE_URL = 'https://beat.cosdrama.cn/downloads';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function installerUrl(version) {
  return `${INSTALLER_BASE_URL}/CosStage-Setup-${version}-x64.exe`;
}

function isCanonicalPublishedAt(value) {
  if (typeof value !== 'string' || !PUBLISHED_AT_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function releaseCore(publishedRelease) {
  const { publishedAt: _publishedAt, installerUrl: _installerUrl, ...core } = publishedRelease;
  return core;
}

function validateExistingIndex(existingIndex) {
  if (!isPlainObject(existingIndex)) {
    throw new Error('existing release index 必须是对象');
  }
  const expectedKeys = ['currentVersion', 'releases', 'schemaVersion', 'stableVersion'];
  const actualKeys = Object.keys(existingIndex).sort();
  if (!isDeepStrictEqual(actualKeys, expectedKeys)) {
    throw new Error('existing release index 只能包含 schemaVersion、currentVersion、stableVersion 和 releases');
  }
  if (!Array.isArray(existingIndex.releases)) {
    throw new Error('existing release index releases 必须是数组');
  }

  const coreReleases = existingIndex.releases.map((release, index) => {
    if (!isPlainObject(release)) {
      throw new Error(`existing release index releases[${index}] 必须是对象`);
    }
    if (!isCanonicalPublishedAt(release.publishedAt)) {
      throw new Error(`existing release index releases[${index}].publishedAt 必须是规范 ISO 时间`);
    }
    if (release.installerUrl !== installerUrl(release.version)) {
      throw new Error(`existing release index releases[${index}].installerUrl 必须是版本化安装包 URL`);
    }
    return releaseCore(release);
  });

  const errors = validateReleaseHistory(
    {
      schemaVersion: existingIndex.schemaVersion,
      currentVersion: existingIndex.currentVersion,
      releases: coreReleases,
    },
    existingIndex.currentVersion,
  );
  if (errors.length > 0) {
    throw new Error(`existing release index 无效：${errors.join('；')}`);
  }

  try {
    compareSemver(existingIndex.stableVersion, existingIndex.stableVersion);
  } catch {
    throw new Error('existing release index stableVersion 必须是有效 SemVer');
  }
  if (!coreReleases.some((release) => release.version === existingIndex.stableVersion)) {
    throw new Error('existing release index stableVersion 必须指向已发布版本');
  }
  return coreReleases;
}

export function mergePublishedRelease(history, existingIndex, version, publishedAt) {
  if (!isCanonicalPublishedAt(publishedAt)) {
    throw new Error('publishedAt 必须是规范 ISO 时间');
  }

  const historyErrors = validateReleaseHistory(history, version);
  if (historyErrors.length > 0) {
    throw new Error(`release history 无效：${historyErrors.join('；')}`);
  }
  const selectedRelease = history.releases.find((release) => release.version === version);
  if (!selectedRelease) {
    throw new Error(`版本历史中不存在 ${version}`);
  }

  let previousSelected;
  let olderPublished = [];
  if (existingIndex !== null && existingIndex !== undefined) {
    const existingCores = validateExistingIndex(existingIndex);
    if (compareSemver(version, existingIndex.currentVersion) < 0) {
      throw new Error(`新版本 ${version} 必须高于 existing currentVersion ${existingIndex.currentVersion}`);
    }

    existingCores.forEach((core, index) => {
      const historical = history.releases.find((release) => release.version === core.version);
      if (!historical) {
        throw new Error(`release history 缺少已发布版本 ${core.version}`);
      }
      if (!isDeepStrictEqual(core, historical)) {
        throw new Error(`已发布版本 ${core.version} 的核心内容与 release history 不一致`);
      }
      if (core.version === version) previousSelected = existingIndex.releases[index];
    });
    olderPublished = existingIndex.releases
      .filter((release) => release.version !== version)
      .map((release) => structuredClone(release));
  }

  const published = {
    ...structuredClone(selectedRelease),
    publishedAt: previousSelected?.publishedAt ?? publishedAt,
    installerUrl: installerUrl(version),
  };
  return {
    schemaVersion: 1,
    currentVersion: version,
    stableVersion: version,
    releases: [published, ...olderPublished],
  };
}

export function setStableVersion(index, version) {
  validateExistingIndex(index);
  if (!index.releases.some((release) => release.version === version)) {
    throw new Error(`版本 ${version} 尚未发布`);
  }
  return {
    ...structuredClone(index),
    stableVersion: version,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'publish') {
    const [historyPath, existingPath, version, outputPath] = args;
    if (!historyPath || !existingPath || !version || !outputPath || args.length !== 4) {
      throw new Error(
        '用法：node published-index.mjs publish <history> <existing> <version> <output>',
      );
    }
    const history = JSON.parse(await readFile(historyPath, 'utf8'));
    const existingSource = await readFile(existingPath, 'utf8');
    const existing = existingSource.trim() ? JSON.parse(existingSource) : null;
    const result = mergePublishedRelease(history, existing, version, new Date().toISOString());
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  } else if (command === 'rollback') {
    const [existingPath, version, outputPath] = args;
    if (!existingPath || !version || !outputPath || args.length !== 3) {
      throw new Error(
        '用法：node published-index.mjs rollback <existing> <version> <output>',
      );
    }
    const existing = JSON.parse(await readFile(existingPath, 'utf8'));
    const result = setStableVersion(existing, version);
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    throw new Error('命令必须为 publish 或 rollback');
  }
}
