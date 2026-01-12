"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairUserAvatarTokens = exports.refreshUserGooglePhoto = exports.refreshAllGooglePhotos = exports.createTicketFromMessage = exports.getEmailNotificationLogs = exports.sendTestEmailNotificationHttp = exports.sendTestEmailNotification = exports.getPushDeviceDiagnostics = exports.sendTestPush = exports.syncServerMemberPhotos = exports.backfillMyDMRail = exports.onDmMessageCreated = exports.onThreadMessageCreated = exports.onChannelMessageCreated = exports.cacheGoogleProfilePhoto = exports.getSlackChannels = exports.syncHConnectThreadMessageToSlack = exports.syncHConnectMessageToSlack = exports.slackOAuth = exports.slackWebhook = exports.requestDomainAutoInvite = void 0;
const firebase_functions_1 = require("firebase-functions");
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const storage_1 = require("firebase-admin/storage");
const firebase_1 = require("./firebase");
const firestore_2 = require("firebase-admin/firestore");
const notifications_1 = require("./notifications");
const ticketAi_1 = require("./ticketAi");
const email_1 = require("./email");
const slack_1 = require("./slack");
var domainInvites_1 = require("./domainInvites");
Object.defineProperty(exports, "requestDomainAutoInvite", { enumerable: true, get: function () { return domainInvites_1.requestDomainAutoInvite; } });
var slack_2 = require("./slack");
Object.defineProperty(exports, "slackWebhook", { enumerable: true, get: function () { return slack_2.slackWebhook; } });
Object.defineProperty(exports, "slackOAuth", { enumerable: true, get: function () { return slack_2.slackOAuth; } });
Object.defineProperty(exports, "syncHConnectMessageToSlack", { enumerable: true, get: function () { return slack_2.syncHConnectMessageToSlack; } });
Object.defineProperty(exports, "syncHConnectThreadMessageToSlack", { enumerable: true, get: function () { return slack_2.syncHConnectThreadMessageToSlack; } });
Object.defineProperty(exports, "getSlackChannels", { enumerable: true, get: function () { return slack_2.getSlackChannels; } });
// Define secrets for functions that need them
const openaiApiKey = (0, params_1.defineSecret)('OPENAI_API_KEY');
const resendApiKey = (0, params_1.defineSecret)('RESEND_API_KEY');
// Shared CORS config for all callable functions
const ALLOWED_ORIGINS = [
    'https://hconnect-6212b.web.app',
    'https://hconnect-6212b.firebaseapp.com',
    'https://hconnect.healthspaces.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
];
/**
 * Check if a URL is a Google profile photo URL
 */
function isGooglePhotoUrl(url) {
    if (!url)
        return false;
    return url.includes('googleusercontent.com') ||
        url.includes('lh3.google.com') ||
        url.includes('lh4.google.com') ||
        url.includes('lh5.google.com') ||
        url.includes('lh6.google.com');
}
function buildStorageDownloadUrl(bucketName, filePath, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}
function isStorageUrlMissingToken(url) {
    if (!url)
        return false;
    const lowered = url.toLowerCase();
    return ((lowered.includes('storage.googleapis.com/') ||
        lowered.includes('firebasestorage.googleapis.com/') ||
        lowered.includes('firebasestorage.app/')) &&
        !lowered.includes('token='));
}
function parseStorageUrl(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname;
        if (host === 'storage.googleapis.com') {
            const parts = pathname.split('/').filter(Boolean);
            if (parts.length < 2)
                return null;
            const bucket = parts[0] ?? '';
            const rawPath = parts.slice(1).join('/');
            return { bucket, path: decodeURIComponent(rawPath) };
        }
        if (host === 'firebasestorage.googleapis.com' || host.endsWith('.firebasestorage.app')) {
            const match = pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)/);
            if (!match)
                return null;
            const bucket = match[1] ?? '';
            const rawPath = match[2] ?? '';
            return { bucket, path: decodeURIComponent(rawPath) };
        }
    }
    catch {
        return null;
    }
    return null;
}
/**
 * Cache a user's Google profile photo to Firebase Storage.
 * Triggered when a profile document is written with a Google photo URL that isn't cached.
 */
