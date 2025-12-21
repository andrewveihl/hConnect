// src/lib/notify/push.ts
import { browser } from '$app/environment';
import { PUBLIC_FCM_VAPID_KEY } from '$env/static/public';
import { env as PUBLIC_ENV } from '$env/dynamic/public';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

const DEVICE_COLLECTION = 'devices';
const DEVICE_ID_STORAGE_KEY = 'hconnect_device_id';
const AUTO_PROMPT_STORAGE_KEY = 'hconnect_push_prompted_v1';
const PUSH_DEBUG_PREFIX = '[push-client]';

export type PushDebugEvent = {
	step: string;
	message?: string;
	context?: unknown;
	error?: string;
	at?: number;
};

export type PushDebugEmitter = (event: PushDebugEvent) => void;

function emitPushDebug(emitter: PushDebugEmitter | undefined, event: PushDebugEvent) {
	if (!emitter) return;
	try {
		emitter({
			...event,
			at: event.at ?? Date.now()
		});
	} catch (err) {
		console.warn('push debug listener error', err);
	}
}

type DevicePlatform =
	| 'web_chrome'
	| 'web_firefox'
	| 'web_edge'
	| 'web_safari'
	| 'web'
	| 'ios_browser'
	| 'ios_pwa'
	| 'android_browser'
	| 'android_pwa';

type DevicePermission = NotificationPermission | 'unsupported';

type DeviceDocUpdate = {
	token?: string | null;
	permission?: DevicePermission;
	enabled?: boolean;
	subscription?: PushSubscriptionJSON | null;
};

let swReg: ServiceWorkerRegistration | null = null;
let cachedDeviceId: string | null = null;
let activeDeviceUid: string | null = null;
let swMessageHandler: ((event: MessageEvent) => void) | null = null;
let swMessagePort: MessagePort | null = null;
type TestPushDelivery = {
	deviceId?: string | null;
	messageId?: string | null;
	sentAt?: number | null;
	status?: 'delivered' | 'failed';
	error?: string | null;
};

type TestPushListener = (payload: TestPushDelivery) => void;
const testPushListeners = new Set<TestPushListener>();
const pingResolvers = new Map<
	string,
	{
		resolve: (value: boolean) => void;
		timer: ReturnType<typeof setTimeout>;
	}
>();

const PUSH_CHANNEL_NAME = 'hconnect-push-events';
let pushBroadcastChannel: BroadcastChannel | null = null;
const SAFARI_WEB_PUSH_PLATFORMS = new Set<DevicePlatform>(['ios_pwa', 'web_safari']);
const FCM_WEB_VAPID_KEY = PUBLIC_ENV.PUBLIC_FCM_VAPID_KEY_FCM || PUBLIC_FCM_VAPID_KEY || '';

async function getEffectiveNotificationPermission(): Promise<DevicePermission> {
	if (!browser || typeof Notification === 'undefined') return 'unsupported';
	const base = Notification.permission;
	if (base === 'granted' || base === 'denied') return base;
	const nav: Navigator & {
		permissions?: {
			query?: (descriptor: PermissionDescriptor) => Promise<{ state?: NotificationPermission }>;
		};
	} = navigator as any;
	if (nav?.permissions?.query) {
		try {
			const result = await nav.permissions.query({ name: 'notifications' as PermissionName });
			const state = result?.state;
			if (state === 'granted' || state === 'denied') return state;
		} catch {
			// ignore
		}
	}
	if ('serviceWorker' in navigator) {
		try {
			const registration = await navigator.serviceWorker.ready;
			const permissionState = registration?.pushManager?.permissionState?.bind(
				registration.pushManager
			);
			if (permissionState) {
				const state = await permissionState({ userVisibleOnly: true });
				if (state === 'granted' || state === 'denied') return state;
			}
		} catch {
			// ignore
		}
	}
	return base;
}

function logPushDebug(message: string, context?: unknown) {
	if (typeof console === 'undefined') return;
	if (context !== undefined) {
		console.info(PUSH_DEBUG_PREFIX, message, context);
	} else {
		console.info(PUSH_DEBUG_PREFIX, message);
	}
}

