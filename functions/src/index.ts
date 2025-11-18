import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  handleDmMessage,
  handleServerMessage,
  handleThreadMessage,
  sendTestPushForUid
} from './notifications';

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
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in to test push notifications.');
    }
    const result = await sendTestPushForUid(uid);
    if (!result.sent) {
      return { ok: false, reason: result.reason ?? 'no_tokens' };
    }
    return { ok: true, tokens: result.sent };
  }
);