exports.cacheGoogleProfilePhoto = (0, firestore_1.onDocumentWritten)('profiles/{userId}', async (event) => {
    const userId = event.params.userId;
    const afterData = event.data?.after.data();
    if (!afterData)
        return; // Document was deleted
    // Check if already has cached photo
    if (afterData.cachedPhotoURL) {
        return; // Already cached
    }
    // Check for Google photo URL
    const googleUrl = afterData.authPhotoURL || afterData.photoURL;
    if (!googleUrl || !isGooglePhotoUrl(googleUrl)) {
        return; // No Google photo to cache
    }
    // Check if this write was already a caching operation (prevent loops)
    const beforeData = event.data?.before.data();
    if (beforeData?.cachedPhotoURL === afterData.cachedPhotoURL &&
        beforeData?.authPhotoURL === afterData.authPhotoURL) {
        // Data hasn't meaningfully changed for our purposes
        return;
    }
    firebase_functions_1.logger.info('[cacheGoogleProfilePhoto] Caching photo for user', { userId, googleUrl });
    try {
        // Fetch the Google photo
        const response = await fetch(googleUrl);
        if (!response.ok) {
            firebase_functions_1.logger.warn('[cacheGoogleProfilePhoto] Failed to fetch photo', {
                userId,
                status: response.status
            });
            return;
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (!buffer.length) {
            firebase_functions_1.logger.warn('[cacheGoogleProfilePhoto] Empty buffer', { userId });
            return;
        }
        // Determine content type
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        // Upload to Storage
        const storage = (0, storage_1.getStorage)();
        const bucket = storage.bucket();
        const filePath = `profile-uploads/${userId}/avatars/cached-${Date.now()}.${ext}`;
        const file = bucket.file(filePath);
        const downloadToken = (0, crypto_1.randomUUID)();
        await file.save(buffer, {
            metadata: {
                contentType,
                metadata: {
                    originalUrl: googleUrl,
                    cachedAt: new Date().toISOString(),
                    firebaseStorageDownloadTokens: downloadToken
                }
            }
        });
        // Use a Firebase Storage download URL so the app doesn't require public ACLs.
        const cachedUrl = buildStorageDownloadUrl(bucket.name, filePath, downloadToken);
        // Update the profile with cached URL
        await firebase_1.db.doc(`profiles/${userId}`).update({
            cachedPhotoURL: cachedUrl,
            photoURL: cachedUrl,
            authPhotoURL: googleUrl,
            updatedAt: firestore_2.FieldValue.serverTimestamp()
        });
        firebase_functions_1.logger.info('[cacheGoogleProfilePhoto] Successfully cached photo', { userId, cachedUrl });
    }
    catch (error) {
        firebase_functions_1.logger.error('[cacheGoogleProfilePhoto] Error caching photo', { userId, error });
    }
});
exports.onChannelMessageCreated = (0, firestore_1.onDocumentCreated)({
    document: 'servers/{serverId}/channels/{channelId}/messages/{messageId}',
    secrets: [openaiApiKey, resendApiKey]
}, async (event) => {
    const { serverId, channelId, messageId } = event.params;
    const messageData = event.data?.data();
    firebase_functions_1.logger.info('[onChannelMessageCreated] Trigger fired', {
        serverId,
        channelId,
        messageId,
        hasMessageData: !!messageData
    });
    // Run Slack sync separately to capture any errors
    const slackSyncPromise = (async () => {
        try {
            if (messageData) {
                await (0, slack_1.syncHConnectMessageToSlack)(serverId, channelId, messageId, messageData);
            }
            else {
                firebase_functions_1.logger.warn('[onChannelMessageCreated] No messageData for Slack sync', { messageId });
            }
        }
        catch (err) {
            firebase_functions_1.logger.error('[onChannelMessageCreated] Slack sync error', { messageId, error: err });
        }
    })();
    await Promise.all([
        (0, notifications_1.handleServerMessage)(event),
        (0, ticketAi_1.handleTicketAiChannelMessage)(event),
        slackSyncPromise
    ]);
});
exports.onThreadMessageCreated = (0, firestore_1.onDocumentCreated)({
    document: 'servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}',
    secrets: [resendApiKey]
}, async (event) => {
    const { serverId, channelId, threadId, messageId } = event.params;
    const messageData = event.data?.data() || {};
    firebase_functions_1.logger.info('[onThreadMessageCreated] Trigger fired', {
        serverId, channelId, threadId, messageId,
        hasMessageData: !!messageData,
        isSlackMessage: !!messageData.isSlackMessage
    });
    await Promise.all([
        (0, notifications_1.handleThreadMessage)(event),
        (0, ticketAi_1.handleTicketAiThreadMessage)(event),
        // Sync thread messages to Slack as thread replies
        (0, slack_1.syncHConnectThreadMessageToSlack)(serverId, channelId, threadId, messageId, messageData)
            .catch(err => firebase_functions_1.logger.error('[onThreadMessageCreated] Slack sync error', { error: err?.message || err }))
    ]);
});
exports.onDmMessageCreated = (0, firestore_1.onDocumentCreated)({
    document: 'dms/{threadID}/messages/{messageId}',
    secrets: [resendApiKey]
}, async (event) => {
    await (0, notifications_1.handleDmMessage)(event);
});
/**
 * Callable function to backfill DM rail entries for the calling user.
 * This finds all DM threads the user is a participant in and ensures
 * they appear in the user's DM sidebar list.
 */
exports.backfillMyDMRail = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS
}, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    firebase_functions_1.logger.info('[backfillMyDMRail] Starting backfill', { callerUid });
    try {
        const seenThreadIds = new Set();
        let updated = 0;
        let skipped = 0;
        // Helper to resolve participants from various formats
        const resolveParticipants = (data) => {
            // Try participants array first
            if (Array.isArray(data.participants) && data.participants.length >= 2) {
                return data.participants;
            }
            // Try participantUids
            if (Array.isArray(data.participantUids) && data.participantUids.length >= 2) {
                return data.participantUids;
            }
            // Try participantsMap
            if (data.participantsMap && typeof data.participantsMap === 'object') {
                const map = data.participantsMap;
                const uids = Object.keys(map).filter(uid => map[uid] === true);
                if (uids.length >= 2)
                    return uids;
            }
            // Try key (format: uid1_uid2)
            if (typeof data.key === 'string' && data.key.includes('_')) {
                const parts = data.key.split('_').filter(Boolean);
                if (parts.length >= 2)
                    return parts;
            }
            return [];
        };
        // Helper to process a DM document
        const processDm = async (doc) => {
            if (seenThreadIds.has(doc.id))
                return;
            seenThreadIds.add(doc.id);
            const dmData = doc.data();
            const participants = resolveParticipants(dmData);
            // Check if caller is actually a participant
            if (!participants.includes(callerUid)) {
                skipped++;
                return;
            }
            if (participants.length < 2) {
                skipped++;
                return;
            }
            const others = participants.filter((p) => p !== callerUid);
            const otherUid = others.length === 1 ? others[0] : null;
            const payload = {
                threadId: doc.id,
                otherUid,
                participants,
                lastMessage: dmData.lastMessage ?? null,
                updatedAt: dmData.updatedAt ?? dmData.createdAt ?? firestore_2.FieldValue.serverTimestamp()
            };
            // Fetch other participant's profile for display metadata
            if (otherUid) {
                try {
                    const profSnap = await firebase_1.db.doc(`profiles/${otherUid}`).get();
                    if (profSnap.exists) {
                        const profData = profSnap.data() ?? {};
                        const name = profData.name ?? profData.displayName ?? null;
                        const email = profData.email ?? null;
                        const photoURL = profData.cachedPhotoURL ?? profData.photoURL ?? profData.authPhotoURL ?? null;
                        if (name)
                            payload.otherDisplayName = name;
                        if (email)
                            payload.otherEmail = email;
                        if (photoURL)
                            payload.otherPhotoURL = photoURL;
                    }
                }
                catch (err) {
                    firebase_functions_1.logger.warn('[backfillMyDMRail] Failed to fetch profile', { otherUid, err });
                }
            }
            await firebase_1.db.doc(`profiles/${callerUid}/dms/${doc.id}`).set(payload, { merge: true });
            updated++;
        };
        // Query 1: Find threads by participants array
        try {
            const threadsSnap = await firebase_1.db.collection('dms')
                .where('participants', 'array-contains', callerUid)
                .limit(100)
                .get();
            for (const doc of threadsSnap.docs) {
                await processDm(doc);
            }
            firebase_functions_1.logger.info('[backfillMyDMRail] Found threads by participants', { count: threadsSnap.size });
        }
        catch (err) {
            firebase_functions_1.logger.warn('[backfillMyDMRail] Query by participants failed', { err });
        }
        // Query 2: Find threads where the document ID contains the user's UID (key-based lookup)
        // This catches legacy threads that might not have participants array
        try {
            // Get all DMs and filter client-side (less efficient but catches edge cases)
            const allDmsSnap = await firebase_1.db.collection('dms').limit(500).get();
            for (const doc of allDmsSnap.docs) {
                // Check if the doc ID (which is often the key) contains the user's UID
                if (doc.id.includes(callerUid)) {
                    await processDm(doc);
                }
                else {
                    // Also check the key field
                    const data = doc.data();
                    if (typeof data.key === 'string' && data.key.includes(callerUid)) {
                        await processDm(doc);
                    }
                }
            }
        }
        catch (err) {
            firebase_functions_1.logger.warn('[backfillMyDMRail] Key-based lookup failed', { err });
        }
        firebase_functions_1.logger.info('[backfillMyDMRail] Complete', { callerUid, updated, skipped, total: seenThreadIds.size });
        return { ok: true, updated, skipped, total: seenThreadIds.size };
    }
    catch (err) {
        firebase_functions_1.logger.error('[backfillMyDMRail] Error', { callerUid, err });
        throw new https_1.HttpsError('internal', 'Failed to backfill DM rail');
    }
});
/**
 * Callable function to sync Google photos for all members of a server.
 * This fetches photos from Firebase Auth and stores them in profiles.
 */
