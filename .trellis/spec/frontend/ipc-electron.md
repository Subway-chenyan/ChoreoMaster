# IPC & Electron Guidelines

> IPC API usage, context isolation, and Electron-specific patterns.

---

## IPC API Guidelines

### Using window.api

The preload script exposes `window.api` for communicating with the main process.

```tsx
// Good - Use window.api for IPC calls
const result = await window.api.auth.login({ email, password });
const session = await window.api.session.restore();

// Bad - Don't use ipcRenderer directly in renderer
import { ipcRenderer } from 'electron'; // Won't work with contextIsolation
```

### Type Safety for IPC

Types should be defined in a shared location and used by both main and renderer processes.

```tsx
// Import types from shared types
import type { LoginInput, AuthResponse, SessionData } from '../shared/types/auth';

// window.api is fully typed via preload.ts
const result: AuthResponse = await window.api.auth.login(data);
```

### File Export Boundary

The renderer must never receive a reusable path-based filesystem write capability. Small exports combine the native save dialog and write in one main-process handler. Large generated files use a scoped, opaque export session created by the native save dialog.

```typescript
saveTextFile(defaultName, content, filters): Promise<string | null>;
saveBinaryFile(defaultName, bytes, filters): Promise<string | null>;
```

Do not expose `readFile(path)`, `writeFile(path, content)`, or `writeBinaryFile(path, bytes)` through preload. Main-process project operations must validate project IDs and resolve all paths beneath managed storage.

## Scenario: Streaming Large Desktop Exports

### 1. Scope / Trigger

- Trigger: encoded video or another generated desktop export can grow with project duration and may exceed comfortable renderer memory limits.

### 2. Signatures

- `beginBinaryFile(defaultName, filters): Promise<string | null>`
- `writeBinaryFileChunk(sessionId, content, position): Promise<void>`
- `closeBinaryFile(sessionId): Promise<void>`
- `abortBinaryFile(sessionId): Promise<void>`
- Renderer wrapper: `createDesktopBinaryExportStream(defaultName, extension): Promise<DesktopBinaryExportStream | null>`

### 3. Contracts

- `beginBinaryFile` must show the native save dialog, open only the chosen file, and return an opaque session ID rather than a filesystem path.
- The renderer must copy muxer-owned bytes before queuing an asynchronous IPC write because chunk buffers may be reused after the callback returns.
- Writes must stay ordered and support explicit byte positions so MP4 finalization can rewrite earlier headers.
- Renderer encoding must periodically await the write chain so slow storage cannot create an unbounded in-memory IPC backlog.
- `closeBinaryFile` preserves the completed file. `abortBinaryFile` closes the handle and removes the partial file.
- Window destruction and every export error path must abort remaining sessions.
- Desktop video export must not select `ArrayBufferTarget`; that target remains browser-only when no streaming file handle is available.

### 4. Validation & Error Matrix

- Native save dialog cancelled -> return `null`; do not start encoding or create a file.
- Unknown or completed session ID -> reject with a session-ended error.
- Negative, fractional, or unsafe write position -> reject before touching the file.
- Short filesystem write -> continue until the complete chunk is written; zero-byte write -> reject.
- Encode, mux, IPC, or disk failure -> abort the session and delete the partial file.
- Normal finalization -> flush queued writes, close the file, and invalidate the session.

### 5. Good/Base/Bad Cases

- Good: a 30-minute MP4 is encoded in bounded chunks and written directly to disk while MP4 header rewrites use their supplied positions.
- Base: cancelling the save dialog leaves export state idle and creates no file.
- Bad: a long desktop export uses `ArrayBufferTarget`, holds the entire MP4 in renderer memory, fails, and reports the failure as unsupported hardware.

### 6. Tests Required

- Unit test asserts queued bytes are copied, preserve call order, and retain exact byte positions.
- Unit test asserts a rejected chunk write can be aborted and invokes partial-file cleanup.
- Desktop regression asserts preload and main handlers expose begin/write/close/abort together.
- Desktop regression asserts 2D and 3D export use `StreamTarget`, periodically flush, and reserve `ArrayBufferTarget` for non-desktop fallback.
- Run Electron type-check, desktop tests, and the renderer production build.

