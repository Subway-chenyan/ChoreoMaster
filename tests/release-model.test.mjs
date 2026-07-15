import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReleaseEntry,
  highestBump,
  parseChangesetDocument,
  validateReleaseHistory,
} from '../scripts/release/release-model.mjs';

const validRelease = {
  version: '1.0.0',
  date: '2026-07-15',
  kind: 'major',
  title: 'CosStage 1.0.0',
  summary: 'CosStage 首个 Windows 桌面版本。',
  changes: [
    { kind: 'major', text: '提供队形编排、时间轴、2D/3D 舞台预览与项目管理。' },
  ],
  breakingChanges: ['这是首个公开版本，没有更早的稳定项目格式兼容承诺。'],
  migrationSteps: ['首次安装无需迁移；请在开始编排前选择项目存储目录。'],
};

test('aggregates the highest version bump without mutating input', () => {
  const bumps = ['patch', 'minor', 'patch'];

  assert.equal(highestBump(bumps), 'minor');
  assert.equal(highestBump(['minor', 'major']), 'major');
  assert.deepEqual(bumps, ['patch', 'minor', 'patch']);
});

test('rejects missing or unknown version bumps', () => {
  assert.throws(() => highestBump([]), /至少需要一个版本影响记录/);
  assert.throws(() => highestBump(['minor', 'none']), /未知版本影响：none/);
  assert.throws(() => highestBump('minor'), /版本影响记录必须是数组/);
});

test('parses the single private package changeset', () => {
  const parsed = parseChangesetDocument(
    `---\r\n"cosstage-desktop": minor\r\n---\r\n\r\n新增版本历史。\r\n`,
    'cosstage-desktop',
  );

  assert.deepEqual(parsed, { bump: 'minor', body: '新增版本历史。' });
});

test('rejects malformed changeset input explicitly', () => {
  assert.throws(
    () => parseChangesetDocument(null, 'cosstage-desktop'),
    /Changeset 文档必须是字符串/,
  );
  assert.throws(
    () => parseChangesetDocument('---\n"cosstage-desktop": minor\n---\n说明', ''),
    /包名必须是非空字符串/,
  );
  assert.throws(
    () => parseChangesetDocument('没有 frontmatter', 'cosstage-desktop'),
    /Changeset 缺少合法 frontmatter/,
  );
  assert.throws(
    () => parseChangesetDocument('---\n"other-package": minor\n---\n说明', 'cosstage-desktop'),
    /Changeset 未声明 cosstage-desktop 的版本影响/,
  );
  assert.throws(
    () => parseChangesetDocument('---\n"cosstage-desktop": none\n---\n说明', 'cosstage-desktop'),
    /版本影响必须为 major、minor 或 patch/,
  );
  assert.throws(
    () => parseChangesetDocument(
      '---\n"cosstage-desktop": minor\n"other-package": patch\n---\n说明',
      'cosstage-desktop',
    ),
    /只能声明 cosstage-desktop 一个包/,
  );
  assert.throws(
    () => parseChangesetDocument('---\n"cosstage-desktop": patch\n---\n   ', 'cosstage-desktop'),
    /Changeset 缺少用户可读说明/,
  );
});

test('builds a normalized release entry', () => {
  assert.deepEqual(
    buildReleaseEntry({
      version: '1.1.0',
      date: '2026-07-16',
      changesets: [
        { bump: 'patch', body: '修复版本提示。' },
        { bump: 'minor', body: '新增版本历史。' },
      ],
    }),
    {
      version: '1.1.0',
      date: '2026-07-16',
      kind: 'minor',
      title: 'CosStage 1.1.0',
      summary: '修复版本提示。',
      changes: [
        { kind: 'patch', text: '修复版本提示。' },
        { kind: 'minor', text: '新增版本历史。' },
      ],
      breakingChanges: [],
      migrationSteps: [],
    },
  );
});

test('requires major migration sections', () => {
  assert.throws(
    () => buildReleaseEntry({
      version: '2.0.0',
      date: '2026-07-16',
      changesets: [{ bump: 'major', body: '重构项目格式。' }],
    }),
    /重大变化.*迁移说明/,
  );

  const release = buildReleaseEntry({
    version: '2.0.0',
    date: '2026-07-16',
    changesets: [{
      bump: 'major',
      body: '重构项目格式。\n\n## 重大变化\n旧格式不再兼容。\n\n## 迁移说明\n请先导出旧项目。',
    }],
  });
  assert.deepEqual(release.breakingChanges, ['旧格式不再兼容。']);
  assert.deepEqual(release.migrationSteps, ['请先导出旧项目。']);
});

test('extracts major migration sections from CRLF changeset bodies', () => {
  const changeset = parseChangesetDocument(
    '---\r\n"cosstage-desktop": major\r\n---\r\n\r\n重构项目格式。\r\n\r\n## 重大变化\r\n旧格式不再兼容。\r\n\r\n## 迁移说明\r\n请先导出旧项目。\r\n',
    'cosstage-desktop',
  );
  const release = buildReleaseEntry({
    version: '2.0.0',
    date: '2026-07-16',
    changesets: [changeset],
  });

  assert.deepEqual(release.breakingChanges, ['旧格式不再兼容。']);
  assert.deepEqual(release.migrationSteps, ['请先导出旧项目。']);
});