exports.syncServerMemberPhotos = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS
}, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const serverId = request.data?.serverId;
    if (!serverId || typeof serverId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Server ID required.');
    }
    firebase_functions_1.logger.info('[syncServerMemberPhotos] Starting sync', { serverId, callerUid });
    // Get all members of the server
    const membersSnap = await firebase_1.db.collection(`servers/${serverId}/members`).get();
    const memberUids = membersSnap.docs.map(d => d.id);
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    // Import auth
    const { auth } = await Promise.resolve().then(() => __importStar(require('./firebase')));
    for (const uid of memberUids) {
        try {
            // Check if profile already has a custom photo (user uploaded)
            const profileSnap = await firebase_1.db.doc(`profiles/${uid}`).get();
            const profileData = profileSnap.data();
            // Skip if user has a custom uploaded photo
            if (profileData?.customPhotoURL) {
                skipped++;
                continue;
            }
            // Get user from Firebase Auth to get their provider photo (Google, etc.)
            let authPhotoURL = null;
            try {
                const authUser = await auth.getUser(uid);
                authPhotoURL = authUser.photoURL || null;
                firebase_functions_1.logger.info('[syncServerMemberPhotos] Got auth user', { uid, hasPhoto: !!authPhotoURL, photoURL: authPhotoURL?.substring(0, 50) });
            }
            catch (e) {
                firebase_functions_1.logger.warn('[syncServerMemberPhotos] Could not get auth user', { uid, error: e });
                skipped++;
                continue;
            }
            if (!authPhotoURL) {
                firebase_functions_1.logger.info('[syncServerMemberPhotos] No photo URL in auth', { uid });
                skipped++;
                continue;
            }
            // Just store the auth photo URL directly - no need to cache for now
            // This makes the photo immediately available
            await firebase_1.db.doc(`profiles/${uid}`).set({
                authPhotoURL: authPhotoURL,
                photoURL: profileData?.photoURL || authPhotoURL, // Only update photoURL if not set
                updatedAt: firestore_2.FieldValue.serverTimestamp()
            }, { merge: true });
            synced++;
            firebase_functions_1.logger.info('[syncServerMemberPhotos] Stored photo URL', { uid, authPhotoURL: authPhotoURL.substring(0, 50) });
        }
        catch (error) {
            firebase_functions_1.logger.error('[syncServerMemberPhotos] Error processing user', { uid, error });
            failed++;
        }
    }
    firebase_functions_1.logger.info('[syncServerMemberPhotos] Complete', { serverId, synced, skipped, failed });
    return { ok: true, synced, skipped, failed, total: memberUids.length };
});
exports.sendTestPush = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS
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
/**
 * Diagnostic function: get details about all devices registered for a user.
 * Returns comprehensive info about token status, platform, and why devices might be filtered.
 */
