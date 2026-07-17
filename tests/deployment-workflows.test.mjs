import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowsDir = path.join(root, '.github', 'workflows');
const actionRefs = {
  checkout: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  setupPython: 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  downloadArtifact: 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
};
const actionVersions = {
  [actionRefs.checkout]: 'v4.3.1',
  [actionRefs.setupNode]: 'v4.4.0',
  [actionRefs.setupPython]: 'v5.6.0',
  [actionRefs.uploadArtifact]: 'v4.6.2',
  [actionRefs.downloadArtifact]: 'v4.3.0',
};

function normalizeSource(source) {
  return source.replace(/\r\n?/g, '\n');
}

async function canonicalPath(candidate) {
  const resolved = await realpath(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function readWorkflow(name) {
  const source = normalizeSource(await readFile(path.join(workflowsDir, name), 'utf8'));
  const workflow = load(source);
  assert.equal(typeof workflow, 'object');
  assert.notEqual(workflow, null);
  return { source, workflow };
}

function findStep(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing step: ${name}`);
  return step;
}

function assertOfficialActionsPinned(workflow, source) {
  const uses = Object.values(workflow.jobs).flatMap((job) => [
    ...(typeof job.uses === 'string' ? [job.uses] : []),
    ...(job.steps ?? []).flatMap((step) => (typeof step.uses === 'string' ? [step.uses] : [])),
  ]).filter((value) => !value.startsWith('./'));

  assert.ok(uses.length > 0);
  for (const action of uses) {
    assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
    assert.ok(Object.hasOwn(actionVersions, action), `unverified action pin: ${action}`);
    assert.ok(
      source.includes(`uses: ${action} # ${actionVersions[action]}`),
      `missing verified version comment for ${action}`,
    );
  }
  assert.doesNotMatch(source, /uses:\s+actions\/[a-z-]+@v\d/);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  return 'C:\\Program Files\\Git\\bin\\bash.exe';
}

async function commit(repo, message) {
  run('git', ['add', '.'], { cwd: repo });
  run('git', ['commit', '-m', message], { cwd: repo });
}

async function runGate(repo, script, forceDeploy = false) {
  const outputName = '.gate-output';
  await writeFile(path.join(repo, outputName), '', 'utf8');
  run(bashExecutable(), ['-c', script], {
    cwd: repo,
    env: {
      ...process.env,
      FORCE_DEPLOY: String(forceDeploy),
      GITHUB_OUTPUT: outputName,
    },
  });
  return readFile(path.join(repo, outputName), 'utf8');
}

async function runDetect(repo, script, mockBin, ghMode) {
  const outputName = '.detect-output';
  await writeFile(path.join(repo, outputName), '', 'utf8');
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: repo });
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'),
  );
  const bashCommand = process.platform === 'win32'
    ? 'export PATH="$(cygpath -u "$MOCK_BIN"):$PATH"; bash -c "$DETECT_SCRIPT"'
    : 'export PATH="$MOCK_BIN:$PATH"; bash -c "$DETECT_SCRIPT"';
  const result = spawnSync(bashExecutable(), ['-c', bashCommand], {
    cwd: repo,
    env: {
      ...inheritedEnvironment,
      PATH: process.env.PATH,
      MOCK_BIN: mockBin,
      MOCK_GH_MODE: ghMode,
      DETECT_SCRIPT: script,
      GITHUB_OUTPUT: outputName,
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: 'cosstage/test',
      GH_TOKEN: 'test-token',
    },
    encoding: 'utf8',
  });
  return {
    ...result,
    output: await readFile(path.join(repo, outputName), 'utf8'),
  };
}

test('legacy mixed deployment workflow is removed', async () => {
  await assert.rejects(
    access(path.join(workflowsDir, 'deploy-cos.yml')),
    (error) => error?.code === 'ENOENT',
  );
});

test('new deployment workflows exist', async () => {
  await access(path.join(workflowsDir, 'web-deploy.yml'));
  await access(path.join(workflowsDir, 'desktop-release.yml'));
});

