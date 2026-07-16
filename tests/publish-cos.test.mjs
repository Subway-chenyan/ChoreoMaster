import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publishScript = path.join(root, 'scripts', 'release', 'publish-cos.sh');
const version = '1.1.0';

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  return 'C:\\Program Files\\Git\\bin\\bash.exe';
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, 'utf8');
  await chmod(filePath, 0o755);
}

function releaseHistory() {
  return {
    schemaVersion: 1,
    currentVersion: version,
    releases: [{
      version,
      date: '2026-07-16',
      kind: 'minor',
      title: `CosStage ${version}`,
      summary: 'atomic desktop release',
      changes: [{ kind: 'minor', text: 'atomic release' }],
      breakingChanges: [],
      migrationSteps: [],
    }],
  };
}

async function createFixture(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'cosstage-publish-cos-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const desktop = path.join(workspace, 'desktop');
  const releaseScripts = path.join(workspace, 'scripts', 'release');
  const mockBin = path.join(workspace, 'mock-bin');
  const tempDir = path.join(workspace, 'temp');
  await Promise.all([
    mkdir(desktop, { recursive: true }),
    mkdir(releaseScripts, { recursive: true }),
    mkdir(mockBin, { recursive: true }),
    mkdir(path.join(workspace, 'data'), { recursive: true }),
    mkdir(tempDir, { recursive: true }),
  ]);

  await copyFile(publishScript, path.join(workspace, 'publish-cos.sh'));
  await copyFile(
    path.join(root, 'scripts', 'release', 'published-index.mjs'),
    path.join(releaseScripts, 'published-index.mjs'),
  );
  await copyFile(
    path.join(root, 'scripts', 'release', 'release-model.mjs'),
    path.join(releaseScripts, 'release-model.mjs'),
  );

  const installerName = `CosStage-Setup-${version}-x64.exe`;
  const installer = Buffer.from('signed installer fixture');
  const sha256 = createHash('sha256').update(installer).digest('hex');
  await Promise.all([
    writeFile(path.join(desktop, installerName), installer),
    writeFile(path.join(desktop, `${installerName}.blockmap`), 'blockmap fixture\n'),
    writeFile(path.join(desktop, `${installerName}.sha256`), `${sha256}  ${installerName}\n`),
    writeFile(path.join(desktop, 'CosStage-Setup-x64.exe'), installer),
    writeFile(path.join(desktop, 'latest.yml'), `version: ${version}\npath: ${installerName}\n`),
    writeFile(path.join(desktop, 'release-notes.md'), '# Release notes\n'),
    writeFile(path.join(workspace, 'data', 'release-history.json'), `${JSON.stringify(releaseHistory())}\n`),
    writeFile(path.join(workspace, 'releases.previous.json'), ''),
  ]);

  const logPath = path.join(workspace, 'commands.log');
  await writeFile(logPath, '');
  await writeExecutable(path.join(mockBin, 'coscli'), `#!/usr/bin/env bash
set -euo pipefail
printf 'coscli %s\\n' "$*" >> "$MOCK_LOG"
if [ "\${1:-}" = 'cp' ] && [[ "\${2:-}" == cos://production/* ]]; then
  object="\${2#cos://production/}"
  destination="$3"
  if [ "$MOCK_SCENARIO" = 'origin-error' ]; then
    echo 'AccessDenied: HTTP 403' >&2
    exit 1
  fi
  if [ "$MOCK_SCENARIO" = 'upload-uncertain-same' ] \
    && [ "$object" = "downloads/CosStage-Setup-$VERSION-x64.exe" ] \
    && [ -f "$MOCK_STATE" ]; then
    cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe" "$destination"
    exit 0
  fi
  if [ "$MOCK_SCENARIO" = 'immutable-mismatch' ] && [ "$object" = "downloads/CosStage-Setup-$VERSION-x64.exe" ]; then
    printf 'different immutable bytes' > "$destination"
    exit 0
  fi
  if [ "$MOCK_SCENARIO" = 'existing-same' ]; then
    case "$object" in
      "downloads/CosStage-Setup-$VERSION-x64.exe")
        cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe" "$destination"
        ;;
      "downloads/CosStage-Setup-$VERSION-x64.exe.blockmap")
        cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe.blockmap" "$destination"
        ;;
      "downloads/CosStage-Setup-$VERSION-x64.exe.sha256")
        cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe.sha256" "$destination"
        ;;
      "downloads/metadata/$VERSION/latest.yml")
        cp "$MOCK_ROOT/desktop/latest.yml" "$destination"
        ;;
      "downloads/release-notes-$VERSION.md")
        cp "$MOCK_ROOT/desktop/release-notes.md" "$destination"
        ;;
      *)
        echo "unexpected immutable object: $object" >&2
        exit 64
        ;;
    esac
    exit 0
  fi
  echo "NoSuchKey: HTTP 404" >&2
  exit 1
fi
if [ "$MOCK_SCENARIO" = 'upload-uncertain-same' ] \
  && [ "\${2:-}" = "desktop/CosStage-Setup-$VERSION-x64.exe" ] \
  && [ "\${3:-}" = "cos://production/downloads/CosStage-Setup-$VERSION-x64.exe" ]; then
  : > "$MOCK_STATE"
  echo 'request timed out after COS accepted the object'
  exit 1
fi
`);
  await writeExecutable(path.join(mockBin, 'tccli'), `#!/usr/bin/env bash
set -euo pipefail
printf 'tccli %s\\n' "$*" >> "$MOCK_LOG"
`);
  await writeExecutable(path.join(mockBin, 'git'), `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "$MOCK_LOG"
`);
  await writeExecutable(path.join(mockBin, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
printf 'gh %s\\n' "$*" >> "$MOCK_LOG"
`);
  await writeExecutable(path.join(mockBin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-D)
      output="$2"
      shift 2
      ;;
    -w|--write-out)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
printf 'curl %s\\n' "$url" >> "$MOCK_LOG"
if [ "$MOCK_SCENARIO" = 'verify-fail' ] && [[ "$url" == *'CosStage-Setup-x64.exe?'* ]]; then
  exit 22
fi
case "$url" in
  *"CosStage-Setup-$VERSION-x64.exe.blockmap?"*)
    cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe.blockmap" "$output"
    ;;
  *"CosStage-Setup-$VERSION-x64.exe.sha256?"*)
    cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe.sha256" "$output"
    ;;
  *"CosStage-Setup-$VERSION-x64.exe?"*)
    cp "$MOCK_ROOT/desktop/CosStage-Setup-$VERSION-x64.exe" "$output"
    ;;
  *"CosStage-Setup-x64.exe?"*)
    cp "$MOCK_ROOT/desktop/CosStage-Setup-x64.exe" "$output"
    ;;
  *"downloads/metadata/$VERSION/latest.yml?"*)
    cp "$MOCK_ROOT/desktop/latest.yml" "$output"
    ;;
  *"release-notes-$VERSION.md?"*)
    cp "$MOCK_ROOT/desktop/release-notes.md" "$output"
    ;;
  *'downloads/latest.yml?'*)
    cp "$MOCK_ROOT/desktop/latest.yml" "$output"
    ;;
  *'downloads/releases.json?'*)
    cp "$MOCK_ROOT/releases.next.json" "$output"
    ;;
  *)
    echo "unexpected curl URL: $url" >&2
    exit 64
    ;;
esac
`);

  return { workspace, mockBin, tempDir, logPath, installerName };
}

function runPublish(fixture, scenario = 'fresh', envOverrides = {}) {
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'),
  );
  const bashCommand = process.platform === 'win32'
    ? 'export PATH="$(cygpath -u "$MOCK_BIN"):$PATH"; exec ./publish-cos.sh'
    : 'export PATH="$MOCK_BIN:$PATH"; exec ./publish-cos.sh';
  return spawnSync(bashExecutable(), ['-c', bashCommand], {
    cwd: fixture.workspace,
    env: {
      ...inheritedEnvironment,
      PATH: `${fixture.mockBin}${path.delimiter}${process.env.PATH}`,
      TMPDIR: fixture.tempDir,
      MOCK_LOG: fixture.logPath,
      MOCK_BIN: fixture.mockBin,
      MOCK_ROOT: fixture.workspace,
      MOCK_STATE: path.join(fixture.workspace, 'cos-state'),
      MOCK_SCENARIO: scenario,
      VERSION: version,
      CDN_URL: 'https://beat.cosdrama.cn/',
      INSTALLER_URL: 'https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe',
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      TENCENT_SECRET_ID: 'test-secret-id',
      TENCENT_SECRET_KEY: 'test-secret-key',
      COSSTAGE_VERIFY_ATTEMPTS: '1',
      COSSTAGE_VERIFY_DELAY: '0',
      ...envOverrides,
    },
    encoding: 'utf8',
  });
}

