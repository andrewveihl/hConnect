"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTestPush = exports.onDmMessageCreated = exports.onThreadMessageCreated = exports.onChannelMessageCreated = void 0;
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
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
exports.sendTestPush = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
}, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in to test push notifications.');
    }
    const deviceId = typeof request.data?.deviceId === 'string' && request.data.deviceId.length > 0
        ? request.data.deviceId
        : undefined;
    firebase_functions_1.logger.info('[sendTestPush] Invoked', { uid, deviceId: deviceId ?? null });
    const result = await (0, notifications_1.sendTestPushForUid)(uid, deviceId);
    firebase_functions_1.logger.info('[sendTestPush] Completed', {
        uid,
        deviceId: deviceId ?? null,
        sent: result.sent,
        reason: result.reason ?? null
    });
    if (!result.sent) {
        return { ok: false, reason: result.reason ?? 'no_tokens' };
    }
    return { ok: true, tokens: result.sent };
});
//# sourceMappingURL=index.js.map
