# ChoreoMaster Desktop - Windows Application

A complete choreography design application with 2D/3D visualization, now available as a native Windows desktop application.

## Features

- 🎭 **Dual View Mode**: Switch between 2D top-down view and immersive 3D stage view
- 👥 **Stage Visualization**: Real-time performer/prop positioning with smooth interpolation
- 📋 **Timeline Editor**: Frame-based choreography with drag-to-rearrange and resize
- 🎵 **Audio Synchronization**: Import music and sync choreography to timeline
- 🎥 **Video Export**: Export choreography animations as 720p WebM video
- 🤖 **AI-Powered Formations**: Generate stage formations using Google Gemini AI
- 💾 **Project Management**: Save and load complete choreography projects
- 🎨 **Customizable Props**: Add and configure 3D stage props with dimensions
- 📦 **Group Management**: Organize performers into color-coded groups
- 🌗 **LED Screen Support**: Display images/videos on stage LED wall
- ⌨️ **Keyboard Shortcuts**: Full keyboard support for power users

## Installation

### Windows (x64)
Download and run `ChoreoMaster-Setup-1.0.0.exe` from the `dist-electron/` folder.

### Development Build
```bash
# Clone repository
git clone <repository-url>
cd ChoreoMaster

# Install dependencies
npm install

# Build desktop application
npm run build:electron

# Run in development mode
npm run dev:electron
```

## System Requirements

- Windows 10 or later (x64)
- 4GB RAM minimum (8GB recommended)
- 100MB free disk space
- GPU with OpenGL 3.0 support (for 3D view)

## Usage

1. **Launch Application**: Double-click ChoreoMaster desktop icon
2. **Create Project**: Add performers, configure stage, import music
3. **Design Choreography**: Use 2D view for precision editing, switch to 3D for visualization
4. **Timeline Management**: Create frames, adjust duration, preview transitions
5. **Export**: Save project as JSON, export animation as video

## Keyboard Shortcuts

| Action | Shortcut |
|---------|-----------|
| Play/Pause | Space |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |
| Copy Selection | Ctrl+C |
| Paste | Ctrl+V |
| Delete Selected | Delete |
| Toggle Labels | Click toolbar button |
| Toggle Grid | Ctrl+Scroll |
| Show Help | F1 or Ctrl+/ |

## File Formats

- **Project**: `.json` (ChoreoMaster format)
- **Export Video**: `.webm` (720p, 30fps)
- **Music Import**: `.mp3`, `.wav`, `.ogg`, `.m4a`
- **LED Content**: `.jpg`, `.png`, `.gif`, `.mp4`, `.webm`

## Technical Stack

- **Framework**: Electron 34 + React 19
- **3D Rendering**: Three.js + React Three Fiber
- **Build Tool**: Vite 6
- **Audio**: Web Audio API
- **Video Export**: MediaRecorder API
- **AI**: Google Gemini 2.5 Flash

## License

Copyright © 2025 ChoreoMaster. All rights reserved.
