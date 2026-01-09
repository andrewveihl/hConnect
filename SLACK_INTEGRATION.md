# Slack Integration for hConnect

This document describes the Slack integration for hConnect.

## Overview

The Slack integration allows bridging Slack channels with hConnect channels, enabling bidirectional message sync between the two platforms.

**Key Feature:** Each hConnect server can have its own Slack app configured. Users set up their own Slack apps and enter credentials through the UI - no Firebase secrets required.

## Architecture

### Per-Server Configuration

Each hConnect server has its own:
- Slack app credentials (Client ID, Client Secret, Signing Secret)
- Connected workspaces
- Channel bridges

Data is stored at:
```
servers/{serverId}/integrations/slack           # Config with credentials
servers/{serverId}/integrations/slack/workspaces/{id}  # Connected workspaces
servers/{serverId}/integrations/slack/bridges/{id}     # Channel bridges
```

## Files

### Cloud Functions (`functions/src/slack.ts`)
- `slackWebhook` - Receives incoming Slack Events API webhooks
- `slackOAuth` - Handles OAuth callback for Slack app installation
- Message transformation both directions
- Signature verification using per-server signing secrets

### Frontend Components
- `src/lib/components/integrations/SlackSettingsPanel.svelte` - UI for setup
- `src/lib/admin/integrations/slack/types.ts` - Type definitions
- `src/lib/admin/integrations/slack/store.ts` - Svelte stores for per-server data

## Setup Guide (Per-Server)

### Step 1: Create a Slack App

1. Go to [Slack API](https://api.slack.com/apps) → Create New App
2. Choose "From scratch"
3. Name it something like "hConnect - [Your Server Name]"
4. Select your Slack workspace

### Step 2: Configure OAuth Scopes

Go to **OAuth & Permissions** and add these Bot Token Scopes:
- `channels:history` - Read messages
- `channels:read` - List channels
- `chat:write` - Post messages
- `groups:history` - Read private channel messages
- `groups:read` - List private channels
- `users:read` - Get user info
- `team:read` - Get workspace info
- `files:read` - Access shared files

### Step 3: Configure Redirect URI

In **OAuth & Permissions** → Redirect URLs, add:
```
https://us-central1-hconnect-6212b.cloudfunctions.net/slackOAuth
```

### Step 4: Configure Event Subscriptions

1. Go to **Event Subscriptions** → Enable Events
2. Set Request URL to:
```
https://us-central1-hconnect-6212b.cloudfunctions.net/slackWebhook
```
3. Subscribe to bot events: `message.channels`, `message.groups`

### Step 5: Get Credentials

From your Slack app settings, collect:
- **Client ID** - Found in Basic Information
- **Client Secret** - Found in Basic Information
- **Signing Secret** - Found in Basic Information

### Step 6: Enter Credentials in hConnect

1. Go to Server Settings → Integrations → Slack
2. Enter your Client ID, Client Secret, and Signing Secret
3. Click "Save Credentials"
4. Click "Connect Slack Workspace" to authorize

## Data Flow

### Slack → hConnect (Inbound)

```
Slack Channel Message
        ↓
Slack Events API webhook
        ↓
slackWebhook Cloud Function
        ↓
Find server by team ID
        ↓
Verify signature with server's signing secret
        ↓
Find active bridge for channel
        ↓
Transform message format
        ↓
Write to Firestore:
  servers/{serverId}/channels/{channelId}/messages/{messageId}
```

### hConnect → Slack (Outbound)

```
hConnect Message Created
        ↓
Firestore trigger in index.ts
        ↓
syncHConnectMessageToSlack function
        ↓
Find active bridges for channel
        ↓
Get workspace bot token
        ↓
Post to Slack channel via chat.postMessage API
```

### Message Format Transformation

Slack messages are converted to hConnect format with:
- `uid`: `slack:{slackUserId}` (special prefix for Slack users)
- `isSlackMessage: true` flag
- `slackMeta` object with original Slack data
- Markdown conversion (Slack → hConnect format)

## Firestore Structure

```
servers/{serverId}/integrations/slack
├── credentials: { clientId, clientSecret, signingSecret }
├── enabled: boolean
├── workspaces/{workspaceId}
│   ├── teamId
│   ├── teamName
│   ├── accessToken
│   └── botAccessToken
└── bridges/{bridgeId}
    ├── slackWorkspaceId
    ├── slackChannelId
    ├── hconnectChannelId
    ├── syncDirection: 'bidirectional' | 'slack-to-hconnect' | 'hconnect-to-slack'
    └── status: 'active' | 'paused' | 'error'
```

## Deploying Functions

```bash
cd functions
pnpm build
firebase deploy --only functions:slackWebhook,functions:slackOAuth
```

## Future Enhancements

| Feature | Estimate | Status |
|---------|----------|--------|
| Complete OAuth flow | 4-6 hours | ✅ Done |
| Bidirectional sync | 8-12 hours | ✅ Done |
| Per-server credentials | 4-6 hours | ✅ Done |
| Slack channel picker API | 4-6 hours | ⏳ Pending |
| User identity mapping | 6-8 hours | ⏳ Pending |
| File attachment proxy | 4-6 hours | ⏳ Pending |
| Thread sync | 8-12 hours | ⏳ Pending |

## Testing

1. Create a Slack app following the setup guide above
2. Enter credentials in hConnect Server Settings → Integrations → Slack
3. Connect your Slack workspace via OAuth
4. Create a channel bridge linking a Slack channel to an hConnect channel
5. Send messages in both directions to verify sync

## Troubleshooting

**Messages not syncing:**
- Check Cloud Functions logs for errors
- Verify signing secret is correctly entered
- Ensure bridge status is "active"
- Check sync direction allows the desired direction

**OAuth not working:**
- Verify redirect URI matches exactly in Slack app settings
- Check that Client ID and Client Secret are correct
- Ensure the serverId is being passed in the OAuth state

**"No server configured" error:**
- Make sure credentials are saved before connecting workspace
- The workspace must be connected after credentials are set