async function assertNoTempFiles(fixture) {
  assert.deepEqual(await readdir(fixture.tempDir), []);
}

test('publish script is executable and avoids unsafe shell constructs', async () => {
  const source = await readFile(publishScript, 'utf8');
  const fileStat = await stat(publishScript);

  assert.match(source, /^#!\/usr\/bin\/env bash\nset -euo pipefail\n/);
  assert.doesNotMatch(source, /\beval\b/);
  assert.doesNotMatch(source, /rm\s+[^\n]*(?:-r|-R|--recursive)/);
  assert.match(source, /--forbid-overwrite/);
  assert.equal(source.lastIndexOf('coscli cp'), source.indexOf('coscli cp desktop/latest.yml'));
  if (process.platform !== 'win32') assert.notEqual(fileStat.mode & 0o111, 0);
});

test('immutable mismatch aborts before uploads, tags, and releases and cleans temps', async (t) => {
  const fixture = await createFixture(t);

  const result = runPublish(fixture, 'immutable-mismatch');

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Immutable object differs/);
  const log = await readFile(fixture.logPath, 'utf8');
  assert.doesNotMatch(log, /^coscli cp (?:desktop\/|releases\.next\.json)/m);
  assert.doesNotMatch(log, /^git (?:tag|push)/m);
  assert.doesNotMatch(log, /^gh release create/m);
  await assertNoTempFiles(fixture);
});