function postMessageToServiceWorker(payload: unknown) {
	if (!browser || !('serviceWorker' in navigator)) return;
	logPushDebug('postMessageToServiceWorker invoked', {
		hasController: Boolean(navigator.serviceWorker.controller),
		payloadType: (payload as any)?.type ?? 'unknown'
	});
	const send = (worker: ServiceWorker | null | undefined) => {
		if (!worker) return false;
		try {
			worker.postMessage(payload);
			logPushDebug('postMessageToServiceWorker -> worker', payload);
			return true;
		} catch {
			console.warn(PUSH_DEBUG_PREFIX, 'postMessageToServiceWorker failed', payload);
			return false;
		}
	};
	if (send(navigator.serviceWorker.controller)) return;
	const resolveFromRegistration = () =>
		navigator.serviceWorker
			.getRegistration('/firebase-messaging-sw.js')
			.then((registration) => {
				const ok = send(
					registration?.active ?? registration?.waiting ?? registration?.installing ?? null
				);
				logPushDebug('postMessageToServiceWorker via getRegistration', { ok });
				return ok;
			})
			.catch(() => {});
	resolveFromRegistration().finally(() => {
		navigator.serviceWorker.ready
			.then((registration) => {
				const ok = send(
					registration?.active ?? registration?.waiting ?? registration?.installing ?? null
				);
				logPushDebug('postMessageToServiceWorker via ready()', { ok });
			})
			.catch(() => {});
	});
}

function emitTestPushEvent(payload: TestPushDelivery) {
	logPushDebug('emitTestPushEvent dispatching', {
		listenerCount: testPushListeners.size,
		payload
	});
	if (!testPushListeners.size) {
		logPushDebug('emitTestPushEvent skipped (no listeners)');
		return;
	}
	testPushListeners.forEach((listener) => {
		try {
			listener(payload);
		} catch (err) {
			console.warn('test push listener error', err);
		}
	});
}

function handleWorkerMessagePayload(payload: any) {
	if (!payload || typeof payload !== 'object') {
		logPushDebug('handleWorkerMessagePayload ignored invalid payload', { payload });
		return;
	}
	logPushDebug('handleWorkerMessagePayload', { type: payload.type, payload });
	if (payload.type === 'FCM_TOKEN_REFRESHED') {
		const token = payload?.token ?? null;
		logPushDebug('FCM token refresh message received', { hasToken: Boolean(token) });
		if (token && activeDeviceUid) {
			void persistDeviceDoc(activeDeviceUid, { token, permission: resolvePermission() });
		}
		return;
	}
	if (payload.type === 'TEST_PUSH_RESULT') {
		logPushDebug('TEST_PUSH_RESULT received', {
			deviceId: payload.deviceId ?? null,
			messageId: payload.messageId ?? null,
			status: payload.status
		});
		emitTestPushEvent({
			deviceId: payload.deviceId ?? null,
			messageId: payload.messageId ?? null,
			sentAt: payload.sentAt ?? Date.now(),
			status: payload.status,
			error: payload.error ?? null
		});
		return;
	}
	if (payload.type === 'TEST_PUSH_PONG' && typeof payload.messageId === 'string') {
		logPushDebug('TEST_PUSH_PONG received', { messageId: payload.messageId });
		const pending = pingResolvers.get(payload.messageId);
		if (pending) {
			clearTimeout(pending.timer);
			pingResolvers.delete(payload.messageId);
			pending.resolve(true);
		}
		return;
	}
	if (payload.type === 'REQUEST_DEVICE_ID') {
		logPushDebug('REQUEST_DEVICE_ID received');
		const deviceId = ensureDeviceId();
		if (deviceId) {
			postDeviceIdToServiceWorker(deviceId);
		}
		return;
	}
	logPushDebug('Unhandled worker message payload', { type: payload.type });
}

function ensurePushBroadcastChannel() {
	if (!browser || typeof BroadcastChannel === 'undefined') return null;
	if (pushBroadcastChannel) {
		logPushDebug('BroadcastChannel already connected');
		return pushBroadcastChannel;
	}
	try {
		pushBroadcastChannel = new BroadcastChannel(PUSH_CHANNEL_NAME);
		pushBroadcastChannel.addEventListener('message', (event) => {
			logPushDebug('BroadcastChannel message received', {
				type: event?.data?.type ?? 'unknown',
				payload: event?.data
			});
			handleWorkerMessagePayload(event?.data);
		});
		logPushDebug('BroadcastChannel connected');
	} catch {
		console.warn(PUSH_DEBUG_PREFIX, 'BroadcastChannel unavailable');
		pushBroadcastChannel = null;
	}
	return pushBroadcastChannel;
}