exports.getPushDeviceDiagnostics = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: true
}, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
        const devicesRef = firebase_1.db.collection(`profiles/${uid}/devices`);
        const devicesSnap = await devicesRef.get();
        const diagnostics = {
            uid,
            timestamp: new Date().toISOString(),
            totalDevices: devicesSnap.size,
            devices: []
        };
        for (const docSnap of devicesSnap.docs) {
            const deviceId = docSnap.id;
            const device = docSnap.data();
            diagnostics.devices.push({
                deviceId,
                platform: device.platform ?? 'unknown',
                userAgent: device.userAgent?.slice(0, 100) ?? null,
                permission: device.permission ?? 'unknown',
                enabled: device.enabled ?? true,
                hasToken: Boolean(device.token),
                tokenPrefix: device.token ? device.token.slice(0, 12) : null,
                hasSubscription: Boolean(device.subscription?.endpoint),
                subscriptionEndpointPrefix: device.subscription?.endpoint ? device.subscription.endpoint.slice(0, 30) : null,
                lastSeen: device.lastSeen?.toDate?.().toISOString?.() ?? null,
                createdAt: device.createdAt?.toDate?.().toISOString?.() ?? null,
                tokenUpdatedAt: device.tokenUpdatedAt?.toDate?.().toISOString?.() ?? null,
                isStandalone: device.isStandalone ?? false,
                filterReasons: {
                    noTokenOrSubscription: !device.token && !device.subscription?.endpoint,
                    permissionDenied: device.permission === 'denied',
                    permissionDefault: device.permission === 'default',
                    disabled: device.enabled === false,
                    willReceivePush: Boolean((device.token || device.subscription?.endpoint) &&
                        (device.permission === 'granted' || device.permission === undefined) &&
                        device.enabled !== false)
                }
            });
        }
        firebase_functions_1.logger.info('[getPushDeviceDiagnostics] Diagnostics retrieved', {
            uid,
            totalDevices: diagnostics.totalDevices,
            willReceivePush: diagnostics.devices.filter(d => d.filterReasons.willReceivePush).length
        });
        return diagnostics;
    }
    catch (err) {
        firebase_functions_1.logger.error('[getPushDeviceDiagnostics] Error', { uid, error: err });
        throw new https_1.HttpsError('internal', 'Failed to retrieve device diagnostics');
    }
});
/**
 * Super Admin callable: send a test email notification to a specified address.
 * Uses RESEND_API_KEY secret for email delivery.
 */
