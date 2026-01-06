# Android Push Notifications - Debugging Guide

## Changes Made

Enhanced logging has been added to the push notification pipeline to help diagnose why Android devices may not be receiving push notifications. These changes do NOT affect iOS or Chrome notifications.

### 1. **Client-Side Token Retrieval Logging** (`src/lib/notify/push.ts`)

Added detailed platform-aware logging for:
- Permission request flow (`requestNotificationPermission()`)
- Service Worker registration status
- FCM token retrieval with platform detection
- Token storage errors

**Key log entries to look for:**
```
[push-client] enablePushForUser: calling getToken { platform: 'android_browser', hasVapidKey: true }
[push-client] enablePushForUser: getToken complete { platform: 'android_browser', hasToken: true }
[push-client] enablePushForUser: FCM token is null { platform: 'android_browser', permission: 'granted' }
```

### 2. **Device Document Filtering Logging** (`functions/src/settings.ts`)

Enhanced `fetchDeviceTokens()` to log:
- Why Android devices are being included/excluded
- Platform information for each device
- Detailed filter reasons (no token, permission denied, disabled, etc.)

**Key log entries to look for:**
```
[fetchDeviceTokens] Device filtered out
  platform: 'android_browser'
  hasToken: false
  permission: 'granted'
  reasons: {
    noTokenOrSubscription: true,
    permissionDenied: false,
    permissionDefault: false,
    disabled: false
  }
```

### 3. **Push Sending Logging** (`functions/src/notifications.ts`)

Enhanced `sendPushToTokens()` to log:
- Detailed breakdown of device tokens by platform
- Individual token delivery status
- FCM multicast send results with error codes

**Key log entries to look for:**
```
[push] sendPushToTokens invoked
  totalTokens: 2
  fcmTokens: 1
  tokenDetails: {
    platforms: ['android_browser', 'web_chrome'],
    hasTokens: [
      { platform: 'android_browser', hasToken: true, hasSubscription: false },
      ...
    ]
  }

[push] FCM delivery failed
  tokenIndex: 0
  tokenPrefix: 'abc123...'
  errorCode: 'messaging/invalid-registration-token'
  errorMessage: 'Invalid registration token provided'
```

### 4. **Service Worker Message Logging** (`static/firebase-messaging-sw.js`)

Enhanced background message handling to log:
- Platform information in messages
- Message ID and type tracking
- Notification display success/failure by platform

**Key log entries to look for:**
```
[firebase-messaging-sw] onBackgroundMessage received
  platform: 'android_browser'
  messageId: 'abc123...'
  hasNotification: true
  hasData: true

[firebase-messaging-sw] showNotification preparing
  platform: 'android_browser'
  messageId: 'abc123...'
  title: 'New message'
```

## Diagnostic Function

A new Cloud Function endpoint is available to get comprehensive device diagnostics:

### Using the Firebase Console or SDK:

```javascript
import { getFunctionsClient } from '$lib/firebase';
import { httpsCallable } from 'firebase/functions';

const functions = getFunctionsClient();
const getPushDeviceDiagnostics = httpsCallable(functions, 'getPushDeviceDiagnostics');

const result = await getPushDeviceDiagnostics();
console.log(result.data);
```

### Returns:

```json
{
  "uid": "user123",
  "totalDevices": 3,
  "devices": [
    {
      "deviceId": "android-device-1",
      "platform": "android_browser",
      "permission": "granted",
      "enabled": true,
      "hasToken": true,
      "tokenPrefix": "abc123def456...",
      "hasSubscription": false,
      "lastSeen": "2025-01-05T12:00:00.000Z",
      "filterReasons": {
        "noTokenOrSubscription": false,
        "permissionDenied": false,
        "permissionDefault": false,
        "disabled": false,
        "willReceivePush": true
      }
    },
    ...
  ]
}
```

## Troubleshooting Steps

### 1. Check Browser Console

