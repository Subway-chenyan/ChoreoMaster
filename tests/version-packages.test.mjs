import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildNpmInvocation,
  createNpmRunner,
  versionPackages,
} from '../scripts/release/version-packages-core.mjs';

const cliPath = fileURLToPath(new URL('../scripts/release/version-packages.mjs', import.meta.url));

const initialRelease = {
  version: '1.0.0',
  date: '2026-07-15',
  kind: 'major',
  title: 'CosStage 1.0.0',
  summary: 'CosStage 首个 Windows 桌面版本。',
  changes: [{ kind: 'major', text: '提供桌面编排能力。' }],
  breakingChanges: ['这是首个公开版本。'],
  migrationSteps: ['首次安装无需迁移。'],
};

const governedMinorRelease = {
  version: '1.1.0',
  date: '2026-07-16',
  kind: 'minor',
  title: 'CosStage 1.1.0',
  summary: '建立版本治理流程。',
  changes: [{ kind: 'minor', text: '建立版本治理流程。' }],
  breakingChanges: [],
  migrationSteps: ['1.0.0 用户需要覆盖安装一次。'],
};

const minorChangeset = `---
"cosstage-desktop": minor
---

建立版本治理流程。

## 迁移说明

1.0.0 用户需要覆盖安装一次。
`;

const patchChangeset = `---
"cosstage-desktop": patch
---

修复发布提示。
`;

const majorChangeset = `---
"cosstage-desktop": major
---

重构项目格式。

## 重大变化
旧格式不再兼容。

## 迁移说明
请先导出旧项目。
`;

const spacedMajorChangeset = `---
"cosstage-desktop": major
---

重构项目格式。

## 重大变化

旧格式不再兼容。

## 迁移说明

请先导出旧项目。
`;

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readChangesetSnapshot(changesetDir) {
  const names = (await readdir(changesetDir))
    .filter((name) => name.endsWith('.md'))
    .sort();
  return Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(changesetDir, name), 'utf8'),
  ]));
}

async function createFixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cosstage-version-packages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.changeset'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  await mkdir(path.join(root, 'build'), { recursive: true });

  const version = options.version ?? '1.0.0';
  await writeJson(path.join(root, 'package.json'), {
    name: 'cosstage-desktop',
    private: true,
    version,
  });
  await writeJson(path.join(root, 'package-lock.json'), {
    name: 'cosstage-desktop',
    version,
    lockfileVersion: 3,
    packages: { '': { name: 'cosstage-desktop', version } },
  });
  await writeFile(
    path.join(root, 'CHANGELOG.md'),
    options.changelog ?? `# cosstage-desktop\n\n## ${version}\n\n- 初始版本。\n`,
  );
  await writeJson(path.join(root, 'data/release-history.json'), options.history ?? {
    schemaVersion: 1,
    currentVersion: version,
    releases: [initialRelease],
  });
  await writeFile(path.join(root, '.changeset/README.md'), '# Changesets\n');

  const changesets = options.changesets ?? {
    'zeta-fix.md': patchChangeset,
    'alpha-governance.md': minorChangeset,
  };
  for (const [name, source] of Object.entries(changesets)) {
    await writeFile(path.join(root, '.changeset', name), source);
  }
  if (options.releaseNotes !== undefined) {
    await writeFile(path.join(root, 'build/release-notes.md'), options.releaseNotes);
  }
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function captureReleaseState(root) {
  const relativePaths = [
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
    'data/release-history.json',
    'build/release-notes.md',
  ];
  const changesetNames = (await readdir(path.join(root, '.changeset')))
    .filter((name) => name.endsWith('.md'))
    .sort();
  relativePaths.push(...changesetNames.map((name) => `.changeset/${name}`));
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => (
    [relativePath, await readOptionalFile(path.join(root, relativePath))]
  ))));
}

async function consumeFixtureChangesets(root) {
  const names = (await readdir(path.join(root, '.changeset')))
    .filter((name) => name.endsWith('.md') && name !== 'README.md');
  await Promise.all(names.map((name) => rm(path.join(root, '.changeset', name))));
}

