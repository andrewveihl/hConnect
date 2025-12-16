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
exports.refreshUserGooglePhoto = exports.refreshAllGooglePhotos = exports.createTicketFromMessage = exports.sendTestPush = exports.syncServerMemberPhotos = exports.onDmMessageCreated = exports.onThreadMessageCreated = exports.onChannelMessageCreated = exports.cacheGoogleProfilePhoto = exports.requestDomainAutoInvite = void 0;
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const storage_1 = require("firebase-admin/storage");
const firebase_1 = require("./firebase");
const firestore_2 = require("firebase-admin/firestore");
const notifications_1 = require("./notifications");
const ticketAi_1 = require("./ticketAi");
var domainInvites_1 = require("./domainInvites");
Object.defineProperty(exports, "requestDomainAutoInvite", { enumerable: true, get: function () { return domainInvites_1.requestDomainAutoInvite; } });
// Define secrets for functions that need them
const openaiApiKey = (0, params_1.defineSecret)('OPENAI_API_KEY');
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
        await file.save(buffer, {
            metadata: {
                contentType,
                metadata: {
                    originalUrl: googleUrl,
                    cachedAt: new Date().toISOString()
                }
            }
        });
        // Make the file publicly readable
        await file.makePublic();
        // Get the public URL
        const cachedUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
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
    secrets: [openaiApiKey]
}, async (event) => {
    await Promise.all([(0, notifications_1.handleServerMessage)(event), (0, ticketAi_1.handleTicketAiChannelMessage)(event)]);
});
exports.onThreadMessageCreated = (0, firestore_1.onDocumentCreated)('servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}', async (event) => {
    await Promise.all([(0, notifications_1.handleThreadMessage)(event), (0, ticketAi_1.handleTicketAiThreadMessage)(event)]);
});
exports.onDmMessageCreated = (0, firestore_1.onDocumentCreated)('dms/{threadID}/messages/{messageId}', async (event) => {
    await (0, notifications_1.handleDmMessage)(event);
});
/**
 * Callable function to sync Google photos for all members of a server.
 * This fetches photos from Firebase Auth and stores them in profiles.
 */
exports.syncServerMemberPhotos = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
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
/**
 * Callable function to manually create a ticket from a message.
 * Staff members can use this to create tickets for messages that weren't auto-detected.
 */
exports.createTicketFromMessage = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    secrets: [openaiApiKey],
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
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
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173'],
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
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
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
        await file.save(imageBuffer, {
            metadata: {
                contentType,
                cacheControl: 'no-cache, max-age=0', // Don't cache - always fetch fresh
            },
        });
        // Make the file publicly accessible
        await file.makePublic();
        // Get the public URL with cache-busting timestamp
        cachedPhotoURL = `https://storage.googleapis.com/${bucket.name}/${fileName}?t=${Date.now()}`;
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
//# sourceMappingURL=index.js.map