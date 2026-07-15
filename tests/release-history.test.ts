import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadProductReleaseHistory,
  ordinaryReleaseChangeText,
  productGuideVersionsView,
  shouldStripDedicatedMajorSections,
  visibleReleases,
} from '../utils/release-history.ts';

const history = {
  schemaVersion: 1 as const,
  currentVersion: '2.0.0',
  releases: [
    {
      version: '2.0.0',
      date: '2026-08-01',
      kind: 'major' as const,
      title: '2.0',
      summary: '2.0',
      changes: [{ kind: 'major' as const, text: '2.0' }],
      breakingChanges: ['格式变化'],
      migrationSteps: ['先备份'],
    },
    {
      version: '1.1.0',
      date: '2026-07-16',
      kind: 'minor' as const,
      title: '1.1',
      summary: '1.1',
      changes: [],
      breakingChanges: [],
      migrationSteps: [],
    },
  ],
};

test('desktop hides releases newer than the installed app', () => {
  assert.deepEqual(visibleReleases(history, '1.1.0').map((item) => item.version), ['1.1.0']);
});

test('web can display the complete published index', () => {
  assert.deepEqual(visibleReleases(history).map((item) => item.version), ['2.0.0', '1.1.0']);
});

test('desktop reads the installed app version, filters bundled releases, and never fetches', async () => {
  let appVersionCalls = 0;
  let fetchCalls = 0;
  const electronAPI = {
    isElectron: true,
    getAppVersion: async () => {
      appVersionCalls += 1;
      return '0.9.0';
    },
  };
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('desktop must not fetch');
  };

  const result = await loadProductReleaseHistory(electronAPI, fetchImpl);

  assert.equal(appVersionCalls, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(result.currentVersion, '0.9.0');
  assert.equal(result.history.latestVisibleVersion, undefined);
  assert.equal('currentVersion' in result.history, false);
  assert.deepEqual(result.history.releases, []);
});

test('desktop visible history reports its newest retained release for installed 1.0 and 1.1', async () => {
  for (const installedVersion of ['1.0.0', '1.1.0']) {
    const result = await loadProductReleaseHistory({
      isElectron: true,
      getAppVersion: async () => installedVersion,
    });

    assert.equal(result.currentVersion, installedVersion);
    assert.equal(result.history.latestVisibleVersion, '1.0.0');
    assert.deepEqual(result.history.releases.map((release) => release.version), ['1.0.0']);
  }
});

test('web fetches the published index without cache and does not call the desktop boundary', async () => {
  const requests: Array<{ url: string; cache: string | undefined }> = [];
  let appVersionCalls = 0;
  const publishedHistory = {
    ...history,
    stableVersion: '1.1.0',
  };
  const electronAPI = {
    isElectron: false,
    getAppVersion: async () => {
      appVersionCalls += 1;
      return '9.9.9';
    },
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    requests.push({ url, cache: init?.cache });
    return {
      ok: true,
      status: 200,
      json: async () => publishedHistory,
    };
  };

  const result = await loadProductReleaseHistory(electronAPI, fetchImpl);

  assert.deepEqual(requests, [{
    url: 'https://beat.cosdrama.cn/downloads/releases.json',
    cache: 'no-store',
  }]);
  assert.equal(appVersionCalls, 0);
  assert.equal(result.currentVersion, '1.1.0');
  assert.equal(result.history.latestVisibleVersion, '2.0.0');
  assert.equal('currentVersion' in result.history, false);
  assert.deepEqual(result.history.releases.map((release) => release.version), ['2.0.0', '1.1.0']);
});

test('web accepts a rollback where stableVersion is below the latest published release', async () => {
  const publishedHistory = { ...history, stableVersion: '1.1.0' };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => publishedHistory,
  });

  const result = await loadProductReleaseHistory(undefined, fetchImpl);

  assert.equal(result.currentVersion, '1.1.0');
  assert.equal(result.history.latestVisibleVersion, '2.0.0');
});