### 7. Wrong vs Correct

#### Wrong

```typescript
const target = new ArrayBufferTarget();
// A long encoded video remains in renderer memory until finalization.
```

#### Correct

```typescript
const stream = await createDesktopBinaryExportStream('export.mp4', 'mp4');
const target = new StreamTarget({
  onData: (data, position) => stream?.enqueue(data, position),
  chunked: true,
});
```

### Preload API Structure

```typescript
// src/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/constants/channels';

contextBridge.exposeInMainWorld('api', {
  auth: {
    login: (data: LoginInput): Promise<AuthResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN, data),
    register: (data: RegisterInput): Promise<AuthResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.REGISTER, data),
    logout: (): Promise<AuthResponse> => ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGOUT),
  },
  session: {
    get: (): Promise<SessionData> => ipcRenderer.invoke(IPC_CHANNELS.SESSION.GET),
    restore: (): Promise<SessionData> => ipcRenderer.invoke(IPC_CHANNELS.SESSION.RESTORE),
  },
});

// Type declaration for window.api
declare global {
  interface Window {
    api: {
      auth: {
        login: (data: LoginInput) => Promise<AuthResponse>;
        register: (data: RegisterInput) => Promise<AuthResponse>;
        logout: () => Promise<AuthResponse>;
      };
      session: {
        get: () => Promise<SessionData>;
        restore: () => Promise<SessionData>;
      };
    };
  }
}
```

---

## Data Refresh Subscription Pattern

All hooks that fetch data from the backend via IPC **should** subscribe to data change events. This ensures UI updates when data changes from external sources (sync, background refresh, etc.).

### Why This Matters

When data changes in the background:

1. New data is written to local database
2. **But UI won't update** unless hooks refetch their data
3. Without subscription, users see stale data until page reload

### Implementation Pattern

```typescript
// Required pattern for data-fetching hooks
import { useDataRefresh } from '../context/DataRefreshContext';

export function useMyData({ workspaceId }: Options) {
  const [data, setData] = useState([]);
  const { onDataRefresh } = useDataRefresh();

  const fetchData = useCallback(async () => {
    const result = await window.api.myData.list({ workspaceId });
    setData(result);
  }, [workspaceId]);

  // Initial fetch
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // CRITICAL: Subscribe to data refresh events
  useEffect(() => {
    const unsubscribe = onDataRefresh(() => {
      void fetchData(); // Refetch when data refreshes
    });
    return unsubscribe;
  }, [onDataRefresh, fetchData]);

  return { data, refetch: fetchData };
}
```

### Common Mistake: Missing Hook

```tsx
// MyPage.tsx uses TWO data hooks:
const { items } = useItems({ workspaceId }); // Has subscription
const { tree } = useItemTree({ workspaceId }); // ALSO needs subscription!

// UI renders from useItemTree, not useItems!
<TreeView nodes={tree} />;
```

**Rule**: Trace which hook's data the UI actually renders, not just what "looks related".

---

## Electron Context Isolation Restrictions

This project uses `contextIsolation: true` for security. This means the renderer process is isolated from Node.js and Electron APIs.

### What You CANNOT Do in Renderer

```tsx
// These will NOT work in renderer process:

// 1. File.path from drag-and-drop
const handleDrop = (e: DragEvent) => {
  const file = e.dataTransfer.files[0];
  console.log(file.path); // undefined! Not exposed with contextIsolation
};

// 2. Node.js APIs
import fs from 'fs'; // Error: Module not found
import path from 'path'; // Error: Module not found

// 3. Electron APIs directly
import { dialog } from 'electron'; // Error: Not available in renderer
import { clipboard } from 'electron'; // Error: Not available in renderer
```

### How to Access Native Features

When you need native functionality (file system, dialogs, clipboard, etc.), you MUST:

1. **Create IPC channel** in shared constants
2. **Add IPC handler** in main process
3. **Expose via preload** in preload.ts
4. **Call via window.api** in renderer

