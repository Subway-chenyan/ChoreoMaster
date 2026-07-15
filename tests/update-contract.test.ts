import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as updateContract from '../electron/update-contract.ts';
import {
  assertUpdateCachePendingPath,
  classifyUpdate,
  normalizeReleaseNotes,
  shouldClearUpdateCache,
  type UpdateState,
} from '../electron/update-contract.ts';

test('classifies patch, minor, and major updates', () => {
  assert.equal(classifyUpdate('1.2.3', '1.2.4'), 'patch');
  assert.equal(classifyUpdate('1.2.3', '1.3.0'), 'minor');
  assert.equal(classifyUpdate('1.9.9', '2.0.0'), 'major');
});

test('rejects invalid SemVer and non-upgrades', () => {
  for (const invalid of ['', '1.2', 'v1.2.3', '01.2.3', '1.2.3-beta.1']) {
    assert.throws(() => classifyUpdate(invalid, '2.0.0'), /无效 SemVer/);
    assert.throws(() => classifyUpdate('1.0.0', invalid), /无效 SemVer/);
  }

  for (const downgrade of ['1.2.3', '1.2.2', '1.1.9', '0.99.99']) {
    assert.throws(() => classifyUpdate('1.2.3', downgrade), /必须高于/);
  }
});

test('normalizes string, array, empty, and mixed release notes', () => {
  assert.equal(normalizeReleaseNotes('  修复时间轴  '), '修复时间轴');
  assert.equal(
    normalizeReleaseNotes([
      { version: '1.2.0', note: ' 新增版本历史 ' },
      null,
      { note: '' },
      { unexpected: 'ignored' },
      { note: 42 },
      'ignored',
    ]),
    '新增版本历史\n\n42',
  );
  assert.equal(normalizeReleaseNotes('   '), undefined);
  assert.equal(normalizeReleaseNotes([]), undefined);
  assert.equal(normalizeReleaseNotes([{ note: null }, { note: ' ' }]), undefined);
  assert.equal(normalizeReleaseNotes({ note: 'ignored' }), undefined);
  assert.equal(normalizeReleaseNotes(null), undefined);
});

test('clears only integrity failures and never network failures', () => {
  for (const message of [
    'sha512 checksum mismatch',
    'sha-512 digest mismatch',
    'signature verification failed',
    'download is corrupt',
    'ERR_UPDATER_CHECKSUM_MISMATCH: sha512 checksum mismatch',
  ]) {
    assert.equal(shouldClearUpdateCache(message), true, message);
  }

  for (const message of [
    'network timeout',
    'ECONNRESET while downloading',
    'offline while fetching sha512 metadata',
    'net::ERR_INTERNET_DISCONNECTED while fetching sha512 metadata',
    'getaddrinfo ENOTFOUND while fetching checksum metadata',
    'net::ERR_SSL_PROTOCOL_ERROR while fetching checksum metadata',
    'EPROTO while verifying sha512',
    'ERR_HTTP2_PROTOCOL_ERROR during signature verification',
    'CERT_HAS_EXPIRED while fetching checksum metadata',
    'EPROTO: sha512 checksum mismatch',
    'net::ERR_SSL_PROTOCOL_ERROR: checksum mismatch',
    'ERR_HTTP2_PROTOCOL_ERROR: signature verification failed',
    'CERT_HAS_EXPIRED: corrupt download',
    'fetching checksum metadata',
    'verifying sha512',
    'during signature verification',
    'ENETDOWN while verifying checksum',
    'ENETRESET while verifying sha512',
    'EHOSTDOWN during signature verification',
    'EPIPE while reading corrupt download',
    'signatured archive label',
    'checksummer process exited',
  ]) {
    assert.equal(shouldClearUpdateCache(message), false, message);
  }
});

test('accepts only the fixed updater pending directory', () => {
  const localAppData = path.resolve('C:\\Users\\Tester\\AppData\\Local');
  const cacheRoot = path.resolve(localAppData, 'cosstage-desktop-updater');
  const pending = path.resolve(cacheRoot, 'pending');

  assert.equal(assertUpdateCachePendingPath(localAppData, pending), pending);
  assert.throws(
    () => assertUpdateCachePendingPath(localAppData, path.resolve(cacheRoot, '..', 'outside')),
    /更新缓存路径越界/,
  );
  assert.throws(
    () => assertUpdateCachePendingPath(localAppData, path.resolve(cacheRoot, 'pending', 'nested')),
    /更新缓存路径越界/,
  );
});

