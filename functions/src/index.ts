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
import { handleTicketAiThreadMessage, handleTicketAiChannelMessage, createManualTicket } from './ticketAi';
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

/**
 * Callable function to manually create a ticket from a message.
 * Staff members can use this to create tickets for messages that weren't auto-detected.
 */
export const createTicketFromMessage = onCall(
  {
    region: 'us-central1',
    invoker: 'public',
    secrets: [openaiApiKey],
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const { serverId, channelId, messageId, threadId } = request.data ?? {};
    
    if (!serverId || typeof serverId !== 'string') {
      throw new HttpsError('invalid-argument', 'Server ID required.');
    }
    if (!channelId || typeof channelId !== 'string') {
      throw new HttpsError('invalid-argument', 'Channel ID required.');
    }
    if (!messageId || typeof messageId !== 'string') {
      throw new HttpsError('invalid-argument', 'Message ID required.');
    }

    logger.info('[createTicketFromMessage] Creating manual ticket', { 
      serverId, channelId, messageId, threadId, callerUid 
    });

    const result = await createManualTicket({
      serverId,
      channelId,
      messageId,
      threadId: typeof threadId === 'string' ? threadId : null,
      callerUid
    });

    if (!result.ok) {
      throw new HttpsError('failed-precondition', result.error ?? 'Failed to create ticket');
    }

    return { ok: true, ticketId: result.ticketId };
  }
);

/**
 * Super Admin callable function to refresh Google profile photos for ALL users.
 * This reads the authPhotoURL from Firebase Auth and updates the profile.
 * DOES NOT override users who have customPhotoURL set (user-uploaded photos).
 */