```tsx
// Example: Native directory picker

// Step 1: Add channel (src/shared/constants/channels.ts)
export const IPC_CHANNELS = {
  DIALOG: {
    SELECT_DIRECTORY: 'dialog:selectDirectory',
  },
} as const;

// Step 2: Add handler (src/main/ipc/dialog.handler.ts)
import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../shared/constants/channels';

ipcMain.handle(IPC_CHANNELS.DIALOG.SELECT_DIRECTORY, async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return { success: true, path: result.filePaths[0] };
});

// Step 3: Expose in preload (src/preload.ts)
contextBridge.exposeInMainWorld('api', {
  dialog: {
    selectDirectory: (): Promise<{ success: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG.SELECT_DIRECTORY),
  },
});

// Step 4: Use in renderer
const result = await window.api.dialog.selectDirectory();
if (result.path) {
  console.log('Selected:', result.path);
}
```

### Common Native Features via IPC

| Feature          | IPC Channel              | API                                   |
| ---------------- | ------------------------ | ------------------------------------- |
| Select directory | `dialog:selectDirectory` | `window.api.dialog.selectDirectory()` |
| Select file      | `dialog:selectFile`      | `window.api.dialog.selectFile()`      |
| Save file        | `dialog:saveFile`        | `window.api.dialog.saveFile()`        |
| Read clipboard   | `clipboard:read`         | `window.api.clipboard.read()`         |
| Write clipboard  | `clipboard:write`        | `window.api.clipboard.write()`        |

### Key Reminder

> **Before implementing any feature that requires file paths, native dialogs, or system APIs:**
>
> 1. Check if `window.api` already has the needed function
> 2. If not, implement the full IPC flow (channel -> handler -> preload -> renderer)
> 3. Never assume browser/Electron APIs work the same way

---

## Desktop Title Bar (macOS traffic lights + draggable regions)

When implementing a custom title bar (like Obsidian/Notion-style **TabBar in the window title bar area**) on macOS, you must coordinate three layers:

1. **Main process**: `BrowserWindow` title bar configuration
2. **Renderer bootstrap**: platform class for CSS targeting
3. **CSS**: explicit draggable / non-draggable regions via `-webkit-app-region`

### 1) Main process: BrowserWindow config (macOS)

- Use `titleBarStyle: "hiddenInset"` on macOS to extend web contents into the title bar.
- Set `trafficLightPosition` so the traffic lights are visually centered in your title bar height.
- Treat the title bar height as a **design constant**: if you change the height, you must re-check `trafficLightPosition`.

```typescript
// src/main.ts
const win = new BrowserWindow({
  titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  trafficLightPosition: { x: 12, y: 12 }, // Adjust based on your title bar height
  // ...other options
});
```

### 2) Renderer bootstrap: platform class

Add a platform class to `document.documentElement` and use it for CSS offsets:

```typescript
// src/renderer.ts
if (process.platform === 'darwin') {
  document.documentElement.classList.add('platform-mac');
}
```

Use it to add left padding to the title bar so tabs do not overlap the traffic lights:

```css
.platform-mac .tab-bar {
  padding-left: 80px; /* Space for traffic lights */
}
```

### 3) CSS: drag/no-drag regions (Electron)

Rules:

- Set `-webkit-app-region: drag` on the _outer_ title bar container (e.g., `.tab-bar`).
- Mark **every interactive element** inside it as `-webkit-app-region: no-drag` (buttons, tabs, menus, inputs).
- Avoid visual seams between the active tab and the main content.

```css
/* Title bar is draggable by default */
.tab-bar {
  -webkit-app-region: drag;
  height: 40px;
  display: flex;
  align-items: center;
}

/* Interactive elements must be non-draggable */
.tab-bar button,
.tab-bar .tab-item,
.tab-bar input {
  -webkit-app-region: no-drag;
}
```

---

## Menu Accelerators (Keyboard Shortcuts)

When implementing native keyboard shortcuts like `Cmd+W`, `Cmd+T`, `Cmd+N`, you must use **Electron's Application Menu**, not `globalShortcut` or `before-input-event`.