type UpdateInfoDouble = {
  version: string;
  files: [];
  path: string;
  sha512: string;
  releaseName: null;
  releaseNotes: unknown;
  releaseDate: string;
};

function createUpdateInfo(version: string, releaseNotes: unknown): UpdateInfoDouble {
  return {
    version,
    files: [],
    path: '',
    sha512: '',
    releaseName: null,
    releaseNotes,
    releaseDate: '2026-07-16T00:00:00.000Z',
  };
}

type UpdaterManagerDouble = {
  init: (mainWindow: unknown) => void;
  getState: () => UpdateState;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  downloadUpdate: () => Promise<void>;
};

type RemoveCall = {
  target: string;
  options: { recursive: boolean; force: boolean };
};

type UpdaterHarness = {
  autoUpdater: EventEmitter;
  manager: UpdaterManagerDouble;
  underlyingCalls: { check: number; download: number };
  removeCalls: RemoveCall[];
  sentStates: UpdateState[];
  initialize: () => void;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (!resolvePromise || !rejectPromise) throw new Error('无法创建延迟 Promise');
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function isUpdaterManager(value: unknown): value is UpdaterManagerDouble {
  return (
    typeof value === 'object'
    && value !== null
    && 'init' in value
    && typeof value.init === 'function'
    && 'getState' in value
    && typeof value.getState === 'function'
    && 'checkForUpdates' in value
    && typeof value.checkForUpdates === 'function'
    && 'downloadUpdate' in value
    && typeof value.downloadUpdate === 'function'
  );
}

function createUpdaterHarness(options?: {
  currentVersion?: string;
  localAppData?: string;
  removeError?: Error;
  removeOperation?: (call: RemoveCall) => Promise<void>;
  checkError?: Error;
  downloadError?: Error;
  checkSynchronousError?: Error;
  downloadSynchronousError?: Error;
}): UpdaterHarness {
  const currentVersion = options?.currentVersion ?? '1.2.3';
  const localAppData = options?.localAppData ?? path.resolve('C:\\Users\\Tester\\AppData\\Local');
  const source = readFileSync(new URL('../electron/updater.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const autoUpdater = new EventEmitter();
  const underlyingCalls = { check: 0, download: 0 };
  const updaterProperties: Record<string, unknown> = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableWebInstaller: true,
    logger: null,
    checkForUpdates: (): Promise<void> => {
      underlyingCalls.check += 1;
      if (options?.checkSynchronousError) throw options.checkSynchronousError;
      if (!options?.checkError) return Promise.resolve();
      autoUpdater.emit('error', options.checkError);
      return Promise.reject(options.checkError);
    },
    downloadUpdate: (): Promise<void> => {
      underlyingCalls.download += 1;
      if (options?.downloadSynchronousError) throw options.downloadSynchronousError;
      if (!options?.downloadError) return Promise.resolve();
      autoUpdater.emit('error', options.downloadError);
      return Promise.reject(options.downloadError);
    },
    quitAndInstall: (): void => undefined,
  };
  Object.assign(autoUpdater, updaterProperties);
  const removeCalls: RemoveCall[] = [];
  const remove = async (
    target: string,
    removeOptions: { recursive: boolean; force: boolean },
  ): Promise<void> => {
    const call = { target, options: removeOptions };
    removeCalls.push(call);
    if (options?.removeOperation) await options.removeOperation(call);
    if (options?.removeError) throw options.removeError;
  };
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const loadDependency = (request: string): unknown => {
    if (request === 'electron-updater') return { autoUpdater };
    if (request === 'electron') return { app: { getVersion: () => currentVersion } };
    if (request === 'events') return { EventEmitter };
    if (request === 'node:fs/promises') return { rm: remove };
    if (request === 'node:path') return path;
    if (request === './update-contract.js') return updateContract;
    throw new Error(`Unexpected updater dependency: ${request}`);
  };
  const execute = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    'process',
    'console',
    output,
  );
  execute(
    moduleRecord.exports,
    loadDependency,
    moduleRecord,
    path.resolve('electron/updater.ts'),
    path.resolve('electron'),
    { platform: 'win32', env: { LOCALAPPDATA: localAppData } },
    { log: (): void => undefined, warn: (): void => undefined, error: (): void => undefined },
  );
  const manager = moduleRecord.exports.updaterManager;
  assert.ok(isUpdaterManager(manager), 'updaterManager export must expose init and getState');
  const sentStates: UpdateState[] = [];
  const initialize = (): void => {
    manager.init({
      webContents: {
        send: (channel: string, state: UpdateState): void => {
          assert.equal(channel, 'update:stateChanged');
          sentStates.push(state);
        },
      },
    });
  };
  initialize();
  return { autoUpdater, manager, underlyingCalls, removeCalls, sentStates, initialize };
}

async function flushUpdaterTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function settlesWithin(operation: Promise<void>, timeoutMs = 50): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

test('updater replaces state so fields from earlier statuses cannot become stale', () => {
  const harness = createUpdaterHarness();
  assert.deepEqual(harness.manager.getState(), { status: 'idle', currentVersion: '1.2.3' });

  harness.autoUpdater.emit('update-available', createUpdateInfo('1.3.0', [{ note: ' 新编舞工具 ' }]));
  assert.deepEqual(harness.manager.getState(), {
    status: 'available',
    currentVersion: '1.2.3',
    availableVersion: '1.3.0',
    updateKind: 'minor',
    releaseNotes: '新编舞工具',
  });

  harness.autoUpdater.emit('download-progress', {
    total: 100,
    delta: 25,
    transferred: 25,
    percent: 25,
    bytesPerSecond: 50,
  });
  assert.deepEqual(harness.manager.getState(), {
    status: 'downloading',
    currentVersion: '1.2.3',
    availableVersion: '1.3.0',
    updateKind: 'minor',
    releaseNotes: '新编舞工具',
    progress: { total: 100, transferred: 25, percent: 25, bytesPerSecond: 50 },
  });

  harness.autoUpdater.emit('checking-for-update');
  assert.deepEqual(harness.manager.getState(), { status: 'checking', currentVersion: '1.2.3' });

  harness.autoUpdater.emit('update-available', createUpdateInfo('2.0.0', ' 大版本 '));
  harness.autoUpdater.emit('download-progress', {
    total: 100,
    delta: 100,
    transferred: 100,
    percent: 100,
    bytesPerSecond: 50,
  });
  harness.autoUpdater.emit('update-downloaded', createUpdateInfo('2.0.0', ' 大版本 '));
  assert.deepEqual(harness.manager.getState(), {
    status: 'downloaded',
    currentVersion: '1.2.3',
    availableVersion: '2.0.0',
    updateKind: 'major',
    releaseNotes: '大版本',
  });

  harness.autoUpdater.emit('update-not-available', createUpdateInfo('1.2.3', null));
  assert.deepEqual(harness.manager.getState(), { status: 'not-available', currentVersion: '1.2.3' });
});

test('integrity errors clear only the fixed pending path before reporting error state', async () => {
  const localAppData = path.resolve('C:\\Users\\Tester\\AppData\\Local');
  const harness = createUpdaterHarness({ localAppData });
  harness.autoUpdater.emit('error', new Error('sha512 checksum mismatch'));
  await flushUpdaterTasks();

  assert.deepEqual(harness.removeCalls, [{
    target: path.resolve(localAppData, 'cosstage-desktop-updater', 'pending'),
    options: { recursive: true, force: true },
  }]);
  assert.deepEqual(harness.manager.getState(), {
    status: 'error',
    currentVersion: '1.2.3',
    error: 'sha512 checksum mismatch',
  });
  assert.deepEqual(harness.sentStates.at(-1), harness.manager.getState());
});

test('network errors never clear the updater cache', async () => {
  const harness = createUpdaterHarness();
  harness.autoUpdater.emit('error', new Error('network timeout while fetching sha512 metadata'));
  await flushUpdaterTasks();

  assert.deepEqual(harness.removeCalls, []);
  assert.deepEqual(harness.manager.getState(), {
    status: 'error',
    currentVersion: '1.2.3',
    error: 'network timeout while fetching sha512 metadata',
  });
});

test('cache cleanup failure cannot prevent error state publication', async () => {
  const harness = createUpdaterHarness({ removeError: new Error('access denied') });
  harness.autoUpdater.emit('error', new Error('signature verification failed'));
  await flushUpdaterTasks();

  assert.equal(harness.removeCalls.length, 1);
  assert.deepEqual(harness.manager.getState(), {
    status: 'error',
    currentVersion: '1.2.3',
    error: 'signature verification failed',
  });
  assert.deepEqual(harness.sentStates.at(-1), harness.manager.getState());
});

test('publishes error synchronously and cleanup cannot overwrite a later available state', async () => {
  for (const outcome of ['resolve', 'reject'] as const) {
    const cleanup = createDeferred<void>();
    const harness = createUpdaterHarness({ removeOperation: () => cleanup.promise });
    harness.autoUpdater.emit('error', new Error('sha512 checksum mismatch'));

    assert.deepEqual(harness.manager.getState(), {
      status: 'error',
      currentVersion: '1.2.3',
      error: 'sha512 checksum mismatch',
    });
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 1);

    harness.autoUpdater.emit('update-available', createUpdateInfo('1.3.0', '竞态修复'));
    const availableState = {
      status: 'available' as const,
      currentVersion: '1.2.3',
      availableVersion: '1.3.0',
      updateKind: 'minor' as const,
      releaseNotes: '竞态修复',
    };
    assert.deepEqual(harness.manager.getState(), availableState);

    if (outcome === 'resolve') cleanup.resolve();
    else cleanup.reject(new Error('access denied'));
    await flushUpdaterTasks();

    assert.deepEqual(harness.manager.getState(), availableState);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 1);
  }
});

