# CosStage Android Debug Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the verified responsive CosStage renderer as a Capacitor 8 Android application, install a debug APK on an API 36 emulator, and smoke-test Android-specific behavior.

**Architecture:** Capacitor hosts the existing Vite `dist` output; it does not introduce a second editor implementation. The renderer owns adaptive layout and close priority, while `@capacitor/app` forwards native Back and `@capacitor/system-bars` supplies Android safe-area variables. Production configuration keeps cleartext disabled; a debug manifest overlay allows emulator-only access to the local FastAPI service at `10.0.2.2`.

**Tech Stack:** Capacitor 8, React 19, TypeScript 5.8, Vite 6, Android Gradle plugin, Android SDK/API 36, ADB.

**Git constraint:** Do not run `git add`, `git commit`, or `git push`. Leave all changes unstaged unless the user separately authorizes a specific Git write.

---

## File Map

**Create**

- `capacitor.config.ts` — stable application identity, Vite output path, secure Android scheme, and native plugin configuration.
- `hooks/useAndroidBackButton.ts` — bridges native Back to the existing renderer history/close stack.
- `tests/android-packaging.test.mjs` — source and configuration contract tests.
- `android/` — Capacitor-generated Android project; generated source is reviewed but not hand-reimplemented.
- `android/app/src/debug/AndroidManifest.xml` — debug-only cleartext permission for local emulator backend testing.

**Modify**

- `App.tsx` — wires native Back and exposes whether a renderer close layer is active.
- `components/Sidebar.tsx` — exposes editable AI backend URL as well as the existing member token.
- `index.css` — resolves safe areas from both browser `env(...)` and Capacitor System Bars variables.
- `package.json` / `package-lock.json` — Capacitor dependencies and repeatable Android scripts.
- `.gitignore` — ignores only Android local/build outputs if the generated project does not already do so.

## Task 1: Lock the Android Packaging Contract with a Failing Test

**Files:**

- Create: `tests/android-packaging.test.mjs`

- [ ] **Step 1: Write the failing contract test**

Create a Node test that reads `package.json`, `capacitor.config.ts`, `components/Sidebar.tsx`, `hooks/useAndroidBackButton.ts`, and the debug manifest. Assert:

```js
assert.equal(pkg.dependencies['@capacitor/core'].split('.')[0], '^8');
assert.equal(pkg.dependencies['@capacitor/android'].split('.')[0], '^8');
assert.equal(pkg.dependencies['@capacitor/app'].split('.')[0], '^8');
assert.equal(pkg.dependencies['@capacitor/system-bars'].split('.')[0], '^8');
assert.equal(pkg.scripts['android:sync'], 'npm run build && cap sync android');
assert.equal(pkg.scripts['android:debug'], 'npm run android:sync && cd android && gradlew.bat assembleDebug');
assert.match(config, /appId:\s*'com\.choreomaster\.app'/);
assert.match(config, /appName:\s*'CosStage'/);
assert.match(config, /webDir:\s*'dist'/);
assert.match(config, /androidScheme:\s*'https'/);
assert.match(sidebar, /AI 后端地址/);
assert.match(backHook, /App\.addListener\('backButton'/);
assert.match(debugManifest, /android:usesCleartextTraffic="true"/);
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/android-packaging.test.mjs
```

Expected: FAIL because the Capacitor config, native hook, dependencies, and Android project do not exist.

## Task 2: Add Capacitor 8 and Generate the Android Project

**Files:**

- Modify: `package.json`, `package-lock.json`
- Create: `capacitor.config.ts`, `android/`

- [ ] **Step 1: Install exact-major dependencies**

Run:

```powershell
npm install @capacitor/core@^8 @capacitor/android@^8 @capacitor/app@^8 @capacitor/system-bars@^8
npm install --save-dev @capacitor/cli@^8 @capacitor/assets@latest
```

Expected: lockfile updates without audit/install failure.

- [ ] **Step 2: Add repeatable scripts**

Add:

```json
"android:sync": "npm run build && cap sync android",
"android:debug": "npm run android:sync && cd android && gradlew.bat assembleDebug",
"android:install": "cd android && gradlew.bat installDebug"
```

- [ ] **Step 3: Add `capacitor.config.ts`**

```ts
/// <reference types="@capacitor/app" />
/// <reference types="@capacitor/system-bars" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.choreomaster.app',
  appName: 'CosStage',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    },
  },
};

export default config;
```

- [ ] **Step 4: Generate and synchronize the Android project**

Run:

```powershell
npm run build
npx cap add android
npx cap sync android
```

Expected: `android/` exists, Gradle configuration resolves, and the copied web assets contain `index.html`.

- [ ] **Step 5: Add debug-only local HTTP access**

Create `android/app/src/debug/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:usesCleartextTraffic="true" />
</manifest>
```

Do not set Capacitor `server.cleartext` globally.

## Task 3: Bridge Android Back and Safe Insets with TDD

**Files:**

- Create: `hooks/useAndroidBackButton.ts`
- Modify: `App.tsx`, `index.css`, `tests/android-packaging.test.mjs`