### Why Menu Accelerators

- macOS respects menu accelerators as the **authoritative source** for keyboard shortcuts
- Using `globalShortcut` can conflict with other apps
- `before-input-event` is low-level and harder to maintain
- Menu accelerators automatically appear in the native menu with correct key symbols

### Implementation Pattern

#### 1. Define IPC Channel

```typescript
// src/shared/constants/channels.ts
export const IPC_CHANNELS = {
  TABS: {
    NEW_TAB: 'tabs:newTab', // Cmd+T
    NEW_DOC: 'tabs:newDoc', // Cmd+N
    CLOSE_ACTIVE: 'tabs:closeActive', // Cmd+W
    REOPEN_CLOSED: 'tabs:reopenClosed', // Shift+Cmd+T
  },
} as const;
```

#### 2. Create Menu with Accelerators

```typescript
// src/main.ts
import { Menu, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { IPC_CHANNELS } from './shared/constants/channels';

function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.send(IPC_CHANNELS.TABS.NEW_TAB);
            }
          },
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.send(IPC_CHANNELS.TABS.CLOSE_ACTIVE);
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

#### 3. Bridge in Preload

```typescript
// src/preload.ts
contextBridge.exposeInMainWorld('api', {
  tabs: {
    onNewTab: (handler: () => void) => {
      const wrapped = () => handler();
      ipcRenderer.on(IPC_CHANNELS.TABS.NEW_TAB, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TABS.NEW_TAB, wrapped);
    },
    onCloseActiveTab: (handler: () => void) => {
      const wrapped = () => handler();
      ipcRenderer.on(IPC_CHANNELS.TABS.CLOSE_ACTIVE, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TABS.CLOSE_ACTIVE, wrapped);
    },
  },
});
```

#### 4. Subscribe in Renderer

```tsx
// src/renderer/src/App.tsx or TabsContext.tsx
useEffect(() => {
  const unsubscribe = window.api.tabs.onNewTab(() => {
    openNewTab();
  });
  return unsubscribe;
}, [openNewTab]);
```

### Data Flow

```
Main Process (Menu Accelerator)
    | webContents.send(channel)
Preload (ipcRenderer.on)
    | handler callback
Renderer (useEffect subscription)
    | state update
UI Re-render
```

### Key Points

| Rule                                      | Reason                                     |
| ----------------------------------------- | ------------------------------------------ |
| Use `Menu.setApplicationMenu()`           | macOS uses app menu as truth for shortcuts |
| Use `webContents.send()` in click handler | Main -> Renderer communication             |
| Return unsubscribe function in preload    | Prevent memory leaks                       |
| Clean up in useEffect return              | React lifecycle management                 |

### Common Shortcuts Reference

| Shortcut    | Action        | Channel                     |
| ----------- | ------------- | --------------------------- |
| Cmd+N       | New document  | `tabs:newDoc`               |
| Cmd+T       | New tab       | `tabs:newTab`               |
| Cmd+W       | Close tab     | `tabs:closeActive`          |
| Shift+Cmd+T | Reopen closed | `tabs:reopenClosed`         |
| Shift+Cmd+N | New window    | (creates new BrowserWindow) |

---

## Floating Window Pattern (Global Shortcut + Always-on-Top)

When implementing a floating window (like Raycast Notes) that:

- Stays on top of other apps
- Toggles via global shortcut
- Pre-loads for instant open

### Architecture Overview

```
Main Process (floating-window.ts)
+-- createFloatingWindow() - Pre-create hidden window
+-- toggleFloatingWindow() - Show/hide instantly
+-- registerFloatingShortcut() - globalShortcut registration
+-- hover tracking (cursor polling -> IPC)
         | webContents.send()
Preload (preload.ts)
+-- floatingWindow.toggle/show/hide
+-- floatingWindow.onFocused
+-- floatingWindow.onHoverChanged
         | callback
Renderer (FloatingWindowPage.tsx)
+-- useEffect subscriptions
```

### Key Implementation Points

#### 1. Pre-load Window for Instant Open

```typescript
// In main process service
import { BrowserWindow } from 'electron';