test('concurrent checks share one operation without waiting for cleanup', async () => {
  const error = new Error('sha512 checksum mismatch');
  const cleanup = createDeferred<void>();
  const harness = createUpdaterHarness({ checkError: error, removeOperation: () => cleanup.promise });
  const operations: Promise<void>[] = [];

  try {
    const firstOperation = harness.manager.checkForUpdates(false);
    const concurrentOperation = harness.manager.checkForUpdates(true);
    operations.push(firstOperation, concurrentOperation);
    assert.equal(concurrentOperation, firstOperation, 'concurrent checks must share the manager promise');
    harness.autoUpdater.emit('update-available', createUpdateInfo('1.3.0', '竞态修复'));

    assert.equal(await settlesWithin(firstOperation), true, 'check must not await updater cache cleanup');
    assert.equal(harness.underlyingCalls.check, 1);
    assert.equal(harness.removeCalls.length, 1);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 1);
    assert.deepEqual(harness.manager.getState(), {
      status: 'available',
      currentVersion: '1.2.3',
      availableVersion: '1.3.0',
      updateKind: 'minor',
      releaseNotes: '竞态修复',
    });

    const secondOperation = harness.manager.checkForUpdates(true);
    operations.push(secondOperation);
    assert.notEqual(secondOperation, firstOperation, 'a completed check must allow a new operation');
    assert.equal(await settlesWithin(secondOperation), true, 'a later check must not await earlier cleanup');
    assert.equal(harness.underlyingCalls.check, 2);
    assert.equal(harness.removeCalls.length, 2);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 2);
  } finally {
    cleanup.resolve();
    await Promise.all(operations);
    await flushUpdaterTasks();
  }
});

