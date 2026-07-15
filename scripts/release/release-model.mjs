const bumpRank = Object.freeze({ patch: 0, minor: 1, major: 2 });
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isVersionBump(value) {
  return typeof value === 'string' && Object.hasOwn(bumpRank, value);
}

function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = semverPattern.exec(value);
  return match ? [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])] : null;
}

function isReleaseDate(value) {
  if (typeof value !== 'string') return false;
  const match = releaseDatePattern.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function highestBump(bumps) {
  if (!Array.isArray(bumps)) throw new Error('版本影响记录必须是数组');
  if (bumps.length === 0) throw new Error('至少需要一个版本影响记录');

  let highest = 'patch';
  for (const bump of bumps) {
    if (!isVersionBump(bump)) throw new Error(`未知版本影响：${String(bump)}`);
    if (bumpRank[bump] > bumpRank[highest]) highest = bump;
  }
  return highest;
}

export function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) {
    throw new Error(`无效 SemVer：${!leftParts ? String(left) : String(right)}`);
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function parseFrontmatter(frontmatter) {
  const lines = frontmatter.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line) => {
    const match = /^\s*(?:"([^"]+)"|'([^']+)'|([^"'\s][^:]*?))\s*:\s*(\S+)\s*$/.exec(line);
    if (!match) throw new Error('Changeset frontmatter 只能包含包名和版本影响');
    return { packageName: (match[1] ?? match[2] ?? match[3]).trim(), bump: match[4] };
  });
}

export function parseChangesetDocument(source, packageName) {
  if (typeof source !== 'string') throw new Error('Changeset 文档必须是字符串');
  if (!isNonEmptyString(packageName)) throw new Error('包名必须是非空字符串');

  const normalizedSource = source.replace(/^\uFEFF/, '').trim();
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(normalizedSource);
  if (!match) throw new Error('Changeset 缺少合法 frontmatter');

  const expectedPackageName = packageName.trim();
  const declarations = parseFrontmatter(match[1]);
  const declaration = declarations.find((item) => item.packageName === expectedPackageName);
  if (!declaration) throw new Error(`Changeset 未声明 ${expectedPackageName} 的版本影响`);
  if (declarations.length !== 1) throw new Error(`Changeset 只能声明 ${expectedPackageName} 一个包`);
  if (!isVersionBump(declaration.bump)) {
    throw new Error('Changeset 版本影响必须为 major、minor 或 patch');
  }

  const body = (match[2] ?? '').trim();
  if (!body) throw new Error('Changeset 缺少用户可读说明');
  return { bump: declaration.bump, body };
}

function extractSection(body, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `(?:^|\\r?\\n)##[ \\t]+${escapedHeading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##[ \\t]+|$)`,
  ).exec(body);
  return match?.[1].trim() ?? '';
}

function normalizeChangesets(changesets) {
  if (!Array.isArray(changesets)) throw new Error('Changesets 必须是数组');
  if (changesets.length === 0) throw new Error('至少需要一个 Changeset');

  return changesets.map((changeset, index) => {
    if (!isPlainObject(changeset)) throw new Error(`changesets[${index}] 必须是对象`);
    if (!isVersionBump(changeset.bump)) {
      throw new Error(`changesets[${index}].bump 必须为 major、minor 或 patch`);
    }
    if (!isNonEmptyString(changeset.body)) {
      throw new Error(`changesets[${index}] Changeset 说明必须是非空字符串`);
    }
    return { bump: changeset.bump, body: changeset.body.trim() };
  });
}

