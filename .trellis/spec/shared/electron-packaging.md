# Electron Packaging Contracts

## Scenario: Windows application icons

### 1. Scope / Trigger

- Applies when changing Electron Builder configuration, application icons, or packaged file locations.

### 2. Signatures

- Builder config: `win.icon = 'build/icon.ico'`
- Runtime icon: `app.isPackaged ? path.join(path.dirname(process.execPath), 'icon.png') : developmentPath`

### 3. Contracts

- `build/icon.ico` is the Windows executable, installer, and uninstaller icon.
- `build/icon.png` is copied beside the packaged executable as `icon.png`.
- `signAndEditExecutable` must not be `false`; Electron Builder must edit executable resources.
- Keep the existing `appId` stable during a product-name rebrand so installed copies continue upgrading in place.

### 4. Validation & Error Matrix

- `signAndEditExecutable: false` -> packaged exe keeps the default Electron icon.
- Missing packaged `icon.png` -> the explicit `BrowserWindow` icon path is invalid.
- Missing ICO sizes -> Windows shell may display a low-quality icon at some scales.

### 5. Good/Base/Bad Cases

- Good: packaged exe icon is extracted and visually matches the branded public icon.
- Base: development window loads `build/icon.png`.
- Bad: only browser/PWA icons are updated while `build/icon.ico` remains unchanged.

### 6. Tests Required

- Assert `win.icon` points to `build/icon.ico`.
- Assert `signAndEditExecutable: false` is absent.
- Assert packaged runtime icon resolves beside `process.execPath`.
- Build with Electron Builder and extract the generated exe icon for final verification.

### 7. Wrong vs Correct

#### Wrong

```javascript
win: {
  icon: 'build/icon.ico',
  signAndEditExecutable: false,
}
```

#### Correct

```javascript
win: {
  icon: 'build/icon.ico',
}
```

## Scenario: COS web deployment verification

### 1. Scope / Trigger

- Applies when changing `.github/workflows/deploy-cos.yml`, Vite web output, CDN purge behavior, or legacy PWA artifact cleanup.

### 2. Signatures

- Build output: `dist/index.html` references a hashed `assets/index-*.js` bundle.
- Legacy PWA artifact names: `sw.js`, `manifest.webmanifest`.
- Deployment URL env: `CDN_URL`.

### 3. Contracts

- Deployment success is proven by the deployed `index.html` referencing the current hashed JS asset and the asset URL returning successfully.
- Current `dist/` must not reference `sw.js`, `manifest.webmanifest`, `navigator.serviceWorker`, or `serviceWorker.register`.
- Legacy artifact URLs may still return HTTP 200 after deletion because CDN edges or static-site fallbacks can keep old paths reachable.
- Legacy URL reachability is diagnostic only; do not fail deploy solely because `/sw.js` or `/manifest.webmanifest` returns 200.

### 4. Validation & Error Matrix

- Deployed `index.html` does not contain the current hash -> fail deployment verification.
- Current hashed JS asset is unavailable -> fail deployment verification.
- Installer size or checksum does not match -> fail deployment verification.
- Current `dist/` references legacy PWA artifacts -> fail deployment verification.
- Legacy artifact URL returns 200 but current build has no references -> warn and continue.

### 5. Good/Base/Bad Cases

- Good: CDN returns the new hashed bundle and legacy URLs are logged as diagnostics if still reachable.
- Base: old CDN edge still returns `/sw.js` with 200, but the current page no longer registers it.
- Bad: verification polls `/sw.js` for 404 and fails an otherwise successful deploy.

### 6. Tests Required

- Desktop regression test asserts the workflow checks current `dist/` for legacy PWA references.
- Desktop regression test asserts legacy URL checks use diagnostic reporting, not `wait_until_unreachable` failure.

### 7. Wrong vs Correct

#### Wrong

```bash
wait_until_unreachable "${CDN_URL}sw.js" "Legacy sw.js"
```

#### Correct

```bash
grep -R -n -E 'sw\.js|manifest\.webmanifest|navigator\.serviceWorker|serviceWorker\.register' dist && exit 1
report_legacy_url "${CDN_URL}sw.js" "Legacy sw.js"
```
