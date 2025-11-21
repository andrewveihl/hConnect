import { getFunctionsClient } from '$lib/firebase';
import { httpsCallable } from 'firebase/functions';

let lastInvoke = 0;
const THROTTLE_MS = 60 * 1000;

export async function requestDomainAutoInvites(force = false): Promise<void> {
  if (!force && Date.now() - lastInvoke < THROTTLE_MS) return;
  lastInvoke = Date.now();
  try {
    const functions = await getFunctionsClient();
    const callable = httpsCallable(functions, 'requestDomainAutoInvite');
    await callable({});
  } catch (error) {
    console.warn('[domainAutoInvite] callable failed', error);
  }
}