function ensureServiceWorkerPort(registration?: ServiceWorkerRegistration | null) {
	if (!browser || typeof MessageChannel === 'undefined') return;
	if (swMessagePort) {
		logPushDebug('ensureServiceWorkerPort skipped (port already connected)');
		return;
	}
	const controller = navigator.serviceWorker?.controller ?? null;
	const targetReg = registration ?? swReg ?? null;
	const worker = targetReg?.active ?? targetReg?.waiting ?? targetReg?.installing ?? null;
	if (!controller && !worker) {
		logPushDebug('ensureServiceWorkerPort: no controller/worker available');
		return;
	}
	logPushDebug('ensureServiceWorkerPort attempting', {
		workerState: worker?.state ?? 'unknown',
		hasController: Boolean(controller)
	});
	try {
		const channel = new MessageChannel();
		channel.port1.addEventListener('message', (event) => {
			logPushDebug('Service worker port message received', {
				type: event?.data?.type ?? 'unknown',
				payload: event?.data
			});
			handleWorkerMessagePayload(event?.data);
		});
		channel.port1.start();
		let sent = false;
		if (controller) {
			try {
				controller.postMessage({ type: 'CLIENT_PORT' }, [channel.port2]);
				sent = true;
				logPushDebug('Service worker port sent via controller');
			} catch (err) {
				console.warn(PUSH_DEBUG_PREFIX, 'Failed to send CLIENT_PORT via controller', err);
			}
		}
		if (!sent && worker) {
			try {
				worker.postMessage({ type: 'CLIENT_PORT' }, [channel.port2]);
				sent = true;
				logPushDebug('Service worker port sent via worker reference');
			} catch (err) {
				console.warn(PUSH_DEBUG_PREFIX, 'Failed to send CLIENT_PORT via worker ref', err);
			}
		}
		if (!sent) {
			logPushDebug('Service worker port could not be delivered');
			channel.port1.close();
			return;
		}
		swMessagePort = channel.port1;
		logPushDebug('Service worker port connected', {
			controller: Boolean(controller),
			workerState: worker?.state ?? 'unknown'
		});
		const cleanup = () => {
			try {
				channel.port1.close();
			} catch {}
			swMessagePort = null;
			logPushDebug('Service worker port closed');
		};
		channel.port1.addEventListener('messageerror', cleanup);
	} catch (err) {
		console.warn(PUSH_DEBUG_PREFIX, 'Failed to establish SW message port', err);
		swMessagePort = null;
	}
}

function postDeviceIdToServiceWorker(deviceId: string | null) {
	if (!browser || !deviceId || !('serviceWorker' in navigator)) return;
	logPushDebug('Posting DEVICE_ID to service worker', { deviceId });
	postMessageToServiceWorker({ type: 'DEVICE_ID', deviceId });
}

export async function registerFirebaseMessagingSW() {
	if (!browser || !('serviceWorker' in navigator)) return null;
	if (swReg) return swReg;
	try {
		logPushDebug('registerFirebaseMessagingSW invoked', {
			hasController: Boolean(navigator.serviceWorker.controller)
		});
		swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
			scope: '/',
			type: 'classic',
			updateViaCache: 'none'
		});
		ensureServiceWorkerPort(swReg);
		try {
			swReg.update();
		} catch {
			// ignore
		}
		const { app } = await ensureFirebaseReady();
		const cfg = (app as any)?.options ?? null;
		const postConfig = () => {
			logPushDebug('Posting FIREBASE_CONFIG to service worker');
			postMessageToServiceWorker({ type: 'FIREBASE_CONFIG', config: cfg });
		};
		if (!navigator.serviceWorker.controller) {
			navigator.serviceWorker.ready
				.then(() => {
					ensureServiceWorkerPort(swReg);
					postConfig();
				})
				.catch(() => {});
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				logPushDebug('serviceWorker controllerchange detected');
				swMessagePort = null;
				ensureServiceWorkerPort(swReg);
				postConfig();
			});
			postMessageToServiceWorker({ type: 'CLAIM_CLIENTS' });
		} else {
			postConfig();
		}
		ensureServiceWorkerPort(swReg);
		postDeviceIdToServiceWorker(cachedDeviceId);
		logPushDebug('registerFirebaseMessagingSW completed');
		return swReg;
	} catch (err) {
		console.warn('SW registration failed', err);
		return null;
	}
}

