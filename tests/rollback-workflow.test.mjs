import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowPath = path.join(root, '.github', 'workflows', 'desktop-rollback.yml');

async function readWorkflow() {
  const source = await readFile(workflowPath, 'utf8');
  return { source, workflow: yaml.load(source) };
}

function findStep(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
}

test('rollback is manual-only, serialized with releases, and production-gated', async () => {
  const { source, workflow } = await readWorkflow();

  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.version, {
    description: 'Existing published SemVer',
    required: true,
    type: 'string',
  });
  assert.deepEqual(workflow.concurrency, {
    group: 'desktop-release-stable',
    'cancel-in-progress': false,
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const rollback = workflow.jobs.rollback;
  assert.equal(rollback.if, "github.ref == 'refs/heads/main'");
  assert.equal(rollback['timeout-minutes'], 30);
  assert.equal(rollback.environment, 'production');
  assert.equal(rollback['runs-on'], 'ubuntu-latest');
  assert.equal(
    findStep(rollback, 'Checkout main').uses,
    'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
  );
  assert.equal(
    findStep(rollback, 'Set up Node.js').uses,
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  );
  assert.doesNotMatch(source, /actions\/(?:checkout|setup-node)@v\d/);
  assert.doesNotMatch(source, /(?:git|gh)\s+(?:tag|release|push|delete)|rm\s+[^\n]*(?:-r|-R|--recursive)/);
});

test('rollback installs verified tools, proves safe bucket versioning, and reads authenticated COS', async () => {
  const { source, workflow } = await readWorkflow();
  const job = workflow.jobs.rollback;
  const validate = findStep(job, 'Validate dispatch context').run;
  assert.match(validate, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(validate, /\^\(0\|\[1-9\]\[0-9\]\*\)/);

  const install = findStep(job, 'Install and configure verified Tencent CLIs').run;
  assert.match(install, /coscli-v1\.0\.8-linux-amd64/);
  assert.match(install, /7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91/);
  assert.match(install, /sha256sum --check --strict/);
  assert.match(install, /tccli==3\.1\.128\.1/);
  assert.match(install, /coscli config add/);
  assert.match(install, /TENCENT_SECRET_ID:\?/);
  assert.match(install, /TENCENT_SECRET_KEY:\?/);
  assert.match(install, /coscli bucket-versioning/);
  assert.match(install, /--method get/);
  assert.match(install, /cos:\/\/production/);
  assert.match(install, /bucket versioning status is Closed/);
  assert.match(install, /--secret-id "\$TENCENT_SECRET_ID"/);
  assert.match(install, /--secret-key "\$TENCENT_SECRET_KEY"/);
  assert.ok(source.indexOf('coscli bucket-versioning') < source.indexOf('- name: Commit rollback pointers'));

  const download = findStep(job, 'Download authenticated historical release').run;
  for (const object of [
    'downloads/releases.json',
    'downloads/CosStage-Setup-$VERSION-x64.exe',
    'downloads/CosStage-Setup-$VERSION-x64.exe.blockmap',
    'downloads/CosStage-Setup-$VERSION-x64.exe.sha256',
    'downloads/metadata/$VERSION/latest.yml',
  ]) {
    assert.ok(download.includes(`cos://production/${object}`), `missing COS object ${object}`);
  }
  assert.match(download, /--secret-id "\$TENCENT_SECRET_ID"/);
  assert.match(download, /--secret-key "\$TENCENT_SECRET_KEY"/);
  assert.doesNotMatch(download, /curl|404|NoSuchKey/);
});

test('rollback verifies historical metadata before atomically switching and hashing public pointers', async () => {
  const { source, workflow } = await readWorkflow();
  const job = workflow.jobs.rollback;
  const validate = findStep(job, 'Verify historical release and select published stable version').run;
  assert.match(validate, /rollback-workspace/);
  assert.match(validate, /verify-builder-output\.mjs "\$VERSION"/);
  assert.match(validate, /sha256sum --check --strict/);
  assert.match(validate, /cmp[\s\S]*remote\.sha256[\s\S]*\.sha256/);
  assert.match(
    validate,
    /published-index\.mjs rollback[\s\S]*releases\.json[\s\S]*"\$VERSION"[\s\S]*releases\.next\.json/,
  );

  const commit = findStep(job, 'Commit rollback pointers').run;
  const aliasWrite = commit.indexOf(
    'coscli cp rollback-workspace/release/CosStage-Setup-x64.exe',
  );
  const indexWrite = commit.indexOf('coscli cp rollback-workspace/releases.next.json');
  const latestWrite = commit.indexOf('coscli cp rollback-workspace/release/latest.yml');
  assert.ok(aliasWrite >= 0 && aliasWrite < indexWrite && indexWrite < latestWrite);
  assert.equal(commit.match(/coscli cp/g)?.length, 3);
  assert.match(commit, /Cache-Control:public,max-age=300/);
  assert.match(commit, /Cache-Control:no-cache#Content-Type:application\/json/);
  assert.match(commit, /Cache-Control:no-cache#Content-Type:text\/yaml/);
  assert.ok(commit.indexOf('tccli cdn PurgeUrlsCache') > latestWrite);
  assert.equal(source.lastIndexOf('coscli cp'), source.indexOf(
    'coscli cp rollback-workspace/release/latest.yml',
  ));

  const verify = findStep(job, 'Verify public rollback pointers').run;
  assert.match(verify, /COSSTAGE_VERIFY_ATTEMPTS:-12/);
  assert.match(verify, /rollback=\$GITHUB_RUN_ID&attempt=\$attempt/);
  assert.match(verify, /downloads\/CosStage-Setup-x64\.exe/);
  assert.match(verify, /downloads\/releases\.json/);
  assert.match(verify, /downloads\/latest\.yml/);
  assert.ok((verify.match(/sha256sum/g) ?? []).length >= 6);
  assert.doesNotMatch(verify, /grep|coscli/);
  assert.doesNotMatch(source, /coscli\s+(?:rm|delete)|git\s+(?:tag|push)|gh\s+release/);
});

test('release test suite includes rollback workflow coverage', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['test:release'], /tests\/rollback-workflow\.test\.mjs/);
});
