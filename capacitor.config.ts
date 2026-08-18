import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.choreomaster.app',
  appName: 'CosStage',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
    },
  },
};

export default config;