test('web accepts forward-compatible extra fields in the published index', async () => {
  const publishedHistory = {
    ...history,
    stableVersion: '1.1.0',
    futureIndexMetadata: { channel: 'stable' },
    releases: history.releases.map((release) => ({
      ...release,
      futureReleaseMetadata: { artifact: `${release.version}.exe` },
      changes: release.changes.map((change) => ({ ...change, futureChangeMetadata: true })),
    })),
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => publishedHistory,
  });

  const result = await loadProductReleaseHistory(undefined, fetchImpl);

  assert.deepEqual(result.history.releases.map((release) => release.version), ['2.0.0', '1.1.0']);
});

test('web HTTP failure rejects instead of falling back to bundled history', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    json: async () => history,
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息请求失败：HTTP 503/,
  );
});

test('web JSON failure rejects in Chinese instead of falling back to bundled history', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token'); },
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息解析失败：公网数据不是合法 JSON/,
  );
});

test('web rejects malformed release history instead of falling back to bundled history', async () => {
  const malformedHistory = {
    ...history,
    stableVersion: '01.1.0',
    releases: [{
      ...history.releases[0],
      kind: 'feature',
      changes: '不是数组',
    }],
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => malformedHistory,
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息结构无效：stableVersion 不是有效 SemVer/,
  );
});

test('web validates schema, current version, and every release collection at runtime', async () => {
  const validPublishedHistory = { ...history, stableVersion: '1.1.0' };
  const invalidCases: Array<{ value: unknown; message: RegExp }> = [
    {
      value: { ...validPublishedHistory, schemaVersion: 2 },
      message: /schemaVersion 必须为 1/,
    },
    {
      value: { ...validPublishedHistory, currentVersion: '2.0' },
      message: /currentVersion 不是有效 SemVer/,
    },
    {
      value: { ...validPublishedHistory, releases: '不是数组' },
      message: /releases 必须是数组/,
    },
    {
      value: {
        ...validPublishedHistory,
        releases: [{ ...history.releases[0], kind: 'feature' }],
      },
      message: /releases\[0\]\.kind 必须为 major、minor 或 patch/,
    },
    {
      value: {
        ...validPublishedHistory,
        releases: [{ ...history.releases[0], changes: '不是数组' }],
      },
      message: /releases\[0\]\.changes 必须是数组/,
    },
    {
      value: {
        ...validPublishedHistory,
        releases: [{ ...history.releases[0], breakingChanges: '不是数组' }],
      },
      message: /releases\[0\]\.breakingChanges 必须是字符串数组/,
    },
    {
      value: {
        ...validPublishedHistory,
        releases: [{ ...history.releases[0], migrationSteps: [1] }],
      },
      message: /releases\[0\]\.migrationSteps\[0\] 必须是非空字符串/,
    },
  ];

  for (const invalidCase of invalidCases) {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => invalidCase.value,
    });
    await assert.rejects(loadProductReleaseHistory(undefined, fetchImpl), invalidCase.message);
  }
});

test('web rejects an empty release history', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      schemaVersion: 1,
      currentVersion: '1.0.0',
      stableVersion: '1.0.0',
      releases: [],
    }),
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息结构无效：releases 至少包含一个版本/,
  );
});

test('web rejects a currentVersion that differs from the first release', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ...history, currentVersion: '1.1.0', stableVersion: '1.1.0' }),
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息结构无效：currentVersion 必须等于 releases\[0\]\.version/,
  );
});

test('web rejects duplicate release versions', async () => {
  const duplicateHistory = {
    schemaVersion: 1,
    currentVersion: '2.0.0',
    stableVersion: '2.0.0',
    releases: [history.releases[0], { ...history.releases[0], date: '2026-07-31' }],
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => duplicateHistory,
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息结构无效：版本历史包含重复版本 2\.0\.0/,
  );
});