test('concurrent downloads share one operation without waiting for cleanup', async () => {
  const error = new Error('signature verification failed');
  const cleanup = createDeferred<void>();
  const harness = createUpdaterHarness({ downloadError: error, removeOperation: () => cleanup.promise });
  const operations: Promise<void>[] = [];
  harness.autoUpdater.emit('update-available', createUpdateInfo('1.3.0', null));

  try {
    const firstOperation = harness.manager.downloadUpdate();
    const concurrentOperation = harness.manager.downloadUpdate();
    operations.push(firstOperation, concurrentOperation);
    assert.equal(concurrentOperation, firstOperation, 'concurrent downloads must share the manager promise');
    harness.autoUpdater.emit('update-available', createUpdateInfo('1.4.0', null));

    assert.equal(await settlesWithin(firstOperation), true, 'download must not await updater cache cleanup');
    assert.equal(harness.underlyingCalls.download, 1);
    assert.equal(harness.removeCalls.length, 1);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 1);
    assert.deepEqual(harness.manager.getState(), {
      status: 'available',
      currentVersion: '1.2.3',
      availableVersion: '1.4.0',
      updateKind: 'minor',
    });

    const secondOperation = harness.manager.downloadUpdate();
    operations.push(secondOperation);
    assert.notEqual(secondOperation, firstOperation, 'a completed download must allow a new operation');
    assert.equal(await settlesWithin(secondOperation), true, 'a later download must not await earlier cleanup');
    assert.equal(harness.underlyingCalls.download, 2);
    assert.equal(harness.removeCalls.length, 2);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 2);
  } finally {
    cleanup.resolve();
    await Promise.all(operations);
    await flushUpdaterTasks();
  }
});

