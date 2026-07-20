import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopBinaryExportStream } from '../utils/desktop-binary-export.ts';

test('desktop binary export owns queued bytes and writes them in order', async () => {
  const writes: Array<{ sessionId: string; content: number[]; position: number }> = [];
  let closeSessionId = '';

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        beginBinaryFile: async () => 'session-1',
        writeBinaryFileChunk: async (sessionId: string, content: Uint8Array, position: number) => {
          writes.push({ sessionId, content: Array.from(content), position });
        },
        closeBinaryFile: async (sessionId: string) => {
          closeSessionId = sessionId;
        },
        abortBinaryFile: async () => undefined,
      },
    },
  });

  const stream = await createDesktopBinaryExportStream('long-export.mp4', 'mp4');
  assert.ok(stream);
  const firstChunk = new Uint8Array([1, 2, 3]);
  stream.enqueue(firstChunk, 0);
  firstChunk[0] = 9;
  stream.enqueue(new Uint8Array([4, 5]), 32);
  await stream.close();

  assert.deepEqual(writes, [
    { sessionId: 'session-1', content: [1, 2, 3], position: 0 },
    { sessionId: 'session-1', content: [4, 5], position: 32 },
  ]);
  assert.equal(closeSessionId, 'session-1');
});

test('desktop binary export aborts and cleans up after a queued write failure', async () => {
  let abortedSessionId = '';

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        beginBinaryFile: async () => 'session-2',
        writeBinaryFileChunk: async () => {
          throw new Error('disk full');
        },
        closeBinaryFile: async () => undefined,
        abortBinaryFile: async (sessionId: string) => {
          abortedSessionId = sessionId;
        },
      },
    },
  });

  const stream = await createDesktopBinaryExportStream('long-export.mp4', 'mp4');
  assert.ok(stream);
  stream.enqueue(new Uint8Array([1]), 0);
  await assert.rejects(stream.flush(), /disk full/);
  await stream.abort();

  assert.equal(abortedSessionId, 'session-2');
});
