export type PresenceState = 'online' | 'busy' | 'idle' | 'offline';

export type ManualPresence = {
	state: PresenceState;
	expiresAt: number | null;
};

export const ONLINE_WINDOW_MS = 10 * 60 * 1000;
export const IDLE_WINDOW_MS = 60 * 60 * 1000;

export const presenceLabels: Record<PresenceState, string> = {
	online: 'Online',
	busy: 'Busy',
	idle: 'Idle',
	offline: 'Offline'
};

const pickString = (value: unknown): string | undefined => {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length) return trimmed;
	}
	return undefined;
};

const toMillis = (value: unknown): number | null => {
	try {
		if (!value) return null;
		if (typeof value === 'number') return Number.isFinite(value) ? value : null;
		if (typeof value === 'string') {
			const parsed = Date.parse(value);
			return Number.isFinite(parsed) ? parsed : null;
		}
		if (value instanceof Date) return value.getTime();
		if (typeof (value as any)?.toMillis === 'function') {
			const ts = (value as any).toMillis();
			return Number.isFinite(ts) ? ts : null;
		}
		if (typeof (value as any)?.seconds === 'number') {
			const base = (value as any).seconds * 1000;
			const extra =
				typeof (value as any)?.nanoseconds === 'number' ? (value as any).nanoseconds / 1e6 : 0;
			const total = base + extra;
			return Number.isFinite(total) ? total : null;
		}
	} catch {
		return null;
	}
	return null;
};

export const normalizePresence = (raw?: string | null): PresenceState | null => {
	if (!raw) return null;
	const normalized = raw.trim().toLowerCase();
	if (!normalized) return null;
	if (['online', 'active', 'available', 'connected', 'here'].includes(normalized)) return 'online';
	if (['busy', 'dnd', 'do not disturb', 'occupied', 'focus'].includes(normalized)) return 'busy';
	if (['idle', 'away', 'brb', 'soon'].includes(normalized)) return 'idle';
	if (['offline', 'invisible', 'off'].includes(normalized)) return 'offline';
	return null;
};

const manualPresenceFrom = (source: any): ManualPresence | null => {
	if (!source || typeof source !== 'object') return null;
	const raw =
		pickString(source.manualState) ??
		pickString((source.manual as any)?.state) ??
		pickString((source.presence as any)?.manualState) ??
		pickString((source.presence as any)?.manual?.state);
	if (!raw) return null;
	const state = normalizePresence(raw);
	if (!state) return null;
	const expiresAt =
		toMillis(source.manualExpiresAt) ??
		toMillis((source.manual as any)?.expiresAt) ??
		toMillis((source.presence as any)?.manualExpiresAt) ??
		toMillis((source.presence as any)?.manual?.expiresAt) ??
		null;
	if (expiresAt && Date.now() > expiresAt) return null;
	return { state, expiresAt };
};

export const resolveManualPresenceFromSources = (...sources: any[]): ManualPresence | null => {
	for (const source of sources) {
		const manual = manualPresenceFrom(source);
		if (manual) return manual;
	}
	return null;
};

const booleanPresenceFrom = (source: any): boolean | null => {
	if (!source || typeof source !== 'object') return null;
	if (typeof source.online === 'boolean') return source.online;
	if (typeof source.isOnline === 'boolean') return source.isOnline;
	if (typeof source.active === 'boolean') return source.active;
	if (source.presence && typeof source.presence === 'object') {
		const nested = booleanPresenceFrom(source.presence);
		if (nested !== null) return nested;
	}
	return null;
};

const statusPresenceFrom = (source: any): PresenceState | null => {
	if (!source || typeof source !== 'object') return null;
	const candidates = [
		pickString(source.status),
		pickString(source.state),
		pickString(source.presenceState),
		pickString(source.availability),
		pickString((source.presence as any)?.status),
		pickString((source.presence as any)?.state),
		pickString((source.presence as any)?.presenceState)
	];
	for (const candidate of candidates) {
		const normalized = normalizePresence(candidate ?? null);
		if (normalized) return normalized;
	}
	return null;
};

const recentTimestampFrom = (source: any): number | null => {
	if (!source || typeof source !== 'object') return null;
	const candidates = [
		source.lastActive,
		source.lastSeen,
		source.updatedAt,
		source.timestamp,
		(source.presence as any)?.lastActive,
		(source.presence as any)?.lastSeen,
		(source.presence as any)?.updatedAt,
		(source.presence as any)?.timestamp
	];
	for (const candidate of candidates) {
		const ts = toMillis(candidate);
		if (ts !== null) return ts;
	}
	return null;
};

export const presenceFromSources = (
	sources: Array<any>,
	{
		onlineWindowMs = ONLINE_WINDOW_MS,
		idleWindowMs = IDLE_WINDOW_MS
	}: { onlineWindowMs?: number; idleWindowMs?: number } = {}
): PresenceState => {
	const filtered = sources.filter(Boolean);

	const manual = resolveManualPresenceFromSources(...filtered);
	if (manual) return manual.state;

	for (const source of filtered) {
		const bool = booleanPresenceFrom(source);
		if (bool === true) return 'online';
	}

	for (const source of filtered) {
		const normalized = statusPresenceFrom(source);
		if (normalized) return normalized;
	}

	for (const source of filtered) {
		const recent = recentTimestampFrom(source);
		if (recent !== null) {
			const diff = Date.now() - recent;
			if (diff <= onlineWindowMs) return 'online';
			if (diff <= idleWindowMs) return 'idle';
			return 'offline';
		}
	}

	return 'offline';
};