test('web rejects release histories that are not in strict SemVer descending order', async () => {
  const unorderedHistory = {
    schemaVersion: 1,
    currentVersion: '1.1.0',
    stableVersion: '1.1.0',
    releases: [history.releases[1], history.releases[0]],
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => unorderedHistory,
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息结构无效：版本历史必须按 SemVer 严格倒序排列/,
  );
});

test('web rejects a stableVersion that is absent from published releases', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ...history, stableVersion: '1.0.0' }),
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /版本信息结构无效：stableVersion 1\.0\.0 必须存在于 releases/,
  );
});

test('web rejects release kind that differs from the highest change kind', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ...history,
      stableVersion: '1.1.0',
      releases: [{ ...history.releases[0], kind: 'patch' }, history.releases[1]],
    }),
  });

  await assert.rejects(
    loadProductReleaseHistory(undefined, fetchImpl),
    /releases\[0\]\.kind patch 与 changes 最高版本影响 major 不一致/,
  );
});

test('visible releases reject invalid maximum versions with a localized error', () => {
  assert.throws(() => visibleReleases(history, 'v1.1'), /无效 SemVer：v1\.1/);
});

test('visible releases compare very large SemVer segments without precision loss', () => {
  const largeHistory = {
    ...history,
    releases: [{ ...history.releases[0], version: '9007199254740993.0.0' }],
  };

  assert.deepEqual(visibleReleases(largeHistory, '9007199254740992.999.999'), []);
});

test('visible releases do not modify the input history', () => {
  const before = structuredClone(history);

  visibleReleases(history, '1.1.0');

  assert.deepEqual(history, before);
});

test('ordinary change text omits dedicated Major sections without deleting later sections', () => {
  const change = [
    '重构项目格式。',
    '',
    '## 重大变化',
    '旧格式不再兼容。',
    '',
    '## 迁移说明',
    '请先导出旧项目。',
    '',
    '## 其他说明',
    '此段仍需展示。',
  ].join('\n');

  assert.equal(
    ordinaryReleaseChangeText(change, true),
    '重构项目格式。\n\n## 其他说明\n此段仍需展示。',
  );
});

test('ordinary change text preserves dedicated headings unless stripping is explicitly enabled', () => {
  const change = '修复说明。\n\n## 重大变化\n此处是普通说明。\n\n## 迁移说明\n无需迁移。';

  assert.equal(ordinaryReleaseChangeText(change, false), change);
});

test('dedicated Major sections are stripped only for a Major change with both dedicated lists', () => {
  const majorRelease = history.releases[0];
  const majorChange = majorRelease.changes[0];

  assert.equal(shouldStripDedicatedMajorSections(majorRelease, majorChange), true);
  assert.equal(shouldStripDedicatedMajorSections(
    { ...majorRelease, kind: 'minor' },
    { ...majorChange, kind: 'minor' },
  ), false);
  assert.equal(shouldStripDedicatedMajorSections(
    majorRelease,
    { ...majorChange, kind: 'patch' },
  ), false);
  assert.equal(shouldStripDedicatedMajorSections(
    { ...majorRelease, breakingChanges: [] },
    majorChange,
  ), false);
  assert.equal(shouldStripDedicatedMajorSections(
    { ...majorRelease, migrationSteps: [] },
    majorChange,
  ), false);
});

test('product guide versions view exposes loading, error, and success states', () => {
  const data = {
    history: {
      schemaVersion: 1 as const,
      latestVisibleVersion: '2.0.0',
      releases: history.releases,
    },
    currentVersion: '1.1.0',
  };

  assert.deepEqual(productGuideVersionsView(null, false), { status: 'loading' });
  assert.deepEqual(productGuideVersionsView(null, true), { status: 'error' });
  assert.deepEqual(productGuideVersionsView(data, false), { status: 'success', data });
});
