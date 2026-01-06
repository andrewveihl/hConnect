# Android Push Notification Quick Debugging Checklist

## Immediate Steps

### 1. Open Browser DevTools on Android Device
```
Chrome: Press F12 or Menu → More Tools → Developer Tools
```

### 2. Check Console for Push Logs
Filter by `[push-client]` to see client-side push registration:

```
✓ Look for: [push-client] enablePushForUser: calling getToken
✓ Look for: [push-client] enablePushForUser: getToken complete
✗ Missing: Token retrieval never started
✗ Incomplete: Shows calling but no complete
```

### 3. Verify Permission Status
In console, run:
```javascript
console.log('Notification permission:', Notification.permission);
console.log('SW ready:', navigator.serviceWorker.ready);
navigator.serviceWorker.ready.then(sw => {
  console.log('SW registration:', sw);
  console.log('Controller:', navigator.serviceWorker.controller);
});
```

Expected output:
```
Notification permission: granted
SW ready: Promise { ServiceWorkerRegistration }
SW registration: ServiceWorkerRegistration { ... }
Controller: ServiceWorker { ... }
```

### 4. Check Local Storage
```javascript
// Device ID should be stored
localStorage.getItem('hconnect_device_id')
// Should output: "uuid-or-dev-timestamp"
```

### 5. Check Service Worker Status
DevTools → Application → Service Workers
- Should see `/firebase-messaging-sw.js` as "Active and running"
- Check "Update on reload" is enabled for testing

## Server-Side Diagnostics

### 6. Call Diagnostic Function
```javascript
// In browser console on hConnect
const { getFunctionsClient } = await import('./lib/firebase');
const { httpsCallable } = await import('firebase/functions');

const functions = getFunctionsClient();
const getDiagnostics = httpsCallable(functions, 'getPushDeviceDiagnostics');
const result = await getDiagnostics();
console.log(JSON.stringify(result.data, null, 2));
```

Look for:
```json
{
  "devices": [
    {
      "platform": "android_browser",
      "permission": "granted",
      "hasToken": true,
      "enabled": true,
      "filterReasons": {
        "willReceivePush": true
      }
    }
  ]
}
```

### 7. Send Test Notification
In hConnect settings, click "Send Test Notification" and check logs:

**Client logs should show:**
```
[push-client] enablePushForUser: getToken complete { hasToken: true }
[firebase-messaging-sw] onBackgroundMessage received { ... }
[firebase-messaging-sw] showNotification succeeded { ... }
```

**Firebase function logs should show:**
```
[push] sendPushToTokens invoked
  fcmTokens: 1
  safariSubscriptions: 0

[push] FCM multicast result
  successCount: 1
  failureCount: 0
```

## Troubleshooting by Symptom

### Symptom: No logs appear at all

**Check:**
1. Is service worker registered? `navigator.serviceWorker.controller`
2. Is Firebase initialized? Open DevTools → Network tab, look for Firebase SDK loads
3. Are you logged in? Check `auth()` 

**Solution:**
- Reload page (Ctrl+Shift+R for hard refresh)
- Clear localStorage: `localStorage.clear()`
- Check network for 404s on Firebase SDK files

---

### Symptom: Token is null (hasToken: false)

**Check Firebase logs:**
```
[fetchDeviceTokens] Device filtered out: noTokenOrSubscription: true
```

**Solutions:**
1. Verify VAPID key in .env.local: `PUBLIC_FCM_VAPID_KEY`
2. Check service worker registration:
   ```javascript
   navigator.serviceWorker.getRegistrations()
     .then(regs => console.log('SW registrations:', regs.length))
   ```
3. Verify permission is granted:
   ```javascript
   Notification.permission // Should be 'granted'
   ```

---

### Symptom: Permission is "denied"

**Check:**
- Chrome Settings → Privacy → Notifications → Check hConnect domain
- On Android: Settings → Apps → Chrome → Permissions → Notifications

**Solution:**
- Reset notification permission:
  ```javascript
  // Open DevTools, click lock icon next to URL
  // Select "Reset Notifications"
  ```
- Or access through Android Settings:
  1. Settings → Apps → Chrome
  2. Permissions → Notifications
  3. Toggle ON

---

### Symptom: Device is filtered out (willReceivePush: false)

**Check diagnostic output for filter reason:**

If `enabled: false`:
- Device was manually disabled by user
- Solution: Enable push again in settings

If `permission: "denied"`:
- User rejected notifications
- Solution: Reset browser notification permission (see above)

If `noTokenOrSubscription: true`:
- Token was never obtained
- Solution: Check console logs for token retrieval errors

---

### Symptom: FCM delivery failed

**Check error code:**

`messaging/invalid-registration-token`:
- Token is expired or invalid
- Solution: Force refresh by clearing device ID:
  ```javascript
  localStorage.removeItem('hconnect_device_id')
  location.reload()
  ```

`messaging/mismatched-credential`:
- Wrong FCM credentials
- Solution: Verify Firebase project ID and messaging sender ID in .env.local

`messaging/authentication-error`:
- Invalid FCM credentials
- Solution: Regenerate and update Firebase config

---

## Platform-Specific Tests

### Test on Different Android Browsers

**Chrome:**
```
1. Open hConnect
2. Wait for push registration log
3. Verify Notification.permission === 'granted'
4. Send test notification
```

**Firefox Android:**
```
1. About:home → Menu → Settings → Web Notifications
2. Same steps as Chrome
```

**Samsung Internet:**
```
1. Settings → Notifications → Manage Notifications
2. Ensure hConnect allowed
3. Same test steps
```

**In PWA (Add to Home Screen):**
```
1. Chrome Menu → "Install app"
2. Check platform: should show "android_pwa"
3. Same notification flow
```

---

## Files to Check

### Client-Side (Browser)
```
src/lib/notify/push.ts        - Main push registration logic
src/lib/notify/testPush.ts    - Test push trigger
static/firebase-messaging-sw.js - Service Worker
```

### Server-Side (Functions)
```
functions/src/notifications.ts - Push sending logic
functions/src/settings.ts      - Device token filtering
functions/src/index.ts         - getPushDeviceDiagnostics endpoint
```

---

## Logs to Review

### Firebase Cloud Functions Logs
```
Firebase Console
→ Functions
→ Select region (us-central1)
→ View logs for:
  - sendTestPush
  - sendServerMessage
  - sendDmMessage
```

Filter for:
```
[push] sendPushToTokens
[push] FCM multicast result
[fetchDeviceTokens] Device filtered out
```

### Browser Console Logs
```
[push-client] - Client-side push registration
[firebase-messaging-sw] - Service Worker background messages
```

---

## Success Indicators

✅ All checks passing:
1. `Notification.permission === 'granted'`
2. `navigator.serviceWorker.controller` exists
3. Token retrieval shows `hasToken: true`
4. Device doc shows `willReceivePush: true`
5. Test notification shows `[firebase-messaging-sw] showNotification succeeded`
6. FCM logs show `successCount: 1, failureCount: 0`

---

## Need Help?

If none of the above resolves the issue:

1. **Share browser console output** (filtered by `[push-client]`)
2. **Share Firebase function logs** (filtered by `[push]`)
3. **Share diagnostic output** from `getPushDeviceDiagnostics()`
4. **Specify Android version** and browser being used
5. **Device model** (Pixel, Samsung, etc.)

This information will help identify if the issue is:
- Token retrieval (client side)
- Device filtering (backend)
- Push delivery (FCM)
- Notification display (service worker)
