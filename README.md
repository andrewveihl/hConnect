# hConnect

hConnect is a Discord/Guilded-style real-time communication app built with SvelteKit and Firebase. It provides servers with channels and threads, DMs, voice/video calls, push notifications, and optional AI-powered writing helpers.

## Features
- Servers with text channels, threads, mentions, uploads (Firebase Storage), polls/forms, and GIF search (Tenor).
- Direct messages and personal notes with message previews, attachments, and AI reply/autocomplete when enabled.
- Voice and video rooms over WebRTC with TURN fallback, screen sharing, and presence/activity indicators.
- Push notifications, per-user notification preferences, domain or link-based invites, and responsive mobile UI with docked controls.
- Admin console at `/admin` for users, servers, channels, logs, feature flags, and archives.
- Optional AI helpers for replies, rewrites, autocomplete, and thread summaries via OpenAI.

## Stack
- SvelteKit + TypeScript + Tailwind.
- Firebase Authentication, Firestore, Storage, and Cloud Messaging.
- WebRTC for voice/video; TURN for NAT traversal.
- Express utility service (`server.js`) for AI proxying and thread archival jobs (Cloud Run/Firebase Function friendly).

## Getting Started
1. Install Node.js 18+ and [pnpm](https://pnpm.io/).
2. Create a Firebase project: enable Authentication (Google/Apple if you want those flows), Firestore, Storage, and Cloud Messaging (generate a Web Push certificate for the VAPID key).
3. Create `.env` in the project root using the template below.
4. Install dependencies: `pnpm install`.
5. Run the SvelteKit app: `pnpm dev -- --open`.
6. Optional: run the utility API locally (AI proxy + archive job): `pnpm start`.

## Environment
Create `.env` with the values your Firebase project and integrations provide:

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