export const refreshAllGooglePhotos = onCall(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    timeoutSeconds: 540 // 9 minutes - this could take a while
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    // Verify caller is a super admin
    const callerEmail = request.auth?.token?.email;
    if (!callerEmail) {
      throw new HttpsError('permission-denied', 'Email required for super admin verification.');
    }

    const superAdminsDoc = await db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true || 
                         callerEmail.toLowerCase() === 'andrew@healthspaces.com';

    if (!isSuperAdmin) {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    logger.info('[refreshAllGooglePhotos] Starting refresh', { callerUid, callerEmail });

    // Get all profiles
    const profilesSnap = await db.collection('profiles').get();
    const totalProfiles = profilesSnap.size;

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let noAuthPhoto = 0;

    // Import auth
    const { auth } = await import('./firebase');

    for (const profileDoc of profilesSnap.docs) {
      const uid = profileDoc.id;
      const profileData = profileDoc.data();

      try {
        // Skip if user has a custom uploaded photo - don't override their choice
        if (profileData?.customPhotoURL) {
          logger.info('[refreshAllGooglePhotos] Skipping user with custom photo', { uid });
          skipped++;
          continue;
        }

        // Get user from Firebase Auth to get their provider photo
        let authPhotoURL: string | null = null;
        try {
          const authUser = await auth.getUser(uid);
          authPhotoURL = authUser.photoURL || null;
        } catch (e) {
          // User might not exist in Auth (old/deleted users)
          logger.warn('[refreshAllGooglePhotos] Could not get auth user', { uid });
          skipped++;
          continue;
        }

        if (!authPhotoURL) {
          noAuthPhoto++;
          continue;
        }

        // Update profile with the Google photo URL
        // Clear cachedPhotoURL since it might be stale
        await db.doc(`profiles/${uid}`).set({
          authPhotoURL: authPhotoURL,
          photoURL: authPhotoURL, // Set main photoURL to Google photo
          cachedPhotoURL: null, // Clear stale cached URL
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        synced++;
        logger.info('[refreshAllGooglePhotos] Updated photo', { 
          uid, 
          authPhotoURL: authPhotoURL.substring(0, 60) + '...'
        });
      } catch (error) {
        logger.error('[refreshAllGooglePhotos] Error processing user', { uid, error });
        failed++;
      }
    }

    logger.info('[refreshAllGooglePhotos] Complete', { 
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
  }
);

/**
 * Super Admin callable function to refresh a SINGLE user's Google profile photo.
 * This reads the authPhotoURL from Firebase Auth and updates the profile.
 * Can optionally force refresh even if user has customPhotoURL.
 */
export const refreshUserGooglePhoto = onCall(
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

    // Verify caller is a super admin
    const callerEmail = request.auth?.token?.email;
    if (!callerEmail) {
      throw new HttpsError('permission-denied', 'Email required for super admin verification.');
    }

    const superAdminsDoc = await db.doc('appConfig/superAdmins').get();
    const superAdminsData = superAdminsDoc.data();
    const emailsMap = superAdminsData?.emails ?? {};
    const isSuperAdmin = emailsMap[callerEmail.toLowerCase()] === true || 
                         callerEmail.toLowerCase() === 'andrew@healthspaces.com';

    if (!isSuperAdmin) {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    const { uid, force } = request.data ?? {};
    
    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'User ID required.');
    }

    logger.info('[refreshUserGooglePhoto] Starting refresh for user', { uid, callerUid, force });

    // Get current profile
    const profileDoc = await db.doc(`profiles/${uid}`).get();
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
    const { auth } = await import('./firebase');
    let authPhotoURL: string | null = null;
    try {
      const authUser = await auth.getUser(uid);
      authPhotoURL = authUser.photoURL || null;
    } catch (e) {
      logger.warn('[refreshUserGooglePhoto] Could not get auth user', { uid });
      throw new HttpsError('not-found', 'User not found in Firebase Auth.');
    }

    if (!authPhotoURL) {
      return {
        ok: false,
        reason: 'no_google_photo',
        message: 'User does not have a Google profile photo.'
      };
    }

    // Download the Google photo and upload to Firebase Storage to avoid CORS issues
    let cachedPhotoURL: string | null = null;
    try {
      // Request a larger size image from Google (change =s96-c to =s400)
      let fetchUrl = authPhotoURL;
      if (fetchUrl.includes('=s96-c')) {
        fetchUrl = fetchUrl.replace('=s96-c', '=s400');
      } else if (!fetchUrl.includes('=s')) {
        fetchUrl = fetchUrl + '=s400';
      }
      
      logger.info('[refreshUserGooglePhoto] Downloading Google photo...', { 
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
      
      logger.info('[refreshUserGooglePhoto] Downloaded image', { 
        size: imageSize,
        contentType 
      });
      
      // Check if image is too small (likely a default avatar)
      if (imageSize < 3000) {
        logger.warn('[refreshUserGooglePhoto] Image too small, likely a default avatar', { size: imageSize });
        return {
          ok: false,
          reason: 'default_avatar',
          googleURL: authPhotoURL,
          imageSize,
          message: `User appears to have a default Google avatar (${imageSize} bytes). They may need to set a profile photo in Google or re-sign in.`
        };
      }
      
      // Upload to Firebase Storage
      const bucket = getStorage().bucket();
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
      
      logger.info('[refreshUserGooglePhoto] Photo cached to Storage', { cachedPhotoURL: cachedPhotoURL.substring(0, 80) });
    } catch (fetchError) {
      logger.warn('[refreshUserGooglePhoto] Failed to cache photo, using original URL', { error: String(fetchError) });
      // Fall back to original URL if caching fails
    }

    // Update profile with cached URL (or original if caching failed)
    const photoURLToUse = cachedPhotoURL || authPhotoURL;
    
    await db.doc(`profiles/${uid}`).set({
      authPhotoURL: authPhotoURL,
      photoURL: photoURLToUse,
      cachedPhotoURL: cachedPhotoURL,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    logger.info('[refreshUserGooglePhoto] Updated photo', { 
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
  }
);
