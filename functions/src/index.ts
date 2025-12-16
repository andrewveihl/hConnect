import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getStorage } from 'firebase-admin/storage';
import { db } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';

import {
  handleDmMessage,
  handleServerMessage,
  handleThreadMessage,
  sendTestPushForUid
} from './notifications';
import { handleTicketAiThreadMessage, handleTicketAiChannelMessage } from './ticketAi';
export { requestDomainAutoInvite } from './domainInvites';

// Define secrets for functions that need them
const openaiApiKey = defineSecret('OPENAI_API_KEY');

/**
 * Check if a URL is a Google profile photo URL
 */
function isGooglePhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
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
export const cacheGoogleProfilePhoto = onDocumentWritten(
  'profiles/{userId}',
  async (event) => {
    const userId = event.params.userId;
    const afterData = event.data?.after.data();
    
    if (!afterData) return; // Document was deleted
    
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
    
    logger.info('[cacheGoogleProfilePhoto] Caching photo for user', { userId, googleUrl });
    
    try {
      // Fetch the Google photo
      const response = await fetch(googleUrl);
      if (!response.ok) {
        logger.warn('[cacheGoogleProfilePhoto] Failed to fetch photo', { 
          userId, 
          status: response.status 
        });
        return;
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      if (!buffer.length) {
        logger.warn('[cacheGoogleProfilePhoto] Empty buffer', { userId });
        return;
      }
      
      // Determine content type
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      
      // Upload to Storage
      const storage = getStorage();
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
      await db.doc(`profiles/${userId}`).update({
        cachedPhotoURL: cachedUrl,
        photoURL: cachedUrl,
        authPhotoURL: googleUrl,
        updatedAt: FieldValue.serverTimestamp()
      });
      
      logger.info('[cacheGoogleProfilePhoto] Successfully cached photo', { userId, cachedUrl });
    } catch (error) {
      logger.error('[cacheGoogleProfilePhoto] Error caching photo', { userId, error });
    }
  }
);

export const onChannelMessageCreated = onDocumentCreated(
  {
    document: 'servers/{serverId}/channels/{channelId}/messages/{messageId}',
    secrets: [openaiApiKey]
  },
  async (event) => {
    await Promise.all([handleServerMessage(event), handleTicketAiChannelMessage(event as any)]);
  }
);

export const onThreadMessageCreated = onDocumentCreated(
  'servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}',
  async (event) => {
    await Promise.all([handleThreadMessage(event as any), handleTicketAiThreadMessage(event as any)]);
  }
);

export const onDmMessageCreated = onDocumentCreated(
  'dms/{threadID}/messages/{messageId}',
  async (event) => {
    await handleDmMessage(event);
  }
);

/**
 * Callable function to sync Google photos for all members of a server.
 * This fetches photos from Firebase Auth and stores them in profiles.
 */
export const syncServerMemberPhotos = onCall(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const serverId = request.data?.serverId;
    if (!serverId || typeof serverId !== 'string') {
      throw new HttpsError('invalid-argument', 'Server ID required.');
    }

    logger.info('[syncServerMemberPhotos] Starting sync', { serverId, callerUid });

    // Get all members of the server
    const membersSnap = await db.collection(`servers/${serverId}/members`).get();
    const memberUids = membersSnap.docs.map(d => d.id);

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    // Import auth
    const { auth } = await import('./firebase');

    for (const uid of memberUids) {
      try {
        // Check if profile already has a custom photo (user uploaded)
        const profileSnap = await db.doc(`profiles/${uid}`).get();
        const profileData = profileSnap.data();
        
        // Skip if user has a custom uploaded photo
        if (profileData?.customPhotoURL) {
          skipped++;
          continue;
        }

        // Get user from Firebase Auth to get their provider photo (Google, etc.)
        let authPhotoURL: string | null = null;
        try {
          const authUser = await auth.getUser(uid);
          authPhotoURL = authUser.photoURL || null;
          logger.info('[syncServerMemberPhotos] Got auth user', { uid, hasPhoto: !!authPhotoURL, photoURL: authPhotoURL?.substring(0, 50) });
        } catch (e) {
          logger.warn('[syncServerMemberPhotos] Could not get auth user', { uid, error: e });
          skipped++;
          continue;
        }

        if (!authPhotoURL) {
          logger.info('[syncServerMemberPhotos] No photo URL in auth', { uid });
          skipped++;
          continue;
        }

        // Just store the auth photo URL directly - no need to cache for now
        // This makes the photo immediately available
        await db.doc(`profiles/${uid}`).set({
          authPhotoURL: authPhotoURL,
          photoURL: profileData?.photoURL || authPhotoURL, // Only update photoURL if not set
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        synced++;
        logger.info('[syncServerMemberPhotos] Stored photo URL', { uid, authPhotoURL: authPhotoURL.substring(0, 50) });
      } catch (error) {
        logger.error('[syncServerMemberPhotos] Error processing user', { uid, error });
        failed++;
      }
    }

    logger.info('[syncServerMemberPhotos] Complete', { serverId, synced, skipped, failed });
    return { ok: true, synced, skipped, failed, total: memberUids.length };
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