test('invalid version and mismatched local sidecar fail before any COS write', async (t) => {
  const invalidVersionFixture = await createFixture(t);
  const invalidVersion = runPublish(invalidVersionFixture, 'fresh', { VERSION: '1.1' });
  assert.notEqual(invalidVersion.status, 0);
  assert.doesNotMatch(await readFile(invalidVersionFixture.logPath, 'utf8'), /^coscli /m);

  const sidecarFixture = await createFixture(t);
  await writeFile(
    path.join(sidecarFixture.workspace, 'desktop', `${sidecarFixture.installerName}.sha256`),
    `${'0'.repeat(64)}  ${sidecarFixture.installerName}\n`,
  );
  const sidecarMismatch = runPublish(sidecarFixture);
  assert.notEqual(sidecarMismatch.status, 0);
  assert.doesNotMatch(await readFile(sidecarFixture.logPath, 'utf8'), /^coscli /m);
});

test('authenticated COS read errors fail closed before any write', async (t) => {
  const fixture = await createFixture(t);

  const result = runPublish(fixture, 'origin-error');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + '\n' + result.stderr, /AccessDenied|Unable to check immutable COS object/);
  const log = await readFile(fixture.logPath, 'utf8');
  assert.doesNotMatch(log, /^coscli cp (?:desktop\/|releases\.next\.json)/m);
  assert.doesNotMatch(log, /^git (?:tag|push)/m);
  assert.doesNotMatch(log, /^gh release create/m);
  await assertNoTempFiles(fixture);
});

