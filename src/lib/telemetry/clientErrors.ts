import { browser } from '$app/environment';
import { user } from '$lib/stores/user';
import { ensureFirebaseReady } from '$lib/firebase';
import { db } from '$lib/firestore/client';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

type ClientErrorPayload = {
	message: string;
	stack?: string | null;
	source?: string | null;
	context?: Record<string, unknown> | null;
	severity?: 'error' | 'warning';
};

let initialized = false;
let currentUser: User | null = null;
let stopUserWatch: (() => void) | null = null;

const clientErrorsRef = () => collection(db(), 'clientErrors');

async function persistClientError(payload: ClientErrorPayload & { path?: string | null }) {
	try {
		await ensureFirebaseReady();
		await addDoc(clientErrorsRef(), {
			severity: payload.severity ?? 'error',
			message: payload.message.slice(0, 2000),
			stack: payload.stack?.slice(0, 8000) ?? null,
			source: payload.source ?? null,
			context: payload.context ?? null,
			path: payload.path ?? null,
			userId: currentUser?.uid ?? null,
			userEmail: currentUser?.email ?? null,
			userAgent: browser ? navigator.userAgent : null,
			createdAt: serverTimestamp()
		});
	} catch (err) {
		console.warn('[clientErrors] failed to persist', err);
	}
}

export async function reportClientError(payload: ClientErrorPayload) {
	if (!browser) return;
	const path =
		typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : null;
	await persistClientError({ ...payload, path });
}

function extractFromError(error: unknown): { message: string; stack?: string | null } {
	if (error instanceof Error) {
		return { message: error.message || 'Unknown error', stack: error.stack ?? null };
	}
	if (typeof error === 'string') {
		return { message: error, stack: null };
	}
	try {
		return { message: JSON.stringify(error), stack: null };
	} catch {
		return { message: 'Unknown error', stack: null };
	}
}

function handleWindowError(event: ErrorEvent) {
	const payload = extractFromError(event.error ?? event.message);
	void reportClientError({
		message: payload.message || event.message || 'Unhandled error',
		stack: payload.stack ?? null,
		source: event.filename ?? null,
		context: {
			line: event.lineno ?? null,
			column: event.colno ?? null
		}
	});
}

function handleRejection(event: PromiseRejectionEvent) {
	const payload = extractFromError(event.reason);
	void reportClientError({
		message: payload.message || 'Unhandled promise rejection',
		stack: payload.stack ?? null,
		source: 'unhandledrejection'
	});
}

export function initClientErrorReporting() {
	if (!browser || initialized) return;
	initialized = true;
	stopUserWatch = user.subscribe((value) => {
		currentUser = value;
	});
	window.addEventListener('error', handleWindowError);
	window.addEventListener('unhandledrejection', handleRejection);
}

export function teardownClientErrorReporting() {
	if (!browser || !initialized) return;
	window.removeEventListener('error', handleWindowError);
	window.removeEventListener('unhandledrejection', handleRejection);
	stopUserWatch?.();
	stopUserWatch = null;
	initialized = false;
}
