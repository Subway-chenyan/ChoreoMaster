import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildReleaseEntry,
  parseChangesetDocument,
  validateReleaseHistory,
} from './release-model.mjs';

export function buildNpmInvocation(
  args,
  {
    execPath = process.execPath,
    npmExecPath = process.env.npm_execpath,
  } = {},
) {
  if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
    throw new Error('npm 参数必须是字符串数组');
  }
  if (typeof npmExecPath !== 'string' || npmExecPath.length === 0) {
    throw new Error('缺少 npm_execpath；请通过 npm run version-packages 执行版本生成');
  }
  return {
    command: execPath,
    args: [npmExecPath, ...args],
  };
}

export function createNpmRunner({
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  execFile = execFileSync,
  env = process.env,
  stdio = 'inherit',
} = {}) {
  buildNpmInvocation([], { execPath, npmExecPath });
  return (args, { cwd } = {}) => {
    const invocation = buildNpmInvocation(args, { execPath, npmExecPath });
    return execFile(invocation.command, invocation.args, {
      cwd,
      encoding: 'utf8',
      env,
      shell: false,
      stdio,
    });
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
}

async function readJson(filePath, label) {
  return parseJson(await readFile(filePath, 'utf8'), label);
}

async function writeReleaseFile(filePath, contents, label) {
  try {
    await writeFile(filePath, contents);
  } catch (error) {
    throw new Error(`无法写入 ${label}：${errorMessage(error)}`, { cause: error });
  }
}

async function runNpmStep(runNpm, args, context, label) {
  try {
    return await runNpm(args, context);
  } catch (error) {
    throw new Error(`${label}：${errorMessage(error)}`, { cause: error });
  }
}

async function listChangesetFiles(changesetDir) {
  try {
    return (await readdir(changesetDir))
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function snapshotFile(filePath) {
  try {
    return { filePath, existed: true, contents: await readFile(filePath) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { filePath, existed: false, contents: null };
    throw error;
  }
}

async function createReleaseSnapshot(targetPaths, changesetDir) {
  const changesetFiles = await listChangesetFiles(changesetDir);
  if (changesetFiles.length === 0) throw new Error('没有可发布 Changeset');
  const snapshots = await Promise.all([
    ...Object.values(targetPaths).map((filePath) => snapshotFile(filePath)),
    ...changesetFiles.map((name) => snapshotFile(path.join(changesetDir, name))),
  ]);
  return { changesetFiles, snapshots };
}

async function restoreFile(snapshot) {
  await rm(snapshot.filePath, { recursive: true, force: true });
  if (!snapshot.existed) return;
  await mkdir(path.dirname(snapshot.filePath), { recursive: true });
  await writeFile(snapshot.filePath, snapshot.contents);
}

async function restoreReleaseSnapshot(snapshot, changesetDir) {
  const errors = [];
  const originalChangesetPaths = new Set(
    snapshot.changesetFiles.map((name) => path.join(changesetDir, name)),
  );
  try {
    const currentChangesets = await listChangesetFiles(changesetDir);
    for (const name of currentChangesets) {
      const filePath = path.join(changesetDir, name);
      if (!originalChangesetPaths.has(filePath)) {
        await rm(filePath, { recursive: true, force: true });
      }
    }
  } catch (error) {
    errors.push(new Error(`清理派生 Changeset 失败：${errorMessage(error)}`, { cause: error }));
  }

  for (const fileSnapshot of snapshot.snapshots) {
    try {
      await restoreFile(fileSnapshot);
    } catch (error) {
      errors.push(new Error(
        `恢复 ${fileSnapshot.filePath} 失败：${errorMessage(error)}`,
        { cause: error },
      ));
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, '发布文件回滚失败');
}

function combineReleaseAndRollbackErrors(originalError, rollbackError) {
  return new AggregateError(
    [originalError, rollbackError],
    `版本生成失败：${errorMessage(originalError)}；回滚失败：${errorMessage(rollbackError)}`,
  );
}

function renderReleaseNotes(entry) {
  const changeSummaries = entry.changes.map((change) => (
    change.text.split(/\r?\n##[ \t]+(?:重大变化|迁移说明)[ \t]*(?:\r?\n|$)/, 1)[0].trim()
  ));
  return [
    `# ${entry.title}`,
    '',
    entry.summary,
    '',
    ...changeSummaries.map((summary) => `- ${summary}`),
    ...(entry.breakingChanges.length > 0
      ? ['', '## 重大变化', '', ...entry.breakingChanges]
      : []),
    ...(entry.migrationSteps.length > 0
      ? ['', '## 迁移说明', '', ...entry.migrationSteps]
      : []),
    '',
  ].join('\n');
}

export async function versionPackages({ root, runNpm, now = () => new Date() }) {
  if (typeof root !== 'string' || root.length === 0) throw new Error('发布根目录必须存在');
  if (typeof runNpm !== 'function') throw new Error('npm runner 必须存在');

  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const historyPath = path.join(root, 'data/release-history.json');
  const notesPath = path.join(root, 'build/release-notes.md');
  const changesetDir = path.join(root, '.changeset');
  const targetPaths = {
    packagePath,
    lockPath,
    changelogPath,
    historyPath,
    notesPath,
  };
  const snapshot = await createReleaseSnapshot(targetPaths, changesetDir);
  const snapshotByPath = new Map(snapshot.snapshots.map((item) => [item.filePath, item]));
  const packageSnapshot = snapshotByPath.get(packagePath);
  const packageBefore = parseJson(packageSnapshot?.contents?.toString('utf8') ?? '', 'package.json');
  const historySnapshot = snapshotByPath.get(historyPath);
  const historyBefore = parseJson(
    historySnapshot?.contents?.toString('utf8') ?? '',
    'data/release-history.json',
  );
  const isFirstGovernedRelease = packageBefore.version === '1.0.0'
    && historyBefore.currentVersion === '1.0.0';
  const changesets = snapshot.changesetFiles.map((name) => (
    parseChangesetDocument(
      snapshotByPath.get(path.join(changesetDir, name))?.contents?.toString('utf8') ?? '',
      packageBefore.name,
    )
  ));

  try {
    await runNpmStep(
      runNpm,
      ['exec', 'changeset', 'version'],
      { cwd: root },
      'Changesets 版本生成失败',
    );
    const versionedPackage = await readJson(packagePath, 'package.json');
    if (isFirstGovernedRelease && versionedPackage.version !== '1.1.0') {
      throw new Error(
        `首个受治理版本必须从 1.0.0 升级到 1.1.0，实际为 ${String(versionedPackage.version)}`,
      );
    }
    await runNpmStep(
      runNpm,
      ['install', '--package-lock-only', '--ignore-scripts'],
      { cwd: root },
      'package-lock.json 同步失败',
    );

    const packageAfter = await readJson(packagePath, 'package.json');
    const packageLock = await readJson(lockPath, 'package-lock.json');
    if (packageLock?.packages?.['']?.version !== packageAfter.version) {
      throw new Error('package-lock.json 与 package.json 版本不一致');
    }
    const changelog = await readFile(changelogPath, 'utf8');
    if (!changelog.includes(`## ${packageAfter.version}`)) {
      throw new Error(`CHANGELOG.md 缺少 ${packageAfter.version}`);
    }

    const history = await readJson(historyPath, 'data/release-history.json');
    const entry = buildReleaseEntry({
      version: packageAfter.version,
      date: now().toISOString().slice(0, 10),
      changesets,
    });
    history.currentVersion = packageAfter.version;
    history.releases = [
      entry,
      ...history.releases.filter((item) => item.version !== entry.version),
    ];
    const errors = validateReleaseHistory(history, packageAfter.version);
    if (errors.length > 0) throw new Error(errors.join('\n'));

    await writeReleaseFile(
      historyPath,
      `${JSON.stringify(history, null, 2)}\n`,
      'data/release-history.json',
    );
    await writeReleaseFile(notesPath, renderReleaseNotes(entry), 'build/release-notes.md');
    return entry;
  } catch (originalError) {
    try {
      await restoreReleaseSnapshot(snapshot, changesetDir);
    } catch (rollbackError) {
      throw combineReleaseAndRollbackErrors(originalError, rollbackError);
    }
    throw originalError;
  }
}
