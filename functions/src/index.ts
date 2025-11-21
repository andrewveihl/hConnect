import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  handleDmMessage,
  handleServerMessage,
  handleThreadMessage,
  sendTestPushForUid
} from './notifications';
export { requestDomainAutoInvite } from './domainInvites';

export const onChannelMessageCreated = onDocumentCreated(
  'servers/{serverId}/channels/{channelId}/messages/{messageId}',
  async (event) => {
    await handleServerMessage(event);
  }
);

export const onThreadMessageCreated = onDocumentCreated(
  'servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}',
  async (event) => {
    await handleThreadMessage(event);
  }
);

export const onDmMessageCreated = onDocumentCreated(
  'dms/{threadID}/messages/{messageId}',
  async (event) => {
    await handleDmMessage(event);
  }
);

export const sendTestPush = onCall(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in to test push notifications.');
    }
    const deviceId =
      typeof request.data?.deviceId === 'string' && request.data.deviceId.length > 0
        ? request.data.deviceId
        : undefined;
    if (!deviceId) {
      logger.warn('[sendTestPush] Missing device id', { uid });
      return { ok: false, reason: 'missing_device' };
    }
    logger.info('[sendTestPush] Invoked', { uid, deviceId });
    const result = await sendTestPushForUid(uid, deviceId);
    logger.info('[sendTestPush] Completed', {
      uid,
      deviceId,
      sent: result.sent,
      reason: result.reason ?? null
    });
    if (!result.sent) {
      return { ok: false, reason: result.reason ?? 'device_not_registered' };
    }
    return { ok: true, tokens: result.sent, messageId: result.messageId ?? null };
  }
);