test('verification failure after pointer writes never creates a tag or GitHub release', async (t) => {
  const fixture = await createFixture(t);

  const result = runPublish(fixture, 'verify-fail');

  assert.notEqual(result.status, 0);
  const log = await readFile(fixture.logPath, 'utf8');
  assert.match(log, /coscli cp desktop\/latest\.yml cos:\/\/production\/downloads\/latest\.yml/);
  assert.doesNotMatch(log, /^git (?:tag|push)/m);
  assert.doesNotMatch(log, /^gh release create/m);
  await assertNoTempFiles(fixture);
});

test('successful publish writes immutables then pointers with root latest last before tag and release', async (t) => {
  const fixture = await createFixture(t);

  const result = runPublish(fixture);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const log = await readFile(fixture.logPath, 'utf8');
  const cosWrites = log
    .split(/\r?\n/)
    .filter((line) => /^coscli cp (?:desktop\/|releases\.next\.json)/.test(line));
  assert.deepEqual(
    cosWrites.map((line) => line.match(/cos:\/\/production\/\S+/)?.[0]),
    [
      `cos://production/downloads/CosStage-Setup-${version}-x64.exe`,
      `cos://production/downloads/CosStage-Setup-${version}-x64.exe.blockmap`,
      `cos://production/downloads/CosStage-Setup-${version}-x64.exe.sha256`,
      `cos://production/downloads/metadata/${version}/latest.yml`,
      `cos://production/downloads/release-notes-${version}.md`,
      'cos://production/downloads/CosStage-Setup-x64.exe',
      'cos://production/downloads/releases.json',
      'cos://production/downloads/latest.yml',
    ],
  );
  const verifyPosition = log.lastIndexOf('curl https://beat.cosdrama.cn/downloads/releases.json?');
  const configureName = log.indexOf('git config user.name cosstage-release-bot');
  const configureEmail = log.indexOf('git config user.email releases@cosstage.invalid');
  const tagPosition = log.indexOf(`git tag -a v${version}`);
  const pushPosition = log.indexOf(`git push origin v${version}`);
  const releasePosition = log.indexOf(`gh release create v${version}`);
  assert.ok(verifyPosition >= 0);
  assert.ok(verifyPosition < configureName);
  assert.ok(configureName < configureEmail);
  assert.ok(configureEmail < tagPosition);
  assert.ok(tagPosition < pushPosition);
  assert.ok(pushPosition < releasePosition);
  await assertNoTempFiles(fixture);
});

test('matching immutable COS objects are reused without rewriting them', async (t) => {
  const fixture = await createFixture(t);

  const result = runPublish(fixture, 'existing-same');

  assert.equal(result.status, 0, 'stdout:\n' + result.stdout + '\nstderr:\n' + result.stderr);
  const log = await readFile(fixture.logPath, 'utf8');
  const immutableWrites = log
    .split(/\r?\n/)
    .filter((line) => /cos:\/\/production\/downloads\/(?:CosStage-Setup-1\.1\.0|metadata\/1\.1\.0|release-notes-1\.1\.0)/.test(line))
    .filter((line) => line.startsWith('coscli cp desktop/'));
  assert.deepEqual(immutableWrites, []);
  assert.match(
    log,
    /coscli cp desktop\/CosStage-Setup-x64\.exe cos:\/\/production\/downloads\/CosStage-Setup-x64\.exe/,
  );
  await assertNoTempFiles(fixture);
});

test('an uncertain create is recovered by reading and matching the COS object', async (t) => {
  const fixture = await createFixture(t);

  const result = runPublish(fixture, 'upload-uncertain-same');

  assert.equal(result.status, 0, 'stdout:\n' + result.stdout + '\nstderr:\n' + result.stderr);
  const log = await readFile(fixture.logPath, 'utf8');
  const installerReads = log
    .split(/\r?\n/)
    .filter((line) => line.startsWith(
      'coscli cp cos://production/downloads/CosStage-Setup-1.1.0-x64.exe ',
    ));
  assert.equal(installerReads.length, 2);
  assert.match(log, /^git tag -a v1\.1\.0/m);
  assert.match(log, /^gh release create v1\.1\.0/m);
  await assertNoTempFiles(fixture);
});
