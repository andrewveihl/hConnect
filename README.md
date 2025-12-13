# 🗣️ hConnect - Community Chat Platform

A modern, real-time **Discord-style chat application** built for **Healthspaces-Purple** using SvelteKit, TypeScript, Tailwind CSS, and Firebase.

## ✨ Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure Firebase (see SETUP.md)
# Create .env.local with your Firebase config

# 3. Start development server
pnpm run dev

# 4. Open http://localhost:5173 and sign up!
```

See **[SETUP.md](SETUP.md)** for detailed setup instructions.

## 🌟 Key Features

- ✅ **Real-time Messaging** - Instant updates with Cloud Firestore
- ✅ **Multi-Server Architecture** - Create multiple communities
- ✅ **Text & Voice Channels** - Organize conversations by topic
- ✅ **Member Management** - See who's online, role-based access control
- ✅ **Authentication** - Email/password sign-up and login
- ✅ **Responsive UI** - Works on mobile (320px) to desktop (1920px+)
- ✅ **Modern Design** - Tailwind CSS with smooth animations
- ✅ **Accessibility** - Keyboard navigation, ARIA labels, focus rings

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | SvelteKit 2.x, TypeScript 5.x, Tailwind CSS 3.x |
| **UI** | Boxicons, Svelte Stores, Transitions |
| **Backend** | Firebase Auth, Cloud Firestore, Cloud Storage |
| **Deployment** | Firebase Hosting, SvelteKit Adapter (Node/Static) |

## 📁 Project Layout

```
src/
├── lib/
│   ├── components/
│   │   ├── app/              # Main UI components
│   │   ├── auth/             # Login/signup forms
│   │   └── modals/           # Server/channel creation
│   ├── firebase/             # Firebase initialization
│   ├── firestore.ts          # Database operations
│   ├── stores/               # Reactive state (servers, messages, etc.)
│   ├── types.ts              # TypeScript interfaces
│   └── app.css               # Global styles + animations
├── routes/
│   ├── +layout.svelte        # Main app layout
│   ├── +page.svelte          # Chat page
│   ├── about/+page.svelte    # About page with animation
│   └── (auth)/               # Auth routes (login, signup)
└── app.html                  # HTML entry point
```

## 🎨 UI Components

### Layout Components
- **ServerSidebar** - List of servers with quick navigation
- **ChannelSidebar** - Channels organized by server
- **ChannelHeader** - Channel title, topic, and action buttons
- **MessageList** - Messages grouped by date with timestamps
- **ChatInput** - Multiline input with send button
- **MembersPane** - Online/offline members with role badges

### Modal Components
- **CreateServerModal** - Create new server
- **CreateChannelModal** - Create new channel
- **Settings** - Server and channel settings

## 🔐 Authentication

Uses Firebase Authentication with email/password:

```typescript
// Sign up
await signUp(email, password, displayName);

// Sign in
await signIn(email, password);

// Sign out
await signOut();
```

Auth state persists via IndexedDB with fallback to session storage.

## 💬 Messaging

Send and receive real-time messages:

```typescript
// Send message
const msg = await sendMessage(serverId, channelId, content);

// Watch channel messages
watchChannelMessages(serverId, channelId, (messages) => {
  // messages updated in real-time
});
```

## 📊 Data Model

**Servers** - Communities with multiple channels
**Channels** - Topics within a server (text or voice)
**Messages** - User-posted content with timestamps
**Memberships** - User roles (owner, admin, member)
**Users** - User profiles with email and display name

```
/servers/{serverId}
  /channels/{channelId}
    /messages/{messageId}
  /memberships/{userId}

/users/{userId}
```

## 🚀 Development Workflow

```bash
# Install dependencies
pnpm install

# Start dev server (hot reload)
pnpm run dev

# Type checking
pnpm run check

# Format & lint
pnpm run format
pnpm run lint

# Build for production
pnpm run build
pnpm run preview

