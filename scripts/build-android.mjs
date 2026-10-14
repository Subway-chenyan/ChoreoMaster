import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../android/', import.meta.url));
const task = process.argv.includes('--release') ? 'assembleRelease' : 'assembleDebug';
const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [task], {
  cwd: directory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) console.error(`Android 构建启动失败：${result.error.message}`);
process.exit(result.status ?? 1);