exports.sendTestEmailNotification = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: true,
    secrets: [resendApiKey]
}, async (request) => {
    const callerUid = request.auth?.uid;
    const callerEmail = request.auth?.token?.email;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    if (!callerEmail) {
        throw new https_1.HttpsError('permission-denied', 'Email required for super admin verification.');
    }
    const superAdminsDoc = await firebase_1.db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true || callerEmail.toLowerCase() === 'andrew@healthspaces.com';
    if (!isSuperAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Super Admin access required.');
    }
    const target = typeof request.data?.email === 'string' ? request.data.email.trim() : '';
    if (!target || !target.includes('@')) {
        throw new https_1.HttpsError('invalid-argument', 'Valid email address required.');
    }
    const message = typeof request.data?.message === 'string' && request.data.message.trim().length
        ? request.data.message.trim()
        : 'This is a test email notification from hConnect.';
    const subject = 'hConnect test notification';
    const text = `${message}\n\nTriggered by ${callerEmail}.`;
    firebase_functions_1.logger.info('[sendTestEmailNotification] Sending test email', {
        callerUid,
        callerEmail,
        target
    });
    const result = await (0, email_1.sendEmail)({
        to: target,
        subject,
        text,
        context: { type: 'test' }
    });
    if (!result.sent) {
        firebase_functions_1.logger.warn('[sendTestEmailNotification] Send failed', { reason: result.reason ?? 'unknown' });
        return { ok: false, reason: result.reason ?? 'send_failed' };
    }
    firebase_functions_1.logger.info('[sendTestEmailNotification] Sent', { target, messageId: result.messageId ?? null });
    return { ok: true, messageId: result.messageId ?? null };
});
/**
 * HTTP variant for browsers: explicit CORS + ID token auth.
 * Uses RESEND_API_KEY secret for email delivery.
 */
exports.sendTestEmailNotificationHttp = (0, https_1.onRequest)({
    region: 'us-central1',
    secrets: [resendApiKey]
}, async (req, res) => {
    const origin = req.headers.origin || '*';
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ ok: false, reason: 'missing_auth' });
        return;
    }
    let decoded = null;
    try {
        const token = authHeader.substring('Bearer '.length);
        decoded = await firebase_1.auth.verifyIdToken(token);
    }
    catch (err) {
        firebase_functions_1.logger.warn('[sendTestEmailNotificationHttp] Invalid token', { err });
        res.status(401).json({ ok: false, reason: 'invalid_token' });
        return;
    }
    const callerUid = decoded?.uid ?? null;
    const callerEmail = decoded?.email ?? null;
    if (!callerUid || !callerEmail) {
        res.status(403).json({ ok: false, reason: 'missing_email' });
        return;
    }
    const superAdminsDoc = await firebase_1.db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true || callerEmail.toLowerCase() === 'andrew@healthspaces.com';
    if (!isSuperAdmin) {
        res.status(403).json({ ok: false, reason: 'not_super_admin' });
        return;
    }
    const body = (req.body ?? {});
    const target = typeof body?.email === 'string'
        ? body.email.trim()
        : typeof body?.target === 'string'
            ? body.target.trim()
            : '';
    if (!target || !target.includes('@')) {
        res.status(400).json({ ok: false, reason: 'invalid_email' });
        return;
    }
    const message = typeof body?.message === 'string' && body.message.trim().length
        ? body.message.trim()
        : 'This is a test email notification from hConnect.';
    const subject = 'hConnect test notification';
    const text = `${message}\n\nTriggered by ${callerEmail}.`;
    try {
        const result = await (0, email_1.sendEmail)({
            to: target,
            subject,
            text,
            context: { type: 'test' }
        });
        if (!result.sent) {
            firebase_functions_1.logger.warn('[sendTestEmailNotificationHttp] Send failed', { reason: result.reason ?? 'unknown' });
            res.status(500).json({ ok: false, reason: result.reason ?? 'send_failed' });
            return;
        }
        firebase_functions_1.logger.info('[sendTestEmailNotificationHttp] Sent', { target, messageId: result.messageId ?? null });
        res.status(200).json({ ok: true, messageId: result.messageId ?? null });
        return;
    }
    catch (err) {
        firebase_functions_1.logger.error('[sendTestEmailNotificationHttp] Unexpected error', { err });
        const reason = err instanceof Error ? err.message : 'internal';
        res.status(500).json({ ok: false, reason });
        return;
    }
});
/**
 * Super Admin callable: fetch recent email notification logs.
 */
