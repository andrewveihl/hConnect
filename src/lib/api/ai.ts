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

const LOCAL_ENDPOINT = '/api/ai';
const FALLBACK_ENDPOINT = 'https://hconnectbackend-118576002113.us-east5.run.app/api/ai';
const ENDPOINTS = [LOCAL_ENDPOINT, FALLBACK_ENDPOINT].filter(
  (endpoint, index, list) => endpoint && list.indexOf(endpoint) === index
);

async function readErrorDetail(response: Response) {
  try {
    const payload = await response.clone().json();
    if (payload && typeof payload.error === 'string') return payload.error;
  } catch {}
  try {
    return await response.clone().text();
  } catch {
    return null;
  }
}

async function postJson<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const errors: string[] = [];
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response);
        const message = detail || `AI request failed (${response.status})`;
        throw new Error(message);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (
        error instanceof DOMException
          ? error.name === 'AbortError'
          : error instanceof Error && error.name === 'AbortError'
      ) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
      errors.push(`${endpoint}: ${message}`);
    }
  }
  throw new Error(errors.length ? errors.join(' | ') : 'AI request failed');
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
