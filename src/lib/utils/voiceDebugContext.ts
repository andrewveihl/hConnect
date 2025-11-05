type VoiceDebugSeverity = 'info' | 'warn' | 'error';

export type VoiceDebugEvent = {
  id: number;
  timestamp: string;
  source: string;
  message: string;
  severity: VoiceDebugSeverity;
  details?: unknown;
};

type VoiceDebugSnapshot = {
  sections: Record<string, unknown>;
  events: VoiceDebugEvent[];
};

const MAX_STORED_EVENTS = 200;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 4;

const sections = new Map<string, unknown>();
let events: VoiceDebugEvent[] = [];
let sequence = 0;

function summarizeMediaStream(stream: MediaStream): Record<string, unknown> {
  const describeTrack = (track: MediaStreamTrack) => ({
    id: track.id,
    kind: track.kind,
    muted: track.muted,
    enabled: track.enabled,
    readyState: track.readyState,
    label: track.label
  });
  return {
    type: 'MediaStream',
    id: stream.id,
    audioTracks: stream.getAudioTracks().slice(0, MAX_ARRAY_LENGTH).map(describeTrack),
    videoTracks: stream.getVideoTracks().slice(0, MAX_ARRAY_LENGTH).map(describeTrack)
  };
}

function safeCloneForDebug(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (value === undefined) return null;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }
  if (valueType === 'bigint') {
    try {
      return Number(value);
    } catch {
      return value.toString();
    }
  }
  if (valueType === 'symbol') return value.toString();
  if (valueType === 'function') return '[Function]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => safeCloneForDebug(item, depth + 1));
  }
  if (typeof MediaStream !== 'undefined' && value instanceof MediaStream) {
    return summarizeMediaStream(value);
  }
  if (typeof MediaStreamTrack !== 'undefined' && value instanceof MediaStreamTrack) {
    return {
      type: 'MediaStreamTrack',
      id: value.id,
      kind: value.kind,
      muted: value.muted,
      enabled: value.enabled,
      readyState: value.readyState,
      label: value.label
    };
  }
  if (value && valueType === 'object') {
    if (value instanceof Map) {
      return {
        type: 'Map',
        entries: Array.from(value.entries())
          .slice(0, MAX_ARRAY_LENGTH)
          .map(([key, val]) => [safeCloneForDebug(key, depth + 1), safeCloneForDebug(val, depth + 1)])
      };
    }
    if (value instanceof Set) {
      return {
        type: 'Set',
        values: Array.from(value.values())
          .slice(0, MAX_ARRAY_LENGTH)
          .map((item) => safeCloneForDebug(item, depth + 1))
      };
    }
    const plain: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ARRAY_LENGTH);
    for (const [key, val] of entries) {
      plain[key] = safeCloneForDebug(val, depth + 1);
    }
    return plain;
  }
  return String(value);
}

export function setVoiceDebugSection(section: string, data: unknown): void {
  sections.set(section, safeCloneForDebug(data));
}

export function removeVoiceDebugSection(section: string): void {
  sections.delete(section);
}

export function appendVoiceDebugEvent(
  source: string,
  message: string,
  details?: unknown,
  severity: VoiceDebugSeverity = 'info'
): void {
  sequence += 1;
  const event: VoiceDebugEvent = {
    id: sequence,
    timestamp: new Date().toISOString(),
    source,
    message,
    severity,
    details: safeCloneForDebug(details)
  };
  events = [event, ...events].slice(0, MAX_STORED_EVENTS);
}

export function getVoiceDebugContext(maxEvents = 50): VoiceDebugSnapshot {
  const snapshotSections: Record<string, unknown> = {};
  sections.forEach((value, key) => {
    snapshotSections[key] = safeCloneForDebug(value);
  });
  const snapshotEvents = events.slice(0, maxEvents);
  return {
    sections: snapshotSections,
    events: snapshotEvents
  };
}

function formatDetails(details: unknown): string {
  if (details === null || details === undefined) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function formatVoiceDebugContext(options: { maxEvents?: number } = {}): string {
  const { maxEvents } = options;
  const snapshot = getVoiceDebugContext(maxEvents ?? 40);
  const lines: string[] = [];

  lines.push('context_sections:');
  const sectionKeys = Object.keys(snapshot.sections);
  if (!sectionKeys.length) {
    lines.push('  (none)');
  } else {
    for (const key of sectionKeys) {
      const value = snapshot.sections[key];
      lines.push(`  ${key}: ${formatDetails(value)}`);
    }
  }

  lines.push('', 'context_events:');
  if (!snapshot.events.length) {
    lines.push('  (none)');
  } else {
    for (const event of snapshot.events) {
      const payload = event.details ? ` | ${formatDetails(event.details)}` : '';
      lines.push(
        `  - [${event.timestamp}] (${event.severity.toUpperCase()}) ${event.source}: ${event.message}${payload}`
      );
    }
  }

  return lines.join('\n');
}

export async function buildVoiceDebugAggregate(options: {
  includeLogs?: number;
  includeEvents?: number;
} = {}): Promise<string> {
  const lines: string[] = [];
  lines.push('=== hConnect Voice Debug Aggregate ===', `captured_at: ${new Date().toISOString()}`);

  lines.push('', formatVoiceDebugContext({ maxEvents: options.includeEvents ?? 60 }));

  if (typeof window !== 'undefined') {
    const dumpFn = (window as any)?.hConnectVoiceDump;
    if (typeof dumpFn === 'function') {
      try {
        const bundle = await dumpFn({ includeLogs: options.includeLogs ?? 40 });
        if (bundle) {
          lines.push('', '--- voice-call-bundle ---', bundle);
        }
      } catch (err) {
        lines.push('', 'voice_call_bundle_error:', String(err));
      }
    } else {
      lines.push('', 'voice_call_bundle_unavailable: voice UI not mounted');
    }
  }

  return lines.join('\n');
}

export async function copyVoiceDebugAggregate(options: {
  includeLogs?: number;
  includeEvents?: number;
} = {}): Promise<boolean> {
  const aggregate = await buildVoiceDebugAggregate(options);
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(aggregate);
      appendVoiceDebugEvent('debug', 'copyVoiceDebugAggregate success', {
        includeLogs: options.includeLogs ?? null,
        includeEvents: options.includeEvents ?? null
      });
      return true;
    } catch (err) {
      appendVoiceDebugEvent('debug', 'copyVoiceDebugAggregate clipboard failure', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  console.info('[voice] debug aggregate\n', aggregate);
  return false;
}
