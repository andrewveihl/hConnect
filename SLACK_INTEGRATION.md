# Slack Integration for hConnect

This document describes the Slack integration scaffolding that has been added to hConnect.

## Overview

The Slack integration allows bridging Slack channels with hConnect channels, enabling message sync between the two platforms.

## Files Created/Modified

### New Files

1. **`functions/src/slack.ts`** - Cloud Functions for Slack integration
   - `slackWebhook` - Receives incoming Slack Events API webhooks
   - `slackOAuth` - Handles OAuth callback for Slack app installation
   - Message transformation from Slack → hConnect format
   - Signature verification for security

2. **`src/lib/components/integrations/SlackSettingsPanel.svelte`** - UI component
   - Enable/disable Slack integration toggle
   - Connected workspaces management
   - Channel bridging configuration
   - Sync direction selection (one-way or bidirectional)

### Pre-existing Files (Already in codebase)

3. **`src/lib/admin/integrations/slack/types.ts`** - Type definitions
   - `SlackWorkspace` - Workspace connection info
   - `SlackChannelBridge` - Channel link configuration
   - `SlackIntegrationConfig` - Global settings
   - `SlackIncomingMessage`, `SlackFile`, `SlackUser` - Slack data types

4. **`src/lib/admin/integrations/slack/store.ts`** - Svelte stores
   - Real-time subscriptions to Firestore
   - CRUD operations for workspaces and bridges
   - Config management functions

### Modified Files

5. **`functions/src/index.ts`** - Added exports for Slack functions
6. **`src/lib/components/servers/ServerSettingsPanel.svelte`** - Added Slack card to integrations tab

## Setup Required

### 1. Create Slack App

1. Go to [Slack API](https://api.slack.com/apps) → Create New App
2. Choose "From scratch"
3. Configure OAuth Scopes (Bot Token Scopes):
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `users:read`
   - `team:read`
   - `files:read`

### 2. Set Environment Variables

**Firebase Functions (via Firebase CLI):**
```bash
firebase functions:secrets:set SLACK_SIGNING_SECRET
```

**Frontend (.env):**
```
VITE_SLACK_CLIENT_ID=your_client_id
VITE_SLACK_REDIRECT_URI=https://us-central1-hconnect-6212b.cloudfunctions.net/slackOAuth
```

### 3. Configure Slack App

1. **Event Subscriptions:**
   - Enable Events
   - Request URL: `https://us-central1-hconnect-6212b.cloudfunctions.net/slackWebhook`
   - Subscribe to bot events: `message.channels`

2. **OAuth & Permissions:**
   - Add Redirect URL: `https://us-central1-hconnect-6212b.cloudfunctions.net/slackOAuth`

### 4. Deploy Functions

```bash
cd functions
pnpm build
firebase deploy --only functions:slackWebhook,functions:slackOAuth
```

## Data Flow

### Slack → hConnect (Inbound)

```
Slack Channel Message
        ↓
Slack Events API webhook
        ↓
slackWebhook Cloud Function
        ↓
Find active bridge for channel
        ↓
Transform message format
        ↓
Write to Firestore:
  servers/{serverId}/channels/{channelId}/messages/{messageId}
```

### Message Format Transformation

Slack messages are converted to hConnect format with:
- `uid`: `slack:{slackUserId}` (special prefix for Slack users)
- `isSlackMessage: true` flag
- `slackMeta` object with original Slack data
- Markdown conversion (Slack → hConnect format)

## Firestore Collections

```
integrations/slack                    # Global config
integrations/slack/workspaces/{id}    # Connected Slack workspaces
integrations/slack/bridges/{id}       # Channel bridges
```

## Future Enhancements

1. **hConnect → Slack (Outbound sync)** - Currently one-way only
2. **Thread sync** - Map Slack threads to hConnect threads
3. **Reaction sync** - Sync emoji reactions
4. **File attachments** - Proxy Slack files through Storage
5. **User identity mapping** - Link Slack users to hConnect accounts
6. **Slack channel picker** - Fetch channels via API instead of manual ID entry

## Estimated Additional Work

| Feature | Estimate |
|---------|----------|
| Complete OAuth flow | 4-6 hours |
| Bidirectional sync | 8-12 hours |
| Slack channel picker API | 4-6 hours |
| User identity mapping | 6-8 hours |
| File attachment proxy | 4-6 hours |
| Thread sync | 8-12 hours |

## Testing

1. Install Slack app to a test workspace
2. Create a channel bridge in hConnect settings
3. Send a message in the linked Slack channel
4. Verify message appears in hConnect channel

## Troubleshooting

**Messages not syncing:**
- Check Cloud Functions logs for errors
- Verify Slack signing secret is correct
- Ensure bridge status is "active"
- Check sync direction allows inbound

**OAuth not working:**
- Verify redirect URI matches exactly
- Check SLACK_CLIENT_ID and SLACK_CLIENT_SECRET
