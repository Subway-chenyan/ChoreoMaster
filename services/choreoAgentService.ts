import { AIChoreoPlan, AIChoreoRequest, AIConfig, ChoreoAgentSession } from '../types';

const getHeaders = (config: AIConfig, json = false): HeadersInit => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  Authorization: `Bearer ${config.memberToken}`,
});

const getBaseUrl = (config: AIConfig) => {
  if (!config.backendUrl.trim()) throw new Error('请先配置 AI 后端地址。');
  if (!config.memberToken.trim()) throw new Error('请先配置会员凭证。');
  return config.backendUrl.replace(/\/+$/, '');
};

const readResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).detail || body;
    } catch {
      // Keep the original response body.
    }
    throw new Error(message || `请求失败 (${response.status})`);
  }
  return response.json();
};

export const validateAgentAccess = async (config: AIConfig): Promise<void> => {
  try {
    const response = await fetch(`${getBaseUrl(config)}/api/auth/validate`, {
      headers: getHeaders(config),
    });
    await readResponse<{ valid: boolean }>(response);
  } catch (error) {
    if (window.electronAPI?.isElectron) {
      const runtime = await window.electronAPI.agent.getRuntime();
      if (runtime.state !== 'ready') {
        throw new Error(runtime.error || '桌面端 Agent 服务尚未就绪。');
      }
    }
    throw error;
  }
};

export const createChoreoPlan = async (
  request: AIChoreoRequest,
  config: AIConfig
): Promise<AIChoreoPlan> => {
  const baseUrl = getBaseUrl(config);
  const response = await fetch(`${baseUrl}/api/ai/choreo-plan`, {
    method: 'POST',
    headers: getHeaders(config, true),
    body: JSON.stringify(request),
  });

  return readResponse<AIChoreoPlan>(response);
};

export const createMultimodalChoreoSession = async (
  input: {
    prompt: string;
    audio?: File | null;
    sketch?: File | null;
    segmentStartMs: number;
    segmentEndMs: number;
  },
  config: AIConfig,
): Promise<ChoreoAgentSession> => {
  const form = new FormData();
  form.append('prompt', input.prompt);
  if (input.audio) form.append('audio', input.audio);
  if (input.sketch) form.append('sketch', input.sketch);
  form.append('segmentStartMs', String(input.segmentStartMs));
  form.append('segmentEndMs', String(input.segmentEndMs));
  const response = await fetch(`${getBaseUrl(config)}/api/choreo/sessions`, {
    method: 'POST',
    headers: getHeaders(config),
    body: form,
  });
  return readResponse<ChoreoAgentSession>(response);
};

export const getMultimodalChoreoSession = async (
  sessionId: string,
  config: AIConfig,
): Promise<ChoreoAgentSession> => {
  const response = await fetch(
    `${getBaseUrl(config)}/api/choreo/sessions/${sessionId}`,
    { headers: getHeaders(config) },
  );
  return readResponse<ChoreoAgentSession>(response);
};

export const runMultimodalChoreoSession = async (
  sessionId: string,
  config: AIConfig,
): Promise<ChoreoAgentSession> => {
  const response = await fetch(
    `${getBaseUrl(config)}/api/choreo/sessions/${sessionId}/run`,
    { method: 'POST', headers: getHeaders(config) },
  );
  return readResponse<ChoreoAgentSession>(response);
};

export const resumeMultimodalChoreoSession = async (
  sessionId: string,
  payload: Record<string, unknown>,
  config: AIConfig,
): Promise<ChoreoAgentSession> => {
  const response = await fetch(
    `${getBaseUrl(config)}/api/choreo/sessions/${sessionId}/resume`,
    {
      method: 'POST',
      headers: getHeaders(config, true),
      body: JSON.stringify(payload),
    },
  );
  return readResponse<ChoreoAgentSession>(response);
};