function createSuccessfulRunner(
  root,
  nextVersion,
  expectedChangesetNames = ['README.md', 'alpha-governance.md', 'zeta-fix.md'],
) {
  const calls = [];
  return {
    calls,
    runNpm: async (args) => {
      calls.push([...args]);
      if (args[0] === 'exec') {
        assert.deepEqual(
          (await readdir(path.join(root, '.changeset'))).sort(),
          expectedChangesetNames,
        );
        const packageJson = await readJson(path.join(root, 'package.json'));
        packageJson.version = nextVersion;
        await writeJson(path.join(root, 'package.json'), packageJson);
        await writeFile(
          path.join(root, 'CHANGELOG.md'),
          `${await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')}\n## ${nextVersion}\n\n- 聚合变更。\n`,
        );
        await consumeFixtureChangesets(root);
        return;
      }
      if (args[0] === 'install') {
        const packageLock = await readJson(path.join(root, 'package-lock.json'));
        packageLock.version = nextVersion;
        packageLock.packages[''].version = nextVersion;
        await writeJson(path.join(root, 'package-lock.json'), packageLock);
        return;
      }
      throw new Error(`未预期 npm 参数：${args.join(' ')}`);
    },
  };
}

test('snapshots sorted changesets before producing every release output', async (t) => {
  const root = await createFixture(t);
  const runner = createSuccessfulRunner(root, '1.1.0');

  const entry = await versionPackages({
    root,
    runNpm: runner.runNpm,
    now: () => new Date('2026-07-16T08:00:00.000Z'),
  });

  assert.deepEqual(runner.calls, [
    ['exec', 'changeset', 'version'],
    ['install', '--package-lock-only', '--ignore-scripts'],
  ]);
  assert.equal((await readJson(path.join(root, 'package.json'))).version, '1.1.0');
  assert.equal((await readJson(path.join(root, 'package-lock.json'))).packages[''].version, '1.1.0');
  assert.match(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), /## 1\.1\.0/);
  const history = await readJson(path.join(root, 'data/release-history.json'));
  assert.equal(history.currentVersion, '1.1.0');
  assert.deepEqual(history.releases[0].changes.map((change) => change.kind), ['minor', 'patch']);
  assert.equal(entry.summary, '建立版本治理流程。');
  assert.equal(
    await readFile(path.join(root, 'build/release-notes.md'), 'utf8'),
    `# CosStage 1.1.0

建立版本治理流程。

- 建立版本治理流程。
- 修复发布提示。

## 迁移说明

1.0.0 用户需要覆盖安装一次。
`,
  );
  assert.deepEqual(await readdir(path.join(root, '.changeset')), ['README.md']);
});

test('rolls back every release file when lock synchronization fails', async (t) => {
  const root = await createFixture(t, { releaseNotes: '旧发布说明。\n' });
  const before = await captureReleaseState(root);
  const successfulRunner = createSuccessfulRunner(root, '1.1.0');
  const runNpm = async (args, context) => {
    if (args[0] === 'install') {
      await writeFile(path.join(root, 'build/release-notes.md'), '半成品发布说明。\n');
      await writeFile(path.join(root, '.changeset/generated.md'), '本次失败产生的派生文件');
      throw new Error('锁文件同步失败');
    }
    await successfulRunner.runNpm(args, context);
  };

  await assert.rejects(
    versionPackages({ root, runNpm }),
    /锁文件同步失败/,
  );

  assert.deepEqual(await captureReleaseState(root), before);
});

test('labels a Changesets process failure in Chinese and rolls back', async (t) => {
  const root = await createFixture(t);
  const before = await captureReleaseState(root);

  await assert.rejects(
    versionPackages({
      root,
      runNpm: async () => {
        throw new Error('spawn ENOENT');
      },
    }),
    /Changesets 版本生成失败：spawn ENOENT/,
  );
  assert.deepEqual(await captureReleaseState(root), before);
});

test('rejects and rolls back a non-1.1.0 first governed release', async (t) => {
  const root = await createFixture(t, {
    changesets: { 'breaking-format.md': majorChangeset },
  });
  const before = await captureReleaseState(root);
  const runner = createSuccessfulRunner(
    root,
    '2.0.0',
    ['README.md', 'breaking-format.md'],
  );

  await assert.rejects(
    versionPackages({ root, runNpm: runner.runNpm }),
    /首个受治理版本必须从 1\.0\.0 升级到 1\.1\.0/,
  );

  assert.deepEqual(await captureReleaseState(root), before);
});

