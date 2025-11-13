// Shared helpers for formatting message previews and mention metadata.
type AnyRecord = Record<string, any>;

export function truncate(input: string | null | undefined, limitTo = 80): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length <= limitTo) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limitTo - 3))}...`;
}

export function pickMessageSnippet(data: AnyRecord | null | undefined): string | null {
  if (!data || typeof data !== 'object') return null;
  const textCandidates = ['text', 'content', 'message', 'body'];
  for (const key of textCandidates) {
    const value = data[key];
    if (typeof value === 'string') {
      const snippet = truncate(value, 84);
      if (snippet) return snippet;
    }
  }

  if (typeof data?.url === 'string' && data.url.trim()) {
    if (data?.type === 'gif') return 'Sent a GIF';
    return 'Shared a link';
  }

  if (data?.type === 'gif') return 'Sent a GIF';
  if (data?.type === 'poll') return 'Posted a poll';
  if (data?.type === 'form') return 'Shared a form';

  return null;
}

export function pickAuthor(data: AnyRecord | null | undefined): string | null {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.displayName,
    data.author?.displayName,
    data.author?.name,
    data.name,
    data.uid
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function formatPreview(author: string | null, snippet: string | null): string | null {
  if (snippet && author) return `${author}: ${snippet}`;
  if (snippet) return snippet;
  if (author) return `${author} sent a message`;
  return null;
}

export function normalizeUid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function extractMentionedUids(raw: AnyRecord | null | undefined): string[] {
  const set = new Set<string>();
  if (Array.isArray(raw?.mentions)) {
    raw.mentions.forEach((entry: any) => {
      const uid = normalizeUid(entry?.uid ?? entry);
      if (uid) set.add(uid);
    });
  } else if (raw?.mentionsMap && typeof raw.mentionsMap === 'object') {
    Object.keys(raw.mentionsMap).forEach((key) => {
      const uid = normalizeUid(key);
      if (uid) set.add(uid);
    });
  }
  return Array.from(set);
}
