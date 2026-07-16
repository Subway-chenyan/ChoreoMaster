import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyBuilderOutput } from '../scripts/release/verify-builder-output.mjs';
import {
  createWindowsSignatureInvocation,
  verifyReleaseArtifacts,
} from '../scripts/release/verify-release-artifacts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const builderConfigPath = path.join(root, 'electron-builder.config.cjs');
const signatureScriptPath = path.join(root, 'scripts/release/verify-windows-signature.ps1');
const signatureHelpersPath = path.join(root, 'scripts/release/windows-signature-helpers.ps1');

async function createFixture(t, overrides = {}) {
  const releaseDir = overrides.releaseDir
    ?? await mkdtemp(path.join(os.tmpdir(), 'cosstage-release-'));
  if (!overrides.releaseDir) {
    t.after(() => rm(releaseDir, { recursive: true, force: true }));
  }

  const version = overrides.version ?? '1.1.0';
  const expectedName = `CosStage-Setup-${version}-x64.exe`;
  const installer = Buffer.from('signed-installer-fixture');
  const installerSha512 = createHash('sha512').update(installer).digest('base64');
  await writeFile(path.join(releaseDir, expectedName), installer);
  if (!overrides.missingBlockmap) {
    await writeFile(
      path.join(releaseDir, `${expectedName}.blockmap`),
      overrides.blockmap ?? 'blockmap',
    );
  }

  const metadata = [
    `version: ${overrides.metadataVersion ?? version}`,
    'files:',
    `  - url: ${overrides.url ?? expectedName}`,
    `    sha512: ${overrides.sha512 ?? installerSha512}`,
    `    size: ${overrides.size ?? installer.length}`,
    `path: ${overrides.metadataPath ?? expectedName}`,
    ...(overrides.topLevelSha512 === false
      ? []
      : [`sha512: ${overrides.topLevelSha512 ?? installerSha512}`]),
    ...(overrides.duplicateTopLevelSha512 ? [`sha512: ${installerSha512}`] : []),
    '',
  ].join('\n');
  await writeFile(path.join(releaseDir, 'latest.yml'), metadata);

  return { expectedName, installer, metadata, releaseDir, version };
}

