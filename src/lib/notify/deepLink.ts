import { browser } from '$app/environment';
import { goto } from '$app/navigation';

import { markActivityEntry } from '$lib/stores/activityFeed';

export type DeepLinkPayload = {
	serverId?: string | null;
	channelId?: string | null;
	threadId?: string | null;
	dmId?: string | null;
	messageId?: string | null;
	origin?: string | null;
	targetUrl?: string | null;
	activityId?: string | null;
};

type Listener = (payload: DeepLinkPayload) => void;

export function startDeepLinkListener(handler: Listener) {
	if (!browser || !('serviceWorker' in navigator)) return () => {};
	const listener = (event: MessageEvent) => {
		const data = event?.data;
		if (data?.type === 'HCONNECT_PUSH_DEEP_LINK' && data?.payload) {
			handler(data.payload as DeepLinkPayload);
		}
	};
	navigator.serviceWorker.addEventListener('message', listener);
	return () => navigator.serviceWorker.removeEventListener('message', listener);
}

function buildTargetUrl(payload: DeepLinkPayload) {
	if (payload.targetUrl) return payload.targetUrl;
	const origin = payload.origin || 'push';
	if (payload.dmId) {
		const params = new URLSearchParams({ origin });
		if (payload.messageId) params.set('messageId', payload.messageId);
		return `/dms/${payload.dmId}?${params.toString()}`;
	}
	if (payload.serverId && payload.channelId) {
		const params = new URLSearchParams({ origin, channel: payload.channelId });
		if (payload.threadId) params.set('thread', payload.threadId);
		if (payload.messageId) params.set('messageId', payload.messageId);
		return `/servers/${payload.serverId}?${params.toString()}`;
	}
	return '/';
}

export async function navigateToDeepLink(payload: DeepLinkPayload) {
	if (!browser) return;
	const url = buildTargetUrl(payload);
	await goto(url, { keepFocus: true, noScroll: false });
}

export async function handleDeepLinkPayload(payload: DeepLinkPayload) {
	if (payload.activityId) {
		await markActivityEntry(payload.activityId, { unread: false, clicked: true }).catch(() => {});
	}
	await navigateToDeepLink(payload);
}

export function extractDeepLinkFromURL(url: URL): DeepLinkPayload | null {
	const params = url.searchParams;
	const origin = params.get('origin');
	if (!origin || (origin !== 'push' && origin !== 'activity')) return null;
	if (url.pathname.startsWith('/dms/')) {
		const [, , dmId] = url.pathname.split('/');
		return {
			origin,
			dmId: dmId ?? null,
			messageId: params.get('messageId')
		};
	}
	if (url.pathname.startsWith('/servers/')) {
		const [, , serverId] = url.pathname.split('/');
		return {
			origin,
			serverId: serverId ?? null,
			channelId: params.get('channel'),
			threadId: params.get('thread'),
			messageId: params.get('messageId')
		};
	}
	return null;
}

export function clearDeepLinkParams(url: URL) {
	if (!browser) return;
	const params = url.searchParams;
	['origin', 'channel', 'thread', 'messageId'].forEach((key) => params.delete(key));
	const next = `${url.pathname}${params.toString() ? `?${params.toString()}` : ''}${url.hash ?? ''}`;
	history.replaceState({}, document.title, next);
}
