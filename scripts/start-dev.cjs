const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
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

function checkPortAvailable(port, targetHost) {
  return new Promise((resolve) => {
    const probeHost = targetHost === '0.0.0.0' ? '127.0.0.1' : targetHost;
    const socket = net.createConnection({ host: probeHost, port: Number(port) });

    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve({
        available: false,
        error: Object.assign(new Error('Port already accepts connections'), { code: 'EADDRINUSE' }),
      });
    });
    const tryBind = () => {
      socket.destroy();
      const server = net.createServer();
      server.unref();
      server.once('error', (error) => resolve({ available: false, error }));
      server.listen({ host: targetHost, port: Number(port), exclusive: true }, () => {
        server.close(() => resolve({ available: true }));
      });
    };
    socket.once('timeout', tryBind);
    socket.once('error', tryBind);
  });
}

async function assertPortAvailable(label, port) {
  const result = await checkPortAvailable(port, host);
  if (result.available) return;

  const code = result.error?.code || 'UNKNOWN';
  console.error(`[error] ${label}端口 ${host}:${port} 不可用（${code}）。`);
  console.error('[hint] 请先关闭占用该端口的旧进程，或在 .env 中修改对应端口。');
  if (process.platform === 'win32') {
    console.error(`[hint] 检查命令: Get-NetTCPConnection -LocalPort ${port} | Select-Object LocalAddress,State,OwningProcess`);
    console.error('[hint] 如果 PID 是 iphlpsvc/svchost，请检查: netsh interface portproxy show all');
  }
  process.exit(1);
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
  console.warn('[warn] LLM_PROVIDER=deepseek，但 DEEPSEEK_API_KEY 为空。文本 Agent 调用时会失败。');
}
if (
  (runtimeEnv.MULTIMODAL_LLM_PROVIDER || 'gemini').toLowerCase() === 'gemini'
  && !runtimeEnv.GEMINI_API_KEY
) {
  console.warn('[warn] GEMINI_API_KEY 为空，多模态编舞 Agent 暂不可用。');
}

const children = [];
let shuttingDown = false;

function terminateProcessTree(child) {
  if (!child?.pid || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
    });
    return;
  }
  child.kill('SIGTERM');
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) terminateProcessTree(child);
  setTimeout(() => process.exit(code), 100);
}

function startProcess(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: runtimeEnv,
    stdio: 'inherit',
    shell: false,
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      console.error(`[error] ${label} 已退出，代码 ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  await assertPortAvailable('前端', frontendPort);
  await assertPortAvailable('后端', backendPort);

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
    [npmCli, 'run', 'dev', '--', '--host', host, '--port', frontendPort, '--strictPort'],
    root,
  );
}

main().catch((error) => {
  console.error('[error] 启动失败:', error);
  shutdown(1);
});