test('check and download reject while the other updater action is active', async () => {
  const error = new Error('sha512 checksum mismatch');
  const cleanup = createDeferred<void>();
  const harness = createUpdaterHarness({
    checkError: error,
    downloadError: error,
    removeOperation: () => cleanup.promise,
  });
  const operations: Promise<void>[] = [];

  try {
    const checkOperation = harness.manager.checkForUpdates(true);
    const concurrentDownload = harness.manager.downloadUpdate();
    operations.push(checkOperation);
    await assert.rejects(concurrentDownload, /已有另一更新操作进行中/);
    assert.equal(await settlesWithin(checkOperation), true);
    assert.deepEqual(harness.underlyingCalls, { check: 1, download: 0 });
    assert.equal(harness.removeCalls.length, 1);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 1);

    const laterDownload = harness.manager.downloadUpdate();
    operations.push(laterDownload);
    const concurrentCheck = harness.manager.checkForUpdates(true);
    await assert.rejects(concurrentCheck, /已有另一更新操作进行中/);
    assert.equal(await settlesWithin(laterDownload), true);
    assert.deepEqual(harness.underlyingCalls, { check: 1, download: 1 });
    assert.equal(harness.removeCalls.length, 2);
    assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 2);
  } finally {
    cleanup.resolve();
    await Promise.all(operations);
    await flushUpdaterTasks();
  }
});

test('synchronous check throws stay inside the Promise API and release single-flight', async () => {
  const error = new Error('synchronous check failure');
  const harness = createUpdaterHarness({ checkSynchronousError: error });

  const firstOperation = harness.manager.checkForUpdates(true);
  assert.ok(firstOperation instanceof Promise);
  await assert.doesNotReject(firstOperation);
  assert.equal(harness.underlyingCalls.check, 1);
  assert.deepEqual(harness.manager.getState(), {
    status: 'error',
    currentVersion: '1.2.3',
    error: error.message,
  });

  const secondOperation = harness.manager.checkForUpdates(true);
  assert.ok(secondOperation instanceof Promise);
  assert.notEqual(secondOperation, firstOperation);
  await assert.doesNotReject(secondOperation);
  assert.equal(harness.underlyingCalls.check, 2);
  assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 2);
});

test('synchronous download throws stay inside the Promise API and release single-flight', async () => {
  const error = new Error('synchronous download failure');
  const harness = createUpdaterHarness({ downloadSynchronousError: error });

  const firstOperation = harness.manager.downloadUpdate();
  assert.ok(firstOperation instanceof Promise);
  await assert.doesNotReject(firstOperation);
  assert.equal(harness.underlyingCalls.download, 1);
  assert.deepEqual(harness.manager.getState(), {
    status: 'error',
    currentVersion: '1.2.3',
    error: error.message,
  });

  const secondOperation = harness.manager.downloadUpdate();
  assert.ok(secondOperation instanceof Promise);
  assert.notEqual(secondOperation, firstOperation);
  await assert.doesNotReject(secondOperation);
  assert.equal(harness.underlyingCalls.download, 2);
  assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 2);
});

test('deduplicates consecutive unscoped errors until a non-error state intervenes', async () => {
  const harness = createUpdaterHarness();
  const error = new Error('download is corrupt');

  harness.autoUpdater.emit('error', error);
  harness.autoUpdater.emit('error', error);
  await flushUpdaterTasks();
  assert.equal(harness.removeCalls.length, 1);
  assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 1);

  harness.autoUpdater.emit('update-available', createUpdateInfo('1.3.0', null));
  harness.autoUpdater.emit('error', error);
  await flushUpdaterTasks();
  assert.equal(harness.removeCalls.length, 2);
  assert.equal(harness.sentStates.filter((state) => state.status === 'error').length, 2);
});

test('init updates the window without registering updater listeners twice', () => {
  const harness = createUpdaterHarness();
  harness.initialize();
  harness.autoUpdater.emit('checking-for-update');

  assert.equal(harness.sentStates.length, 1);
  assert.deepEqual(harness.manager.getState(), { status: 'checking', currentVersion: '1.2.3' });
});
