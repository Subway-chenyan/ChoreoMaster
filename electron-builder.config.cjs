module.exports = {
  appId: 'com.choreomaster.app',
  productName: 'ChoreoMaster',
  copyright: 'Copyright © 2025',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist-electron/main.js',
    'dist-electron/preload.js',
    'dist-electron/ipc-handlers.js',
    'dist-electron/project-contract.js',
    'dist-electron/project-service.js',
    'dist/**/*',
    'package.json',
  ],
  extraFiles: [
    {
      from: 'build/icon.png',
      to: 'icon.png',
    },
  ],
  extraResources: [],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'build/icon.ico',
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'ChoreoMaster',
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: ['dmg'],
    icon: 'build/icon.icns',
    category: 'public.app-category.productivity',
  },
  linux: {
    target: ['AppImage', 'deb'],
    icon: 'build/icon.png',
    category: 'Productivity',
  },
  asar: true,
  asarUnpack: [],
  compression: 'maximum',
  publish: null,
  // 只保留英文和中文 locale
  electronLanguages: ['en', 'en-US', 'zh-CN', 'zh-TW'],
};