export async function requestNotificationPermission(): Promise<boolean> {
	if (!browser) return false;
	
	logPushDebug('requestNotificationPermission starting');
	
	// Check if Notification API exists
	if (!('Notification' in window)) {
		logPushDebug('requestNotificationPermission: Notification API not available');
		// On iOS PWA, we might need to use PushManager directly
		if ('serviceWorker' in navigator && 'PushManager' in window) {
			logPushDebug('requestNotificationPermission: trying PushManager approach for iOS');
			try {
				const registration = await navigator.serviceWorker.ready;
				const permState = await registration.pushManager.permissionState({ userVisibleOnly: true });
				logPushDebug('requestNotificationPermission: PushManager permissionState', { permState });
				if (permState === 'granted') return true;
				if (permState === 'denied') return false;
				// For 'prompt', we'll try to subscribe which triggers the permission
				return true; // Let the subscription flow handle the prompt
			} catch (err) {
				logPushDebug('requestNotificationPermission: PushManager check failed', { 
					error: err instanceof Error ? err.message : String(err) 
				});
			}
		}
		return false;
	}
	
	const initial = await getEffectiveNotificationPermission();
	logPushDebug('requestNotificationPermission: initial permission', { initial });
	if (initial === 'granted') return true;
	if (initial === 'denied') return false;
	
	try {
		logPushDebug('requestNotificationPermission: calling Notification.requestPermission()');
		
		// Add timeout to prevent hanging on mobile browsers - increased to 15s for iOS
		const timeoutPromise = new Promise<NotificationPermission>((resolve) => {
			setTimeout(() => {
				logPushDebug('requestNotificationPermission: timeout reached');
				resolve('default');
			}, 15000);
		});
		
		// Notification.requestPermission can return a promise or use callback (legacy)
		let permissionPromise: Promise<NotificationPermission>;
		try {
			const result = Notification.requestPermission();
			if (result instanceof Promise) {
				permissionPromise = result;
			} else {
				// Old callback style - wrap in promise
				permissionPromise = new Promise((resolve) => {
					Notification.requestPermission(resolve);
				});
			}
		} catch {
			// Fallback for very old browsers
			permissionPromise = new Promise((resolve) => {
				Notification.requestPermission(resolve);
			});
		}
		
		const res = await Promise.race([permissionPromise, timeoutPromise]);
		logPushDebug('requestNotificationPermission: result', { res });
		
		if (res === 'granted') return true;
		
		// Double-check the final state
		const finalState = await getEffectiveNotificationPermission();
		logPushDebug('requestNotificationPermission: final state check', { finalState });
		return finalState === 'granted';
	} catch (err) {
		logPushDebug('requestNotificationPermission: exception', { 
			error: err instanceof Error ? err.message : String(err) 
		});
		const fallback = await getEffectiveNotificationPermission();
		return fallback === 'granted';
	}
}

export function setActivePushUser(uid: string | null) {
	logPushDebug('setActivePushUser called', { previousUid: activeDeviceUid, nextUid: uid });
	activeDeviceUid = uid;
	if (!browser || !('serviceWorker' in navigator)) return;
	logPushDebug('setActivePushUser', { uid });
	ensurePushBroadcastChannel();
	ensureServiceWorkerPort();
	if (!swMessageHandler) {
		swMessageHandler = (event: MessageEvent) => {
			logPushDebug('Navigator serviceWorker message event', {
				type: event?.data?.type ?? 'unknown',
				hasPorts: Boolean(event?.ports?.length)
			});
			handleWorkerMessagePayload(event?.data);
		};
		navigator.serviceWorker.addEventListener('message', swMessageHandler);
	}
	if (uid) {
		void syncDeviceRegistration(uid).catch(() => {});
	}
}

export async function syncDeviceRegistration(uid: string) {
	if (!browser || !('serviceWorker' in navigator)) return;
	const permission = resolvePermission();
	if (permission === 'granted') {
		await enablePushForUser(uid, { prompt: false });
		return;
	}
	if (permission === 'default' && shouldAutoPromptForPush()) {
		markAutoPromptedForPush();
		await enablePushForUser(uid, { prompt: true });
		return;
	}
	await registerFirebaseMessagingSW();
	// Non-blocking persist
	persistDeviceDoc(uid, { permission }).catch(() => {});
}

export type EnablePushOptions = {
	prompt?: boolean;
	debug?: PushDebugEmitter;
};

