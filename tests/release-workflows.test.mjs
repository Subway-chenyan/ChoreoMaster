import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const actionRefs = {
  checkout: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  setupPython: 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
  changesets: 'changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d',
};

function assertPinnedUses(steps) {
  const uses = steps.flatMap((step) => (step.uses ? [step.uses] : []));
  assert.ok(uses.length > 0);
  for (const action of uses) {
    assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/);
  }
}

function normalizeWorkflowSource(source) {
  return source.replace(/\r\n?/g, '\n');
}

test('normalizes CRLF workflow source for comment assertions', () => {
  const crlfSource = '# first comment\r\n# second comment\r\n';

  assert.equal(
    normalizeWorkflowSource(crlfSource),
    '# first comment\n# second comment\n',
  );
});

async function readWorkflow(name) {
  const source = normalizeWorkflowSource(
    await readFile(path.join(root, '.github', 'workflows', name), 'utf8'),
  );
  const workflow = load(source);
  assert.equal(typeof workflow, 'object');
  assert.notEqual(workflow, null);
  return { source, workflow };
}

test('root test script runs the release suite without recursion', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  assert.equal(
    pkg.scripts.test,
    'npm run typecheck && npm run test:release && npm run test:backend && npm run test:project && npm run test:desktop && npm run build',
  );
  assert.doesNotMatch(pkg.scripts['test:release'], /npm (?:run )?test(?:\s|$)/);
  assert.equal(pkg.devDependencies['js-yaml'], '4.3.0');
});

test('project archive tests declare their checksum dependency directly', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  assert.equal(pkg.devDependencies['buffer-crc32'], '1.0.0');
});

test('quality workflow automatically checks every pushed branch and pull request with least privilege', async () => {
  const { workflow } = await readWorkflow('ci.yml');

  assert.equal(workflow.name, 'Quality');
  assert.deepEqual(workflow.on, {
    pull_request: {
      types: ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled'],
    },
    push: { branches: ['**'] },
  });
  assert.deepEqual(workflow.permissions, {
    contents: 'read',
    'pull-requests': 'read',
  });
  assert.deepEqual(Object.keys(workflow.jobs), ['quality']);

  const quality = workflow.jobs.quality;
  assert.equal(quality['runs-on'], 'ubuntu-latest');
  assert.equal(quality['timeout-minutes'], 30);
  assert.equal(quality.steps.length, 8);
  assertPinnedUses(quality.steps);

  assert.deepEqual(quality.steps[0], {
    uses: actionRefs.checkout,
    with: { 'fetch-depth': 0 },
  });
  assert.deepEqual(quality.steps[1], {
    uses: actionRefs.setupNode,
    with: { 'node-version': 22, cache: 'npm' },
  });
  assert.deepEqual(quality.steps[2], {
    uses: actionRefs.setupPython,
    with: {
      'python-version': '3.11',
      cache: 'pip',
      'cache-dependency-path': 'backend/requirements.txt',
    },
  });
  assert.deepEqual(
    quality.steps.slice(3, 5).map((step) => step.run),
    ['pip install -r backend/requirements.txt', 'npm ci'],
  );
  assert.deepEqual(quality.steps[5], {
    name: 'Validate release intent',
    if: "github.event_name == 'pull_request' && (github.actor != 'github-actions[bot]' || github.event.pull_request.head.repo.full_name != github.repository || github.event.pull_request.head.ref != 'changeset-release/main')",
    env: {
      CHANGE_BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      CHANGE_HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      PR_LABELS_JSON: '${{ toJSON(github.event.pull_request.labels.*.name) }}',
    },
    run: 'node scripts/release/validate-change-intent.mjs',
  });
  assert.deepEqual(
    quality.steps.slice(6).map((step) => step.run),
    ['npm run validate:release-data', 'npm test'],
  );
});

test('release workflow maintains one version pull request without publishing', async () => {
  const { source, workflow } = await readWorkflow('release-pr.yml');

  assert.equal(workflow.name, 'Release PR');
  assert.ok(source.includes(
    '# Quality 监听所有仓库分支的 push，因此 GITHUB_TOKEN 更新 Release PR 分支后会自动检查，\n'
    + '# 无需 maintainer 在 PR UI 手工批准 workflow run；Release PR 本身仍由负责人审核合并。',
  ));
  assert.ok(source.includes(`uses: ${actionRefs.changesets} # v1.9.0`));
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    workflow_dispatch: null,
  });
  assert.deepEqual(workflow.concurrency, {
    group: 'changesets-release-pr',
    'cancel-in-progress': false,
  });
  assert.deepEqual(workflow.permissions, {
    contents: 'write',
    'pull-requests': 'write',
  });
  assert.deepEqual(Object.keys(workflow.jobs), ['release-pr']);

  const releaseJob = workflow.jobs['release-pr'];
  assert.equal(releaseJob['runs-on'], 'ubuntu-latest');
  assert.equal(releaseJob['timeout-minutes'], 20);
  assert.equal(releaseJob.steps.length, 4);
  assertPinnedUses(releaseJob.steps);
  assert.deepEqual(releaseJob.steps[0], {
    uses: actionRefs.checkout,
    with: { 'fetch-depth': 0 },
  });
  assert.deepEqual(releaseJob.steps[1], {
    uses: actionRefs.setupNode,
    with: { 'node-version': 22, cache: 'npm' },
  });
  assert.equal(releaseJob.steps[2].run, 'npm ci');
  assert.deepEqual(releaseJob.steps[3], {
    uses: actionRefs.changesets,
    with: {
      version: 'npm run version-packages',
      commit: 'chore: version packages',
      title: 'chore: version packages',
    },
    env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
  });
});
