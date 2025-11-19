"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultNotificationSettings = void 0;
exports.fetchNotificationSettings = fetchNotificationSettings;
exports.perChannelKey = perChannelKey;
exports.perRoleKey = perRoleKey;
exports.fetchPresence = fetchPresence;
exports.fetchDeviceTokens = fetchDeviceTokens;
const firebase_1 = require("./firebase");
const SETTINGS_SUBCOLLECTION = 'notificationSettings';
const SETTINGS_DOC_ID = 'preferences';
exports.defaultNotificationSettings = {
    globalMute: false,
    muteDMs: false,
    muteServerIds: [],
    perChannelMute: {},
    perRoleMute: {},
    allowMentionPush: true,
    allowDMPreview: true,
    allowActivityBadges: true,
    allowThreadPush: true,
    allowRoleMentionPush: true,
    allowHereMentionPush: true,
    allowEveryoneMentionPush: true,
    doNotDisturbUntil: null
};
async function fetchNotificationSettings(uid) {
    const ref = firebase_1.db.doc(`profiles/${uid}/${SETTINGS_SUBCOLLECTION}/${SETTINGS_DOC_ID}`);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    return {
        ...exports.defaultNotificationSettings,
        ...(data ?? {})
    };
}
function perChannelKey(serverId, channelId) {
    return `${serverId}/${channelId}`;
}
function perRoleKey(serverId, roleId) {
    return `${serverId}/${roleId}`;
}
async function fetchPresence(uid) {
    try {
        const snap = await firebase_1.db.doc(`profiles/${uid}/presence/status`).get();
        return snap.exists ? (snap.data() ?? null) : null;
    }
    catch {
        return null;
    }
}
async function fetchDeviceTokens(uid, deviceId) {
    try {
        if (deviceId) {
            const docSnap = await firebase_1.db.doc(`profiles/${uid}/devices/${deviceId}`).get();
            if (!docSnap.exists)
                return [];
            const doc = docSnap.data();
            if (doc &&
                typeof doc.token === 'string' &&
                doc.token.length > 0 &&
                (doc.permission === 'granted' || doc.permission === undefined) &&
                doc.enabled !== false) {
                return [doc.token];
            }
            return [];
        }
        const snap = await firebase_1.db.collection(`profiles/${uid}/devices`).get();
        return snap.docs
            .map((docSnap) => docSnap.data())
            .filter((doc) => typeof doc?.token === 'string' &&
            doc.token.length > 0 &&
            (doc.permission === 'granted' || doc.permission === undefined) &&
            doc.enabled !== false)
            .map((doc) => doc.token);
    }
    catch (err) {
        console.warn('Failed to fetch device tokens', uid, err);
        return [];
    }
}
//# sourceMappingURL=settings.js.map
