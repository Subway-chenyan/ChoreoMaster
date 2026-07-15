import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { hasValidChangeIntent } from '../scripts/release/validate-change-intent.mjs';

const cliPath = fileURLToPath(new URL('../scripts/release/validate-change-intent.mjs', import.meta.url));

test('accepts a product changeset', () => {
  assert.deepEqual(hasValidChangeIntent(['.changeset/bright-stage.md'], []), {
    valid: true,
    reason: 'changeset',
  });
});

test('accepts an explicit no-release label', () => {
  assert.deepEqual(hasValidChangeIntent(['tests/a.test.ts'], ['release:none']), {
    valid: true,
    reason: 'release:none',
  });
});

test('rejects missing and conflicting intent', () => {
  assert.equal(hasValidChangeIntent(['App.tsx'], []).valid, false);
  assert.deepEqual(hasValidChangeIntent(['.changeset/a.md'], ['release:none']), {
    valid: false,
    reason: 'Changeset 与 release:none 不能同时存在',
  });
});

test('does not treat the changeset README as release intent', () => {
  assert.deepEqual(hasValidChangeIntent(['.changeset/README.md'], []), {
    valid: false,
    reason: '缺少 Changeset 或 release:none 标签',
  });
});

test('rejects malformed changed paths and labels explicitly', () => {
  assert.throws(
    () => hasValidChangeIntent('App.tsx', []),
    /changedPaths 必须是字符串数组/,
  );
  assert.throws(
    () => hasValidChangeIntent(['App.tsx', null], []),
    /changedPaths\[1\] 必须是字符串/,
  );
  assert.throws(
    () => hasValidChangeIntent([], 'release:none'),
    /labels 必须是字符串数组/,
  );
  assert.throws(
    () => hasValidChangeIntent([], ['release:none', 1]),
    /labels\[1\] 必须是字符串/,
  );
});

test('CLI rejects missing commit SHAs without a stack trace', () => {
  const result = spawnSync(process.execPath, [cliPath], {
    encoding: 'utf8',
    env: { ...process.env, CHANGE_BASE_SHA: '', CHANGE_HEAD_SHA: '' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHANGE_BASE_SHA 和 CHANGE_HEAD_SHA 必须存在/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI rejects malformed or non-array label JSON explicitly', () => {
  for (const labelsJson of ['{', '{"name":"release:none"}']) {
    const result = spawnSync(process.execPath, [cliPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CHANGE_BASE_SHA: 'HEAD',
        CHANGE_HEAD_SHA: 'HEAD',
        PR_LABELS_JSON: labelsJson,
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /PR_LABELS_JSON 必须是字符串数组 JSON/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});
