import { app, ipcMain, shell } from 'electron';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import isDev from 'electron-is-dev';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type AgentBackendState = 'starting' | 'ready' | 'stopped' | 'error';

export interface AgentBackendRuntime {
  state: AgentBackendState;
  baseUrl: string;
  accessToken: string;
  configPath: string;
  logPath: string;
  error?: string;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
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

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法分配本地 Agent 端口。'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function commandWorks(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

export class AgentBackendManager {
  private child: ChildProcess | null = null;
  private state: AgentBackendState = 'stopped';
  private baseUrl = '';
  private accessToken = '';
  private lastError = '';
  private stopping = false;
  private readonly configPath: string;
  private readonly logPath: string;

  constructor() {
    const dataDir = app.getPath('userData');
    this.configPath = isDev
      ? path.resolve(__dirname, '..', '.env')
      : path.join(dataDir, 'agent.env');
    this.logPath = path.join(dataDir, 'logs', 'agent-backend.log');
    this.ensureProductionConfig();
  }

  registerIpc(): void {
    ipcMain.handle('agent:getRuntime', () => this.getRuntime());
    ipcMain.handle('agent:restart', async () => {
      await this.restart();
      return this.getRuntime();
    });
    ipcMain.handle('agent:openConfig', async () => {
      const error = await shell.openPath(this.configPath);
      if (error) throw new Error(error);
    });
    ipcMain.handle('agent:openLogs', async () => {
      const error = await shell.openPath(path.dirname(this.logPath));
      if (error) throw new Error(error);
    });
  }

  getRuntime(): AgentBackendRuntime {
    return {
      state: this.state,
      baseUrl: this.baseUrl,
      accessToken: this.accessToken,
      configPath: this.configPath,
      logPath: this.logPath,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async start(): Promise<void> {
    if (this.child || this.state === 'starting') return;

    this.state = 'starting';
    this.lastError = '';
    this.stopping = false;
    const port = await reservePort();
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.accessToken = randomBytes(24).toString('hex');

    const fileEnv = parseEnvFile(this.configPath);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...fileEnv,
      APP_HOST: '127.0.0.1',
      BACKEND_PORT: String(port),
      AGENT_ACCESS_KEYS: this.accessToken,
      ALLOW_DEV_MEMBER_TOKEN: 'false',
      CHOREOMASTER_DESKTOP: 'true',
    };

    const ffmpegPath = isDev
      ? ''
      : path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (ffmpegPath && existsSync(ffmpegPath)) env.FFMPEG_PATH = ffmpegPath;

    const command = this.resolveCommand();
    if (!command) {
      this.fail(
        isDev
          ? '未找到可用的 Python。请安装 Python 3.11+，或在 .env 中设置 PYTHON。'
          : '安装包中缺少 Agent 后端可执行文件，请重新构建桌面安装包。',
      );
      return;
    }

    mkdirSync(path.dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, `\n[${new Date().toISOString()}] starting ${command.executable}\n`);

    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    this.child = child;
    child.stdout.on('data', (data: Buffer) => this.writeLog(data));
    child.stderr.on('data', (data: Buffer) => this.writeLog(data));
    child.once('error', (error) => this.fail(`Agent 后端启动失败：${error.message}`));
    child.once('exit', (code, signal) => {
      this.child = null;
      if (!this.stopping && this.state !== 'error') {
        this.fail(`Agent 后端意外退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）。`);
      }
    });

    try {
      await this.waitUntilHealthy();
      this.state = 'ready';
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      await this.stop();
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    if (this.state !== 'error') this.state = 'stopped';
  }

  private resolveCommand(): { executable: string; args: string[]; cwd: string } | null {
    if (!isDev) {
      const executableName = process.platform === 'win32'
        ? 'choreomaster-agent.exe'
        : 'choreomaster-agent';
      const executable = path.join(process.resourcesPath, 'agent-backend', executableName);
      return existsSync(executable)
        ? { executable, args: [], cwd: path.dirname(executable) }
        : null;
    }

    const root = path.resolve(__dirname, '..');
    const backendDir = path.join(root, 'backend');
    const configuredPython = parseEnvFile(this.configPath).PYTHON;
    const candidates = [
      configuredPython,
      process.env.PYTHON,
      'python',
      'python3',
      'py',
    ].filter((value): value is string => Boolean(value));
    const python = candidates.find(commandWorks);
    return python
      ? {
          executable: python,
          args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', this.baseUrl.split(':').at(-1)!],
          cwd: backendDir,
        }
      : null;
  }

  private async waitUntilHealthy(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error('Agent 后端在健康检查完成前退出。');
      try {
        const response = await fetch(`${this.baseUrl}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) return;
      } catch {
        // The server may still be importing model dependencies.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Agent 后端启动超时，请打开日志查看依赖或模型配置错误。');
  }

  private ensureProductionConfig(): void {
    if (isDev || existsSync(this.configPath)) return;
    mkdirSync(path.dirname(this.configPath), { recursive: true });
    writeFileSync(
      this.configPath,
      [
        '# ChoreoMaster 桌面端 Agent 配置',
        'LLM_PROVIDER=rule',
        'MULTIMODAL_LLM_PROVIDER=gemini',
        'GEMINI_API_KEY=',
        'GEMINI_FLASH_MODEL=gemini-2.5-flash',
        'GEMINI_PRO_MODEL=gemini-2.5-pro',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  private writeLog(data: Buffer): void {
    appendFileSync(this.logPath, data);
  }

  private fail(message: string): void {
    this.state = 'error';
    this.lastError = message;
    appendFileSync(this.logPath, `[${new Date().toISOString()}] ERROR ${message}\n`);
  }
}
