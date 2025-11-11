export type ReplyMessageContext = {
  text?: string | null;
  preview?: string | null;
  author?: string | null;
  type?: string | null;
};

export type ReplySuggestionInput = {
  message?: ReplyMessageContext | null;
  threadLabel?: string | null;
};

export type PredictionInput = {
  text: string;
  count?: number;
  platform?: 'desktop' | 'mobile';
};

import { PUBLIC_AI_ENDPOINT } from '$env/static/public';

const AI_ENDPOINT = (PUBLIC_AI_ENDPOINT?.trim() || '/api/ai') as string;

async function postJson<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const payload = await response.json();
      detail = payload?.error;
    } catch {
      detail = await response.text();
    }
    throw new Error(detail || `AI request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function requestReplySuggestion(input: ReplySuggestionInput, signal?: AbortSignal) {
  const payload = await postJson<{ suggestion?: string }>({ intent: 'reply', ...input }, signal);
  return (payload.suggestion ?? '').trim();
}

export async function requestPredictions(input: PredictionInput, signal?: AbortSignal) {
  const payload = await postJson<{ suggestions?: string[] }>(
    { intent: 'predict', text: input.text, count: input.count, platform: input.platform },
    signal
  );
  return Array.isArray(payload.suggestions) ? payload.suggestions.filter(Boolean) : [];
}
