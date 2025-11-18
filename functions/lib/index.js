"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDmMessageCreated = exports.onThreadMessageCreated = exports.onChannelMessageCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const notifications_1 = require("./notifications");
exports.onChannelMessageCreated = (0, firestore_1.onDocumentCreated)('servers/{serverId}/channels/{channelId}/messages/{messageId}', async (event) => {
    await (0, notifications_1.handleServerMessage)(event);
});
exports.onThreadMessageCreated = (0, firestore_1.onDocumentCreated)('servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}', async (event) => {
    await (0, notifications_1.handleThreadMessage)(event);
});
exports.onDmMessageCreated = (0, firestore_1.onDocumentCreated)('dms/{threadID}/messages/{messageId}', async (event) => {
    await (0, notifications_1.handleDmMessage)(event);
});
//# sourceMappingURL=index.js.map