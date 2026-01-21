# ChoreoMaster Desktop - Build Instructions

## Prerequisites
- Node.js 18+
- npm or pnpm

## Development

### Run Web Version (Development)
```bash
npm run dev
```

### Run Electron Desktop (Development)
```bash
npm run dev:electron
```

## Building

### Build Web Version
```bash
npm run build
```

### Build Electron Desktop Application
```bash
npm run build:electron
```

The Windows installer will be generated in `dist-electron/`.

## Application Icons

Windows icon should be placed at `build/icon.ico` (256x256 minimum)
MacOS icon should be placed at `build/icon.icns`
Linux icon should be placed at `build/icon.png` (512x512)

## Distribution

### Windows
- Output: `dist-electron/ChoreoMaster Setup 1.0.0.exe`
- Installer: NSIS (nullsoft scriptable install system)
- Architecture: x64

### macOS
- Output: `dist-electron/ChoreoMaster-1.0.0.dmg`
- Format: Disk Image

### Linux
- Output: `dist-electron/ChoreoMaster-1.0.0.AppImage`
- Output: `dist-electron/choreomaster-desktop_1.0.0_amd64.deb`

## Features Implemented

✅ Complete UI migration (99% code unchanged)
✅ File system integration via Electron dialogs
✅ Project import/export
✅ Audio/video import support
✅ MediaRecorder API support for video export
✅ Three.js 3D rendering via WebGL
✅ AI service integration (Gemini API)

## Known Limitations

- Bundle size: ~80-100MB (Electron runtime overhead)
- Video export: Fixed 720p WebM format (same as web version)
- AI API key: Requires environment variable or manual entry

## Troubleshooting

### Port already in use
```
Error: listen EADDRINUSE: address already in use :::5173
```
Solution: Kill other processes or change port in vite.config.ts

### Electron window blank
Ensure `npm run build` completes before running `npm run build:main`

### IPC errors
Check that preload script is compiled to `dist-electron/preload.js`
