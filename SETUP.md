# 🗣️ hConnect - Community Chat for Healthspaces-Purple

A modern, real-time Discord-style chat application built with **SvelteKit**, **TypeScript**, **Tailwind CSS**, and **Firebase**.

![hConnect](https://img.shields.io/badge/hConnect-v1.0.0-teal?style=flat-square)
![SvelteKit](https://img.shields.io/badge/SvelteKit-5.x-FF3E00?style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-12.x-FFA500?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square)

## 🌟 Features

- **Real-time Messaging** - Instant message delivery with Cloud Firestore
- **Multi-Server Architecture** - Create and manage multiple communities
- **Channels** - Organize conversations in text and voice channels
- **Members Management** - See who's online with role-based access control
- **Authentication** - Email/password sign-up and login with persistent sessions
- **Responsive Design** - Works seamlessly on mobile (320px) to desktop
- **Role-Based Access** - Owner, Admin, and Member roles with permissions
- **Modern UI** - Clean, accessible interface with Boxicons and Tailwind CSS

## 🏗️ Architecture

### Tech Stack

**Frontend:**
- SvelteKit 2.x - Modern reactive framework
- TypeScript 5.x - Type-safe development
- Tailwind CSS 3.x - Utility-first styling
- Boxicons - Beautiful icon library

**Backend & Services:**
- Firebase Authentication - Secure user management
- Cloud Firestore - Real-time database
- Firebase Storage - File uploads (ready for expansion)

### Data Model

```
servers/
  ├── {serverId}
  │   ├── channels/
  │   │   └── {channelId}/
  │   │       └── messages/{messageId}
  │   └── memberships/{userId}

users/{userId}
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ (check with `node --version`)
- **pnpm** (install with `npm install -g pnpm`)
- Firebase project with Firestore, Authentication enabled

### 1. Install Dependencies

```bash
cd c:\Users\veihl\Desktop\Coding\hConnect
pnpm install
```

### 2. Configure Firebase

Create `.env.local` in the project root (or update existing):

```env
PUBLIC_FIREBASE_API_KEY=your_api_key
PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
PUBLIC_FIREBASE_PROJECT_ID=your_project_id
PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
PUBLIC_FIREBASE_APP_ID=your_app_id
```

Get these values from:
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Project Settings → General → Your apps
4. Click the Web app (or create one)
5. Copy the config values

### 3. Set Up Firebase Security Rules

In Firebase Console → Firestore Database → Rules, apply these:

```rules
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }

    // Servers: owners can manage, members can read
    match /servers/{serverId} {
      allow read: if exists(/databases/$(database)/documents/servers/$(serverId)/memberships/$(request.auth.uid));
      allow write: if get(/databases/$(database)/documents/servers/$(serverId)).data.ownerId == request.auth.uid;

      // Channels: members can read and write
      match /channels/{channelId} {
        allow read, write: if exists(/databases/$(database)/documents/servers/$(serverId)/memberships/$(request.auth.uid));

        // Messages: members can CRUD
        match /messages/{messageId} {
          allow create: if exists(/databases/$(database)/documents/servers/$(serverId)/memberships/$(request.auth.uid));
          allow read: if exists(/databases/$(database)/documents/servers/$(serverId)/memberships/$(request.auth.uid));
          allow update, delete: if get(/databases/$(database)/documents/servers/$(serverId)/channels/$(channelId)/messages/$(messageId)).data.userId == request.auth.uid;
        }
      }

      // Memberships: server owner manages
      match /memberships/{memberId} {
        allow read: if get(/databases/$(database)/documents/servers/$(serverId)).data.ownerId == request.auth.uid;
        allow write: if get(/databases/$(database)/documents/servers/$(serverId)).data.ownerId == request.auth.uid;
      }
    }
  }
}
```

### 4. Enable Email/Password Authentication

1. Firebase Console → Authentication → Sign-in method
2. Enable **Email/Password** provider
3. Click Save

### 5. Run Development Server

```bash
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

You should see the login page. Sign up or sign in to get started! 🎉

### 6. (Optional) Seed Initial Data

Once authenticated, you can run the seed script to create a sample server:

```bash
pnpm run seed
```

This creates:
- ✅ "Healthspaces-Purple" server
- ✅ 5 default channels (general, announcements, introductions, random, voice-lounge)
- ✅ Owner membership

