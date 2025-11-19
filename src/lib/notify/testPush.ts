// src/lib/notify/testPush.ts
import { getFunctionsClient } from '$lib/firebase';
import { getCurrentDeviceId } from '$lib/notify/push';
import { httpsCallable } from 'firebase/functions';

type TestPushResponse = {
  ok: boolean;
  tokens?: number;
  messageId?: string;
  reason?: string;
};

export async function triggerTestPush(): Promise<TestPushResponse> {
  const functions = await getFunctionsClient();
  const callable = httpsCallable(functions, 'sendTestPush');
  const deviceId = getCurrentDeviceId();
  if (!deviceId) {
    return { ok: false, reason: 'missing_device' };
  }
  const result = await callable({ deviceId });
  const data = (result?.data ?? {}) as TestPushResponse;
  return {
    ok: Boolean(data.ok),
    tokens: typeof data.tokens === 'number' ? data.tokens : undefined,
    messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
    reason: data.reason
  };
}
