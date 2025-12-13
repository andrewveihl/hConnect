# iOS Mobile Testing Quick Guide

## 🚀 Quick Start Testing

### Step 1: Build & Preview
```bash
cd "c:\Users\veihl\Desktop\Coding\hConnect"
npm run build
npm run preview
```

The app will be available at: **http://localhost:4173**

### Step 2: Test on iPhone/iPad

#### Option A: Simulator (Mac with Xcode)
```bash
# In simulator browser, visit:
http://localhost:4173

# Or if on different machine:
http://<your-computer-ip>:4173
```

#### Option B: Real Device (Same WiFi)
```bash
# Find your computer's IP
ipconfig

# On iPhone Safari, visit:
http://192.168.1.XXX:4173
```

#### Option C: Remote Debug (Safari DevTools)
1. Enable on iPhone: Settings → Safari → Advanced → Web Inspector
2. On Mac: Safari → Develop → [Your Device] → [hConnect]
3. Inspect and debug in real-time

## ✅ Testing Checklist

### Visual Tests
- [ ] **Notch Space**: Content doesn't overlap notch on iPhone 14 Pro
- [ ] **Home Indicator**: Bottom nav respects safe area above home button
- [ ] **Full Screen**: Content fills entire viewport (no wasted space)
- [ ] **Bottom Nav**: 5 tabs visible and clickable (Servers, DMs, Activity, Notes, Profile)
- [ ] **Colors**: Same Discord-like theme on mobile
- [ ] **Text**: All text readable (no tiny fonts)
- [ ] **Images**: Properly scaled on small screens
- [ ] **Buttons**: At least 44x44px touch target

### Responsive Tests
- [ ] **Portrait (390px)**: iPhone 14 layout works
- [ ] **Portrait (375px)**: iPhone SE layout works
- [ ] **Landscape (844px)**: iPhone rotated works
- [ ] **iPad (810px)**: Tablet layout works (bottom nav shows)
- [ ] **iPad (1024px+)**: Desktop layout works (bottom nav hides)

### Interaction Tests
- [ ] **Tap Bottom Nav**: All 5 tabs respond to taps
- [ ] **Scroll Content**: Smooth scrolling in messages
- [ ] **Swipe Right**: Opens navigation (if implemented)
- [ ] **Swipe Left**: Closes overlays (if implemented)
- [ ] **Keyboard**: Login form doesn't zoom on focus
- [ ] **Modals**: Close button works and respects safe areas

### Performance Tests
- [ ] **Load Time**: First paint < 2 seconds
- [ ] **Interactive**: App interactive < 4 seconds
- [ ] **Scrolling**: 60fps smooth animations
- [ ] **Memory**: No memory leaks (Chrome DevTools)
- [ ] **Battery**: Doesn't drain battery excessively

### Navigation Tests
- [ ] **Login Flow**: Sign in/up works on mobile
- [ ] **Server Navigation**: Can switch between servers
- [ ] **Message Loading**: Messages load and display properly
- [ ] **DM List**: DMs appear in bottom nav
- [ ] **Back Button**: Hardware back button works (Android)
- [ ] **Link Navigation**: Internal links work

### Edge Cases
- [ ] **Slow Network**: Works on 3G (use Chrome DevTools throttling)
- [ ] **Offline**: Shows appropriate offline message
- [ ] **Screen Lock**: Content preserved after lock/unlock
- [ ] **App Background**: State preserved when switching apps
- [ ] **Orientation Change**: Rotates and adjusts layout properly
- [ ] **Keyboard Open**: Content scrolls above keyboard

## 📊 Device Testing Matrix

### iPhone Models to Test
```
Priority 1 (Most Common):
- iPhone 14 Pro (6.1", 390px, notch)
- iPhone 14 (6.1", 390px, notch)
- iPhone 14 Plus (6.7", 430px, notch)
- iPhone SE (4.7", 375px, no notch)

Priority 2 (Still Used):
- iPhone 13 (6.1", 390px)
- iPhone 12 (6.1", 390px)
- iPhone 11 (6.1", 414px)
```

### iPad Models to Test
```
- iPad Pro 12.9" (1024px+)
- iPad Air (820px)
- iPad Mini (768px)
```