exports.getEmailNotificationLogs = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS
}, async (request) => {
    const callerUid = request.auth?.uid;
    const callerEmail = request.auth?.token?.email;
    if (!callerUid || !callerEmail) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    // Check super admin
    const superAdminsDoc = await firebase_1.db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true || callerEmail.toLowerCase() === 'andrew@healthspaces.com';
    if (!isSuperAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Super Admin access required.');
    }
    const limitParam = typeof request.data?.limit === 'number' ? request.data.limit : 50;
    const actualLimit = Math.min(Math.max(1, limitParam), 200);
    try {
        const logsRef = firebase_1.db.collection('adminLogs').doc('email').collection('notifications');
        const snapshot = await logsRef
            .orderBy('createdAt', 'desc')
            .limit(actualLimit)
            .get();
        const logs = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                to: data.to ?? null,
                subject: data.subject ?? null,
                sent: data.sent ?? false,
                reason: data.reason ?? null,
                messageId: data.messageId ?? null,
                provider: data.provider ?? null,
                context: data.context ?? null,
                durationMs: data.durationMs ?? null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null
            };
        });
        return { ok: true, logs };
    }
    catch (err) {
        firebase_functions_1.logger.error('[getEmailNotificationLogs] Failed to fetch logs', { err });
        throw new https_1.HttpsError('internal', 'Failed to fetch email logs.');
    }
});
/**
 * Callable function to manually create a ticket from a message.
 * Staff members can use this to create tickets for messages that weren't auto-detected.
 */
exports.createTicketFromMessage = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    secrets: [openaiApiKey],
    cors: ALLOWED_ORIGINS
}, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const { serverId, channelId, messageId, threadId } = request.data ?? {};
    if (!serverId || typeof serverId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Server ID required.');
    }
    if (!channelId || typeof channelId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Channel ID required.');
    }
    if (!messageId || typeof messageId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Message ID required.');
    }
    firebase_functions_1.logger.info('[createTicketFromMessage] Creating manual ticket', {
        serverId, channelId, messageId, threadId, callerUid
    });
    const result = await (0, ticketAi_1.createManualTicket)({
        serverId,
        channelId,
        messageId,
        threadId: typeof threadId === 'string' ? threadId : null,
        callerUid
    });
    if (!result.ok) {
        throw new https_1.HttpsError('failed-precondition', result.error ?? 'Failed to create ticket');
    }
    return { ok: true, ticketId: result.ticketId };
});
/**
 * Super Admin callable function to refresh Google profile photos for ALL users.
 * This reads the authPhotoURL from Firebase Auth and updates the profile.
 * DOES NOT override users who have customPhotoURL set (user-uploaded photos).
 */
exports.refreshAllGooglePhotos = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 540 // 9 minutes - this could take a while
}, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    // Verify caller is a super admin
    const callerEmail = request.auth?.token?.email;
    if (!callerEmail) {
        throw new https_1.HttpsError('permission-denied', 'Email required for super admin verification.');
    }
    const superAdminsDoc = await firebase_1.db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true ||
        callerEmail.toLowerCase() === 'andrew@healthspaces.com';
    if (!isSuperAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Super Admin access required.');
    }
    firebase_functions_1.logger.info('[refreshAllGooglePhotos] Starting refresh', { callerUid, callerEmail });
    // Get all profiles
    const profilesSnap = await firebase_1.db.collection('profiles').get();
    const totalProfiles = profilesSnap.size;
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let noAuthPhoto = 0;
    // Import auth
    const { auth } = await Promise.resolve().then(() => __importStar(require('./firebase')));
    for (const profileDoc of profilesSnap.docs) {
        const uid = profileDoc.id;
        const profileData = profileDoc.data();
        try {
            // Skip if user has a custom uploaded photo - don't override their choice
            if (profileData?.customPhotoURL) {
                firebase_functions_1.logger.info('[refreshAllGooglePhotos] Skipping user with custom photo', { uid });
                skipped++;
                continue;
            }
            // Get user from Firebase Auth to get their provider photo
            let authPhotoURL = null;
            try {
                const authUser = await auth.getUser(uid);
                authPhotoURL = authUser.photoURL || null;
            }
            catch (e) {
                // User might not exist in Auth (old/deleted users)
                firebase_functions_1.logger.warn('[refreshAllGooglePhotos] Could not get auth user', { uid });
                skipped++;
                continue;
            }
            if (!authPhotoURL) {
                noAuthPhoto++;
                continue;
            }
            // Update profile with the Google photo URL
            // Clear cachedPhotoURL since it might be stale
            await firebase_1.db.doc(`profiles/${uid}`).set({
                authPhotoURL: authPhotoURL,
                photoURL: authPhotoURL, // Set main photoURL to Google photo
                cachedPhotoURL: null, // Clear stale cached URL
                updatedAt: firestore_2.FieldValue.serverTimestamp()
            }, { merge: true });
            synced++;
            firebase_functions_1.logger.info('[refreshAllGooglePhotos] Updated photo', {
                uid,
                authPhotoURL: authPhotoURL.substring(0, 60) + '...'
            });
        }
        catch (error) {
            firebase_functions_1.logger.error('[refreshAllGooglePhotos] Error processing user', { uid, error });
            failed++;
        }
    }
    firebase_functions_1.logger.info('[refreshAllGooglePhotos] Complete', {
        total: totalProfiles,
        synced,
        skipped,
        failed,
        noAuthPhoto
    });
    return {
        ok: true,
        total: totalProfiles,
        synced,
        skipped,
        failed,
        noAuthPhoto,
        message: `Refreshed ${synced} photos. Skipped ${skipped} (custom photos or no auth). ${noAuthPhoto} users have no Google photo.`
    };
});
/**
 * Super Admin callable function to refresh a SINGLE user's Google profile photo.
 * This reads the authPhotoURL from Firebase Auth and updates the profile.
 * Can optionally force refresh even if user has customPhotoURL.
 */
