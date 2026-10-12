import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.cosstage.mobile',
  appName: 'CosStage',
  webDir: 'dist',
  plugins: { SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'cover', style: 'DARK' } },
  android: { backgroundColor: '#0b1220' },
};
export default config;