test('web workflow is reusable, least-privilege, production-concurrent, and supply-chain pinned', async () => {
  const { source, workflow } = await readWorkflow('web-deploy.yml');

  assert.equal(workflow.name, 'Deploy Web');
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    workflow_call: {
      inputs: { force: { type: 'boolean', default: false } },
    },
    workflow_dispatch: null,
  });
  assert.deepEqual(workflow.concurrency, {
    group: 'deploy-web-production',
    'cancel-in-progress': true,
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['deploy']);
  assert.equal(workflow.jobs.deploy.environment, 'production');
  assert.equal(workflow.jobs.deploy['runs-on'], 'ubuntu-latest');
  assertOfficialActionsPinned(workflow, source);

  const install = findStep(workflow.jobs.deploy, 'Install verified Tencent CLIs').run;
  assert.match(install, /coscli-v1\.0\.8-linux-amd64/);
  assert.match(install, /7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91/);
  assert.match(install, /sha256sum --check --strict/);
  assert.match(install, /tccli==3\.1\.128\.1/);
  assert.ok(install.indexOf('sha256sum --check --strict') < install.indexOf('install -m 0755'));
  assert.match(install, /coscli bucket-versioning/);
  assert.match(install, /--method get/);
  assert.match(install, /--secret-id "\$TENCENT_SECRET_ID"/);
  assert.match(install, /--secret-key "\$TENCENT_SECRET_KEY"/);
  assert.match(install, /set -euo pipefail/);
  assert.match(install, /bucket versioning status is Closed/);
  assert.ok(source.indexOf('coscli bucket-versioning') < source.indexOf('- name: Upload web'));

  const upload = findStep(workflow.jobs.deploy, 'Upload web').run;
  assert.ok(upload.indexOf('coscli sync') < upload.indexOf('coscli cp ./dist/index.html'));
  assert.match(upload, /Cache-Control:no-cache/);
  assert.match(upload, /remove_legacy_object "sw\.js"/);
  assert.match(upload, /remove_legacy_object "manifest\.webmanifest"/);
  assert.match(upload, /PurgeUrlsCache/);

  const verify = findStep(workflow.jobs.deploy, 'Verify web').run;
  assert.match(verify, /expected_asset/);
  assert.match(verify, /navigator\\\.serviceWorker\|serviceWorker\\\.register/);
  assert.match(verify, /report_legacy_url/);
  assert.doesNotMatch(verify, /wait_until_unreachable/);
  assert.doesNotMatch(source, /Generate latest\.yml/);
  assert.doesNotMatch(source, /set -x|echo\s+.*TENCENT_SECRET/);
});