let floatingWindow: BrowserWindow | null = null;

export function createFloatingWindow(): BrowserWindow {
  floatingWindow = new BrowserWindow({
    show: false, // Hidden initially
    alwaysOnTop: true, // Float above other apps
    frame: false, // Custom titlebar
    skipTaskbar: true, // Don't show in dock/taskbar
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // Load content immediately so it's ready
  floatingWindow.loadURL(`${MAIN_WINDOW_VITE_URL}#/floating-window`);

  // Don't destroy on close, just hide
  floatingWindow.on('close', (event) => {
    event.preventDefault();
    floatingWindow?.hide();
  });

  return floatingWindow;
}
```

#### 2. Global Shortcut Registration

```typescript
import { globalShortcut, app } from 'electron';

export function registerFloatingShortcut(): boolean {
  return globalShortcut.register('Alt+J', toggleFloatingWindow);
}

// MUST unregister on app quit
app.on('before-quit', () => {
  globalShortcut.unregister('Alt+J');
});

export function toggleFloatingWindow(): void {
  if (!floatingWindow) return;

  if (floatingWindow.isVisible()) {
    floatingWindow.hide();
  } else {
    floatingWindow.show();
    floatingWindow.focus();
    floatingWindow.webContents.send('floating-window:focused');
  }
}
```

#### 3. Cross-Process Hover Detection

When using `-webkit-app-region: drag`, DOM mouse events don't fire. Solution: poll cursor position in main process.

```typescript
// Main process
import { screen } from 'electron';

let hoverInterval: NodeJS.Timeout | null = null;

export function startHoverTracking(): void {
  hoverInterval = setInterval(() => {
    if (!floatingWindow || !floatingWindow.isVisible()) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = floatingWindow.getBounds();
    const isInside =
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height;

    floatingWindow.webContents.send('floating-window:hoverChanged', isInside);
  }, 50);
}
```

```tsx
// Renderer - avoid React re-renders by manipulating DOM directly
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const container = containerRef.current;
  const unsubscribe = window.api.floatingWindow.onHoverChanged((isHovered) => {
    container?.classList.toggle('floating-window--hovered', isHovered);
  });
  return unsubscribe;
}, []);
```

### IPC Channels

| Channel                        | Direction | Purpose                        |
| ------------------------------ | --------- | ------------------------------ |
| `floating-window:toggle`       | R->M      | Toggle visibility              |
| `floating-window:show`         | R->M      | Show window                    |
| `floating-window:hide`         | R->M      | Hide window                    |
| `floating-window:focused`      | M->R      | Window just shown, focus input |
| `floating-window:hoverChanged` | M->R      | Cursor inside/outside window   |

---

**Language**: All documentation must be written in **English**.

## Scenario: Persisted Timeline Metadata

### 1. Scope / Trigger

- Trigger: adding timeline metadata that must survive managed desktop project saves and browser JSON import/export.

### 2. Signatures

- Shared document field: `ProjectDocument.audioMarkers?: AudioMarker[]`
- Marker shape: `AudioMarker { id: string; label: string; timeMs: number; color: string }`

### 3. Contracts

- Store timeline times as finite Unix-style millisecond numbers relative to project playback start.
- Put persisted timeline metadata in `electron/project-contract.ts`; do not duplicate renderer and main-process interfaces.
- Desktop managed projects write the field into `project.json`.
- Renderer save, auto-save, dirty-state comparison, template load, reset, and browser JSON import/export must all include the field.
- Missing fields in legacy projects normalize to an empty array.

### 4. Validation & Error Matrix

- Missing or non-array marker collection -> `[]`.
- Marker with non-finite `timeMs` -> discard it.
- Negative time -> clamp to `0`.
- Empty label -> create a readable fallback label.
- Invalid color -> use the product default marker color.

### 5. Good/Base/Bad Cases

- Good: a sorted marker array round-trips through `project.json` and restores in the timeline.
- Base: an old project without `audioMarkers` loads with no markers.
- Bad: renderer-only state is omitted from auto-save or manual JSON export.

### 6. Tests Required

- Project service test asserts normalization and exact JSON persistence.
- Browser verification asserts add, edit, seek, delete, and responsive layout.
- Full build verifies the shared type reaches renderer and Electron main process.

### 7. Wrong vs Correct

#### Wrong

```typescript
const [markers, setMarkers] = useState([]);
// Save paths omit markers, so they disappear when the project is reopened.
```

#### Correct

```typescript
const projectData: ProjectDocument = {
  ...baseProjectData,
  audioMarkers,
};
```

## Scenario: Remote Agent Service Boundary

### 1. Scope / Trigger

- Trigger: desktop and web must share an Agent backend without bundling Python or model dependencies into Electron.

### 2. Signatures

- Client configuration: `AIConfig { backendUrl: string; memberToken: string }`
- Health endpoint: `GET /health`
- Access validation: `POST /api/auth/validate`
- Agent requests: HTTP calls from `services/choreoAgentService.ts`

### 3. Contracts

- `VITE_AI_BACKEND_URL` provides the default service URL.
- `VITE_MEMBER_TOKEN` may provide a development token; users can override both values in client settings.
- Electron preload must not expose Agent process lifecycle methods.
- Electron Builder must not package Python executables, Agent resources, or FFmpeg for Agent use.

### 4. Validation & Error Matrix

- Empty backend URL -> reject before issuing a request.
- Empty member token -> reject before issuing a request.
- Unreachable service -> preserve and report the original network error.
- Non-2xx response -> report the backend response detail.
- Missing embedded Agent process -> not an error condition because no embedded process exists.

### 5. Good/Base/Bad Cases

- Good: desktop and web call the same HTTPS Agent deployment with a valid access key.
- Base: local development uses `http://127.0.0.1:8000`.
- Bad: renderer catches a network failure and then calls a removed `window.electronAPI.agent` fallback.