exports.refreshUserGooglePhoto = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS
}, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    // Verify caller is a super admin
    const callerEmail = request.auth?.token?.email;
    if (!callerEmail) {
        throw new https_1.HttpsError('permission-denied', 'Email required for super admin verification.');
    }
    const superAdminsDoc = await firebase_1.db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true ||
        callerEmail.toLowerCase() === 'andrew@healthspaces.com';
    if (!isSuperAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Super Admin access required.');
    }
    const { uid, force } = request.data ?? {};
    if (!uid || typeof uid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'User ID required.');
    }
    firebase_functions_1.logger.info('[refreshUserGooglePhoto] Starting refresh for user', { uid, callerUid, force });
    // Get current profile
    const profileDoc = await firebase_1.db.doc(`profiles/${uid}`).get();
    const profileData = profileDoc.data();
    // Check if user has custom photo and force is not set
    if (profileData?.customPhotoURL && !force) {
        return {
            ok: false,
            reason: 'has_custom_photo',
            message: 'User has a custom photo. Use force=true to override.'
        };
    }
    // Get user from Firebase Auth
    const { auth } = await Promise.resolve().then(() => __importStar(require('./firebase')));
    let authPhotoURL = null;
    try {
        const authUser = await auth.getUser(uid);
        authPhotoURL = authUser.photoURL || null;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[refreshUserGooglePhoto] Could not get auth user', { uid });
        throw new https_1.HttpsError('not-found', 'User not found in Firebase Auth.');
    }
    if (!authPhotoURL) {
        return {
            ok: false,
            reason: 'no_google_photo',
            message: 'User does not have a Google profile photo.'
        };
    }
    // Download the Google photo and upload to Firebase Storage to avoid CORS issues
    let cachedPhotoURL = null;
    try {
        // Request a larger size image from Google (change =s96-c to =s400)
        let fetchUrl = authPhotoURL;
        if (fetchUrl.includes('=s96-c')) {
            fetchUrl = fetchUrl.replace('=s96-c', '=s400');
        }
        else if (!fetchUrl.includes('=s')) {
            fetchUrl = fetchUrl + '=s400';
        }
        firebase_functions_1.logger.info('[refreshUserGooglePhoto] Downloading Google photo...', {
            originalUrl: authPhotoURL.substring(0, 80),
            fetchUrl: fetchUrl.substring(0, 80)
        });
        // Fetch the image from Google
        const response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`);
        }
        const imageBuffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const imageSize = imageBuffer.length;
        firebase_functions_1.logger.info('[refreshUserGooglePhoto] Downloaded image', {
            size: imageSize,
            contentType
        });
        // Check if image is too small (likely a default avatar)
        if (imageSize < 3000) {
            firebase_functions_1.logger.warn('[refreshUserGooglePhoto] Image too small, likely a default avatar', { size: imageSize });
            return {
                ok: false,
                reason: 'default_avatar',
                googleURL: authPhotoURL,
                imageSize,
                message: `User appears to have a default Google avatar (${imageSize} bytes). They may need to set a profile photo in Google or re-sign in.`
            };
        }
        // Upload to Firebase Storage
        const bucket = (0, storage_1.getStorage)().bucket();
        const fileName = `avatars/${uid}/google-photo.jpg`;
        const file = bucket.file(fileName);
        const downloadToken = (0, crypto_1.randomUUID)();
        await file.save(imageBuffer, {
            metadata: {
                contentType,
                cacheControl: 'no-cache, max-age=0', // Don't cache - always fetch fresh
                metadata: {
                    firebaseStorageDownloadTokens: downloadToken
                }
            },
        });
        // Get the download URL with cache-busting timestamp
        cachedPhotoURL = `${buildStorageDownloadUrl(bucket.name, fileName, downloadToken)}&t=${Date.now()}`;
        firebase_functions_1.logger.info('[refreshUserGooglePhoto] Photo cached to Storage', { cachedPhotoURL: cachedPhotoURL.substring(0, 80) });
    }
    catch (fetchError) {
        firebase_functions_1.logger.warn('[refreshUserGooglePhoto] Failed to cache photo, using original URL', { error: String(fetchError) });
        // Fall back to original URL if caching fails
    }
    // Update profile with cached URL (or original if caching failed)
    const photoURLToUse = cachedPhotoURL || authPhotoURL;
    await firebase_1.db.doc(`profiles/${uid}`).set({
        authPhotoURL: authPhotoURL,
        photoURL: photoURLToUse,
        cachedPhotoURL: cachedPhotoURL,
        updatedAt: firestore_2.FieldValue.serverTimestamp()
    }, { merge: true });
    firebase_functions_1.logger.info('[refreshUserGooglePhoto] Updated photo', {
        uid,
        photoURL: photoURLToUse.substring(0, 60) + '...',
        cached: !!cachedPhotoURL
    });
    return {
        ok: true,
        photoURL: photoURLToUse,
        googleURL: authPhotoURL, // Original Google URL for debugging
        cached: !!cachedPhotoURL,
        message: cachedPhotoURL ? 'Profile photo refreshed and cached.' : 'Profile photo refreshed (not cached).'
    };
});
/**
 * Super Admin callable: repair token-missing Firebase Storage URLs stored in a user's profile.
 */
exports.repairUserAvatarTokens = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ALLOWED_ORIGINS
}, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const callerEmail = request.auth?.token?.email;
    if (!callerEmail) {
        throw new https_1.HttpsError('permission-denied', 'Email required for super admin verification.');
    }
    const superAdminsDoc = await firebase_1.db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true ||
        callerEmail.toLowerCase() === 'andrew@healthspaces.com';
    if (!isSuperAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Super Admin access required.');
    }
    const { uid } = request.data ?? {};
    if (!uid || typeof uid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'User ID required.');
    }
    const profileRef = firebase_1.db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
        return { ok: false, reason: 'profile_not_found', message: 'Profile not found.' };
    }
    const profileData = profileSnap.data() ?? {};
    const fieldsToCheck = [
        'authPhotoURL',
        'photoURL',
        'cachedPhotoURL',
        'customPhotoURL',
        'avatar',
        'avatarUrl',
        'avatarURL'
    ];
    const objectMap = new Map();
    for (const field of fieldsToCheck) {
        const value = profileData[field];
        if (typeof value !== 'string' || !value)
            continue;
        if (!isStorageUrlMissingToken(value))
            continue;
        const parsed = parseStorageUrl(value);
        if (!parsed?.bucket || !parsed?.path)
            continue;
        const key = `${parsed.bucket}/${parsed.path}`;
        const existing = objectMap.get(key);
        if (existing) {
            existing.fields.push(field);
        }
        else {
            objectMap.set(key, { ...parsed, fields: [field] });
        }
    }
    if (objectMap.size === 0) {
        return {
            ok: false,
            reason: 'no_missing_tokens',
            message: 'No token-missing Storage URLs found.'
        };
    }
    const updates = {};
    const failures = [];
    for (const item of objectMap.values()) {
        try {
            const bucket = (0, storage_1.getStorage)().bucket(item.bucket);
            const file = bucket.file(item.path);
            const [exists] = await file.exists();
            if (!exists) {
                failures.push({ bucket: item.bucket, path: item.path, reason: 'object_not_found' });
                continue;
            }
            const token = (0, crypto_1.randomUUID)();
            await file.setMetadata({
                metadata: {
                    firebaseStorageDownloadTokens: token
                }
            });
            const cacheBust = Date.now();
            const downloadUrl = `${buildStorageDownloadUrl(item.bucket, item.path, token)}&t=${cacheBust}`;
            for (const field of item.fields) {
                updates[field] = downloadUrl;
            }
        }
        catch (error) {
            failures.push({
                bucket: item.bucket,
                path: item.path,
                reason: error instanceof Error ? error.message : 'unknown_error'
            });
        }
    }
    if (Object.keys(updates).length > 0) {
        await profileRef.set({
            ...updates,
            updatedAt: firestore_2.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    return {
        ok: Object.keys(updates).length > 0,
        updated: updates,
        updatedCount: Object.keys(updates).length,
        failures,
        message: Object.keys(updates).length > 0
            ? 'Repaired token-missing Storage URLs.'
            : 'No Storage URLs were repaired.'
    };
});
//# sourceMappingURL=index.js.map