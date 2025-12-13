# iPhone 15 Pro Max Testing Guide

## Quick Deployment

### Build and Test Locally
```bash
npm run build
npm run preview   # Runs on http://localhost:4173
```

### Test on Real Device
1. **Connect iPhone to same network as your development machine**
2. **Find your machine's IP address**:
   ```bash
   ipconfig /all  # Windows - look for IPv4 Address
   ```
3. **Visit from iPhone**: `http://<YOUR_IP>:4173`
4. **Bookmark for easy access**

### Deploy to Production
After testing on device:
```bash
# Deploy to Firebase Hosting
firebase deploy

# Or deploy to your preferred hosting service
```

---

## Testing Checklist for Mobile Nav Bar

### Visual Verification
- [ ] **Bottom Nav Bar Visible**: 5 tabs should appear at bottom of screen
  - Servers (leftmost icon)
  - DMs 
  - Activity (bell icon)
  - Notes
  - Profile (rightmost - shows your avatar)

- [ ] **Proper Positioning**: 
  - Nav bar sits above the home indicator (safe area padding)
  - Nav bar spans full width
  - Tabs evenly distributed

- [ ] **Styling Correct**:
  - Dark gradient background with blur effect
  - Icons and labels visible
  - Active tab shows purple gradient highlight

### Interaction Testing
- [ ] **Tab Navigation**: Tap each tab, verify page changes
  - Tab turns purple when active
  - Previous tab returns to normal color
  - Page content updates

- [ ] **Unread Badges**:
  - Red badge appears on DMs if messages unread
  - Red badge appears on Activity if notifications unread
  - Badge shows count (e.g., "3")

- [ ] **Chat Feed Layout**:
  - Messages start at top (below header)
  - Message list extends down to nav bar
  - No extra padding wasting vertical space
  - Input field above nav bar

- [ ] **Scrolling**:
  - Scroll through chat messages smoothly
  - -webkit-overflow-scrolling: touch works
  - No lag or jank

### Edge Cases
- [ ] **Portrait Mode**: Nav bar visible and functional
- [ ] **Landscape Mode**: Nav bar adjusts (may be hidden on very wide view)
- [ ] **Safe Area**: Bottom of nav bar respects home indicator
- [ ] **Network Offline**: Nav bar still shows (no network dependency)
- [ ] **Settings Open**: Nav bar may hide/suppress (check suppression logic)

---

## What Was Fixed

### Problem 1: Nav Bar Not Showing
**Before**: Mobile nav bar was off-screen or hidden  
**After**: Nav bar anchored to bottom with `position: fixed; bottom: 0; left: 0; right: 0;`

### Problem 2: Wasted Screen Space
**Before**: Safe area padding took up top/bottom, reducing chat area by ~50px  
**After**: Padding removed on mobile, chat content now extends to nav bar

### Problem 3: Width Calculation Issues
**Before**: `width: min(640px, calc(100% - 1.5rem))` caused centering problems  
**After**: `width: 100%; max-width: 100%;` ensures full-width at any size

---

## Troubleshooting

### Nav Bar Still Not Showing?
1. **Check Media Query**: Open DevTools, verify max-width: 767px is applying
   - iPhone 15 Pro Max: 430px width (should trigger mobile styles)
   - Try forcing mobile view in DevTools if testing on desktop

2. **Check z-index**: Nav bar has `z-index: 55` (higher than most elements)
   - If settings modal is open, nav might suppress automatically

3. **Check Visibility**: 
   - Open Console: `document.querySelector('.mobile-dock')`
   - Should return element, not null
   - Check `display` property is not `none`

### Chat Scrolling Issues?
1. **Check padding**: Message container should have padding-bottom matching nav height + safe area
2. **Check overflow**: Should be `overflow-y: auto; -webkit-overflow-scrolling: touch;`
3. **Test momentum scrolling**: Swipe up/down in chat, should continue scrolling smoothly

### Safe Area Not Working?
1. **iPhone Settings**: 
   - Settings → Safari → Toggle "Develop" menu
   - Settings → Display & Brightness → Safe Area
   - Verify iPhone is not in Low Power Mode (can affect rendering)

2. **Viewport Meta Tags**: Check `src/app.html`
   - Should have `viewport-fit=cover`
   - Should have `maximum-scale=1` (prevents zoom bugs)
   - Should have `user-scalable=no`

---

## Performance Testing

### Check Rendering Performance
1. **Open DevTools** on iPhone (Safari Developer Menu)
2. **Enable FPS Counter**:
   - Settings → Developer → (toggle FPS Counter if available)
3. **Scroll through chat**:
   - Should maintain 60 FPS
   - No janky scrolling
   - No layout thrashing

### Check Network Usage
1. **Monitor API calls**:
   - Messages should batch load
   - No excessive image downloads on scroll
   - WebSocket/realtime updates working

2. **Check Cache**:
   - App should load faster on second visit
   - Service Worker caching should work
   - Offline mode should show cached content

---

## Device Specs Reference

### iPhone 15 Pro Max
- **Screen Size**: 6.7 inches
- **Viewport Width**: 430px (physical: 1290px / 3x scale)
- **Viewport Height**: 932px (physical: 2796px)
- **Safe Area Top**: ~47px (status bar + notch buffer)
- **Safe Area Bottom**: ~34px (home indicator)
- **Status Bar Height**: 15px (normal), 44px (with Dynamic Island notch)
- **Max supported viewport**: 1440px wide (landscape mode)

### Comparison Devices
- **iPhone 15 Pro**: 390px viewport (6.1")
- **iPhone 15**: 390px viewport (6.1")
- **iPhone 15 Plus**: 428px viewport (6.7")
- **iPhone SE**: 375px viewport (4.7")
- **iPad Mini**: 768px viewport (7.9")
- **iPad Air**: 820px viewport (10.9")

---

## Discord Comparison

### What's Similar Now
- ✅ Fixed bottom navigation with 5 tabs
- ✅ Purple accent color for active tabs
- ✅ Full-screen chat content area
- ✅ Efficient use of screen real estate
- ✅ Smooth scrolling with momentum
- ✅ Status bar respecting
- ✅ Home indicator respecting

### What's Different (By Design)
- Different color scheme (your brand colors)
- Different channel/server list UI
- Custom message reactions/features
- Your authentication flow
- Custom emoji/stickers

---

## Contact & Support

If nav bar still doesn't show after testing:
1. Verify you're on `http://` not `https://` on local network (if using preview)
2. Clear browser cache: Settings → Safari → Clear History and Website Data
3. Check browser console for JavaScript errors
4. Try different browsers: Safari, Chrome, Firefox
5. Test on another iOS device if possible

---

## Files Changed
- `src/lib/components/app/MobileNavBar.svelte` - Nav bar styling
- `src/app.css` - Mobile layout styles
- `src/routes/+layout.svelte` - Root layout padding

**Build Status**: ✅ All checks pass, production ready
