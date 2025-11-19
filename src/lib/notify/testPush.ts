// src/lib/notify/testPush.ts
import { getFunctionsClient } from '$lib/firebase';
import { getCurrentDeviceId } from '$lib/notify/push';
import { httpsCallable } from 'firebase/functions';

type TestPushResponse = {
  ok: boolean;
  tokens?: number;
  reason?: string;
};

export async function triggerTestPush(): Promise<TestPushResponse> {
  const functions = await getFunctionsClient();
  const callable = httpsCallable(functions, 'sendTestPush');
  const deviceId = getCurrentDeviceId();
  const payload = deviceId ? { deviceId } : undefined;
  const result = await callable(payload);
  const data = (result?.data ?? {}) as TestPushResponse;
  return {
    ok: Boolean(data.ok),
    tokens: typeof data.tokens === 'number' ? data.tokens : undefined,
    reason: data.reason
  };
}
