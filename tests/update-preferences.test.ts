import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beforeInstallSafely,
  readUpdatePreference,
  removeUpdatePreference,
  shouldAutoOpenUpdate,
  shouldPromptIgnoredUpdate,
  shouldShowWhatsNew,
  writeUpdatePreference,
} from '../utils/update-preferences.ts';

test('shows whats new only after an upgrade', () => {
  assert.equal(shouldShowWhatsNew('1.1.0', '1.0.0'), true);
  assert.equal(shouldShowWhatsNew('1.1.0', '1.1.0'), false);
  assert.equal(shouldShowWhatsNew('1.0.0', null), false);
  assert.equal(shouldShowWhatsNew('1.0.0', '1.1.0'), false);
});

test('shows the first governed release when legacy 1.0.0 has no version preference', () => {
  assert.equal(shouldShowWhatsNew('1.1.0', null), true);
  assert.equal(shouldShowWhatsNew('1.2.0', null), false);
});

test('does not repeat the same ignored major update', () => {
  assert.equal(shouldPromptIgnoredUpdate('2.0.0', '2.0.0'), false);
  assert.equal(shouldPromptIgnoredUpdate('2.0.1', '2.0.0'), true);
  assert.equal(shouldPromptIgnoredUpdate('2.0.0', null), true);
  assert.equal(shouldPromptIgnoredUpdate('1.9.0', '2.0.0'), false);
});

test('update errors stay reachable and ignored major only suppresses automatic opening', () => {
  assert.equal(shouldAutoOpenUpdate({ status: 'error' }), true);
  assert.equal(shouldAutoOpenUpdate({ status: 'downloaded' }), true);
  assert.equal(shouldAutoOpenUpdate({
    status: 'available',
    updateKind: 'major',
    availableVersion: '2.0.0',
    ignoredVersion: '2.0.0',
  }), false);
  assert.equal(shouldAutoOpenUpdate({
    status: 'available',
    updateKind: 'minor',
    availableVersion: '1.1.0',
    ignoredVersion: '1.1.0',
  }), true);
});

test('malformed and very large stored versions cannot hide a newer update', () => {
  assert.equal(shouldPromptIgnoredUpdate('2.0.0', 'garbage'), true);
  assert.equal(shouldShowWhatsNew('2.0.0', 'garbage'), true);
  assert.equal(
    shouldPromptIgnoredUpdate('9007199254740993.0.0', '9007199254740992.0.0'),
    true,
  );
});

test('storage failures fall back without throwing', () => {
  const storage = {
    getItem(): string | null {
      throw new Error('storage unavailable');
    },
    setItem(): void {
      throw new Error('storage unavailable');
    },
    removeItem(): void {
      throw new Error('storage unavailable');
    },
  };

  assert.equal(readUpdatePreference('test-key', storage), null);
  assert.equal(writeUpdatePreference('test-key', '1.0.0', storage), false);
  assert.equal(removeUpdatePreference('test-key', storage), false);
});

test('a thrown project save cancels installation', async () => {
  let installCalls = 0;
  const mayInstall = await beforeInstallSafely(async () => {
    throw new Error('save failed');
  });
  if (mayInstall) installCalls += 1;

  assert.equal(mayInstall, false);
  assert.equal(installCalls, 0);
});
