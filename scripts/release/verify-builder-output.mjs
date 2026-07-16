import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STRICT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function resolveFileOperations(overrides = {}) {
  return {
    lstat: overrides.lstat ?? lstat,
    link: overrides.link ?? link,
    rename: overrides.rename ?? rename,
    unlink: overrides.unlink ?? unlink,
  };
}

function requireSingleMatch(lines, expression, label) {
  const matches = lines
    .map((line) => expression.exec(line))
    .filter((match) => match !== null);
  if (matches.length !== 1) {
    throw new Error(`latest.yml must contain exactly one ${label}`);
  }
  return matches[0][1];
}

function parseOptionalTopLevelSha512(lines) {
  const matches = lines
    .map((line) => /^sha512:(.*)$/.exec(line))
    .filter((match) => match !== null);
  if (matches.length > 1) {
    throw new Error('latest.yml must contain exactly one top-level sha512 when present');
  }
  if (matches.length === 0) return undefined;

  const value = matches[0][1].trim();
  if (!value) {
    throw new Error('latest.yml top-level sha512 must not be empty');
  }
  if (/\s/.test(value)) {
    throw new Error('latest.yml top-level sha512 must be a single non-empty value');
  }
  return value;
}

function parseLatestMetadata(source) {
  const lines = source.split(/\r?\n/);
  const version = requireSingleMatch(lines, /^version:[ \t]*(\S+)[ \t]*$/, 'version');
  const metadataPath = requireSingleMatch(lines, /^path:[ \t]*(\S+)[ \t]*$/, 'path');
  const filesIndexes = lines
    .map((line, index) => (/^files:[ \t]*$/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (filesIndexes.length !== 1) {
    throw new Error('latest.yml must contain exactly one files block');
  }

  const filesStart = filesIndexes[0] + 1;
  let filesEnd = lines.length;
  for (let index = filesStart; index < lines.length; index += 1) {
    if (lines[index] !== '' && !/^[ \t]/.test(lines[index])) {
      filesEnd = index;
      break;
    }
  }
  const filesLines = lines.slice(filesStart, filesEnd);
  return {
    version,
    metadataPath,
    topLevelSha512: parseOptionalTopLevelSha512(lines),
    url: requireSingleMatch(filesLines, /^ {2}-[ \t]+url:[ \t]*(\S+)[ \t]*$/, 'files.url'),
    sha512: requireSingleMatch(filesLines, /^ {4}sha512:[ \t]*(\S+)[ \t]*$/, 'files.sha512'),
    size: requireSingleMatch(filesLines, /^ {4}size:[ \t]*(\d+)[ \t]*$/, 'files.size'),
  };
}

async function requireRegularFile(filePath, label, operations) {
  let fileStat;
  try {
    fileStat = await operations.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing`);
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (fileStat.size === 0n) {
    throw new Error(`${label} is empty`);
  }
  return fileStat;
}

function createDerivedPaths(releaseDir, installerName) {
  const sha256Name = `${installerName}.sha256`;
  const aliasName = 'CosStage-Setup-x64.exe';
  const suffix = `${process.pid}-${randomUUID()}.tmp`;
  return {
    sha256Path: path.join(releaseDir, sha256Name),
    aliasPath: path.join(releaseDir, aliasName),
    sha256TempPath: path.join(releaseDir, `.${sha256Name}.${suffix}`),
    aliasTempPath: path.join(releaseDir, `.${aliasName}.${suffix}`),
    tempPrefixes: [`.${sha256Name}.`, `.${aliasName}.`],
  };
}

async function lstatIfPresent(filePath, operations) {
  try {
    return await operations.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isSafeToUnlink(fileStat) {
  return fileStat.isFile() || fileStat.isSymbolicLink();
}

function identityOf(fileStat) {
  if (typeof fileStat.dev !== 'bigint' || typeof fileStat.ino !== 'bigint') {
    throw new Error('file identity must use bigint dev and ino values');
  }
  return { dev: fileStat.dev, ino: fileStat.ino };
}

function isSameIdentity(left, right) {
  return left?.dev === right.dev && left?.ino === right.ino;
}

async function collectCleanupCandidate(filePath, label, operations) {
  const fileStat = await lstatIfPresent(filePath, operations);
  if (!fileStat) return null;
  if (!isSafeToUnlink(fileStat)) {
    throw new Error(
      `${label} ${filePath} must be a regular file or symbolic link; refusing to delete it`,
    );
  }
  return {
    publicPath: filePath,
    label,
    identity: identityOf(fileStat),
  };
}

async function collectKnownTemps(releaseDir, tempPrefixes, operations) {
  let names;
  try {
    names = await readdir(releaseDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const tempNames = names.filter((name) => (
    name.endsWith('.tmp') && tempPrefixes.some((prefix) => name.startsWith(prefix))
  ));
  const candidates = [];
  for (const name of tempNames) {
    const tempPath = path.join(releaseDir, name);
    const candidate = await collectCleanupCandidate(tempPath, 'stale temp', operations);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function createQuarantinePath(publicPath) {
  return path.join(
    path.dirname(publicPath),
    `.${path.basename(publicPath)}.cosstage-quarantine-${process.pid}-${randomUUID()}`,
  );
}

async function preserveUnexpectedQuarantine(publicPath, quarantinePath, operations) {
  let publicStat;
  try {
    publicStat = await lstatIfPresent(publicPath, operations);
  } catch (error) {
    return `could not inspect original path; object remains at quarantine path ${quarantinePath}: ${error.message}`;
  }
  if (publicStat) {
    return `original path is occupied; object remains at quarantine path ${quarantinePath}`;
  }

  try {
    await operations.rename(quarantinePath, publicPath);
    return `object was restored to original path; quarantine path was ${quarantinePath}`;
  } catch (error) {
    return `restore failed; object remains at quarantine path ${quarantinePath}: ${error.message}`;
  }
}

async function quarantineAndUnlink({
  publicPath,
  label,
  expectedIdentity,
  operations,
  allowMissing = false,
}) {
  const quarantinePath = createQuarantinePath(publicPath);
  try {
    await operations.rename(publicPath, quarantinePath);
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return false;
    throw new Error(
      `${label} cleanup could not quarantine original path ${publicPath} `
      + `at quarantine path ${quarantinePath}: ${error.message}`,
      { cause: error },
    );
  }

  let quarantinedStat;
  try {
    quarantinedStat = await operations.lstat(quarantinePath, { bigint: true });
  } catch (error) {
    throw new Error(
      `${label} cleanup could not inspect original path ${publicPath} `
      + `at quarantine path ${quarantinePath}: ${error.message}`,
      { cause: error },
    );
  }

  const quarantinedIdentity = identityOf(quarantinedStat);
  if (
    !isSameIdentity(expectedIdentity, quarantinedIdentity)
    || !isSafeToUnlink(quarantinedStat)
  ) {
    const preservation = await preserveUnexpectedQuarantine(
      publicPath,
      quarantinePath,
      operations,
    );
    throw new Error(
      `${label} changed before cleanup; original path ${publicPath}; `
      + `quarantine path ${quarantinePath}; ${preservation}`,
    );
  }

  try {
    await operations.unlink(quarantinePath);
  } catch (error) {
    throw new Error(
      `${label} cleanup failed for original path ${publicPath}; `
      + `verified object remains at quarantine path ${quarantinePath}: ${error.message}`,
      { cause: error },
    );
  }
  return true;
}

async function prepareDerivedPaths(releaseDir, derived, operations) {
  const candidates = await collectKnownTemps(
    releaseDir,
    derived.tempPrefixes,
    operations,
  );
  for (const [filePath, label] of [
    [derived.sha256Path, 'derived SHA-256 path'],
    [derived.aliasPath, 'derived installer alias path'],
  ]) {
    const candidate = await collectCleanupCandidate(filePath, label, operations);
    if (candidate) candidates.push(candidate);
  }

  let removedCount = 0;
  for (const candidate of candidates) {
    try {
      await quarantineAndUnlink({ ...candidate, expectedIdentity: candidate.identity, operations });
      removedCount += 1;
    } catch (error) {
      if (removedCount === 0) throw error;
      throw new Error(
        `stale cleanup failed after ${removedCount} earlier artifact(s) were removed `
        + `and cannot be restored: ${error.message}`,
        { cause: error },
      );
    }
  }
}

async function recordOwnedPath(ownedPaths, filePath, operations) {
  ownedPaths.set(filePath, null);
  ownedPaths.set(
    filePath,
    identityOf(await operations.lstat(filePath, { bigint: true })),
  );
}

async function promoteOwnedNoReplace({
  tempPath,
  finalPath,
  label,
  ownedPaths,
  operations,
}) {
  const identity = ownedPaths.get(tempPath);
  if (!identity) {
    throw new Error(`${label} promotion is missing owned identity for ${tempPath}`);
  }

  try {
    await operations.link(tempPath, finalPath);
  } catch (error) {
    const code = error?.code ? `${error.code}: ` : '';
    throw new Error(
      `${label} promotion failed using no-replace link ${tempPath} -> ${finalPath}: `
      + `${code}${error.message}`,
      { cause: error },
    );
  }

  ownedPaths.set(finalPath, identity);
  let finalStat;
  try {
    finalStat = await operations.lstat(finalPath, { bigint: true });
  } catch (error) {
    throw new Error(
      `${label} promotion could not verify linked final ${finalPath}: ${error.message}`,
      { cause: error },
    );
  }
  if (!isSameIdentity(identity, identityOf(finalStat)) || !isSafeToUnlink(finalStat)) {
    throw new Error(`${label} promotion linked final identity changed at ${finalPath}`);
  }

  await quarantineAndUnlink({
    publicPath: tempPath,
    label: `${label} temporary path`,
    expectedIdentity: identity,
    operations,
    allowMissing: true,
  });
  ownedPaths.delete(tempPath);
}

async function rollbackOwnedPaths(ownedPaths, operations) {
  const cleanupErrors = [];
  for (const [filePath, identity] of [...ownedPaths.entries()].reverse()) {
    try {
      if (!identity) {
        throw new Error(`owned cleanup identity is unavailable for original path ${filePath}`);
      }
      await quarantineAndUnlink({
        publicPath: filePath,
        label: 'owned rollback path',
        expectedIdentity: identity,
        operations,
        allowMissing: true,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  return cleanupErrors;
}

export async function verifyBuilderOutput({ releaseDir, version, fileOperations } = {}) {
  if (!STRICT_VERSION_PATTERN.test(version)) {
    throw new Error('version must be a strict x.y.z version');
  }

  const resolvedReleaseDir = path.resolve(releaseDir);
  const expectedName = `CosStage-Setup-${version}-x64.exe`;
  const derived = createDerivedPaths(resolvedReleaseDir, expectedName);
  const ownedPaths = new Map();
  const operations = resolveFileOperations(fileOperations);
  try {
    await prepareDerivedPaths(resolvedReleaseDir, derived, operations);
    const latestPath = path.join(resolvedReleaseDir, 'latest.yml');
    await requireRegularFile(latestPath, 'latest.yml', operations);
    const latest = await readFile(latestPath, 'utf8');
    const metadata = parseLatestMetadata(latest);
    if (metadata.version !== version) {
      throw new Error(`latest.yml version ${metadata.version} does not match ${version}`);
    }

    if (metadata.url !== expectedName) {
      throw new Error(`latest.yml files.url must be ${expectedName}`);
    }
    if (metadata.metadataPath !== metadata.url) {
      throw new Error('latest.yml path must match files.url exactly');
    }
    if (metadata.topLevelSha512 && metadata.topLevelSha512 !== metadata.sha512) {
      throw new Error('latest.yml top-level sha512 must match files.sha512');
    }

    const installerPath = path.join(resolvedReleaseDir, expectedName);
    const blockmapPath = path.join(resolvedReleaseDir, `${expectedName}.blockmap`);
    const installerStat = await requireRegularFile(installerPath, 'installer', operations);
    await requireRegularFile(blockmapPath, 'blockmap', operations);

    const declaredSize = BigInt(metadata.size);
    if (declaredSize !== installerStat.size) {
      throw new Error('latest.yml files.size does not match actual installer size');
    }

    const installer = await readFile(installerPath);
    const actualSha512 = createHash('sha512').update(installer).digest('base64');
    if (metadata.sha512 !== actualSha512) {
      throw new Error('latest.yml SHA-512 does not match the installer');
    }
    if (metadata.topLevelSha512 && metadata.topLevelSha512 !== actualSha512) {
      throw new Error('latest.yml top-level SHA-512 does not match the installer');
    }

    await writeFile(
      derived.sha256TempPath,
      `${createHash('sha256').update(installer).digest('hex')}  ${expectedName}\n`,
      { flag: 'wx' },
    );
    await recordOwnedPath(ownedPaths, derived.sha256TempPath, operations);
    await copyFile(installerPath, derived.aliasTempPath, fsConstants.COPYFILE_EXCL);
    await recordOwnedPath(ownedPaths, derived.aliasTempPath, operations);
    await promoteOwnedNoReplace({
      tempPath: derived.sha256TempPath,
      finalPath: derived.sha256Path,
      label: 'SHA-256',
      ownedPaths,
      operations,
    });
    await promoteOwnedNoReplace({
      tempPath: derived.aliasTempPath,
      finalPath: derived.aliasPath,
      label: 'installer alias',
      ownedPaths,
      operations,
    });
    return { installerPath, blockmapPath, latestPath, sha256Path: derived.sha256Path };
  } catch (error) {
    const cleanupErrors = await rollbackOwnedPaths(ownedPaths, operations);
    if (cleanupErrors.length > 0) {
      const cleanupDetails = cleanupErrors.map((cleanupError) => cleanupError.message).join('; ');
      throw new AggregateError(
        [error, ...cleanupErrors],
        `release artifact verification failed and cleanup failed: ${error.message}; `
        + cleanupDetails,
      );
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    throw new Error('usage: node verify-builder-output.mjs <version>');
  }
  await verifyBuilderOutput({ releaseDir: path.resolve('release'), version });
  console.log(`builder output ${version} is valid`);
}
