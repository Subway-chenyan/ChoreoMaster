module.exports = {
  appId: 'com.choreomaster.app',
  productName: 'ChoreoMaster',
  copyright: 'Copyright © 2025',
  directories: {
    output: 'dist-electron',
    buildResources: 'build',
  },
  files: [
    'electron/**/*',
    'dist/**/*',
    'package.json',
  ],
  extraFiles: [
    {
      from: 'build/icon.png',
      to: 'icon.png',
    },
  ],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'build/icon.ico',
    artifactName: '${productName}-${version}-setup.${ext}',
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
};
