import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Capacitor 8 dependencies and Android scripts stay aligned', async () => {
  const packageJson = JSON.parse(await read('package.json'));

  for (const dependency of ['@capacitor/core', '@capacitor/android', '@capacitor/app']) {
    assert.match(packageJson.dependencies?.[dependency] ?? '', /^\^8\./, `${dependency} must use Capacitor 8`);
  }
  assert.match(packageJson.devDependencies?.['@capacitor/cli'] ?? '', /^\^8\./);
  assert.equal(packageJson.scripts?.['android:sync'], 'npm run build && cap sync android');
  assert.equal(packageJson.scripts?.['android:debug'], 'npm run android:sync && cd android && gradlew.bat assembleDebug');
  assert.equal(packageJson.scripts?.['android:install'], 'cd android && gradlew.bat installDebug');
});

test('the standard npm test path includes the Android packaging contract', async () => {
  const packageJson = JSON.parse(await read('package.json'));

  assert.match(packageJson.scripts?.['test:desktop'] ?? '', /(?:^|\s)tests\/android-packaging\.test\.mjs(?:\s|$)/);
  assert.match(packageJson.scripts?.test ?? '', /(?:^|&&\s*)npm run test:desktop(?:\s*&&|$)/);
});

test('Capacitor config identifies CosStage and enables CSS system-bar insets', async () => {
  const config = await read('capacitor.config.ts');

  assert.match(config, /appId:\s*['"]com\.choreomaster\.app['"]/);
  assert.match(config, /appName:\s*['"]CosStage['"]/);
  assert.match(config, /webDir:\s*['"]dist['"]/);
  assert.match(config, /androidScheme:\s*['"]https['"]/);
  assert.match(config, /SystemBars:\s*\{[\s\S]{0,160}insetsHandling:\s*['"]css['"]/);
});

test('Gradle wrapper pins the smaller official distribution for reliable first setup', async () => {
  const wrapper = await read('android/gradle/wrapper/gradle-wrapper.properties');

  assert.match(wrapper, /^networkTimeout=60000$/m);
  assert.match(wrapper, /^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-8\.14\.3-bin\.zip$/m);
  assert.match(wrapper, /^distributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531$/m);
});

test('native Android Back delegates layers to browser history and minimizes only at the root', async () => {
  const [hook, app] = await Promise.all([
    read('hooks/useAndroidBackButton.ts'),
    read('App.tsx'),
  ]);

  assert.match(hook, /@capacitor\/app/);
  assert.match(hook, /@capacitor\/core/);
  assert.match(hook, /addListener\(['"]backButton['"]/);
  assert.match(hook, /hasHistoryLayer\s*\|\|\s*canGoBack[\s\S]{0,100}window\.history\.back\(\)/);
  assert.match(hook, /minimizeApp\(\)/);
  assert.match(hook, /return\s*\(\)\s*=>\s*\{[\s\S]{0,260}(?:remove\(\)|removeListener)/);
  assert.match(app, /useAndroidBackButton\(\{[\s\S]{0,220}enabled:\s*isPhoneLayout[\s\S]{0,220}hasHistoryLayer:/);
  assert.match(app, /useMobileHistoryLayer\(\{/);
});

test('web-only save reminder excludes Capacitor native without changing the Electron gate', async () => {
  const app = await read('App.tsx');

  assert.match(app, /import\s+\{\s*Capacitor\s*\}\s+from\s+['"]@capacitor\/core['"]/);
  assert.match(
    app,
    /showWebSaveReminder,\s*setShowWebSaveReminder\]\s*=\s*useState\(\s*\(\)\s*=>\s*!window\.electronAPI\?\.isElectron\s*&&\s*!Capacitor\.isNativePlatform\(\)\s*,?\s*\)/,
  );
});

test('Sidebar exposes the persisted AI backend URL for Android devices', async () => {
  const sidebar = await read('components/Sidebar.tsx');

  assert.match(sidebar, /<label[^>]*>[\s\S]{0,80}AI 后端地址[\s\S]{0,80}<\/label>/);
  assert.match(sidebar, /value=\{aiConfig\.backendUrl\}/);
  assert.match(sidebar, /onAiConfigChange\(\{\s*\.\.\.aiConfig,\s*backendUrl:\s*e\.target\.value\s*\}\)/);
  assert.match(sidebar, /Android 模拟器[\s\S]{0,120}http:\/\/10\.0\.2\.2:8000/);
});

test('cleartext HTTP is debug-only in the generated Android manifests', async () => {
  const [debugManifest, mainManifest] = await Promise.all([
    read('android/app/src/debug/AndroidManifest.xml'),
    read('android/app/src/main/AndroidManifest.xml'),
  ]);

  assert.match(debugManifest, /android:usesCleartextTraffic=['"]true['"]/);
  assert.doesNotMatch(mainManifest, /android:usesCleartextTraffic=['"]true['"]/);
});

test('generated Android instrumentation test expects the CosStage application id', async () => {
  const instrumentationTest = await read('android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java');

  assert.match(instrumentationTest, /assertEquals\("com\.choreomaster\.app",\s*appContext\.getPackageName\(\)\);/);
  assert.doesNotMatch(instrumentationTest, /com\.getcapacitor\.app/);
});

test('Git ignores local Android artifacts and signing configuration', async () => {
  const [rootIgnore, androidIgnore] = await Promise.all([
    read('.gitignore'),
    read('android/.gitignore'),
  ]);

  assert.match(rootIgnore, /^\/artifacts\/$/m);
  assert.match(androidIgnore, /^\*\.jks$/m);
  assert.match(androidIgnore, /^\*\.keystore$/m);
  assert.match(androidIgnore, /^key\.properties$/m);
  assert.match(androidIgnore, /^google-services\.json$/m);
});

test('safe-area variables prefer Capacitor injection and fall back to browser env values', async () => {
  const css = await read('index.css');

  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.match(
      css,
      new RegExp(`--app-safe-${edge}:\\s*var\\(--safe-area-inset-${edge},\\s*env\\(safe-area-inset-${edge},\\s*0px\\)\\)`),
    );
  }
  assert.match(css, /\.safe-top\s*\{[\s\S]{0,100}var\(--app-safe-top\)/);
  assert.match(css, /\.safe-bottom\s*\{[\s\S]{0,100}var\(--app-safe-bottom\)/);
});
