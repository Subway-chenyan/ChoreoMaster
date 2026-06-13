import { app, BrowserWindow, protocol } from 'electron';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import { getProjectStoragePath, registerIpcHandlers } from './ipc-handlers.js';
import { resolveProjectAssetPath } from './project-service.js';

// ESM 兼容: 获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'choreo-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function contentTypeForPath(assetPath: string): string | null {
  const ext = path.extname(assetPath).toLowerCase();
  const typeByExt: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return typeByExt[ext] ?? null;
}

function parseRangeHeader(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) return null;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return null;
  if (!rawStart && rawEnd) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, size - suffixLength);
    const end = size - 1;
    return { start, end };
  }
  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : (size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start) return null;
  if (start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function respondWithProjectAsset(request: Request, assetPath: string): Promise<Response> {
  const stats = await stat(assetPath);
  if (!stats.isFile()) return new Response('Project asset not found', { status: 404 });

  const size = stats.size;
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Accept-Ranges', 'bytes');

  const contentType = contentTypeForPath(assetPath);
  if (contentType) headers.set('Content-Type', contentType);

  const rangeHeader = request.headers.get('range');
  const range = rangeHeader ? parseRangeHeader(rangeHeader, size) : null;
  const method = request.method?.toUpperCase() || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    if (method === 'HEAD') return new Response(null, { status: 206, headers });
    const nodeStream = createReadStream(assetPath, { start: range.start, end: range.end });
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers });
  }

  headers.set('Content-Length', String(size));
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  const nodeStream = createReadStream(assetPath);
  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers });
}

function registerProjectAssetProtocol(): void {
  protocol.handle('choreo-asset', async (request) => {
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const projectId = pathParts.shift();
      if (!projectId) return new Response('Project asset not found', { status: 404 });
      const relativePath = pathParts.join('/');
      const storagePath = await getProjectStoragePath();
      const assetPath = resolveProjectAssetPath(storagePath, projectId, relativePath);
      return await respondWithProjectAsset(request, assetPath);
    } catch {
      return new Response('Project asset not found', { status: 404 });
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  registerProjectAssetProtocol();
  createWindow();
  if (mainWindow) {
    registerIpcHandlers(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });
});