export async function enablePushForUser(
	uid: string,
	options: EnablePushOptions = {}
): Promise<string | null> {
	const { prompt = true, debug } = options;
	if (!browser) {
		emitPushDebug(debug, {
			step: 'environment.unavailable',
			message: 'enablePushForUser called outside of the browser.'
		});
		return null;
	}
	
	// Check if push is supported on this iOS browser
	if (!isIOSPushSupported()) {
		const supportInfo = getPushSupportMessage();
		emitPushDebug(debug, {
			step: 'ios.unsupported',
			message: supportInfo.message,
			context: { platform: detectPlatform(), userAgent: navigator.userAgent }
		});
		logPushDebug('Push not supported on this iOS browser', { message: supportInfo.message });
		return null;
	}
	
	// Detect if we're on iOS PWA
	const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
	const isIOSPWA = isIOSDevice && isStandalone();
	
	emitPushDebug(debug, {
		step: 'enable.start',
		message: 'Attempting to enable push for user.',
		context: { uid, prompt, isIOSPWA }
	});
	
	let permission = resolvePermission();
	emitPushDebug(debug, {
		step: 'permission.resolve',
		context: { permission, isIOSPWA }
	});
	
	if (permission === 'denied') {
		emitPushDebug(debug, {
			step: 'fail.permission_denied',
			message: 'Notification permission previously denied in browser settings.'
		});
		// Non-blocking persist
		persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
		return null;
	}
	
	// On iOS PWA, skip the Notification.requestPermission() and let PushManager.subscribe() 
	// handle the permission prompt natively - this works more reliably on iOS
	if (isIOSPWA && permission === 'default' && prompt) {
		emitPushDebug(debug, {
			step: 'ios.skip_notification_api',
			message: 'iOS PWA: skipping Notification API, will prompt via PushManager'
		});
		// Don't request permission here - let ensureSafariSubscription handle it
	} else if (permission === 'default' && prompt) {
		emitPushDebug(debug, {
			step: 'permission.request',
			message: 'Requesting notification permission from the browser.'
		});
		const granted = await requestNotificationPermission();
		permission = resolvePermission();
		emitPushDebug(debug, {
			step: 'permission.request.result',
			context: { granted, permission }
		});
		if (!granted) {
			emitPushDebug(debug, {
				step: 'fail.permission_not_granted',
				message: 'User did not grant notification permission.',
				context: { permission }
			});
			// Non-blocking persist
			persistDeviceDoc(uid, {
				permission: permission ?? 'default',
				token: null,
				subscription: null
			}).catch(() => {});
			return null;
		}
	} else if (permission === 'default' && !isIOSPWA) {
		emitPushDebug(debug, {
			step: 'fail.prompt_skipped',
			message: 'Permission is default but prompting was disabled and not iOS PWA.'
		});
		// Non-blocking persist
		persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
		return null;
	}

	emitPushDebug(debug, {
		step: 'sw.register.start',
		message: 'Registering Firebase messaging service worker.'
	});
	const sw = await registerFirebaseMessagingSW();
	const controllerPresent =
		typeof navigator !== 'undefined' && 'serviceWorker' in navigator
			? Boolean(navigator.serviceWorker.controller)
			: false;
	emitPushDebug(debug, {
		step: 'sw.register.result',
		context: { hasRegistration: Boolean(sw), controllerPresent, scope: sw?.scope ?? null }
	});
	if (!sw) {
		emitPushDebug(debug, {
			step: 'fail.sw_missing',
			message: 'Service worker registration failed or returned null.'
		});
		// Non-blocking persist
		persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
		return null;
	}

	const useSafariWebPush = shouldUseSafariWebPush();
	if (useSafariWebPush) {
		emitPushDebug(debug, {
			step: 'safari.subscription.start',
			message: 'Preparing Safari Web Push subscription.'
		});
		const subscription = await ensureSafariSubscription(sw);
		if (!subscription) {
			emitPushDebug(debug, {
				step: 'safari.subscription.error',
				message: 'Failed to obtain Safari Web Push subscription.'
			});
			// Non-blocking persist for error case
			persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
			return null;
		}
		const previewEndpoint =
			typeof subscription.endpoint === 'string'
				? `${subscription.endpoint.slice(0, 20)}…`
				: 'unknown';
		emitPushDebug(debug, {
			step: 'safari.subscription.success',
			context: { endpointPreview: previewEndpoint }
		});
		permission = 'granted';
		
		// Non-blocking persist - don't wait for Firestore, return token immediately
		emitPushDebug(debug, {
			step: 'device.persist',
			context: { reason: 'safari_subscription', permission: 'granted' }
		});
		persistDeviceDoc(uid, {
			permission: 'granted',
			subscription,
			token: null,
			enabled: true
		}).catch((err) => {
			console.warn('[push] Safari subscription persist failed (non-blocking):', err);
		});
		
		const endpointPreview =
			typeof subscription.endpoint === 'string'
				? `safari:${subscription.endpoint.slice(-12)}`
				: 'safari_web_push';
		return endpointPreview;
	}

	try {
		emitPushDebug(debug, {
			step: 'messaging.token.start',
			context: { hasVapidKey: Boolean(PUBLIC_FCM_VAPID_KEY) }
		});
		const { app } = await ensureFirebaseReady();
		const vapid = useSafariWebPush ? (PUBLIC_FCM_VAPID_KEY ?? '') : FCM_WEB_VAPID_KEY;
		if (!vapid) {
			emitPushDebug(debug, {
				step: 'messaging.vapid.missing',
				message: 'No VAPID key configured for FCM token collection.'
			});
			// Non-blocking persist
			persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
			return null;
		}
		const messagingSdk = await import('firebase/messaging');
		const messaging = messagingSdk.getMessaging(app);
		const token = await messagingSdk.getToken(messaging, {
			vapidKey: vapid || undefined,
			serviceWorkerRegistration: sw
		});
		emitPushDebug(debug, {
			step: 'messaging.token.result',
			context: {
				hasToken: Boolean(token),
				tokenPreview: token ? `${token.slice(0, 12)}…${token.slice(-6)}` : null
			}
		});
		if (!token) {
			emitPushDebug(debug, {
				step: 'device.persist',
				context: { reason: 'token_missing', permission }
			});
			// Non-blocking persist
			persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
			return null;
		}
		emitPushDebug(debug, {
			step: 'device.persist',
			context: { reason: 'token_success', permission: 'granted' }
		});
		// Non-blocking persist - return token immediately
		persistDeviceDoc(uid, {
			permission: 'granted',
			token,
			subscription: null,
			enabled: true
		}).catch((err) => {
			console.warn('[push] FCM token persist failed (non-blocking):', err);
		});
		emitPushDebug(debug, {
			step: 'enable.success',
			message: 'Push token stored for device.',
			context: { tokenPreview: `${token.slice(0, 6)}…${token.slice(-6)}` }
		});
		return token;
	} catch (err) {
		console.error('Failed to obtain FCM token', err);
		emitPushDebug(debug, {
			step: 'messaging.token.error',
			message: 'Failed while collecting FCM token.',
			error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
		});
		emitPushDebug(debug, {
			step: 'device.persist',
			context: { reason: 'token_error', permission }
		});
		// Non-blocking persist
		persistDeviceDoc(uid, { permission, token: null, subscription: null }).catch(() => {});
		return null;
	}
}

