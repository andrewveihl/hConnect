import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { handleDmMessage, handleServerMessage, handleThreadMessage } from './notifications';

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