### 6. Tests Required

- Assert Electron main/preload contain no Agent lifecycle IPC.
- Assert the Electron build configuration contains no Agent or FFmpeg resources.
- Assert the renderer Agent service contains no Electron-specific fallback.
- Build the NSIS package and inspect `release/win-unpacked/resources`.

### 7. Wrong vs Correct

#### Wrong

```typescript
const runtime = await window.electronAPI.agent.getRuntime();
```

#### Correct

```typescript
const response = await fetch(`${config.backendUrl}/api/auth/validate`, {
  headers: { Authorization: `Bearer ${config.memberToken}` },
});
```

## Scenario: Managed Project Save Boundary

### 1. Scope / Trigger

- Trigger: any renderer action that persists the currently edited managed project through Electron IPC.

### 2. Signatures

- Preload API: `project.save(projectId: string, projectData: ProjectDocument): Promise<void>`
- Main handler: `ipcMain.handle('project:save', (_, projectId: string, projectData: ProjectDocument): Promise<void>)`
- Storage service: `saveManagedProject(storagePath: string, projectId: string, projectData: ProjectDocument): Promise<ProjectDocument>`

### 3. Contracts

- The renderer state is the editing source of truth. A save captures and persists a complete immutable snapshot.
- A successful save updates only persistence metadata such as dirty state and last-saved time. It must not replace performers, frames, transitions, or stage state with a post-save readback.
- The IPC save response is an acknowledgement only. Explicit project loading is the only operation allowed to hydrate and replace renderer editing state.
- Manual save, keyboard save, navigation guards, and timed auto-save must share one serialized save coordinator.
- `project.json` must be written to a same-directory temporary file and renamed into place; failure must preserve the previous readable project file.

### 4. Validation & Error Matrix

- Missing current project ID -> do not invoke IPC and report save as unavailable.
- File write or rename failure -> reject IPC, keep renderer dirty state, and show a retryable error.
- Repeated save while one is active -> reuse the active promise and queue the latest changed snapshot; never overlap writes.
- Edit during an active save -> mark the project dirty after the older snapshot completes.
- Save with no changes -> avoid unnecessary disk I/O but still allow explicit user feedback.

### 5. Good/Base/Bad Cases