## 📁 Project Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── app/
│   │   │   ├── ServerSidebar.svelte    # Server list
│   │   │   ├── ChannelSidebar.svelte   # Channel list
│   │   │   ├── ChannelHeader.svelte    # Channel title & actions
│   │   │   ├── MessageList.svelte      # Messages with formatting
│   │   │   ├── ChatInput.svelte        # Message input
│   │   │   └── MembersPane.svelte      # Online/offline members
│   │   ├── auth/
│   │   │   └── LoginForm.svelte        # Sign in / Sign up
│   │   └── modals/
│   │       ├── CreateServerModal.svelte
│   │       └── CreateChannelModal.svelte
│   ├── firebase/
│   │   └── index.ts                    # Firebase init & config
│   ├── stores/
│   │   └── index.ts                    # Svelte reactive stores
│   ├── firestore.ts                    # All Firestore CRUD operations
│   ├── types.ts                        # TypeScript interfaces
│   └── app.css                         # Global styles & animations
├── routes/
│   ├── +layout.svelte                  # Main chat layout
│   ├── +page.svelte                    # Chat page
│   ├── about/+page.svelte              # About page with dog animation
│   └── (auth)/
│       ├── +layout.svelte              # Auth layout
│       └── login/+page.svelte          # Login page
├── app.html                            # HTML entry point
└── app.d.ts                            # TypeScript declarations
```

## 🎨 UI/UX Design

### Design Goals Met

✅ **Tailwind Plus sidebar layout** - Left server sidebar with icons  
✅ **Material Design feel** - Rounded corners, smooth transitions  
✅ **White/gray sidebar** - Dark gray (#374151) with hover effects  
✅ **Smooth animations** - Svelte transitions on open/close  
✅ **Mobile responsive** - Sidebar overlays on <768px, persistent on desktop  
✅ **Accessibility** - Focus rings, ARIA labels, keyboard support  

### Responsive Breakpoints

- **Mobile** (320px-639px): Overlay sidebar, full-width chat
- **Tablet** (640px-1023px): Channel sidebar visible, no members pane
- **Desktop** (1024px+): Full three-pane layout with members

## 🔐 Authentication Flow

1. User signs up/in with email and password
2. Firebase Auth creates a user and returns auth token
3. User profile is created in Firestore `/users/{uid}`
4. Auth state persists using IndexedDB (with fallback to session)
5. Auth token is automatically sent with Firestore requests

## 💬 Real-Time Messaging

1. Message is sent via `sendMessage()` function
2. Firestore auto-generates document ID
3. `watchChannelMessages()` listener updates store
4. All subscribed users see message immediately
5. Messages grouped by date with timestamps

## 🛡️ Security Considerations

- ✅ Firebase Rules enforce authentication checks
- ✅ Server owners can manage memberships
- ✅ Users can only edit/delete their own messages
- ✅ No direct client-side permission granting
- ✅ Email verification recommended for production

## 🐛 Troubleshooting

### "Firebase config not found"
→ Check `.env.local` exists and has all PUBLIC_FIREBASE_* variables

### "User profile not found"
→ Wait a moment for Firestore to sync after sign-up

### "Messages not loading"
→ Check Firestore Rules are deployed correctly
→ Verify user is a member of the server

### "Real-time updates not working"
→ Check browser console for Firestore errors
→ Verify Firestore Rules allow your user to read

## 📝 Scripts

```bash
# Development
pnpm run dev          # Start dev server on :5173

# Building
pnpm run build        # Build for production
pnpm run preview      # Preview production build

# Code Quality
pnpm run check        # TypeScript check + Svelte check
pnpm run lint         # Run ESLint & Prettier
pnpm run format       # Format code with Prettier

# Data
pnpm run seed         # Create sample server & channels
```

## 🎯 Next Steps / Future Features

- [ ] Voice/video chat integration (WebRTC)
- [ ] File upload & sharing
- [ ] Direct messages (DMs)
- [ ] Message reactions & threading
- [ ] User profiles & avatars
- [ ] Server invitations
- [ ] Message search
- [ ] Dark/light theme toggle
- [ ] Notifications & @mentions
- [ ] Typing indicators
- [ ] Emoji picker

## 📄 License

MIT License - Feel free to use this for your Healthspaces-Purple community!

## 🙋 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Firestore Rules
3. Check browser console for errors
4. Verify Firebase config in `.env.local`

---

**Built with ❤️ for Healthspaces-Purple Community**

*hConnect v1.0.0 • SvelteKit • Firebase • Tailwind CSS*
