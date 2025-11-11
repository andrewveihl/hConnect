export type ReplyMessageContext = {
  text?: string | null;
  preview?: string | null;
  author?: string | null;
  type?: string | null;
};

export type ReplySuggestionInput = {
  message?: ReplyMessageContext | null;
  threadLabel?: string | null;
  context?: ReplyMessageContext[] | null;
};

export type PredictionInput = {
  text: string;
  count?: number;
  platform?: 'desktop' | 'mobile';
};

export type RewriteSuggestionInput = {
  text: string;
  count?: number;
  threadLabel?: string | null;
  context?: ReplyMessageContext[] | null;
  mode?: string | null;
};

export type ThreadSummaryMessage = {
  id?: string | null;
  messageId?: string | null;
  author?: string | null;
  text?: string | null;
  createdAt?: number | string | Date | null;
};

export type ThreadSummaryRequest = {
  threadId?: string;
  idleHours?: number;
  messages: ThreadSummaryMessage[];
};

export type ThreadSummaryItem = {
  title: string;
  details: string;
  messageId?: string | null;
};

const rawBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AI_API_BASE ?? '' : '';
const apiBase = rawBase.trim().replace(/\/+$/, '');
const REMOTE_ENDPOINT =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AI_FALLBACK) ||
  'https://hconnectbackend-118576002113.us-east5.run.app/api/ai';
const isBrowser = typeof window !== 'undefined';
const currentOrigin = isBrowser ? window.location.origin : '';
const isLocalDev = /^http:\/\/localhost(?::\d+)?$/i.test(currentOrigin);
const LOCAL_ENDPOINT = apiBase ? `${apiBase}/api/ai` : isLocalDev ? REMOTE_ENDPOINT : '/api/ai';
const fallbackPref =
  typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AI_REMOTE_FALLBACK : undefined;
const remoteFallbackEnabled = fallbackPref !== '0';
const FALLBACK_ENDPOINT = !apiBase && remoteFallbackEnabled ? REMOTE_ENDPOINT : '';
const ENDPOINTS = [LOCAL_ENDPOINT, ...(FALLBACK_ENDPOINT ? [FALLBACK_ENDPOINT] : [])].filter(
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

type PostOptions = {
  signal?: AbortSignal;
  endpoints?: string[];
};

async function postJson<T>(body: Record<string, unknown>, options: PostOptions = {}): Promise<T> {
  const { signal, endpoints = ENDPOINTS } = options;
  const errors: string[] = [];
  let unsupportedIntent = false;
  for (const endpoint of endpoints) {
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
      if (/unsupported intent/i.test(message)) {
        unsupportedIntent = true;
        continue;
      }
      errors.push(`${endpoint}: ${message}`);
      if (typeof console !== 'undefined') {
        console.error('[ai] request error', { endpoint, body, message });
      }
    }
  }
  if (errors.length) {
    throw new Error(errors.join(' | '));
  }
  if (unsupportedIntent) {
    throw new Error('AI intent not supported on the configured backend.');
  }
  throw new Error('AI request failed');
}

export async function requestReplySuggestion(input: ReplySuggestionInput, signal?: AbortSignal) {
  const payload = await postJson<{ suggestion?: string }>(
    { intent: 'reply', ...input },
    { signal }
  );
  return (payload.suggestion ?? '').trim();
}

export async function requestPredictions(input: PredictionInput, signal?: AbortSignal) {
  const payload = await postJson<{ suggestions?: string[] }>(
    { intent: 'predict', text: input.text, count: input.count, platform: input.platform },
    { signal }
  );
  return Array.isArray(payload.suggestions) ? payload.suggestions.filter(Boolean) : [];
}

export async function requestRewriteSuggestions(input: RewriteSuggestionInput, signal?: AbortSignal) {
  const payload = await postJson<{ options?: string[] }>(
    {
      intent: 'rewrite',
      text: input.text,
      count: input.count,
      threadLabel: input.threadLabel,
      context: input.context,
      mode: input.mode
    },
    { signal }
  );
  return Array.isArray(payload.options) ? payload.options.filter(Boolean) : [];
}

export async function requestThreadSummary(input: ThreadSummaryRequest, signal?: AbortSignal) {
  const payload = await postJson<{ summary?: ThreadSummaryItem[] }>(
    { intent: 'thread-summary', ...input },
    { signal }
  );
  return Array.isArray(payload.summary) ? payload.summary : [];
}