export async function disablePushForUser(uid: string) {
	if (!browser) return;
	await persistDeviceDoc(uid, { token: null, subscription: null, enabled: false });
}

function resolvePermission(): DevicePermission {
	if (!browser || typeof Notification === 'undefined') return 'unsupported';
	return Notification.permission;
}

function ensureDeviceId(): string | null {
	if (!browser) return null;
	if (cachedDeviceId) {
		postDeviceIdToServiceWorker(cachedDeviceId);
		logPushDebug('ensureDeviceId using cached id', { deviceId: cachedDeviceId });
		return cachedDeviceId;
	}
	try {
		const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
		if (existing) {
			cachedDeviceId = existing;
			postDeviceIdToServiceWorker(existing);
			logPushDebug('ensureDeviceId loaded existing id', { deviceId: existing });
			return existing;
		}
		const next =
			typeof crypto !== 'undefined' && crypto.randomUUID
				? crypto.randomUUID()
				: `dev_${Date.now()}`;
		localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
		cachedDeviceId = next;
		postDeviceIdToServiceWorker(next);
		logPushDebug('ensureDeviceId generated new id', { deviceId: next });
		return next;
	} catch (err) {
		console.warn('Failed to read/write device id', err);
		return null;
	}
}

function shouldAutoPromptForPush() {
	if (!browser) return false;
	try {
		return localStorage.getItem(AUTO_PROMPT_STORAGE_KEY) !== '1';
	} catch {
		return false;
	}
}

function markAutoPromptedForPush() {
	if (!browser) return;
	try {
		localStorage.setItem(AUTO_PROMPT_STORAGE_KEY, '1');
	} catch {
		// ignore
	}
}