Look for `[push-client]` prefixed messages on the client side:

```javascript
// In your browser console, filter by: [push-client]
[push-client] enablePushForUser: calling getToken
[push-client] enablePushForUser: getToken complete
```

If you see "getToken complete" with `hasToken: false`, the token retrieval failed.

### 2. Call Diagnostic Endpoint

Use the `getPushDeviceDiagnostics()` function to see:
- Total devices registered for the user
- Token status for each device
- Permission status
- Why devices might be filtered out

### 3. Check Firebase Cloud Functions Logs

In Firebase Console → Functions → Logs:

```
[push] sendPushToTokens invoked
  totalTokens: 1
  fcmTokens: 1
  platforms: ['android_browser']
```

If `fcmTokens: 0` when you expected Android devices, look for "Device filtered out" messages.

### 4. Common Issues & Solutions

#### Issue: `hasToken: false` in browser console
**Causes:**
- Service Worker not registered
- Firebase not initialized
- Browser is blocking token request
- FCM VAPID key not configured

**Solution:**
- Check `PUBLIC_FCM_VAPID_KEY` in `.env.local`
- Verify service worker registration: open DevTools → Application → Service Workers
- Check for `navigator.serviceWorker.controller` in console

#### Issue: `Device filtered out` with `noTokenOrSubscription: true`
**Causes:**
- Token retrieval failed on client
- Token was never persisted to Firestore

**Solution:**
- Check browser console for `[push-client]` errors
- Verify permission is "granted"
- Manually test service worker with: `navigator.serviceWorker.ready.then(sw => console.log(sw))`

#### Issue: `permissionDenied: true` or `permission: 'denied'`
**Causes:**
- User explicitly denied notifications
- Permission was revoked in browser settings

**Solution:**
- On Android: Settings → App Permissions → Notifications → Enable
- On Chrome: Click lock icon → Reset Notification permissions

#### Issue: FCM delivery failed with error code `messaging/invalid-registration-token`
**Causes:**
- Token expired or was revoked
- Token format is invalid

**Solution:**
- Force token refresh: Clear localStorage key `hconnect_device_id`
- Reload page to re-register device

## Monitoring Notifications

### Test Push:
1. Open hConnect settings
2. Click "Send Test Notification"
3. Check browser console for delivery logs

### Check Function Logs:
```
Firebase Console → Functions → Logs → search for "FCM"
```

Look for patterns like:
```
[push] sendPushToTokens invoked: fcmTokens: 1
[push] FCM multicast result: successCount: 1, failureCount: 0
```

## Platform-Specific Considerations

### Android Chrome (android_browser)
- Uses FCM exclusively
- Requires Notification API permission
- Token should be non-empty string

### Android PWA (android_pwa)
- Uses FCM exclusively
- Installed via "Add to Home Screen"
- Should have `isStandalone: true` in device doc

### iOS Safari PWA (ios_pwa)
- Uses Web Push API (not FCM)
- Requires Safari subscription
- Should have `hasSubscription: true` in device doc

### Desktop Chrome (web_chrome)
- Uses FCM
- Similar requirements to Android Chrome

## Debug Configuration

Enable extra verbose logging by checking device doc with:

```javascript
// In Firebase Console → Firestore
profiles/{uid}/devices/{deviceId}
```

Verify these fields:
- `platform`: Should match detected platform (e.g., 'android_browser')
- `permission`: Should be 'granted'
- `enabled`: Should be true or missing
- `token`: Should be non-empty string for FCM platforms
- `lastSeen`: Recent timestamp indicates device is active

## Log Query Examples

### Firebase Cloud Functions Logs:

```
resource.type="cloud_function"
severity="INFO"
textPayload=~"push.*sendPushToTokens"
```

```
resource.type="cloud_function"
severity="WARN"
textPayload=~"Device filtered out"
```

```
resource.type="cloud_function"
severity="WARNING"
textPayload=~"FCM.*failed"
```
