import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePublishedRelease } from '../scripts/release/published-index.mjs';

const FIRST_PUBLISHED_AT = '2026-07-16T12:00:00.000Z';
const RETRY_PUBLISHED_AT = '2026-07-17T12:00:00.000Z';

function createRelease(version, kind = 'patch') {
  return {
    version,
    date: '2026-07-16',
    kind,
    title: `CosStage ${version}`,
    summary: `${version} release`,
    changes: [{ kind, text: `${version} change` }],
    breakingChanges: kind === 'major' ? [`${version} breaking change`] : [],
    migrationSteps: kind === 'major' ? [`${version} migration step`] : [],
  };
}

function createHistory(versions) {
  return {
    schemaVersion: 1,
    currentVersion: versions[0],
    releases: versions.map((version) => createRelease(version)),
  };
}

function createPublishedRelease(release, publishedAt = FIRST_PUBLISHED_AT) {
  return {
    ...structuredClone(release),
    publishedAt,
    installerUrl: `https://beat.cosdrama.cn/downloads/CosStage-Setup-${release.version}-x64.exe`,
  };
}

function createPublishedIndex(history, versions, stableVersion = versions[0]) {
  return {
    schemaVersion: 1,
    currentVersion: versions[0],
    stableVersion,
    releases: versions.map((version) => {
      const release = history.releases.find((item) => item.version === version);
      assert.ok(release);
      return createPublishedRelease(release);
    }),
  };
}

test('first publication exposes only the selected release and makes it stable', () => {
  const history = createHistory(['1.1.0', '1.0.0']);

  const result = mergePublishedRelease(history, null, '1.1.0', FIRST_PUBLISHED_AT);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.currentVersion, '1.1.0');
  assert.equal(result.stableVersion, '1.1.0');
  assert.deepEqual(result.releases.map((release) => release.version), ['1.1.0']);
  assert.equal(
    result.releases[0].installerUrl,
    'https://beat.cosdrama.cn/downloads/CosStage-Setup-1.1.0-x64.exe',
  );
  assert.equal(result.releases[0].publishedAt, FIRST_PUBLISHED_AT);
});

test('same-version retry preserves its original publication timestamp', () => {
  const history = createHistory(['1.1.0']);
  const first = mergePublishedRelease(history, null, '1.1.0', FIRST_PUBLISHED_AT);

  const retry = mergePublishedRelease(history, first, '1.1.0', RETRY_PUBLISHED_AT);

  assert.equal(retry.releases[0].publishedAt, FIRST_PUBLISHED_AT);
});

test('new publication preserves already-published older releases in strict descending order', () => {
  const history = createHistory(['1.2.0', '1.1.0', '1.0.0']);
  const existing = createPublishedIndex(history, ['1.1.0', '1.0.0'], '1.0.0');

  const result = mergePublishedRelease(history, existing, '1.2.0', RETRY_PUBLISHED_AT);

  assert.deepEqual(
    result.releases.map((release) => [release.version, release.publishedAt]),
    [
      ['1.2.0', RETRY_PUBLISHED_AT],
      ['1.1.0', FIRST_PUBLISHED_AT],
      ['1.0.0', FIRST_PUBLISHED_AT],
    ],
  );
});

test('rejects malformed, duplicate, and unsorted existing indexes', () => {
  const history = createHistory(['1.2.0', '1.1.0', '1.0.0']);
  const valid = createPublishedIndex(history, ['1.1.0', '1.0.0']);
  const cases = [
    { ...structuredClone(valid), schemaVersion: 2 },
    { ...structuredClone(valid), unexpected: true },
    { ...structuredClone(valid), currentVersion: '1.0.0' },
    {
      ...structuredClone(valid),
      releases: [valid.releases[0], structuredClone(valid.releases[0])],
    },
    {
      ...structuredClone(valid),
      currentVersion: '1.0.0',
      releases: [valid.releases[1], valid.releases[0]],
    },
    {
      ...structuredClone(valid),
      releases: [{ ...structuredClone(valid.releases[0]), publishedAt: 'not-an-iso-time' }],
      currentVersion: '1.1.0',
      stableVersion: '1.1.0',
    },
    {
      ...structuredClone(valid),
      releases: [{
        ...structuredClone(valid.releases[0]),
        installerUrl: 'https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe',
      }],
      currentVersion: '1.1.0',
      stableVersion: '1.1.0',
    },
  ];

  for (const existing of cases) {
    assert.throws(
      () => mergePublishedRelease(history, existing, '1.2.0', RETRY_PUBLISHED_AT),
      /existing release index/,
    );
  }
});

test('rejects an existing stableVersion that is not published', () => {
  const history = createHistory(['1.2.0', '1.1.0']);
  const existing = createPublishedIndex(history, ['1.1.0']);
  existing.stableVersion = '1.0.0';

  assert.throws(
    () => mergePublishedRelease(history, existing, '1.2.0', RETRY_PUBLISHED_AT),
    /stableVersion/,
  );
});

test('rejects a selected version missing from history or not equal to history currentVersion', () => {
  const history = createHistory(['1.1.0', '1.0.0']);

  assert.throws(
    () => mergePublishedRelease(history, null, '9.9.9', FIRST_PUBLISHED_AT),
    /release history|不存在/,
  );
  assert.throws(
    () => mergePublishedRelease(history, null, '1.0.0', FIRST_PUBLISHED_AT),
    /currentVersion/,
  );
});

test('rejects publication below an existing current version', () => {
  const history = createHistory(['1.1.0']);
  const newerHistory = createHistory(['1.2.0']);
  const existing = createPublishedIndex(newerHistory, ['1.2.0']);

  assert.throws(
    () => mergePublishedRelease(history, existing, '1.1.0', FIRST_PUBLISHED_AT),
    /高于 existing currentVersion/,
  );
});

test('compares arbitrarily large SemVer components without Number precision loss', () => {
  const older = '90071992547409931234567890.0.0';
  const current = '90071992547409931234567891.0.0';
  const history = createHistory([current, older]);
  const existing = createPublishedIndex(history, [older]);

  const result = mergePublishedRelease(history, existing, current, FIRST_PUBLISHED_AT);

  assert.deepEqual(result.releases.map((release) => release.version), [current, older]);
});

test('rejects non-canonical or impossible publication timestamps', () => {
  const history = createHistory(['1.1.0']);

  for (const publishedAt of [
    '2026-07-16',
    '2026-07-16T12:00:00Z',
    '2026-07-16T12:00:00.000+00:00',
    '2026-02-30T12:00:00.000Z',
  ]) {
    assert.throws(
      () => mergePublishedRelease(history, null, '1.1.0', publishedAt),
      /publishedAt/,
    );
  }
});

test('rejects retry when published core release content drifted', () => {
  const history = createHistory(['1.1.0']);
  const existing = createPublishedIndex(history, ['1.1.0']);
  existing.releases[0].summary = 'rewritten after publication';

  assert.throws(
    () => mergePublishedRelease(history, existing, '1.1.0', RETRY_PUBLISHED_AT),
    /核心内容/,
  );
});

test('does not mutate history or existing index inputs', () => {
  const history = createHistory(['1.2.0', '1.1.0']);
  const existing = createPublishedIndex(history, ['1.1.0']);
  const historyBefore = structuredClone(history);
  const existingBefore = structuredClone(existing);

  mergePublishedRelease(history, existing, '1.2.0', RETRY_PUBLISHED_AT);

  assert.deepEqual(history, historyBefore);
  assert.deepEqual(existing, existingBefore);
});