function detectPlatform(): DevicePlatform {
	if (typeof navigator === 'undefined') return 'web';
	const ua = navigator.userAgent || '';
	const standalone = isStandalone();
	const isIOS = /iPhone|iPad|iPod/i.test(ua);
	if (isIOS) {
		// If the app is running as an installed web app (standalone), treat it as an iOS PWA
		// even if the UA string is from Chrome/Firefox; iOS exposes the same WebKit push APIs.
		if (standalone) return 'ios_pwa';
		return 'ios_browser';
	}
	if (/Android/i.test(ua)) {
		return standalone ? 'android_pwa' : 'android_browser';
	}
	if (/Edg\//i.test(ua)) return 'web_edge';
	if (/Firefox\//i.test(ua)) return 'web_firefox';
	if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'web_safari';
	if (/Chrome|Chromium/i.test(ua)) return 'web_chrome';
	return 'web';
}

/**
 * Check if the current browser supports push notifications on iOS.
 * Only Safari and Safari-based PWAs support push on iOS.
 */
export function isIOSPushSupported(): boolean {
	if (typeof navigator === 'undefined') return true; // Assume supported on non-iOS
	const ua = navigator.userAgent || '';
	const isIOS = /iPhone|iPad|iPod/i.test(ua);
	if (!isIOS) return true; // Not iOS, assume supported

	const standalone = isStandalone();
	const hasPushApis =
		typeof PushManager !== 'undefined' &&
		typeof Notification !== 'undefined' &&
		'serviceWorker' in navigator;

	// On iOS, push is only available to installed web apps (standalone) that expose PushManager.
	if (standalone && hasPushApis) return true;

	// In-browser tabs (including Chrome/Firefox) do not get push on iOS.
	return false;
}

/**
 * Get a user-friendly message about push notification support.
 */
export function getPushSupportMessage(): { supported: boolean; message: string } {
	if (typeof navigator === 'undefined') {
		return { supported: false, message: 'Notifications are not available in this environment.' };
	}
	
	const ua = navigator.userAgent || '';
	const isIOS = /iPhone|iPad|iPod/i.test(ua);
	const standalone = isStandalone();
	const hasPushApis =
		typeof PushManager !== 'undefined' &&
		typeof Notification !== 'undefined' &&
		'serviceWorker' in navigator;
	const isThirdPartyBrowser = /CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
	
	if (!isIOS) {
		return { supported: true, message: 'Push notifications are supported.' };
	}
	
	if (standalone && hasPushApis) {
		return {
			supported: true,
			message: isThirdPartyBrowser
				? 'Push notifications are supported in this installed web app.'
				: 'Push notifications are supported in this PWA.'
		};
	}

	if (isThirdPartyBrowser) {
		return {
			supported: false,
			message:
				'Add hConnect to your Home Screen, then open it from that icon to enable notifications.'
		};
	}
	
	return {
		supported: false,
		message:
			'On iOS, add hConnect to your Home Screen from Safari and open it from that icon to enable notifications.'
	};
}

function isStandalone() {
	if (!browser) return false;
	const nav = navigator as Navigator & { standalone?: boolean };
	if (typeof nav?.standalone === 'boolean') return nav.standalone;
	if (typeof window.matchMedia === 'function') {
		try {
			const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
			return modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
		} catch {
			return false;
		}
	}
	return false;
}

function shouldUseSafariWebPush() {
	if (!browser) return false;
	if (typeof window === 'undefined' || !window.isSecureContext) return false;
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	if (typeof PushManager === 'undefined') return false;
	const platform = detectPlatform();
	return SAFARI_WEB_PUSH_PLATFORMS.has(platform);
}

function urlBase64ToUint8Array(base64String: string) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData =
		typeof window !== 'undefined'
			? window.atob(base64)
			: Buffer.from(base64, 'base64').toString('binary');
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

async function ensureSafariSubscription(
	sw: ServiceWorkerRegistration
): Promise<PushSubscriptionJSON | null> {
	if (!sw?.pushManager) {
		logPushDebug('ensureSafariSubscription: pushManager unavailable');
		return null;
	}
	
	// Check permission state first
	try {
		const permState = await sw.pushManager.permissionState({ userVisibleOnly: true });
		logPushDebug('ensureSafariSubscription: permissionState', { permState });
		if (permState === 'denied') {
			logPushDebug('ensureSafariSubscription: permission denied by user');
			return null;
		}
	} catch (err) {
		logPushDebug('ensureSafariSubscription: permissionState check failed', {
			error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
		});
		// Continue anyway - some browsers don't support permissionState
	}
	
	try {
		const existing = await sw.pushManager.getSubscription();
		if (existing) {
			logPushDebug('ensureSafariSubscription using existing subscription');
			return existing.toJSON();
		}
	} catch (err) {
		logPushDebug('ensureSafariSubscription getSubscription failed', {
			error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
		});
	}
	
	if (!PUBLIC_FCM_VAPID_KEY) {
		logPushDebug('ensureSafariSubscription aborted (missing VAPID key)');
		return null;
	}
	
	try {
		logPushDebug('ensureSafariSubscription: calling pushManager.subscribe() - this should trigger iOS prompt');
		const convertedKey = urlBase64ToUint8Array(PUBLIC_FCM_VAPID_KEY);
		
		// Add a timeout for the subscribe call as it may hang on iOS
		const timeoutPromise = new Promise<PushSubscription | null>((resolve) => {
			setTimeout(() => {
				logPushDebug('ensureSafariSubscription: subscribe timeout after 20s');
				resolve(null);
			}, 20000);
		});
		
		const subscribePromise = sw.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: convertedKey
		});
		
		const subscription = await Promise.race([subscribePromise, timeoutPromise]);
		
		if (subscription) {
			logPushDebug('ensureSafariSubscription created new subscription');
			return subscription.toJSON();
		} else {
			logPushDebug('ensureSafariSubscription: subscribe returned null or timed out');
			return null;
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		logPushDebug('ensureSafariSubscription subscribe failed', { error: errorMsg });
		
		// Check if it's a permission error
		if (errorMsg.includes('permission') || errorMsg.includes('denied') || errorMsg.includes('NotAllowedError')) {
			logPushDebug('ensureSafariSubscription: likely a permission denial');
		}
		
		return null;
	}
}

async function persistDeviceDoc(uid: string, update: DeviceDocUpdate) {
	const deviceId = ensureDeviceId();
	if (!deviceId) return;
	postDeviceIdToServiceWorker(deviceId);
	
	logPushDebug('persistDeviceDoc starting', { uid, deviceId });
	
	// Add timeout to prevent hanging on Firestore operations
	const timeoutMs = 10000;
	const timeoutPromise = new Promise<void>((_, reject) => 
		setTimeout(() => reject(new Error('persistDeviceDoc timeout')), timeoutMs)
	);
	
	try {
		await Promise.race([
			(async () => {
				logPushDebug('persistDeviceDoc: awaiting ensureFirebaseReady');
				await ensureFirebaseReady();
				logPushDebug('persistDeviceDoc: firebase ready, getting db');
				const db = getDb();
				const now = serverTimestamp();
				const ref = doc(collection(db, 'profiles', uid, DEVICE_COLLECTION), deviceId);
				logPushDebug('persistDeviceDoc: preparing payload');
				const payload: Record<string, unknown> = {
					deviceId,
					platform: detectPlatform(),
					isStandalone: isStandalone(),
					userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
					permission: update.permission ?? resolvePermission(),
					lastSeen: now,
					updatedAt: now
				};
				if (update.token !== undefined) {
					payload.token = update.token || null;
					payload.tokenUpdatedAt = now;
				}
				if (update.subscription !== undefined) {
					payload.subscription = update.subscription || null;
					payload.subscriptionUpdatedAt = now;
				}
				if (update.enabled !== undefined) {
					payload.enabled = update.enabled;
				}
				logPushDebug('persistDeviceDoc: calling setDoc');
				await setDoc(ref, payload, { merge: true });
				logPushDebug('persistDeviceDoc: setDoc complete');
			})(),
			timeoutPromise
		]);
	} catch (err) {
		// Log but don't throw - we don't want to block the push enable flow
		console.warn('[push] persistDeviceDoc failed:', err instanceof Error ? err.message : err);
		logPushDebug('persistDeviceDoc error', { 
			error: err instanceof Error ? err.message : String(err) 
		});
	}
}

export function getCurrentDeviceId(): string | null {
	return ensureDeviceId();
}

export function listenForTestPushDelivery(callback: TestPushListener) {
	logPushDebug('listenForTestPushDelivery registered listener');
	testPushListeners.add(callback);
	logPushDebug('listenForTestPushDelivery listener count', { count: testPushListeners.size });
	return () => {
		testPushListeners.delete(callback);
		logPushDebug('listenForTestPushDelivery removed listener');
		logPushDebug('listenForTestPushDelivery listener count', { count: testPushListeners.size });
	};
}

export function pingServiceWorker(messageId?: string, timeoutMs = 2000): Promise<boolean> {
	if (!browser || !('serviceWorker' in navigator)) return Promise.resolve(false);
	const controller = navigator.serviceWorker.controller;
	if (!controller) {
		logPushDebug('pingServiceWorker skipped (no controller)');
		return Promise.resolve(false);
	}
	const id =
		messageId ??
		(typeof crypto !== 'undefined' && crypto.randomUUID
			? crypto.randomUUID()
			: `ping_${Date.now()}`);
	logPushDebug('pingServiceWorker start', { id, timeoutMs });
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pingResolvers.delete(id);
			logPushDebug('pingServiceWorker timed out', { id });
			resolve(false);
		}, timeoutMs);
		pingResolvers.set(id, { resolve, timer });
		try {
			controller.postMessage({ type: 'TEST_PUSH_PING', messageId: id });
			logPushDebug('pingServiceWorker message posted', { id });
		} catch {
			clearTimeout(timer);
			pingResolvers.delete(id);
			logPushDebug('pingServiceWorker failed to post', { id });
			resolve(false);
		}
	});
}

if (browser) {
	ensurePushBroadcastChannel();
	if ('serviceWorker' in navigator) {
		if (!navigator.serviceWorker.controller) {
			postMessageToServiceWorker({ type: 'CLAIM_CLIENTS' });
		}
		navigator.serviceWorker.ready
			.then((registration) => {
				logPushDebug('navigator.serviceWorker.ready resolved', {
					scope: registration.scope,
					workerState:
						registration.active?.state ??
						registration.waiting?.state ??
						registration.installing?.state ??
						'unknown'
				});
				if (!swReg) swReg = registration;
				ensureServiceWorkerPort(registration);
			})
			.catch(() => {});
		navigator.serviceWorker
			.getRegistration('/firebase-messaging-sw.js')
			.then((registration) => {
				if (!registration) return;
				logPushDebug('navigator.serviceWorker.getRegistration resolved', {
					hasActive: Boolean(registration.active),
					hasWaiting: Boolean(registration.waiting),
					hasInstalling: Boolean(registration.installing)
				});
				if (!swReg) swReg = registration;
				ensureServiceWorkerPort(registration);
			})
			.catch(() => {});
	}
}