test('rejects invalid release entry input explicitly', () => {
  assert.throws(
    () => buildReleaseEntry({ version: 'v1.0', date: '2026-07-16', changesets: [] }),
    /无效 SemVer：v1.0/,
  );
  assert.throws(
    () => buildReleaseEntry({ version: '1.0.0', date: '2026-02-30', changesets: [] }),
    /无效发布日期：2026-02-30/,
  );
  assert.throws(
    () => buildReleaseEntry({ version: '1.0.0', date: '2026-07-16', changesets: [] }),
    /至少需要一个 Changeset/,
  );
  assert.throws(
    () => buildReleaseEntry({
      version: '1.0.1',
      date: '2026-07-16',
      changesets: [{ bump: 'patch', body: '   ' }],
    }),
    /Changeset 说明必须是非空字符串/,
  );
});

test('accepts the initialized 1.0.0 release history', () => {
  const history = {
    schemaVersion: 1,
    currentVersion: '1.0.0',
    releases: [validRelease],
  };

  assert.deepEqual(validateReleaseHistory(history, '1.0.0'), []);
});

test('rejects duplicate or mismatched release history', () => {
  const history = {
    schemaVersion: 1,
    currentVersion: '1.1.0',
    releases: [
      { version: '1.1.0', date: '2026-07-16', kind: 'minor', title: 'A', summary: 'A', changes: [], breakingChanges: [], migrationSteps: [] },
      { version: '1.1.0', date: '2026-07-15', kind: 'patch', title: 'B', summary: 'B', changes: [], breakingChanges: [], migrationSteps: [] },
    ],
  };

  assert.deepEqual(validateReleaseHistory(history, '1.0.0'), [
    'currentVersion 1.1.0 与 package.json 1.0.0 不一致',
    '版本历史包含重复版本 1.1.0',
  ]);
});

test('reports malformed release history instead of throwing', () => {
  const rootErrors = validateReleaseHistory(
    { schemaVersion: '1', currentVersion: 1, releases: {} },
    'v1',
  ).join('\n');

  assert.match(rootErrors, /package.json 版本 v1 不是有效 SemVer/);
  assert.match(rootErrors, /release history schemaVersion 必须为 1/);
  assert.match(rootErrors, /currentVersion 必须是有效 SemVer/);
  assert.match(rootErrors, /releases 必须是数组/);

  const releaseErrors = validateReleaseHistory({
    schemaVersion: 1,
    currentVersion: '1.0.0',
    releases: [{
      version: '1.0',
      date: '2026-02-30',
      kind: 'none',
      title: ' ',
      summary: 42,
      changes: [{ kind: 'minor', text: '' }],
      breakingChanges: '无',
      migrationSteps: [1],
    }],
  }, '1.0.0').join('\n');

  assert.match(releaseErrors, /releases\[0\]\.version 不是有效 SemVer/);
  assert.match(releaseErrors, /releases\[0\]\.date 不是有效发布日期/);
  assert.match(releaseErrors, /releases\[0\]\.kind 必须为 major、minor 或 patch/);
  assert.match(releaseErrors, /releases\[0\]\.title 必须是非空字符串/);
  assert.match(releaseErrors, /releases\[0\]\.summary 必须是非空字符串/);
  assert.match(releaseErrors, /releases\[0\]\.changes\[0\]\.text 必须是非空字符串/);
  assert.match(releaseErrors, /releases\[0\]\.breakingChanges 必须是字符串数组/);
  assert.match(releaseErrors, /releases\[0\]\.migrationSteps\[0\] 必须是非空字符串/);
});

test('rejects ascending history and incomplete major records', () => {
  const older = {
    ...validRelease,
    version: '1.0.0',
  };
  const newer = {
    ...validRelease,
    version: '1.1.0',
    date: '2026-07-16',
    breakingChanges: ['   '],
    migrationSteps: [],
  };
  const errors = validateReleaseHistory({
    schemaVersion: 1,
    currentVersion: '1.0.0',
    releases: [older, newer],
  }, '1.0.0');

  assert.ok(errors.includes('Major 版本 1.1.0 缺少重大变化或迁移说明'));
  assert.ok(errors.includes('版本历史必须按版本号严格倒序排列'));
});

test('derives release impact from changes when validating history', () => {
  const history = {
    schemaVersion: 1,
    currentVersion: '1.0.0',
    releases: [{
      ...validRelease,
      kind: 'patch',
      changes: [{ kind: 'major', text: '项目格式不再兼容。' }],
      breakingChanges: [],
      migrationSteps: [],
    }],
  };

  assert.deepEqual(validateReleaseHistory(history, '1.0.0'), [
    'releases[0].kind patch 与 changes 最高版本影响 major 不一致',
    'Major 版本 1.0.0 缺少重大变化或迁移说明',
  ]);
});