test('web gate deploys ordinary commits but waits only for a package version change', async (t) => {
  const { workflow } = await readWorkflow('web-deploy.yml');
  const gate = findStep(workflow.jobs.deploy, 'Detect pending release commit');
  assert.equal(gate.env.FORCE_DEPLOY, '${{ inputs.force || false }}');
  assert.doesNotMatch(gate.run, /git diff --quiet.*package\.json/);
  assert.match(gate.run, /git show HEAD\^:package\.json/);

  const repo = await mkdtemp(path.join(os.tmpdir(), 'cosstage-web-gate-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  run('git', ['init'], { cwd: repo });
  run('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: repo });
  run('git', ['config', 'user.name', 'Gate Test'], { cwd: repo });

  await writeFile(path.join(repo, 'package.json'), '{"version":"1.0.0","dependencies":{}}\n');
  await commit(repo, 'initial');
  assert.match(await runGate(repo, gate.run), /deploy=true/);

  await writeFile(path.join(repo, 'package.json'), '{"version":"1.0.0","dependencies":{"x":"1"}}\n');
  await commit(repo, 'dependency only');
  assert.match(await runGate(repo, gate.run), /deploy=true/);

  await writeFile(path.join(repo, 'app.txt'), 'ordinary change\n');
  await commit(repo, 'ordinary change');
  assert.match(await runGate(repo, gate.run), /deploy=true/);

  await writeFile(path.join(repo, 'package.json'), '{"version":"1.1.0","dependencies":{"x":"1"}}\n');
  await commit(repo, 'version change');
  assert.match(await runGate(repo, gate.run), /deploy=false/);
  assert.match(await runGate(repo, gate.run, true), /deploy=true/);

  const missingParentPackage = await mkdtemp(path.join(os.tmpdir(), 'cosstage-web-gate-parent-'));
  t.after(() => rm(missingParentPackage, { recursive: true, force: true }));
  run('git', ['init'], { cwd: missingParentPackage });
  run('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: missingParentPackage });
  run('git', ['config', 'user.name', 'Gate Test'], { cwd: missingParentPackage });
  await writeFile(path.join(missingParentPackage, 'README.md'), 'first\n');
  await commit(missingParentPackage, 'without package');
  await writeFile(path.join(missingParentPackage, 'package.json'), '{"version":"1.0.0"}\n');
  await commit(missingParentPackage, 'add package');
  assert.match(await runGate(missingParentPackage, gate.run), /deploy=true/);
});

test('desktop workflow detects safe modes, builds signed artifacts, and gates stable writes to main', async () => {
  const { source, workflow } = await readWorkflow('desktop-release.yml');

  assert.equal(workflow.name, 'Desktop Release');
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    workflow_dispatch: null,
  });
  assert.deepEqual(workflow.concurrency, {
    group: 'desktop-release-stable',
    'cancel-in-progress': false,
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), [
    'detect',
    'build-windows',
    'publish',
    'repair-release',
    'deploy-web',
  ]);
  assertOfficialActionsPinned(workflow, source);
  assert.doesNotMatch(source, /Generate latest\.yml/);

  const detect = workflow.jobs.detect;
  assert.deepEqual(detect.permissions, { contents: 'read' });
  const detectScript = findStep(detect, 'Detect release mode').run;
  assert.match(detectScript, /compareSemver/);
  assert.match(detectScript, /mode=skip/);
  assert.match(detectScript, /mode=publish/);
  assert.match(detectScript, /mode=repair-release/);
  assert.match(detectScript, /git rev-list -n 1/);
  assert.match(detectScript, /GITHUB_SHA/);
  assert.match(detectScript, /Tag .* does not target current release commit/);
  assert.match(detectScript, /version_commit/);
  assert.match(detectScript, /release\.assets/);

  const build = workflow.jobs['build-windows'];
  assert.equal(build.if, "needs.detect.outputs.mode == 'publish'");
  assert.equal(build.environment, 'production');
  const signed = findStep(build, 'Build signed installer');
  assert.deepEqual(signed.env, {
    CSC_LINK: '${{ secrets.CSC_LINK }}',
    CSC_KEY_PASSWORD: '${{ secrets.CSC_KEY_PASSWORD }}',
    COSSTAGE_REQUIRE_CODE_SIGNING: 'true',
    COSSTAGE_WINDOWS_PUBLISHER_NAME: '${{ vars.WINDOWS_PUBLISHER_NAME }}',
  });
  const verify = findStep(build, 'Verify signed release artifacts').run;
  assert.match(verify, /verify-builder-output\.mjs/);
  assert.match(verify, /verify-windows-signature\.ps1/);
  const artifact = build.steps.find((step) => step.uses === actionRefs.uploadArtifact);
  assert.ok(artifact);
  for (const required of [
    'CosStage-Setup-${{ needs.detect.outputs.version }}-x64.exe',
    'CosStage-Setup-${{ needs.detect.outputs.version }}-x64.exe.blockmap',
    'CosStage-Setup-${{ needs.detect.outputs.version }}-x64.exe.sha256',
    'CosStage-Setup-x64.exe',
    'latest.yml',
    'release-notes.md',
  ]) {
    assert.match(artifact.with.path, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(artifact.with['if-no-files-found'], 'error');
  assert.equal(artifact.with['retention-days'], 1);

  const publish = workflow.jobs.publish;
  assert.equal(
    publish.if,
    "needs.detect.outputs.mode == 'publish' && github.ref == 'refs/heads/main'",
  );
  assert.deepEqual(publish.permissions, { contents: 'write' });
  assert.equal(publish.environment, 'production');
  const installTencent = findStep(publish, 'Install and configure verified Tencent CLIs').run;
  assert.match(installTencent, /--forbid-overwrite|bucket-versioning/);
  assert.match(installTencent, /bucket versioning status is Closed/);
  const downloadIndex = findStep(publish, 'Download existing release index').run;
  assert.match(downloadIndex, /coscli cp cos:\/\/production\/downloads\/releases\.json/);
  assert.match(downloadIndex, /NoSuchKey/);
  assert.match(downloadIndex, /404/);
  assert.doesNotMatch(downloadIndex, /CDN_URL|curl/);

  const repair = workflow.jobs['repair-release'];
  assert.equal(
    repair.if,
    "needs.detect.outputs.mode == 'repair-release' && github.ref == 'refs/heads/main'",
  );
  assert.deepEqual(repair.permissions, { contents: 'write' });
  const repairSource = repair.steps.map((step) => step.run ?? '').join('\n');
  assert.match(repairSource, /CosStage-Setup-\$VERSION-x64\.exe\.sha256/);
  assert.match(repairSource, /sha256sum --check --strict/);
  assert.match(repairSource, /gh release create/);
  assert.doesNotMatch(repairSource, /coscli|PurgeUrlsCache|publish-cos\.sh/);

  const deployWeb = workflow.jobs['deploy-web'];
  assert.deepEqual(Object.keys(deployWeb), ['needs', 'if', 'uses', 'with', 'secrets']);
  assert.equal(deployWeb.uses, './.github/workflows/web-deploy.yml');
  assert.deepEqual(deployWeb.with, { force: true });
  assert.equal(deployWeb.secrets, 'inherit');
  assert.match(deployWeb.if, /needs\.publish\.result == 'success'/);
  assert.match(deployWeb.if, /needs\.repair-release\.result == 'success'/);
  assert.doesNotMatch(source, /set -x|echo\s+.*TENCENT_SECRET/);
});

test('desktop mode detection skips aggregate commits and rejects a colliding version tag', async (t) => {
  const { workflow } = await readWorkflow('desktop-release.yml');
  const detectScript = findStep(workflow.jobs.detect, 'Detect release mode').run;
  const repo = await mkdtemp(path.join(os.tmpdir(), 'cosstage-desktop-detect-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const mockBin = path.join(repo, 'mock-bin');
  await mkdir(mockBin, { recursive: true });
  const ghPath = path.join(mockBin, 'gh');
  await writeFile(ghPath, `#!/usr/bin/env bash
set -euo pipefail
case "$MOCK_GH_MODE" in
  exists)
    printf '%s\\n' '{"assets":[{"name":"CosStage-Setup-1.1.0-x64.exe"},{"name":"CosStage-Setup-1.1.0-x64.exe.sha256"}]}'
    ;;
  partial)
    printf '%s\\n' '{"assets":[{"name":"CosStage-Setup-1.1.0-x64.exe"}]}'
    ;;
  missing)
    echo 'gh: Not Found (HTTP 404)' >&2
    exit 1
    ;;
esac
`);
  await chmod(ghPath, 0o755);

  run('git', ['init'], { cwd: repo });
  run('git', ['config', 'user.email', 'detect@example.invalid'], { cwd: repo });
  run('git', ['config', 'user.name', 'Detect Test'], { cwd: repo });
  await mkdir(path.join(repo, 'scripts', 'release'), { recursive: true });
  await copyFile(
    path.join(root, 'scripts', 'release', 'release-model.mjs'),
    path.join(repo, 'scripts', 'release', 'release-model.mjs'),
  );
  await writeFile(path.join(repo, 'package.json'), '{"version":"1.0.0"}\n');
  await commit(repo, 'baseline');
  await writeFile(path.join(repo, 'package.json'), '{"version":"1.1.0"}\n');
  await commit(repo, 'version release');

  const publish = await runDetect(repo, detectScript, mockBin, 'missing');
  assert.equal(publish.status, 0, publish.stderr);
  assert.match(publish.output, /mode=publish/);

  assert.equal(
    await canonicalPath(run('git', ['rev-parse', '--show-toplevel'], { cwd: repo })),
    await canonicalPath(repo),
  );
  assert.equal(run('git', ['tag', '--list', 'v1.1.0'], { cwd: repo }), '');
  run('git', ['tag', '-a', 'v1.1.0', '-m', '1.1.0'], { cwd: repo });
  await writeFile(path.join(repo, 'aggregate.txt'), 'next aggregate change\n');
  await commit(repo, 'aggregate change');

  const skip = await runDetect(repo, detectScript, mockBin, 'exists');
  assert.equal(skip.status, 0, `${skip.stderr}\nrefs:\n${run('git', ['show-ref', '--tags'], { cwd: repo })}`);
  assert.match(skip.output, /mode=skip/);

  const repair = await runDetect(repo, detectScript, mockBin, 'partial');
  assert.equal(repair.status, 0, repair.stderr);
  assert.match(repair.output, /mode=repair-release/);

  const collisionRepo = await mkdtemp(path.join(os.tmpdir(), 'cosstage-desktop-collision-'));
  t.after(() => rm(collisionRepo, { recursive: true, force: true }));
  run('git', ['init'], { cwd: collisionRepo });
  run('git', ['config', 'user.email', 'detect@example.invalid'], { cwd: collisionRepo });
  run('git', ['config', 'user.name', 'Detect Test'], { cwd: collisionRepo });
  await mkdir(path.join(collisionRepo, 'scripts', 'release'), { recursive: true });
  await copyFile(
    path.join(root, 'scripts', 'release', 'release-model.mjs'),
    path.join(collisionRepo, 'scripts', 'release', 'release-model.mjs'),
  );
  await writeFile(path.join(collisionRepo, 'package.json'), '{"version":"1.0.0"}\n');
  await commit(collisionRepo, 'baseline');
  run('git', ['tag', '-a', 'v1.1.0', '-m', 'collision'], { cwd: collisionRepo });
  await writeFile(path.join(collisionRepo, 'package.json'), '{"version":"1.1.0"}\n');
  await commit(collisionRepo, 'version release');

  const collision = await runDetect(collisionRepo, detectScript, mockBin, 'exists');
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /does not target current release commit/);
});