async function createReleaseProjectFixture(t, version = '1.1.0') {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'cosstage-release-project-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const releaseDir = path.join(projectRoot, 'release');
  await mkdir(releaseDir);
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({ name: 'cosstage-desktop', version }, null, 2)}\n`,
  );
  const fixture = await createFixture(t, { releaseDir, version });
  return { ...fixture, projectRoot };
}

async function assertNoDerivedArtifacts(releaseDir, installerName) {
  for (const name of [`${installerName}.sha256`, 'CosStage-Setup-x64.exe']) {
    await assert.rejects(access(path.join(releaseDir, name)), { code: 'ENOENT' });
  }
  assert.deepEqual(
    (await readdir(releaseDir)).filter((name) => (
      name.includes('CosStage-Setup') && name.endsWith('.tmp')
    )),
    [],
  );
}

async function assertNoOwnedTempsOrQuarantines(releaseDir) {
  assert.deepEqual(
    (await readdir(releaseDir)).filter((name) => (
      name.endsWith('.tmp') || name.includes('.cosstage-quarantine-')
    )),
    [],
  );
}

function validateBuilderConfig(extraEnv = {}) {
  const { COSSTAGE_REQUIRE_CODE_SIGNING, COSSTAGE_WINDOWS_PUBLISHER_NAME, ...baseEnv } = process.env;
  const result = spawnSync(
    process.execPath,
    ['-e', [
      '(async () => {',
      `  const config = require(${JSON.stringify(builderConfigPath)});`,
      "  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');",
      "  const { DebugLogger } = require('builder-util');",
      '  await validateConfiguration(config, new DebugLogger(false));',
      '  process.stdout.write(JSON.stringify(config));',
      '})().catch((error) => {',
      '  console.error(error.message);',
      '  process.exitCode = 1;',
      '});',
    ].join('\n')],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...baseEnv, ...extraEnv },
    },
  );
  return result;
}

async function createSignatureHelperHarness(t) {
  const harnessDir = await mkdtemp(path.join(os.tmpdir(), 'cosstage-signature-helper-'));
  t.after(() => rm(harnessDir, { recursive: true, force: true }));
  const harnessPath = path.join(harnessDir, 'invoke-helper.ps1');
  await writeFile(harnessPath, [
    'param(',
    '  [Parameter(Mandatory = $true)][string]$HelperPath,',
    '  [Parameter(Mandatory = $true)][string]$Mode,',
    '  [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Actual,',
    '  [Parameter(Mandatory = $true)][string]$Expected',
    ')',
    "$ErrorActionPreference = 'Stop'",
    ". $HelperPath",
    "if ($Mode -eq 'version') {",
    '  Assert-ExactProductVersion -ActualVersion $Actual -ExpectedVersion $Expected',
    '} else {',
    '  Assert-ExactPublisherName -ActualPublisher $Actual -ExpectedPublisher $Expected',
    '}',
    '',
  ].join('\n'));
  return harnessPath;
}

function runSignatureHelper(harnessPath, mode, actual, expected) {
  return spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    harnessPath,
    '-HelperPath',
    signatureHelpersPath,
    '-Mode',
    mode,
    '-Actual',
    actual,
    '-Expected',
    expected,
  ], { encoding: 'utf8' });
}

test('accepts exact builder metadata without rewriting latest.yml or SHA-512', async (t) => {
  const fixture = await createFixture(t);

  const result = await verifyBuilderOutput({
    releaseDir: fixture.releaseDir,
    version: fixture.version,
  });

  assert.equal(path.basename(result.installerPath), fixture.expectedName);
  assert.equal(await readFile(result.latestPath, 'utf8'), fixture.metadata);
  assert.equal(
    await readFile(result.sha256Path, 'utf8'),
    `${createHash('sha256').update(fixture.installer).digest('hex')}  ${fixture.expectedName}\n`,
  );
  assert.deepEqual(
    await readFile(path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe')),
    fixture.installer,
  );
});

test('rejects a mismatched builder SHA-512 before creating derived artifacts', async (t) => {
  const fixture = await createFixture(t, { sha512: 'invalid', topLevelSha512: false });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /SHA-512/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects a mismatched top-level SHA-512 before creating derived artifacts', async (t) => {
  const fixture = await createFixture(t, { topLevelSha512: 'invalid' });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /top-level sha512.*files\.sha512/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects duplicate top-level SHA-512 metadata', async (t) => {
  const fixture = await createFixture(t, { duplicateTopLevelSha512: true });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /exactly one top-level sha512/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects an empty top-level SHA-512 value', async (t) => {
  const fixture = await createFixture(t, { topLevelSha512: '' });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /top-level sha512.*(?:empty|required)/i,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects duplicate top-level SHA-512 keys even when one value is empty', async (t) => {
  const fixture = await createFixture(t, {
    topLevelSha512: '',
    duplicateTopLevelSha512: true,
  });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /exactly one top-level sha512/i,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('accepts legacy builder metadata without a top-level SHA-512', async (t) => {
  const fixture = await createFixture(t, { topLevelSha512: false });

  await verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version });

  assert.deepEqual(
    await readFile(path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe')),
    fixture.installer,
  );
});

test('rejects an installer URL that is not the exact versioned file name', async (t) => {
  const fixture = await createFixture(t, {
    url: '../CosStage-Setup-1.1.0-x64.exe',
  });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /files\.url.*CosStage-Setup-1\.1\.0-x64\.exe/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects a latest.yml path that does not match files.url', async (t) => {
  const fixture = await createFixture(t, {
    metadataPath: 'nested/CosStage-Setup-1.1.0-x64.exe',
  });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /latest\.yml path.*files\.url/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects missing and empty blockmaps before creating derived artifacts', async (t) => {
  for (const overrides of [{ missingBlockmap: true }, { blockmap: '' }]) {
    await t.test(overrides.missingBlockmap ? 'missing' : 'empty', async (subtest) => {
      const fixture = await createFixture(subtest, overrides);

      await assert.rejects(
        verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
        /blockmap.*(?:missing|empty)/i,
      );

      await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
    });
  }
});

test('rejects a mismatched installer size before creating derived artifacts', async (t) => {
  const fixture = await createFixture(t, { size: 1 });

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /files\.size.*actual installer size/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('removes stale derived artifacts and temps when a later validation fails', async (t) => {
  const fixture = await createFixture(t);
  await verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version });
  await writeFile(
    path.join(fixture.releaseDir, `.${fixture.expectedName}.sha256.stale.tmp`),
    'stale sha temp',
  );
  await writeFile(
    path.join(fixture.releaseDir, '.CosStage-Setup-x64.exe.stale.tmp'),
    'stale alias temp',
  );
  await writeFile(
    path.join(fixture.releaseDir, 'latest.yml'),
    fixture.metadata.replace(/^ {4}sha512: \S+$/m, '    sha512: invalid'),
  );

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /top-level sha512.*files\.sha512/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, fixture.expectedName);
});

test('rejects a non-file alias without deleting it or other stale outputs', async (t) => {
  const fixture = await createFixture(t);
  const sha256Path = path.join(fixture.releaseDir, `${fixture.expectedName}.sha256`);
  const aliasPath = path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe');
  const markerPath = path.join(aliasPath, 'do-not-delete.txt');
  await writeFile(sha256Path, 'preexisting sha output');
  await mkdir(aliasPath);
  await writeFile(markerPath, 'keep me');

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /CosStage-Setup-x64\.exe.*(?:regular file|symbolic link)/i,
  );

  assert.equal(await readFile(sha256Path, 'utf8'), 'preexisting sha output');
  assert.equal(await readFile(markerPath, 'utf8'), 'keep me');
});

test('rejects a stale temp directory without recursively deleting its marker', async (t) => {
  const fixture = await createFixture(t);
  const tempPath = path.join(fixture.releaseDir, '.CosStage-Setup-x64.exe.stale.tmp');
  const markerPath = path.join(tempPath, 'do-not-delete.txt');
  await mkdir(tempPath);
  await writeFile(markerPath, 'keep me');
  await writeFile(
    path.join(fixture.releaseDir, 'latest.yml'),
    fixture.metadata.replace(/^ {4}sha512: \S+$/m, '    sha512: invalid'),
  );

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: fixture.version }),
    /stale temp.*(?:regular file|symbolic link)/i,
  );

  assert.equal(await readFile(markerPath, 'utf8'), 'keep me');
});

test('rolls back only invocation-owned paths when alias promotion fails', async (t) => {
  const fixture = await createFixture(t);
  const aliasPath = path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe');
  const markerPath = path.join(aliasPath, 'do-not-delete.txt');
  const linkFile = async (sourcePath, destinationPath) => {
    if (destinationPath === aliasPath) {
      await mkdir(aliasPath);
      await writeFile(markerPath, 'keep me');
    }
    await link(sourcePath, destinationPath);
  };

  await assert.rejects(
    verifyBuilderOutput({
      releaseDir: fixture.releaseDir,
      version: fixture.version,
      fileOperations: { link: linkFile },
    }),
    /installer alias promotion.*EEXIST/i,
  );

  assert.equal(await readFile(markerPath, 'utf8'), 'keep me');
  await assert.rejects(
    access(path.join(fixture.releaseDir, `${fixture.expectedName}.sha256`)),
    { code: 'ENOENT' },
  );
  assert.deepEqual(
    (await readdir(fixture.releaseDir)).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('no-replace SHA-256 promotion preserves an external final marker', async (t) => {
  const fixture = await createFixture(t);
  const sha256Path = path.join(fixture.releaseDir, `${fixture.expectedName}.sha256`);
  const marker = 'external sha marker';
  const fileOperations = {
    async link(sourcePath, destinationPath) {
      if (destinationPath === sha256Path) {
        await writeFile(destinationPath, marker, { flag: 'wx' });
      }
      return link(sourcePath, destinationPath);
    },
  };

  await assert.rejects(
    verifyBuilderOutput({
      releaseDir: fixture.releaseDir,
      version: fixture.version,
      fileOperations,
    }),
    /SHA-256 promotion.*EEXIST/i,
  );

  assert.equal(await readFile(sha256Path, 'utf8'), marker);
  await assert.rejects(
    access(path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe')),
    { code: 'ENOENT' },
  );
  await assertNoOwnedTempsOrQuarantines(fixture.releaseDir);
});

test('no-replace alias promotion preserves an external final marker', async (t) => {
  const fixture = await createFixture(t);
  const sha256Path = path.join(fixture.releaseDir, `${fixture.expectedName}.sha256`);
  const aliasPath = path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe');
  const marker = 'external alias marker';
  const fileOperations = {
    async link(sourcePath, destinationPath) {
      if (destinationPath === aliasPath) {
        await writeFile(destinationPath, marker, { flag: 'wx' });
      }
      return link(sourcePath, destinationPath);
    },
  };

  await assert.rejects(
    verifyBuilderOutput({
      releaseDir: fixture.releaseDir,
      version: fixture.version,
      fileOperations,
    }),
    /installer alias promotion.*EEXIST/i,
  );

  assert.equal(await readFile(aliasPath, 'utf8'), marker);
  await assert.rejects(access(sha256Path), { code: 'ENOENT' });
  await assertNoOwnedTempsOrQuarantines(fixture.releaseDir);
});

test('keeps stale artifact identities as bigint beyond Number safe range', async (t) => {
  const fixture = await createFixture(t);
  const sha256Path = path.join(fixture.releaseDir, `${fixture.expectedName}.sha256`);
  await writeFile(sha256Path, 'stale sha output');
  const fakeIdentities = new Map();
  let identityCount = 0n;
  let lstatCalls = 0;
  const bigintBase = BigInt(Number.MAX_SAFE_INTEGER) + 10_000n;
  const lstatBigint = async (filePath, options) => {
    assert.deepEqual(options, { bigint: true });
    lstatCalls += 1;
    const fileStat = await lstat(filePath, options);
    const realIdentity = `${fileStat.dev}:${fileStat.ino}`;
    if (!fakeIdentities.has(realIdentity)) {
      identityCount += 1n;
      fakeIdentities.set(realIdentity, {
        dev: bigintBase + identityCount,
        ino: bigintBase + 1_000n + identityCount,
      });
    }
    const fakeIdentity = fakeIdentities.get(realIdentity);
    return new Proxy(fileStat, {
      get(target, property) {
        if (property === 'dev' || property === 'ino') return fakeIdentity[property];
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };

  await verifyBuilderOutput({
    releaseDir: fixture.releaseDir,
    version: fixture.version,
    fileOperations: { lstat: lstatBigint },
  });

  assert.ok(lstatCalls > 0);
  assert.equal(typeof fakeIdentities.values().next().value.ino, 'bigint');
});

test('quarantines and preserves a stale path replaced after preflight lstat', async (t) => {
  const fixture = await createFixture(t);
  const sha256Path = path.join(fixture.releaseDir, `${fixture.expectedName}.sha256`);
  const displacedPath = `${sha256Path}.displaced`;
  const markerPath = path.join(sha256Path, 'do-not-delete.txt');
  await writeFile(sha256Path, 'stale sha output');
  let quarantinePath;
  const largeInode = 2n ** 53n;
  assert.equal(Number(largeInode), Number(largeInode + 1n));
  const fileOperations = {
    async lstat(filePath, options) {
      assert.deepEqual(options, { bigint: true });
      const fileStat = await lstat(filePath, options);
      if (filePath !== sha256Path && filePath !== quarantinePath) return fileStat;
      return new Proxy(fileStat, {
        get(target, property) {
          if (property === 'dev') return 7n;
          if (property === 'ino') {
            return filePath === quarantinePath ? largeInode + 1n : largeInode;
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    async rename(sourcePath, destinationPath) {
      if (sourcePath === sha256Path) {
        quarantinePath = destinationPath;
        await rename(sourcePath, displacedPath);
        await mkdir(sourcePath);
        await writeFile(markerPath, 'keep me');
      }
      return rename(sourcePath, destinationPath);
    },
  };

  await assert.rejects(
    verifyBuilderOutput({
      releaseDir: fixture.releaseDir,
      version: fixture.version,
      fileOperations,
    }),
    (error) => {
      assert.ok(error.message.includes(sha256Path));
      assert.ok(error.message.includes(quarantinePath));
      return true;
    },
  );

  assert.equal(await readFile(markerPath, 'utf8'), 'keep me');
  assert.equal(await readFile(displacedPath, 'utf8'), 'stale sha output');
});

test('rollback preserves a replaced owned path when its public path is occupied', async (t) => {
  const fixture = await createFixture(t);
  const aliasPath = path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe');
  let aliasTempPath;
  let displacedOwnedPath;
  let quarantinePath;
  let markerPath;
  const fileOperations = {
    async lstat(filePath, options) {
      assert.deepEqual(options, { bigint: true });
      const fileStat = await lstat(filePath, options);
      if (filePath === quarantinePath) {
        await writeFile(aliasTempPath, 'external public occupant');
      }
      return fileStat;
    },
    async rename(sourcePath, destinationPath) {
      if (sourcePath === aliasTempPath) {
        quarantinePath = destinationPath;
        displacedOwnedPath = `${aliasTempPath}.displaced`;
        await rename(sourcePath, displacedOwnedPath);
        await mkdir(sourcePath);
        markerPath = path.join(sourcePath, 'do-not-delete.txt');
        await writeFile(markerPath, 'keep me');
      }
      return rename(sourcePath, destinationPath);
    },
    async link(sourcePath, destinationPath) {
      if (destinationPath === aliasPath) {
        aliasTempPath = sourcePath;
        throw new Error('simulated alias promotion failure');
      }
      return link(sourcePath, destinationPath);
    },
  };

  await assert.rejects(
    verifyBuilderOutput({
      releaseDir: fixture.releaseDir,
      version: fixture.version,
      fileOperations,
    }),
    (error) => {
      assert.match(error.message, /cleanup failed/i);
      assert.ok(error.message.includes(aliasTempPath));
      assert.ok(error.message.includes(quarantinePath));
      return true;
    },
  );

  assert.equal(await readFile(aliasTempPath, 'utf8'), 'external public occupant');
  assert.equal(await readFile(displacedOwnedPath, 'utf8'), fixture.installer.toString());
  assert.equal(
    await readFile(path.join(quarantinePath, path.basename(markerPath)), 'utf8'),
    'keep me',
  );
});

test('rejects non-canonical versions before reading or writing release artifacts', async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    verifyBuilderOutput({ releaseDir: fixture.releaseDir, version: '1.0.01' }),
    /strict x\.y\.z version/,
  );

  await assertNoDerivedArtifacts(fixture.releaseDir, 'CosStage-Setup-1.0.01-x64.exe');
});

test('electron-builder validates local and production Windows x64 NSIS configs', () => {
  const localResult = validateBuilderConfig();
  const productionResult = validateBuilderConfig({
    COSSTAGE_REQUIRE_CODE_SIGNING: 'true',
    COSSTAGE_WINDOWS_PUBLISHER_NAME: 'CosStage Publisher',
  });
  assert.equal(localResult.status, 0, localResult.stderr);
  assert.equal(productionResult.status, 0, productionResult.stderr);
  const localConfig = JSON.parse(localResult.stdout);
  const productionConfig = JSON.parse(productionResult.stdout);

  assert.equal(localConfig.forceCodeSigning, false);
  assert.equal(localConfig.win.signtoolOptions, undefined);
  assert.equal(productionConfig.forceCodeSigning, true);
  assert.deepEqual(
    productionConfig.win.signtoolOptions.publisherName,
    ['CosStage Publisher'],
  );
  assert.deepEqual(productionConfig.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(productionConfig.releaseInfo.releaseNotesFile, 'build/release-notes.md');
  assert.equal(productionConfig.appId, 'com.choreomaster.app');
  assert.equal(productionConfig.productName, 'CosStage');
  assert.equal(productionConfig.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(productionConfig.nsis.deleteAppDataOnUninstall, false);
});

test('production builder config rejects a missing publisher before packaging', () => {
  const result = validateBuilderConfig({
    COSSTAGE_REQUIRE_CODE_SIGNING: 'true',
    COSSTAGE_WINDOWS_PUBLISHER_NAME: '   ',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COSSTAGE_WINDOWS_PUBLISHER_NAME.*required/);
});

test('signature gate only permits explicitly allowed NotSigned dry-runs', async () => {
  const [source, helpers] = await Promise.all([
    readFile(signatureScriptPath, 'utf8'),
    readFile(signatureHelpersPath, 'utf8'),
  ]);

  assert.match(source, /Assert-ExactProductVersion/);
  assert.match(source, /\$AllowUnsigned -and \$signature\.Status -eq 'NotSigned'/);
  assert.match(source, /if \(\$signature\.Status -ne 'Valid'\)/);
  assert.match(source, /GetNameInfo\([\s\S]*X509NameType\]::SimpleName,[\s\S]*\$false\s*\)/);
  assert.match(source, /Assert-ExactPublisherName/);
  assert.match(helpers, /StringComparison\]::Ordinal\s*\)/);
  assert.match(helpers, /StringComparison\]::OrdinalIgnoreCase\s*\)/);
  assert.match(helpers, /ExpectedPublisher is required for signed production artifacts/);
});

test('PowerShell helper requires an exact ProductVersion', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const harnessPath = await createSignatureHelperHarness(t);
  const exact = runSignatureHelper(harnessPath, 'version', '1.0.0', '1.0.0');
  assert.equal(exact.status, 0, `${exact.stdout}\n${exact.stderr}`);

  for (const actual of ['1.0.0.999', '1.0.0-malicious', '1.0.0 ']) {
    const result = runSignatureHelper(harnessPath, 'version', actual, '1.0.0');
    assert.notEqual(result.status, 0, `accepted ProductVersion ${JSON.stringify(actual)}`);
  }
});

test('PowerShell helper compares the certificate SimpleName exactly', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const harnessPath = await createSignatureHelperHarness(t);
  const exact = runSignatureHelper(
    harnessPath,
    'publisher',
    'CosStage Publisher',
    'cosstage publisher',
  );
  assert.equal(exact.status, 0, `${exact.stdout}\n${exact.stderr}`);

  const substring = runSignatureHelper(
    harnessPath,
    'publisher',
    'CosStage Publisher LLC',
    'CosStage Publisher',
  );
  assert.notEqual(substring.status, 0);
});

test('builds shell-free PowerShell argument arrays for dry-run and production', () => {
  const dryRun = createWindowsSignatureInvocation({
    installerPath: 'C:\\release with spaces\\CosStage.exe',
    scriptPath: 'C:\\scripts with spaces\\verify.ps1',
    version: '1.2.3',
    allowUnsigned: true,
    expectedPublisher: '  CosStage Publisher  ',
    platform: 'win32',
  });
  assert.equal(dryRun.command, 'powershell.exe');
  assert.equal(dryRun.options.shell, false);
  assert.ok(dryRun.args.includes('C:\\release with spaces\\CosStage.exe'));
  assert.ok(dryRun.args.includes('C:\\scripts with spaces\\verify.ps1'));
  assert.ok(dryRun.args.includes('-AllowUnsigned'));
  assert.deepEqual(
    dryRun.args.slice(dryRun.args.indexOf('-ExpectedPublisher')),
    ['-ExpectedPublisher', 'CosStage Publisher'],
  );

  const unsignedOnly = createWindowsSignatureInvocation({
    installerPath: 'C:\\release\\CosStage.exe',
    scriptPath: 'C:\\scripts\\verify.ps1',
    version: '1.2.3',
    allowUnsigned: true,
    platform: 'win32',
  });
  assert.ok(unsignedOnly.args.includes('-AllowUnsigned'));
  assert.ok(!unsignedOnly.args.includes('-ExpectedPublisher'));

  const production = createWindowsSignatureInvocation({
    installerPath: 'C:\\release\\CosStage.exe',
    scriptPath: 'C:\\scripts\\verify.ps1',
    version: '1.2.3',
    expectedPublisher: 'CosStage Publisher',
    platform: 'win32',
  });
  assert.ok(!production.args.includes('-AllowUnsigned'));
  assert.deepEqual(
    production.args.slice(production.args.indexOf('-ExpectedPublisher')),
    ['-ExpectedPublisher', 'CosStage Publisher'],
  );
  assert.throws(
    () => createWindowsSignatureInvocation({
      installerPath: 'installer.exe',
      scriptPath: 'verify.ps1',
      version: '1.2.3',
      platform: 'linux',
    }),
    /requires Windows/,
  );
  assert.throws(
    () => createWindowsSignatureInvocation({
      installerPath: 'installer.exe',
      scriptPath: 'verify.ps1',
      version: '1.2.3',
      platform: 'win32',
    }),
    /expectedPublisher.*required/,
  );
});

test('reads package version and runs Builder verification before the signature gate', async (t) => {
  const fixture = await createReleaseProjectFixture(t, '1.2.3');
  const events = [];

  const result = await verifyReleaseArtifacts({
    root: fixture.projectRoot,
    allowUnsigned: true,
    env: { COSSTAGE_WINDOWS_PUBLISHER_NAME: '  CosStage Publisher  ' },
    verifyBuilder: async (options) => {
      events.push(['builder', options.version]);
      return verifyBuilderOutput(options);
    },
    runSignature: async (options) => {
      events.push([
        'signature',
        options.version,
        options.allowUnsigned,
        options.expectedPublisher,
      ]);
      await access(path.join(fixture.releaseDir, 'CosStage-Setup-x64.exe'));
    },
  });

  assert.deepEqual(events, [
    ['builder', '1.2.3'],
    ['signature', '1.2.3', true, 'CosStage Publisher'],
  ]);
  assert.equal(path.basename(result.installerPath), fixture.expectedName);
});

test('production orchestration requires and forwards the configured publisher', async (t) => {
  const fixture = await createReleaseProjectFixture(t, '1.2.3');
  await assert.rejects(
    verifyReleaseArtifacts({
      root: fixture.projectRoot,
      env: {},
      runSignature: async () => assert.fail('signature runner must not execute'),
    }),
    /COSSTAGE_WINDOWS_PUBLISHER_NAME.*required/,
  );

  let signatureOptions;
  await verifyReleaseArtifacts({
    root: fixture.projectRoot,
    env: { COSSTAGE_WINDOWS_PUBLISHER_NAME: '  CosStage Publisher  ' },
    runSignature: async (options) => {
      signatureOptions = options;
    },
  });
  assert.equal(signatureOptions.allowUnsigned, false);
  assert.equal(signatureOptions.expectedPublisher, 'CosStage Publisher');
});

test('release scripts keep version packaging tests and do not recurse', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  assert.match(pkg.scripts['test:release'], /tests\/version-packages\.test\.mjs/);
  assert.match(pkg.scripts['test:release'], /tests\/release-artifacts\.test\.mjs/);
  assert.match(pkg.scripts['build:electron:win'], /electron-builder --win nsis --x64/);
  assert.equal(
    pkg.scripts['verify:release-artifacts'],
    'node scripts/release/verify-release-artifacts.mjs',
  );
  assert.match(pkg.scripts['release:dry-run'], /npm run validate:release-data/);
  assert.match(pkg.scripts['release:dry-run'], /npm test/);
  assert.match(pkg.scripts['release:dry-run'], /npm run build:electron:win/);
  assert.match(
    pkg.scripts['release:dry-run'],
    /npm run verify:release-artifacts -- --allow-unsigned/,
  );
  assert.doesNotMatch(pkg.scripts['release:dry-run'], /release:dry-run/);
  assert.doesNotMatch(pkg.scripts['build:electron:win'], /build:electron:win/);
});
