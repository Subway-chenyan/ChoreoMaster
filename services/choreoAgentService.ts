import { AIChoreoPlan, AIChoreoRequest, AIConfig } from '../types';

export const createChoreoPlan = async (
  request: AIChoreoRequest,
  config: AIConfig
): Promise<AIChoreoPlan> => {
  if (!config.backendUrl.trim()) {
    throw new Error('AI backend URL is missing.');
  }
  if (!config.memberToken.trim()) {
    throw new Error('Member credential is missing.');
  }

  const baseUrl = config.backendUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/ai/choreo-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.memberToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI backend failed: ${response.status} ${text}`);
  }

  return response.json();
};
