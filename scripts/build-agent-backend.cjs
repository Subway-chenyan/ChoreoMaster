const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const distDir = path.join(root, 'build', 'agent-backend');
const workDir = path.join(root, 'build', '.pyinstaller-agent');

function commandWorks(command) {
  const result = spawnSync(command, ['--version'], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

const candidates = [
  process.env.PYTHON,
  'python',
  'python3',
  'py',
  path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'python', 'current', 'python.exe'),
].filter(Boolean);
const python = candidates.find(commandWorks);

if (!python) {
  console.error('未找到 Python 3.11+，无法构建桌面端 Agent 后端。');
  process.exit(1);
}

const pyinstallerCheck = spawnSync(
  python,
  ['-c', 'import PyInstaller'],
  { cwd: backendDir, stdio: 'ignore', shell: false },
);
if (pyinstallerCheck.status !== 0) {
  console.error(
    '缺少桌面构建依赖。请先运行：python -m pip install -r backend/requirements-desktop.txt',
  );
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(workDir, { recursive: true, force: true });

const result = spawnSync(
  python,
  [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onedir',
    '--name',
    'choreomaster-agent',
    '--distpath',
    distDir,
    '--workpath',
    workDir,
    '--specpath',
    workDir,
    '--paths',
    backendDir,
    '--collect-all',
    'langgraph',
    '--collect-all',
    'uvicorn',
    path.join(backendDir, 'desktop_entry.py'),
  ],
  {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  },
);

if (result.status !== 0) process.exit(result.status || 1);

const executable = path.join(
  distDir,
  'choreomaster-agent',
  process.platform === 'win32' ? 'choreomaster-agent.exe' : 'choreomaster-agent',
);
if (!fs.existsSync(executable)) {
  console.error(`Agent 后端构建完成，但未找到输出文件：${executable}`);
  process.exit(1);
}

console.log(`Agent 后端已构建：${executable}`);