# Create sample data
pnpm run seed
```

## 📱 Responsive Design

- **Mobile (320px-639px)** - Sidebar overlays, full-width chat
- **Tablet (640px-1023px)** - Channel sidebar visible, no members pane
- **Desktop (1024px+)** - Full three-pane layout

Mobile sidebar includes smooth slide-in animation with dark overlay.

## ♿ Accessibility

- ✅ Semantic HTML structure
- ✅ ARIA labels on interactive elements
- ✅ Focus rings (Tailwind `ring-*` utilities)
- ✅ Keyboard navigation (Tab, Enter, Escape)
- ✅ Color contrast meets WCAG AA
- ✅ Focus trap in modals
- ✅ Screen reader support

## 🐛 Troubleshooting

**"Firebase config not found"**
→ Ensure `.env.local` has all `PUBLIC_FIREBASE_*` variables

**"Sign-up fails with permission denied"**
→ Check Firestore Rules are correctly deployed (see SETUP.md)

**"Messages not showing"**
→ Verify you're a member of the server
→ Check browser console for Firestore errors

**"Real-time updates not working"**
→ Check Firestore Rules allow read/write
→ Verify network connectivity

See **[SETUP.md](SETUP.md)** for detailed troubleshooting.

## 📋 Requirements Met

✅ SvelteKit + TypeScript + Tailwind CSS (no inline styles)
✅ Firebase Authentication & Firestore
✅ Real-time messaging with Cloud Firestore listeners
✅ Role-based access control (owner, admin, member)
✅ Responsive from 320px to desktop
✅ No TypeScript errors
✅ No SSR crashes (browser-only code in `onMount`)
✅ Smooth UI with Tailwind transitions
✅ Keyboard support and ARIA labels
✅ About page with dog animation in app.css
✅ Seed script for initial data
✅ Clear setup and run instructions

## 🎯 Future Enhancements

- [ ] Direct messages (DMs)
- [ ] Voice/video chat (WebRTC)
- [ ] File uploads & sharing
- [ ] Message reactions
- [ ] Typing indicators
- [ ] User presence (away, do not disturb)
- [ ] Message search
- [ ] Server invitations
- [ ] Admin console
- [ ] Notifications & @mentions

## 📄 License

MIT - Build your community with hConnect!

---

**hConnect v1.0.0** • Built for **Healthspaces-Purple**  
*SvelteKit • Firebase • Tailwind CSS*


```
# Firebase client config
PUBLIC_FIREBASE_API_KEY=
PUBLIC_FIREBASE_AUTH_DOMAIN=
PUBLIC_FIREBASE_PROJECT_ID=
PUBLIC_FIREBASE_APP_ID=
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
PUBLIC_FIREBASE_STORAGE_BUCKET=
PUBLIC_FIREBASE_STORAGE_BUCKET_URL=           # optional gs:// bucket URL

# Push notifications (FCM Web Push key)
PUBLIC_FCM_VAPID_KEY=                         # primary VAPID key
PUBLIC_FCM_VAPID_KEY_FCM=                     # optional alt key from Firebase console

# Media (optional TURN for voice/video)
PUBLIC_TURN_URLS=turn:turn.example.com:3478   # comma/space separated URLs
PUBLIC_TURN_USERNAME=
PUBLIC_TURN_CREDENTIAL=
PUBLIC_ENABLE_TURN_FALLBACK=true

# Optional integrations
PUBLIC_TENOR_API_KEY=                         # Tenor GIF search
OPENAI_API_KEY=                               # AI assistants (reply, autocomplete, rewrites, summaries)
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1

# Utility API / jobs (server.js)
ARCHIVE_THREADS_TOKEN=                        # bearer token required for POST /api/archiveThreads
CORS_ALLOWED_ORIGINS=http://localhost:5173    # comma-separated list
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' # for server-side Firestore access
```

If you skip optional keys, related features stay hidden or fall back gracefully (e.g., AI helpers and GIF search disappear without their keys).

## Scripts
- `pnpm dev` – start the SvelteKit dev server.
- `pnpm build` – production build.
- `pnpm preview` – preview the production build locally.
- `pnpm lint` – prettier + eslint.
- `pnpm check` – svelte-check with TypeScript.
- `pnpm start` – run the Express utility API (for AI proxy + thread archival job).

## Deployment notes
- UI (SvelteKit): run `pnpm build` and deploy the static/server output to your host (Firebase Hosting works well). Make sure the PUBLIC_* env vars are provided at runtime so Firebase Auth/Storage/FCM work in the browser.
- Utility API (`server.js`): optional Express service for AI proxy + thread archival. Containerize or deploy to Cloud Run/Firebase Functions, and set `OPENAI_*`, `ARCHIVE_THREADS_TOKEN`, `CORS_ALLOWED_ORIGINS`, and `FIREBASE_SERVICE_ACCOUNT_JSON` so it can call OpenAI and Firestore.

### Local development reminder
- Add your dev origins (e.g., `http://localhost:5173`, `http://127.0.0.1:5173`, and any LAN IP you use) to Firebase Authentication → Authorized domains, otherwise sign-in will be blocked.