### Android to Verify
```
- Samsung Galaxy S22 (360px)
- Google Pixel 6 (412px)
- Samsung Galaxy Tab (600px+)
```

## 🔧 DevTools Debugging

### Chrome DevTools (Remote Debugging Android)
```bash
# Connect Android via USB
# Open Chrome DevTools (F12)
# Go to chrome://inspect

# For iPhone:
# Use Safari Develop menu (Mac only)
# Settings → Safari → Advanced → Web Inspector
```

### Console Commands
```javascript
// Check safe areas
getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')

// Check viewport
window.innerWidth   // Current width
window.innerHeight  // Current height

// Check touch support
navigator.maxTouchPoints > 1  // Should be true

// Simulate slow network
// DevTools → Network tab → Throttling dropdown
```

## 🎬 Screen Recording

### Record on iPhone
1. Control Center → Screen Recording (or Settings → Control Center)
2. Tap to start recording
3. Record your testing flow
4. Stop and save video

### Record on Mac
```bash
xcrun simctl io booted recordVideo ~/Desktop/test.mov
```

## 📱 Test Scenarios

### Scenario 1: New User Flow
1. Open app in Safari
2. See login screen
3. Sign up with test account
4. Accept permissions
5. See empty server list
6. Verify bottom nav works

### Scenario 2: Server Navigation
1. Create or join a server
2. See server in bottom nav / sidebar
3. Click through channels
4. Verify messages load
5. Send a test message
6. Message appears instantly

### Scenario 3: Mobile-Specific
1. Open on iPhone
2. Verify notch space respected
3. Verify home indicator safe area
4. Test swipe gestures
5. Rotate device (landscape)
6. Content adjusts properly

### Scenario 4: Network Issues
1. Open DevTools (mobile Chrome)
2. Throttle to "Slow 3G"
3. Load messages
4. Should still be usable
5. Return to normal network
6. Verify sync works

## 🐛 Debugging Tips

### Issue: Content Hidden Behind Notch
**Check**: CSS has safe area padding
```css
padding-top: env(safe-area-inset-top);
```

### Issue: Bottom Nav Not Showing
**Check**: 
- Viewport < 768px?
- `mobileDockSuppressed` is false?
- CSS media query active?

### Issue: Swipe Not Working
**Check**:
- Real device (not simulator)?
- Long enough swipe (40px+)?
- Fast enough (< 600ms)?

### Issue: Text Too Large
**Check**:
- `font-size` >= 16px on inputs?
- iOS zoom prevention enabled?

### Issue: Scrolling Janky
**Check**:
- `-webkit-overflow-scrolling: touch` enabled?
- No heavy JavaScript in scroll handler?
- GPU acceleration enabled?

## 📈 Performance Metrics

### Target Metrics (Google Lighthouse)
```
Performance:  > 90
Accessibility: > 95
Best Practices: > 95
SEO: 100
```

### Speed Insights
- **First Contentful Paint (FCP)**: < 1.8s
- **Largest Contentful Paint (LCP)**: < 2.5s
- **Cumulative Layout Shift (CLS)**: < 0.1
- **Time to Interactive (TTI)**: < 3.8s

### Check With Lighthouse
```bash
# Open Chrome DevTools
# Lighthouse tab
# Select "Mobile"
# Run audit
```

## 🚫 Common Mistakes to Avoid

1. ❌ Using `hover` for mobile (no hover on touch)
2. ❌ Small touch targets (< 44x44px)
3. ❌ Not testing on real device
4. ❌ Assuming one device = all devices
5. ❌ Ignoring safe areas (notch/home indicator)
6. ❌ Using viewport width for responsive design (check vw units)
7. ❌ Heavy animations on mobile
8. ❌ Not throttling network when testing

## ✅ Final Sign-Off Checklist

Before deploying:

- [ ] npm run check (0 errors)
- [ ] npm run build (success)
- [ ] npm run preview (launches)
- [ ] iPhone 12/14 tested ✅
- [ ] iPad tested ✅
- [ ] Android tested ✅
- [ ] Landscape orientation works ✅
- [ ] Bottom nav visible and working ✅
- [ ] Safe areas respected ✅
- [ ] Swipe gestures working ✅
- [ ] Lighthouse > 90 ✅
- [ ] User feedback positive ✅

---

**Ready to Deploy!** 🚀
