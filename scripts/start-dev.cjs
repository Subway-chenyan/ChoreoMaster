const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const envPath = path.join(root, '.env');
const envExamplePath = path.join(root, '.env.example');
const shouldInstall = process.argv.includes('--install');

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('[setup] 已创建 .env，请填写所选模型的 API Key 后重新运行 start.bat。');
  process.exit(0);
}

const fileEnv = parseEnv(fs.readFileSync(envPath, 'utf8'));
const runtimeEnv = { ...process.env, ...fileEnv };
const host = runtimeEnv.APP_HOST || '127.0.0.1';
const frontendPort = runtimeEnv.FRONTEND_PORT || '5173';
const backendPort = runtimeEnv.BACKEND_PORT || '8000';

function commandWorks(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: runtimeEnv,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0;
}

function findPython() {
  const candidates = [
    runtimeEnv.PYTHON,
    'python',
    'python3',
    'py',
    path.join(runtimeEnv.USERPROFILE || '', 'scoop', 'apps', 'python', 'current', 'python.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => commandWorks(candidate));
}

function findNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(runtimeEnv.APPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const python = findPython();
if (!python) {
  console.error('[error] 未找到可用的 Python，请安装 Python 3.11+ 或在 .env 设置 PYTHON。');
  process.exit(1);
}

const npmCli = findNpmCli();
if (!npmCli) {
  console.error('[error] 未找到 npm，请先安装 Node.js 20+。');
  process.exit(1);
}

if (!commandWorks('ffmpeg', ['-version'])) {
  console.error('[error] 未找到 ffmpeg。多模态 Agent 需要 ffmpeg 截取音频片段。');
  process.exit(1);
}

if (shouldInstall || !fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('[setup] 安装前端依赖...');
  const npmInstall = spawnSync(process.execPath, [npmCli, 'install'], {
    cwd: root,
    env: runtimeEnv,
    stdio: 'inherit',
    shell: false,
  });
  if (npmInstall.status !== 0) process.exit(npmInstall.status || 1);
}

const backendCheck = spawnSync(
  python,
  ['-c', 'import fastapi, google.genai, langgraph, multipart, uvicorn'],
  { cwd: backendDir, env: runtimeEnv, stdio: 'ignore', shell: false },
);
if (shouldInstall || backendCheck.status !== 0) {
  console.log('[setup] 安装后端依赖...');
  const pipInstall = spawnSync(
    python,
    ['-m', 'pip', 'install', '-r', 'requirements.txt'],
    { cwd: backendDir, env: runtimeEnv, stdio: 'inherit', shell: false },
  );
  if (pipInstall.status !== 0) process.exit(pipInstall.status || 1);
}

const textProvider = (runtimeEnv.LLM_PROVIDER || 'rule').toLowerCase();
if (textProvider === 'deepseek' && !runtimeEnv.DEEPSEEK_API_KEY) {
  console.warn('[warn] LLM_PROVIDER=deepseek，但 DEEPSEEK_API_KEY 为空。普通文本 Agent 调用时会失败。');
}
if (
  (runtimeEnv.MULTIMODAL_LLM_PROVIDER || 'gemini').toLowerCase() === 'gemini'
  && !runtimeEnv.GEMINI_API_KEY
) {
  console.warn('[warn] GEMINI_API_KEY 为空，多模态编舞 Agent 暂不可用。');
}

const children = [];
function startProcess(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: runtimeEnv,
    stdio: 'inherit',
    shell: false,
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[error] ${label} 已退出，代码 ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 100);
}

console.log('');
console.log(`[model] 文本 Agent: ${textProvider}`);
console.log(`[model] 多模态 Agent: ${runtimeEnv.MULTIMODAL_LLM_PROVIDER || 'gemini'}`);
console.log(`[start] 前端: http://${host}:${frontendPort}`);
console.log(`[start] 后端: http://${host}:${backendPort}`);
console.log('[start] 按 Ctrl+C 停止全部服务。');
console.log('');

startProcess(
  'backend',
  python,
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--host', host, '--port', backendPort],
  backendDir,
);
startProcess(
  'frontend',
  process.execPath,
  [npmCli, 'run', 'dev', '--', '--host', host, '--port', frontendPort],
  root,
);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
});