- [ ] **Step 1: Tighten the failing assertions**

Assert that the hook checks `Capacitor.isNativePlatform()`, installs and removes the `backButton` listener, calls `window.history.back()` while a close layer/history entry exists, and calls `App.minimizeApp()` only at the root.

- [ ] **Step 2: Verify RED**

Run `node --test tests/android-packaging.test.mjs` and confirm failure is caused by the missing hook behavior.

- [ ] **Step 3: Implement the minimal hook**

```ts
import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export function useAndroidBackButton(enabled: boolean, hasCloseLayer: boolean): void {
  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return;

    let disposed = false;
    const listener = App.addListener('backButton', async ({ canGoBack }) => {
      if (hasCloseLayer || canGoBack) {
        window.history.back();
        return;
      }
      await App.minimizeApp();
    });

    return () => {
      disposed = true;
      void listener.then((handle) => {
        if (disposed) void handle.remove();
      });
    };
  }, [enabled, hasCloseLayer]);
}
```

Refactor the cleanup if TypeScript or a real listener test reveals a race; preserve the contract rather than the literal sample.

- [ ] **Step 4: Wire the hook in `App.tsx`**

Call it only for phone mode and pass `activeMobileHistoryLayer !== null`. Keep browser `popstate` as the source of truth for actually closing drawers/modals.

- [ ] **Step 5: Resolve Capacitor safe-area variables**

Define root values and use them in the existing safe helpers:

```css
:root {
  --app-safe-top: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0px));
  --app-safe-right: max(env(safe-area-inset-right), var(--safe-area-inset-right, 0px));
  --app-safe-bottom: max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px));
  --app-safe-left: max(env(safe-area-inset-left), var(--safe-area-inset-left, 0px));
}

.safe-top { padding-top: var(--app-safe-top); }
.safe-bottom { padding-bottom: var(--app-safe-bottom); }
```

- [ ] **Step 6: Verify GREEN**

Run:

```powershell
node --test tests/android-packaging.test.mjs
npm run typecheck
```

Expected: contract and type checks pass.

## Task 4: Expose a Reachable Android Backend Endpoint

**Files:**

- Modify: `components/Sidebar.tsx`, `tests/android-packaging.test.mjs`

- [ ] **Step 1: Add a failing UI contract**

Assert the presets/AI configuration panel contains a labeled URL input bound to `aiConfig.backendUrl` and updates through `onAiConfigChange`.

- [ ] **Step 2: Verify RED**

Run `node --test tests/android-packaging.test.mjs`; expected FAIL because the current UI states that the address is centrally managed.

- [ ] **Step 3: Add the backend URL field**

Add a URL input before the member token. Use Chinese copy explaining `http://10.0.2.2:8000` for the Android emulator and HTTPS/LAN for a device. Preserve the existing localStorage persistence in `App.tsx`.

- [ ] **Step 4: Verify GREEN**

Run the Android contract test, desktop regressions, and typecheck.

## Task 5: Generate Branded Android Assets and Build the APK

**Files:**

- Modify: generated `android/app/src/main/res/**`

- [ ] **Step 1: Generate assets from the existing product icon**

Run:

```powershell
npx capacitor-assets generate --android --iconBackgroundColor '#0f172a' --iconBackgroundColorDark '#0f172a'
```

If the tool requires an `assets/icon-only.png` input, copy the existing highest-resolution CosStage PNG into that documented input path without altering the source image.

- [ ] **Step 2: Synchronize and build**

Run:

```powershell
npm run android:debug
```

Expected artifact: `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 3: Verify the APK structurally**

Run SDK-local `aapt2 dump badging` or `apkanalyzer manifest application-id` and assert application ID `com.choreomaster.app`, label `CosStage`, debug signing, and minimum SDK 24+.

## Task 6: Create an API 36 AVD, Install, and Smoke-Test

**Files:**

- External local Android SDK state: one AVD named `CosStage_API_36`.

- [ ] **Step 1: Create the AVD only if absent**

Use the installed `avdmanager.bat` and `system-images;android-36;google_apis_playstore;x86_64`. Do not overwrite an existing AVD with the same name.

- [ ] **Step 2: Start the emulator**

Launch hidden with a writable quick-boot snapshot and wait via `adb wait-for-device` plus `getprop sys.boot_completed`.

- [ ] **Step 3: Install and launch**

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.choreomaster.app -c android.intent.category.LAUNCHER 1
adb shell pm path com.choreomaster.app
```

Expected: install succeeds, launch event is delivered, and `pm path` returns the installed APK path.

- [ ] **Step 4: Smoke-test native behavior**

Verify portrait and landscape, top-left tools drawer, compact/expanded bottom timeline, stage drag, Android Back priority, system bars/cutouts, soft keyboard, backend URL entry, and project JSON save/import. Capture screenshots and filtered logcat evidence.

- [ ] **Step 5: Run final Android quality gate**

```powershell
node --test tests/android-packaging.test.mjs
npm test
npm run android:debug
```

Expected: all commands pass and the final APK hash is recorded.
