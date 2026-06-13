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
