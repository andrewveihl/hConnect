"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTestPush = exports.onDmMessageCreated = exports.onThreadMessageCreated = exports.onChannelMessageCreated = exports.requestDomainAutoInvite = void 0;
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const notifications_1 = require("./notifications");
var domainInvites_1 = require("./domainInvites");
Object.defineProperty(exports, "requestDomainAutoInvite", { enumerable: true, get: function () { return domainInvites_1.requestDomainAutoInvite; } });
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
    if (!deviceId) {
        firebase_functions_1.logger.warn('[sendTestPush] Missing device id', { uid });
        return { ok: false, reason: 'missing_device' };
    }
    firebase_functions_1.logger.info('[sendTestPush] Invoked', { uid, deviceId });
    const result = await (0, notifications_1.sendTestPushForUid)(uid, deviceId);
    firebase_functions_1.logger.info('[sendTestPush] Completed', {
        uid,
        deviceId,
        sent: result.sent,
        reason: result.reason ?? null
    });
    if (!result.sent) {
        return { ok: false, reason: result.reason ?? 'device_not_registered' };
    }
    return { ok: true, tokens: result.sent, messageId: result.messageId ?? null };
});
//# sourceMappingURL=index.js.map