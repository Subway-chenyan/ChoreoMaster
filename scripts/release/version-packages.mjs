import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNpmRunner, versionPackages } from './version-packages-core.mjs';

async function main() {
  const root = path.resolve(import.meta.dirname, '../..');
  const entry = await versionPackages({
    root,
    runNpm: createNpmRunner(),
  });
  console.log(`已准备 CosStage ${entry.version}`);
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : '版本生成失败');
    process.exitCode = 1;
  }
}
