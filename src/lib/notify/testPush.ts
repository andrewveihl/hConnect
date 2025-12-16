// src/lib/notify/testPush.ts
import { getFunctionsClient } from '$lib/firebase';
import { getCurrentDeviceId } from '$lib/notify/push';
import type { PushDebugEmitter } from '$lib/notify/push';
import { httpsCallable } from 'firebase/functions';

type TestPushResponse = {
	ok: boolean;
	tokens?: number;
	messageId?: string;
	reason?: string;
};

type TriggerTestPushOptions = {
	debug?: PushDebugEmitter;
};

export async function triggerTestPush(
	options: TriggerTestPushOptions = {}
): Promise<TestPushResponse> {
	const { debug } = options;
	emitTestPushDebug(debug, {
		step: 'test_push.start',
		message: 'Sending callable request to sendTestPush.'
	});
	const functions = await getFunctionsClient();
	emitTestPushDebug(debug, {
		step: 'test_push.functions_ready',
		context: {
			appId: functions.app?.options?.appId ?? null,
			region: (functions as any)?._region ?? 'default'
		}
	});
	const callable = httpsCallable(functions, 'sendTestPush');
	const deviceId = getCurrentDeviceId();
	emitTestPushDebug(debug, {
		step: 'test_push.device_id',
		context: { deviceId }
	});
	if (!deviceId) {
		emitTestPushDebug(debug, {
			step: 'test_push.device_missing',
			message: 'No current device id found.'
		});
		return { ok: false, reason: 'missing_device' };
	}
	try {
		const result = await callable({ deviceId });
		const data = (result?.data ?? {}) as TestPushResponse;
		emitTestPushDebug(debug, {
			step: 'test_push.response',
			context: {
				ok: Boolean(data.ok),
				tokens: typeof data.tokens === 'number' ? data.tokens : undefined,
				messageId: data.messageId ?? null,
				reason: data.reason ?? null
			}
		});
		return {
			ok: Boolean(data.ok),
			tokens: typeof data.tokens === 'number' ? data.tokens : undefined,
			messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
			reason: data.reason
		};
	} catch (err) {
		emitTestPushDebug(debug, {
			step: 'test_push.error',
			message: 'Callable request rejected.',
			error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
		});
		throw err;
	}
}

function emitTestPushDebug(
	debug: PushDebugEmitter | undefined,
	event: { step: string; message?: string; context?: unknown; error?: string }
) {
	if (!debug) return;
	try {
		debug({
			...event,
			at: Date.now()
		});
	} catch (err) {
		console.warn('test push debug listener error', err);
	}
}