- Good: a project with performers and frames saves, remains unchanged on screen, and reopens with the same data.
- Base: `Ctrl/Cmd+S` on a clean project shows acknowledgement without rewriting the file.
- Bad: `setPerformers(saved.data.performers)` runs after save and clears valid editor state when normalization or readback differs.

### 6. Tests Required

- Desktop regression asserts the save handler contains no editor-state hydration setters.
- Desktop regression asserts preload and main-process save signatures both return `Promise<void>` and the IPC handler does not call the load service.
- Project service test asserts the atomic temporary-write and rename path is used.
- Type-check Electron, run desktop/project tests, and run the renderer production build.

### 7. Wrong vs Correct

#### Wrong

```typescript
const saved = await window.electronAPI.project.save(projectId, projectData);
setPerformers(saved.data.performers);
setFrames(saved.data.frames);
```

#### Correct

```typescript
await window.electronAPI.project.save(projectId, snapshot.document);
setLastSavedState(snapshot.state);
setLastSavedAt(Date.now());
```

## Scenario: Sandboxed Preload Packaging Boundary

### 1. Scope / Trigger

- Trigger: changing the Electron preload source, TypeScript module output, `BrowserWindow.webPreferences`, or Electron Builder file allowlist.

### 2. Signatures

- Preload source: `electron/preload.cts`
- Compiled entry: `dist-electron/preload.cjs`
- Window configuration: `preload: path.join(__dirname, 'preload.cjs')`
- Packaging allowlist: `'dist-electron/preload.cjs'`

### 3. Contracts

- Keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` on the main renderer window.
- The sandboxed preload must be a standalone CommonJS entry. Its emitted runtime imports may use only Electron's sandbox-supported `require('electron')` bridge.
- Cross-layer contract imports in the preload must remain type-only so the emitted preload does not require local project modules.
- The main-process filename, TypeScript output filename, and Electron Builder allowlist must all point to the same `.cjs` artifact.
- Do not package or reference a stale ESM `preload.js`; an ESM import failure leaves `window.electronAPI` undefined and makes the desktop renderer fall back to Web-only UI.

### 4. Validation & Error Matrix

- Compiled preload starts with an ESM `import` while sandboxing is enabled -> Electron logs `Cannot use import statement outside a module`; reject the build.
- Main process references `preload.js` while TypeScript emits `preload.cjs` -> preload is missing; reject the build.
- Builder omits `dist-electron/preload.cjs` -> packaged app has no desktop bridge; reject the package.
- `window.electronAPI?.isElectron !== true` in a packaged smoke test -> desktop detection failed; reject the package.
- Disabling the sandbox only to make an ESM preload run -> security regression; reject the change.

### 5. Good/Base/Bad Cases

- Good: packaged Electron exposes `window.electronAPI.project`, shows the local project manager, and does not show the Web save reminder.
- Base: `npm run build:main` emits one CommonJS preload that contains `require('electron')` and no ESM import statement.
- Bad: source tests pass, but the packaged ASAR contains only `dist-electron/preload.js` or omits the preload entirely.

### 6. Tests Required

- Desktop regression asserts the sandbox stays enabled and the main process references `preload.cjs`.
- Desktop regression asserts the compiled preload contains `require('electron')` and no ESM `import` statement.
- Desktop regression asserts Electron Builder includes `dist-electron/preload.cjs` and excludes the old `preload.js` path.
- Packaged smoke verification asserts `window.electronAPI.isElectron === true`, project methods are present, the project manager is visible, and the Web save reminder is absent.
- Electron startup logs must contain no `Unable to load preload script` or preload syntax error.

### 7. Wrong vs Correct

#### Wrong

```typescript
// dist-electron/preload.js (ESM) cannot run in the sandbox bundle.
import { contextBridge, ipcRenderer } from 'electron';

webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  sandbox: true,
}
```

#### Correct

```typescript
// electron/preload.cts -> dist-electron/preload.cjs
import { contextBridge, ipcRenderer } from 'electron';

webPreferences: {
  preload: path.join(__dirname, 'preload.cjs'),
  sandbox: true,
}
```