test('builds a shell-free npm CLI invocation through the Node executable', () => {
  assert.deepEqual(
    buildNpmInvocation(['exec', 'changeset', 'version'], {
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      npmExecPath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    }),
    {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
        'exec',
        'changeset',
        'version',
      ],
    },
  );
});

test('rejects a missing npm CLI path explicitly', () => {
  assert.throws(
    () => createNpmRunner({ npmExecPath: '' }),
    /缺少 npm_execpath.*npm run version-packages/,
  );
});

test('starts the current npm CLI through Node without a platform shell', () => {
  const runNpm = createNpmRunner({ stdio: 'pipe' });

  const output = runNpm(['--version'], { cwd: process.cwd() });

  assert.match(output.trim(), /^\d+\.\d+\.\d+$/);
});

test('CLI rejects a missing npm_execpath before touching the real release state', async () => {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  const changesetDir = fileURLToPath(new URL('../.changeset', import.meta.url));
  const packageBefore = await readFile(packagePath, 'utf8');
  const changesetsBefore = await readChangesetSnapshot(changesetDir);

  const result = spawnSync(process.execPath, [cliPath], {
    encoding: 'utf8',
    env: { ...process.env, npm_execpath: '' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 npm_execpath.*npm run version-packages/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.equal(await readFile(packagePath, 'utf8'), packageBefore);
  assert.deepEqual(await readChangesetSnapshot(changesetDir), changesetsBefore);
});

test('allows future major releases and renders each notes section once', async (t) => {
  const root = await createFixture(t, {
    version: '1.1.0',
    history: {
      schemaVersion: 1,
      currentVersion: '1.1.0',
      releases: [governedMinorRelease, initialRelease],
    },
    changesets: { 'breaking-format.md': spacedMajorChangeset },
  });
  const runner = createSuccessfulRunner(
    root,
    '2.0.0',
    ['README.md', 'breaking-format.md'],
  );

  await versionPackages({
    root,
    runNpm: runner.runNpm,
    now: () => new Date('2026-07-17T08:00:00.000Z'),
  });

  assert.equal(
    await readFile(path.join(root, 'build/release-notes.md'), 'utf8'),
    `# CosStage 2.0.0

重构项目格式。

- 重构项目格式。

## 重大变化

旧格式不再兼容。

## 迁移说明

请先导出旧项目。
`,
  );
});

test('rolls back when release history becomes invalid after versioning', async (t) => {
  const root = await createFixture(t, { releaseNotes: '旧发布说明。\n' });
  const before = await captureReleaseState(root);
  const successfulRunner = createSuccessfulRunner(root, '1.1.0');
  const runNpm = async (args, context) => {
    await successfulRunner.runNpm(args, context);
    if (args[0] === 'install') {
      await writeFile(path.join(root, 'data/release-history.json'), '{不是 JSON');
    }
  };

  await assert.rejects(
    versionPackages({ root, runNpm }),
    /data\/release-history\.json 不是合法 JSON/,
  );
  assert.deepEqual(await captureReleaseState(root), before);
});

test('rolls back history and derived notes when notes writing fails', async (t) => {
  const root = await createFixture(t);
  const before = await captureReleaseState(root);
  const successfulRunner = createSuccessfulRunner(root, '1.1.0');
  const runNpm = async (args, context) => {
    await successfulRunner.runNpm(args, context);
    if (args[0] === 'install') {
      await mkdir(path.join(root, 'build/release-notes.md'));
    }
  };

  await assert.rejects(
    versionPackages({ root, runNpm }),
    /无法写入 build\/release-notes\.md/,
  );
  assert.deepEqual(await captureReleaseState(root), before);
});

test('reports both the original and rollback errors', async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    versionPackages({
      root,
      runNpm: async () => {
        await rm(root, { recursive: true, force: true });
        await writeFile(root, '阻止回滚恢复目录');
        throw new Error('原始版本生成失败');
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /版本生成失败：原始版本生成失败/);
      assert.match(error.message, /回滚失败：发布文件回滚失败/);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /原始版本生成失败/);
      assert.ok(error.errors[1] instanceof AggregateError);
      return true;
    },
  );
});