export function buildReleaseEntry(input) {
  if (!isPlainObject(input)) throw new Error('发布记录输入必须是对象');
  const { version, date, changesets } = input;
  if (!parseSemver(version)) throw new Error(`无效 SemVer：${String(version)}`);
  if (!isReleaseDate(date)) throw new Error(`无效发布日期：${String(date)}`);

  const normalizedChangesets = normalizeChangesets(changesets);
  const kind = highestBump(normalizedChangesets.map((item) => item.bump));
  const breakingChanges = [];
  const migrationSteps = [];

  for (const [index, changeset] of normalizedChangesets.entries()) {
    const breakingChange = extractSection(changeset.body, '重大变化');
    const migrationStep = extractSection(changeset.body, '迁移说明');
    if (changeset.bump === 'major' && (!breakingChange || !migrationStep)) {
      throw new Error(`第 ${index + 1} 个 Major Changeset 必须包含非空的“重大变化”和“迁移说明”`);
    }
    if (breakingChange) breakingChanges.push(breakingChange);
    if (migrationStep) migrationSteps.push(migrationStep);
  }

  const changes = normalizedChangesets.map(({ bump, body }) => ({ kind: bump, text: body }));
  const firstLine = normalizedChangesets[0].body
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.trimStart().startsWith('#'))
    ?.trim() ?? `CosStage ${version}`;

  return {
    version,
    date,
    kind,
    title: `CosStage ${version}`,
    summary: firstLine,
    changes,
    breakingChanges,
    migrationSteps,
  };
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是字符串数组`);
    return false;
  }

  let isValid = true;
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      errors.push(`${path}[${index}] 必须是非空字符串`);
      isValid = false;
    }
  });
  return isValid;
}

function validateChanges(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`);
    return null;
  }

  const validBumps = [];
  value.forEach((change, index) => {
    const changePath = `${path}[${index}]`;
    if (!isPlainObject(change)) {
      errors.push(`${changePath} 必须是对象`);
      return;
    }
    if (!isVersionBump(change.kind)) {
      errors.push(`${changePath}.kind 必须为 major、minor 或 patch`);
    } else {
      validBumps.push(change.kind);
    }
    if (!isNonEmptyString(change.text)) {
      errors.push(`${changePath}.text 必须是非空字符串`);
    }
  });
  return validBumps.length > 0 ? highestBump(validBumps) : null;
}

function validateRelease(release, index, errors) {
  const path = `releases[${index}]`;
  if (!isPlainObject(release)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }

  const version = parseSemver(release.version) ? release.version : null;
  if (!version) errors.push(`${path}.version 不是有效 SemVer`);
  if (!isReleaseDate(release.date)) errors.push(`${path}.date 不是有效发布日期`);
  if (!isVersionBump(release.kind)) {
    errors.push(`${path}.kind 必须为 major、minor 或 patch`);
  }
  if (!isNonEmptyString(release.title)) errors.push(`${path}.title 必须是非空字符串`);
  if (!isNonEmptyString(release.summary)) errors.push(`${path}.summary 必须是非空字符串`);
  const actualKind = validateChanges(release.changes, `${path}.changes`, errors);
  if (isVersionBump(release.kind) && actualKind && release.kind !== actualKind) {
    errors.push(`${path}.kind ${release.kind} 与 changes 最高版本影响 ${actualKind} 不一致`);
  }
  const hasValidBreakingChanges = validateStringArray(
    release.breakingChanges,
    `${path}.breakingChanges`,
    errors,
  );
  const hasValidMigrationSteps = validateStringArray(
    release.migrationSteps,
    `${path}.migrationSteps`,
    errors,
  );

  if (
    (release.kind === 'major' || actualKind === 'major')
    && (
      !hasValidBreakingChanges
      || !hasValidMigrationSteps
      || release.breakingChanges.length === 0
      || release.migrationSteps.length === 0
    )
  ) {
    errors.push(`Major 版本 ${String(release.version)} 缺少重大变化或迁移说明`);
  }
  return version;
}

export function validateReleaseHistory(history, packageVersion) {
  const errors = [];
  const packageSemver = parseSemver(packageVersion);
  if (!packageSemver) errors.push(`package.json 版本 ${String(packageVersion)} 不是有效 SemVer`);

  if (!isPlainObject(history)) {
    errors.push('release history 必须是对象');
    return errors;
  }
  if (history.schemaVersion !== 1) errors.push('release history schemaVersion 必须为 1');

  const currentVersionIsValid = parseSemver(history.currentVersion) !== null;
  if (!currentVersionIsValid) errors.push('currentVersion 必须是有效 SemVer');
  if (history.currentVersion !== packageVersion) {
    errors.push(`currentVersion ${String(history.currentVersion)} 与 package.json ${String(packageVersion)} 不一致`);
  }

  if (!Array.isArray(history.releases)) {
    errors.push('releases 必须是数组');
    return errors;
  }
  if (history.releases.length === 0) {
    errors.push('releases 至少包含一个版本');
    return errors;
  }

  if (
    isPlainObject(history.releases[0])
    && history.releases[0].version !== history.currentVersion
  ) {
    errors.push('版本历史首项必须等于 currentVersion');
  }

  const seen = new Set();
  const versions = history.releases.map((release, index) => {
    const version = validateRelease(release, index, errors);
    if (isPlainObject(release) && typeof release.version === 'string') {
      if (seen.has(release.version)) errors.push(`版本历史包含重复版本 ${release.version}`);
      seen.add(release.version);
    }
    return version;
  });

  for (let index = 1; index < versions.length; index += 1) {
    const previous = versions[index - 1];
    const current = versions[index];
    if (previous && current && compareSemver(previous, current) < 0) {
      errors.push('版本历史必须按版本号严格倒序排列');
      break;
    }
  }
  return errors;
}
