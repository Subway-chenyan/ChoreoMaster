const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const backendDir = path.join(repoRoot, 'backend');

const candidates = [
  process.env.PYTHON,
  'python',
  'python3',
  'py',
  path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'python', 'current', 'python.exe'),
].filter(Boolean);

let lastError = '';

for (const python of candidates) {
  const version = spawnSync(python, ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
  if (version.status !== 0) {
    lastError = `${python}: ${(version.stderr || version.stdout || '').trim()}`;
    continue;
  }

  const result = spawnSync(python, ['-m', 'pytest'], {
    cwd: backendDir,
    encoding: 'utf8',
    shell: false,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

console.error(`No usable Python interpreter found. Last error: ${lastError}`);
process.exit(1);
