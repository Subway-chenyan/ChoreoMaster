import test from 'node:test';
import assert from 'node:assert/strict';
import { createThrottledProgressReporter } from '../utils/export-progress.ts';

test('export progress reporting avoids frame-rate React updates', () => {
  let currentTime = 0;
  const reported: number[] = [];
  const report = createThrottledProgressReporter(
    (progress) => reported.push(progress),
    () => currentTime,
  );

  report(0.01);
  currentTime = 249;
  report(0.02);
  assert.deepEqual(reported, []);

  currentTime = 250;
  report(0.03);
  currentTime = 400;
  report(0.04);
  currentTime = 500;
  report(0.05);

  assert.deepEqual(reported, [0.03, 0.05]);
});
