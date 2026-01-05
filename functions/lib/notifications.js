"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTestPushForUid = sendTestPushForUid;
exports.handleServerMessage = handleServerMessage;
exports.handleThreadMessage = handleThreadMessage;
exports.handleDmMessage = handleDmMessage;
const url_1 = require("url");
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-admin/firestore");
const web_push_1 = __importDefault(require("web-push"));
const firebase_1 = require("./firebase");
const email_1 = require("./email");
const settings_1 = require("./settings");
const SPECIAL_MENTION_IDS = {
    EVERYONE: 'special:mention:everyone',
    HERE: 'special:mention:here'
};
const MENTION_PRIORITY = {
    dm: 6,
    direct: 5,
    role: 4,
    here: 3,
    everyone: 2,
    channel: 1 // lowest priority - channel member notifications
};
let functionsConfig = {};
;
try {
    functionsConfig = (0, firebase_functions_1.config)();
}
catch (err) {
    firebase_functions_1.logger.warn('firebase config unavailable', err);
}
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? functionsConfig.vapid?.subject ?? 'mailto:support@hconnect.app';
const VAPID_PUBLIC_KEY = process.env.PUBLIC_FCM_VAPID_KEY ?? process.env.VAPID_PUBLIC_KEY ?? functionsConfig.vapid?.public_key ?? '';
const VAPID_PRIVATE_KEY = process.env.FCM_VAPID_PRIVATE_KEY ??
    process.env.VAPID_PRIVATE_KEY ??
    functionsConfig.vapid?.private_key ??
    '';
const APP_BASE_URL = process.env.APP_BASE_URL ??
    functionsConfig.app?.base_url ??
    'https://hconnect-6212b.web.app';
const WEB_PUSH_AVAILABLE = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (WEB_PUSH_AVAILABLE) {
    try {
        web_push_1.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    }
    catch (err) {
        firebase_functions_1.logger.error('Failed to configure web push VAPID details', err);
    }
}
else {
    firebase_functions_1.logger.warn('Web push disabled (missing VAPID keys)');
}
class ServerMemberCache {
    constructor(serverId) {
        this.serverId = serverId;
        this.cache = new Map();
        this.fullyLoaded = false;
    }
    async get(uid) {
        if (this.cache.has(uid))
            return this.cache.get(uid);
        try {
            const snap = await firebase_1.db.doc(`servers/${this.serverId}/members/${uid}`).get();
            if (!snap.exists)
                return null;
            const payload = snap.data();
            const member = { ...payload, uid };
            this.cache.set(uid, member);
            return member;
        }
        catch (err) {
            firebase_functions_1.logger.warn('Failed to load member', { serverId: this.serverId, uid, err });
            return null;
        }
    }
    async getAll() {
        if (this.fullyLoaded) {
            return Array.from(this.cache.values());
        }
        try {
            const snap = await firebase_1.db.collection(`servers/${this.serverId}/members`).get();
            snap.forEach((docSnap) => {
                const payload = docSnap.data();
                this.cache.set(docSnap.id, { ...payload, uid: docSnap.id });
            });
            this.fullyLoaded = true;
        }
        catch (err) {
            firebase_functions_1.logger.error('Failed to list server members', { serverId: this.serverId, err });
        }
        return Array.from(this.cache.values());
    }
}
const mentionLabel = (type, roleName) => {
    switch (type) {
        case 'dm':
            return '[DM]';
        case 'direct':
            return '[mention]';
        case 'role':
            return roleName ? `[@${roleName}]` : '[@role]';
        case 'here':
            return '[here]';
        case 'everyone':
            return '[everyone]';
        case 'channel':
            return ''; // No prefix for regular channel messages
        default:
            return '';
    }
};
function normalizeUid(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}
function normalizeUidList(values) {
    if (!Array.isArray(values))
        return [];
    const set = new Set();
    for (const value of values) {
        const uid = normalizeUid(value);
        if (uid)
            set.add(uid);
    }
    return Array.from(set);
}
function normalizeUidMap(mapLike) {
    if (!mapLike || typeof mapLike !== 'object')
        return [];
    const set = new Set();
    const entries = Object.entries(mapLike);
    for (const [key, value] of entries) {
        if (!value)
            continue;
        const uid = normalizeUid(key);
        if (uid)
            set.add(uid);
    }
    return Array.from(set);
}
function resolveDmParticipants(dm) {
    if (!dm)
        return [];
    const sources = [
        normalizeUidList(dm.participants),
        normalizeUidList(dm.participantUids),
        normalizeUidMap(dm.participantsMap),
        typeof dm.key === 'string' ? normalizeUidList(dm.key.split('_')) : []
    ];
    for (const list of sources) {
        if (list.length)
            return list;
    }
    return [];
}
function extractMentions(message) {
    if (Array.isArray(message?.mentions) && message.mentions.length) {
        return message.mentions;
    }
    if (message?.mentionsMap && typeof message.mentionsMap === 'object') {
        return Object.keys(message.mentionsMap).map((key) => ({
            uid: key,
            ...(message.mentionsMap?.[key] ?? {})
        }));
    }
    return [];
}
function previewFromMessage(message) {
    if (message.plainTextContent)
        return truncate(message.plainTextContent, 120);
    if (message.text)
        return truncate(message.text, 120);
    if (message.content)
        return truncate(message.content, 120);
    switch (message.type) {
        case 'gif':
            return 'Shared a GIF';
        case 'file':
            return 'Shared a file';
        case 'form':
            return 'Shared a form';
        case 'poll':
            return 'Shared a poll';
        default:
            return 'New message';
    }
}
function truncate(text, max = 120) {
    if (!text)
        return 'New message';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max)
        return cleaned;
    return `${cleaned.slice(0, max - 1)}…`;
}
function toMillis(value) {
    try {
        if (!value)
            return Date.now();
        if (typeof value === 'number')
            return value;
        if (value instanceof Date)
            return value.getTime();
        if (typeof value?.toMillis === 'function')
            return value.toMillis();
        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : Date.now();
        }
    }
    catch {
        return Date.now();
    }
    return Date.now();
}
function toTimestamp(value) {
    if (value instanceof firestore_1.Timestamp)
        return value;
    if (value && typeof value.toMillis === 'function') {
        return firestore_1.Timestamp.fromMillis(value.toMillis());
    }
    const millis = toMillis(value);
    return firestore_1.Timestamp.fromMillis(millis);
}
function buildDeepLink(context) {
    if (context.dmId) {
        const params = new url_1.URLSearchParams({ origin: 'push' });
        if (context.messageId)
            params.set('messageId', context.messageId);
        return `/dms/${context.dmId}?${params.toString()}`;
    }
    if (context.serverId && context.channelId) {
        const params = new url_1.URLSearchParams({ origin: 'push', channel: context.channelId });
        if (context.threadId)
            params.set('thread', context.threadId);
        if (context.messageId)
            params.set('messageId', context.messageId);
        return `/servers/${context.serverId}?${params.toString()}`;
    }
    return '/?origin=push';
}
function absoluteUrl(path) {
    try {
        return new URL(path, APP_BASE_URL).toString();
    }
    catch (err) {
        firebase_functions_1.logger.warn('[notify] Failed to build absolute URL', { path, err });
        const base = APP_BASE_URL.endsWith('/') ? APP_BASE_URL.slice(0, -1) : APP_BASE_URL;
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${base}${normalizedPath}`;
    }
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function describeTitle(context) {
    if (context.dmId) {
        return 'Direct message';
    }
    const serverName = context.server?.name ?? 'Server';
    const channelName = context.channel?.name ? `#${context.channel.name}` : '#channel';
    if (context.threadId) {
        const threadName = context.thread?.name ?? 'Thread';
        return `[${serverName}] ${channelName} • ${threadName}`;
    }
    return `[${serverName}] ${channelName}`;
}
function describeDmTitle(dm, sender) {
    const participants = Array.isArray(dm?.participants) ? dm?.participants.length : 0;
    if (participants && participants > 2) {
        const name = dm?.name || dm?.title || 'Group DM';
        return `${sender} in ${name}`;
    }
    return sender;
}
function pickAuthorName(message) {
    return (message.displayName ||
        message.author?.displayName ||
        message.authorId ||
        message.uid ||
        'Someone');
}
function pickMentionUids(mentions, kind) {
    return mentions
        .filter((entry) => {
        if (!kind)
            return entry.kind !== 'special' && entry.kind !== 'role';
        return entry.kind === kind;
    })
        .map((entry) => normalizeUid(entry.uid))
        .filter((uid) => Boolean(uid));
}
function hasSpecialMention(mentions, id) {
    return mentions.some((entry) => entry.uid === id || entry.handle === id);
}
/**
 * Check if a member has access to a channel.
 * - Public channels (no allowedRoleIds): all members have access
 * - Private channels: member must have at least one role in allowedRoleIds
 */
function memberHasChannelAccess(member, channelAllowedRoleIds, defaultRoleId) {
    // If no allowedRoleIds, channel is public - all members have access
    if (!channelAllowedRoleIds || channelAllowedRoleIds.length === 0) {
        return true;
    }
    // Get member's roles (including default role)
    const memberRoles = new Set(Array.isArray(member.roleIds) ? member.roleIds : []);
    if (defaultRoleId) {
        memberRoles.add(defaultRoleId);
    }
    // Check if member has any of the allowed roles
    return channelAllowedRoleIds.some((roleId) => memberRoles.has(roleId));
}
async function computeServerCandidates(options) {
    const { message, serverId, channelId, authorId, memberCache, channelAllowedRoleIds, defaultRoleId } = options;
    const mentionList = extractMentions(message);
    const directMentionUids = pickMentionUids(mentionList);
    const roleMentionIds = pickMentionUids(mentionList, 'role');
    const includeEveryone = hasSpecialMention(mentionList, SPECIAL_MENTION_IDS.EVERYONE);
    const includeHere = hasSpecialMention(mentionList, SPECIAL_MENTION_IDS.HERE);
    const candidateMap = new Map();
    const addCandidate = (candidate) => {
        if (!candidate.uid || candidate.uid === authorId)
            return;
        const existing = candidateMap.get(candidate.uid);
        if (!existing || MENTION_PRIORITY[candidate.mentionType] > MENTION_PRIORITY[existing.mentionType]) {
            candidateMap.set(candidate.uid, candidate);
        }
    };
    // Get all members first - we'll need them for channel access check
    const allMembers = await memberCache.getAll();
    // Add direct mentions
    await Promise.all(directMentionUids.map(async (uid) => {
        const member = await memberCache.get(uid);
        if (!member)
            return;
        addCandidate({ uid, mentionType: 'direct' });
    }));
    // Add role mentions
    if (roleMentionIds.length) {
        for (const roleId of roleMentionIds) {
            for (const member of allMembers) {
                const roleIds = Array.isArray(member.roleIds) ? member.roleIds : [];
                if (roleIds.includes(roleId) && member.uid !== authorId) {
                    addCandidate({ uid: member.uid, mentionType: 'role', roleId });
                }
            }
        }
    }
    // Add @everyone and @here mentions
    if (includeEveryone || includeHere) {
        if (includeEveryone) {
            allMembers.forEach((member) => addCandidate({ uid: member.uid, mentionType: 'everyone', requirePresence: false }));
        }
        if (includeHere) {
            allMembers.forEach((member) => addCandidate({ uid: member.uid, mentionType: 'here', requirePresence: true }));
        }
    }
    // ALWAYS add all channel members as 'channel' type candidates
    // This ensures everyone with channel access gets notified (lowest priority)
    for (const member of allMembers) {
        if (memberHasChannelAccess(member, channelAllowedRoleIds ?? null, defaultRoleId ?? null)) {
            addCandidate({ uid: member.uid, mentionType: 'channel' });
        }
    }
    return Array.from(candidateMap.values());
}
function presenceAllowsHere(presence) {
    const raw = (presence?.state || presence?.status || '').toLowerCase();
    if (!raw)
        return false;
    return raw === 'online' || raw === 'active' || raw === 'idle';
}
function respectsSettings(settings, candidate, opts) {
    if (settings.globalMute)
        return false;
    if (settings.doNotDisturbUntil && settings.doNotDisturbUntil > Date.now())
        return false;
    if (opts.isDM) {
        if (settings.muteDMs)
            return false;
        return true;
    }
    if (!opts.serverId || !opts.channelId)
        return false;
    if (settings.muteServerIds?.includes(opts.serverId))
        return false;
    if (settings.perChannelMute?.[(0, settings_1.perChannelKey)(opts.serverId, opts.channelId)])
        return false;
    if (opts.threadId && settings.allowThreadPush === false)
        return false;
    switch (candidate.mentionType) {
        case 'direct':
            return settings.allowMentionPush !== false;
        case 'role':
            if (!settings.allowMentionPush || settings.allowRoleMentionPush === false)
                return false;
            if (candidate.roleId) {
                if (settings.perRoleMute?.[(0, settings_1.perRoleKey)(opts.serverId, candidate.roleId)])
                    return false;
            }
            return true;
        case 'here':
            return settings.allowMentionPush && settings.allowHereMentionPush !== false;
        case 'everyone':
            return settings.allowMentionPush && settings.allowEveryoneMentionPush !== false;
        case 'channel':
            // Channel notifications - users can opt out with allowChannelMessagePush setting
            // If pushChannelMentionsOnly is enabled, skip plain channel messages (only allow mentions)
            if (settings.allowChannelMessagePush === false)
                return false;
            if (settings.pushChannelMentionsOnly)
                return false;
            return true;
        default:
            return true;
    }
}
function getFilterReason(settings, candidate, opts) {
    if (settings.globalMute)
        return 'globalMute';
    if (settings.doNotDisturbUntil && settings.doNotDisturbUntil > Date.now())
        return 'doNotDisturb';
    if (opts.isDM) {
        if (settings.muteDMs)
            return 'muteDMs';
        return null;
    }
    if (!opts.serverId || !opts.channelId)
        return 'missing_server_or_channel';
    if (settings.muteServerIds?.includes(opts.serverId))
        return 'server_muted';
    if (settings.perChannelMute?.[(0, settings_1.perChannelKey)(opts.serverId, opts.channelId)])
        return 'channel_muted';
    if (opts.threadId && settings.allowThreadPush === false)
        return 'threads_disabled';
    switch (candidate.mentionType) {
        case 'direct':
            if (settings.allowMentionPush === false)
                return 'mentions_disabled';
            return null;
        case 'role':
            if (!settings.allowMentionPush)
                return 'mentions_disabled';
            if (settings.allowRoleMentionPush === false)
                return 'role_mentions_disabled';
            if (candidate.roleId && settings.perRoleMute?.[(0, settings_1.perRoleKey)(opts.serverId, candidate.roleId)]) {
                return 'role_muted';
            }
            return null;
        case 'here':
            if (!settings.allowMentionPush)
                return 'mentions_disabled';
            if (settings.allowHereMentionPush === false)
                return 'here_mentions_disabled';
            return null;
        case 'everyone':
            if (!settings.allowMentionPush)
                return 'mentions_disabled';
            if (settings.allowEveryoneMentionPush === false)
                return 'everyone_mentions_disabled';
            return null;
        case 'channel':
            if (settings.allowChannelMessagePush === false)
                return 'channel_push_disabled';
            if (settings.pushChannelMentionsOnly)
                return 'channel_mentions_only';
            return null;
        default:
            return null;
    }
}
async function filterCandidates(candidates, opts) {
    const deliveries = [];
    const filtered = [];
    for (const candidate of candidates) {
        const settings = await (0, settings_1.fetchNotificationSettings)(candidate.uid);
        const filterReason = getFilterReason(settings, candidate, opts);
        // Special case: For 'channel' type candidates, don't filter out if user wants email for all channel messages
        // This allows users who have push disabled but email enabled to still get channel message emails
        if (filterReason) {
            const canStillReceiveEmail = candidate.mentionType === 'channel' &&
                settings.emailEnabled &&
                settings.emailForAllChannelMessages;
            if (!canStillReceiveEmail) {
                filtered.push({ uid: candidate.uid, reason: filterReason });
                continue;
            }
            // Log that we're keeping this candidate for email-only delivery
            firebase_functions_1.logger.info('[notify] Keeping channel candidate for email-only delivery', {
                uid: candidate.uid,
                filterReason,
                emailEnabled: settings.emailEnabled,
                emailForAllChannelMessages: settings.emailForAllChannelMessages
            });
        }
        if (!respectsSettings(settings, candidate, opts)) {
            // Same check for email-only users
            const canStillReceiveEmail = candidate.mentionType === 'channel' &&
                settings.emailEnabled &&
                settings.emailForAllChannelMessages;
            if (!canStillReceiveEmail) {
                filtered.push({ uid: candidate.uid, reason: 'unknown_settings_filter' });
                continue;
            }
        }
        if (candidate.requirePresence) {
            const presence = await (0, settings_1.fetchPresence)(candidate.uid);
            if (!presenceAllowsHere(presence)) {
                filtered.push({ uid: candidate.uid, reason: 'presence_not_active' });
                continue;
            }
        }
        deliveries.push({ ...candidate, settings });
    }
    if (filtered.length > 0) {
        firebase_functions_1.logger.info('[notify] Candidates filtered out', {
            filteredCount: filtered.length,
            filtered: filtered.slice(0, 10), // Limit to first 10 for log size
            opts
        });
    }
    return deliveries;
}
async function fetchRoleNames(serverId, roleIds) {
    const ids = Array.from(new Set(roleIds.filter((value) => Boolean(value))));
    if (!ids.length)
        return {};
    const entries = await Promise.all(ids.map(async (id) => {
        try {
            const snap = await firebase_1.db.doc(`servers/${serverId}/roles/${id}`).get();
            if (!snap.exists)
                return [id, 'role'];
            const data = snap.data();
            return [id, data?.name || 'role'];
        }
        catch {
            return [id, 'role'];
        }
    }));
    return Object.fromEntries(entries);
}
async function writeActivityEntry(uid, recipient, message, context, title, body, hasPush) {
    const ref = firebase_1.db.collection(`profiles/${uid}/activity`).doc();
    const preview = previewFromMessage(message);
    const authorName = pickAuthorName(message);
    const createdAt = message.createdAt ? toTimestamp(message.createdAt) : firestore_1.FieldValue.serverTimestamp();
    await ref.set({
        id: ref.id,
        type: recipient.mentionType === 'dm'
            ? 'dm'
            : recipient.mentionType === 'role'
                ? 'roleMention'
                : recipient.mentionType,
        mentionType: recipient.mentionType,
        context: {
            serverId: context.serverId ?? null,
            serverName: context.server?.name ?? null,
            channelId: context.channelId ?? null,
            channelName: context.channel?.name ?? null,
            threadId: context.threadId ?? null,
            threadName: context.thread?.name ?? null,
            dmId: context.dmId ?? null
        },
        messageInfo: {
            messageId: context.messageId,
            authorId: normalizeUid(message.authorId || message.uid),
            authorName,
            previewText: preview,
            createdAt
        },
        status: {
            unread: true,
            readAt: null,
            clicked: false
        },
        title,
        body,
        deepLink: buildDeepLink(context),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        lastNotifiedAt: firestore_1.FieldValue.serverTimestamp(),
        hasPush
    });
    return ref.id;
}
function describeLocation(context) {
    if (context.dmId)
        return 'Direct messages';
    const serverName = context.server?.name ?? 'Server';
    const channelName = context.channel?.name ? `#${context.channel.name}` : '#channel';
    if (context.threadId) {
        const threadName = context.thread?.name ?? 'Thread';
        return `${serverName} ${channelName} > ${threadName}`;
    }
    return `${serverName} ${channelName}`;
}
const recipientContactCache = new Map();
async function resolveRecipientContact(uid) {
    if (recipientContactCache.has(uid)) {
        return recipientContactCache.get(uid);
    }
    let email = null;
    let displayName = null;
    try {
        const snap = await firebase_1.db.doc(`profiles/${uid}`).get();
        if (snap.exists) {
            const data = snap.data();
            if (typeof data?.email === 'string' && data.email.trim()) {
                email = data.email.trim();
            }
            if (!displayName && typeof data?.displayName === 'string') {
                displayName = data.displayName;
            }
        }
    }
    catch (err) {
        firebase_functions_1.logger.warn('[notify] Failed to read profile for email fallback', { uid, err });
    }
    if (!email) {
        try {
            const userRecord = await firebase_1.auth.getUser(uid);
            if (userRecord.email)
                email = userRecord.email;
            if (!displayName && userRecord.displayName)
                displayName = userRecord.displayName;
        }
        catch (err) {
            firebase_functions_1.logger.warn('[notify] Failed to read auth record for email fallback', { uid, err });
        }
    }
    const contact = { email, displayName };
    recipientContactCache.set(uid, contact);
    return contact;
}
function shouldSendEmailForRecipient(recipient, hasLikelyReachablePush) {
    const settings = recipient.settings;
    if (!settings.emailEnabled)
        return { should: false, reason: 'email_disabled' };
    if (settings.emailOnlyWhenNoPush !== false && hasLikelyReachablePush) {
        return { should: false, reason: 'push_available' };
    }
    if (recipient.mentionType === 'dm') {
        if (settings.emailForDMs === false)
            return { should: false, reason: 'dm_email_disabled' };
    }
    else if (recipient.mentionType === 'channel') {
        // Check both the old setting and the new "all channel messages" setting
        if (!settings.emailForChannelMessages && !settings.emailForAllChannelMessages) {
            return { should: false, reason: 'channel_email_disabled' };
        }
        // If emailChannelMentionsOnly is enabled, skip emails for plain channel messages
        // (only allow direct mentions, role mentions, @here, @everyone - not 'channel' type)
        if (settings.emailChannelMentionsOnly) {
            return { should: false, reason: 'channel_mentions_only' };
        }
    }
    else {
        if (settings.emailForMentions === false)
            return { should: false, reason: 'mention_email_disabled' };
    }
    return { should: true };
}
function buildEmailCopy(params) {
    const location = describeLocation(params.context);
    const openUrl = absoluteUrl(params.deepLink);
    let subjectContext = `New message in ${location}`;
    let heading = `${params.authorName} sent a new message in ${location}.`;
    if (params.recipient.mentionType === 'dm') {
        subjectContext = `New direct message from ${params.authorName}`;
        heading = `${params.authorName} sent you a direct message.`;
    }
    else if (params.recipient.mentionType !== 'channel') {
        subjectContext = `You were mentioned in ${location}`;
        heading = `${params.authorName} mentioned you in ${location}.`;
    }
    const subject = `[hConnect] ${subjectContext}`;
    const bodyText = `${heading}\n\n${params.preview}\n\nOpen hConnect: ${openUrl}\n\nManage email alerts in Settings → Notifications.`;
    const logoUrl = 'https://hconnect-6212b.web.app/HS-LOGO.png';
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;max-width:600px;">
    <div style="margin-bottom:16px;">
      <img src="${logoUrl}" alt="hConnect" style="width:48px;height:48px;border-radius:8px;" />
    </div>
    <p>${escapeHtml(heading)}</p>
    <div style="margin:12px 0;padding:12px;border-radius:10px;background:#0f172a;color:#e2e8f0;">
      ${escapeHtml(params.preview)}
    </div>
    <p><a href="${openUrl}" style="color:#0ea5e9;text-decoration:none;font-weight:600;" target="_blank" rel="noopener noreferrer">Open hConnect</a></p>
    <p style="font-size:12px;color:#64748b;">You can change these emails in Settings → Notifications.</p>
  </div>`;
    return { subject, text: bodyText, html };
}
async function maybeSendEmailNotification(params) {
    // Log the decision inputs for debugging
    firebase_functions_1.logger.info('[notify] maybeSendEmailNotification checking', {
        recipientUid: params.recipient.uid,
        mentionType: params.recipient.mentionType,
        hasLikelyReachablePush: params.hasLikelyReachablePush,
        deviceTokenCount: params.deviceTokenCount,
        emailEnabled: params.recipient.settings.emailEnabled,
        emailOnlyWhenNoPush: params.recipient.settings.emailOnlyWhenNoPush,
        emailForDMs: params.recipient.settings.emailForDMs,
        emailForMentions: params.recipient.settings.emailForMentions
    });
    const decision = shouldSendEmailForRecipient(params.recipient, params.hasLikelyReachablePush);
    if (!decision.should) {
        firebase_functions_1.logger.info('[notify] Email skipped by shouldSendEmailForRecipient', {
            recipientUid: params.recipient.uid,
            reason: decision.reason
        });
        return { attempted: false, sent: false, reason: decision.reason };
    }
    // Skip sending email if the user appears active to avoid noisy duplicates
    const presence = await (0, settings_1.fetchPresence)(params.recipient.uid);
    const presenceState = (presence?.state || presence?.status || '').toLowerCase();
    if (presenceState === 'online' || presenceState === 'active') {
        firebase_functions_1.logger.info('[notify] Email skipped - recipient is active', {
            recipientUid: params.recipient.uid,
            presenceState
        });
        return { attempted: true, sent: false, reason: 'recipient_active' };
    }
    const contact = await resolveRecipientContact(params.recipient.uid);
    if (!contact.email) {
        firebase_functions_1.logger.info('[notify] Email skipped - no email address found', {
            recipientUid: params.recipient.uid
        });
        return { attempted: true, sent: false, reason: 'missing_email', to: null };
    }
    firebase_functions_1.logger.info('[notify] Proceeding to send email', {
        recipientUid: params.recipient.uid,
        to: contact.email,
        dmId: params.context.dmId
    });
    const deepLink = buildDeepLink(params.context);
    const copy = buildEmailCopy({
        recipient: params.recipient,
        context: params.context,
        authorName: params.authorName,
        preview: params.preview,
        deepLink
    });
    const result = await (0, email_1.sendEmail)({
        to: contact.email,
        subject: copy.subject,
        text: copy.text,
        html: copy.html,
        context: {
            type: params.context.dmId ? 'dm' : params.context.threadId ? 'thread' : 'channel',
            recipientUid: params.recipient.uid,
            messageId: params.context.messageId,
            serverId: params.context.serverId ?? undefined,
            channelId: params.context.channelId ?? undefined,
            dmId: params.context.dmId ?? undefined
        }
    });
    return {
        attempted: true,
        sent: result.sent,
        reason: result.reason,
        to: contact.email
    };
}
const APPLE_WEB_PUSH_PLATFORMS = new Set(['ios_browser', 'ios_pwa', 'web_safari']);
function hasLikelyReachablePush(deviceTokens) {
    return deviceTokens.some((token) => {
        const platform = (token.platform ?? '').toLowerCase();
        if (platform && APPLE_WEB_PUSH_PLATFORMS.has(platform))
            return false;
        return Boolean(token.token || token.subscription?.endpoint);
    });
}
function groupTokensByChannel(deviceTokens) {
    const safariSubscriptions = [];
    const fcmTokens = [];
    for (const record of deviceTokens) {
        const platform = (record.platform ?? '').toLowerCase();
        if (record.subscription?.endpoint && APPLE_WEB_PUSH_PLATFORMS.has(platform)) {
            safariSubscriptions.push(record.subscription);
        }
        else if (record.token) {
            fcmTokens.push(record.token);
        }
    }
    return { safariSubscriptions, fcmTokens };
}
async function sendPushToTokens(deviceTokens, payload) {
    if (!deviceTokens.length)
        return;
    const { safariSubscriptions, fcmTokens } = groupTokensByChannel(deviceTokens);
    const startedAt = Date.now();
    firebase_functions_1.logger.info('[push] sendPushToTokens invoked', {
        totalTokens: deviceTokens.length,
        safariSubscriptions: safariSubscriptions.length,
        fcmTokens: fcmTokens.length,
        dataKeys: Object.keys(payload.data ?? {}),
        messageId: payload.data?.messageId ?? null,
        targetUrl: payload.data?.targetUrl ?? null,
        platforms: deviceTokens.map((d) => d.platform ?? 'unknown')
    });
    const tasks = [];
    if (fcmTokens.length) {
        // Generate a unique collapse key for grouping similar notifications
        const collapseKey = payload.data?.dmId
            ? `dm-${payload.data.dmId}`
            : payload.data?.channelId
                ? `channel-${payload.data.serverId}-${payload.data.channelId}`
                : 'hconnect-message';
        // Send to FCM tokens with enhanced iOS/APNS configuration
        const fcmTask = firebase_1.messaging.sendEachForMulticast({
            tokens: fcmTokens,
            data: payload.data,
            notification: {
                title: payload.title,
                body: payload.body
            },
            // Android-specific configuration
            android: {
                priority: 'high',
                notification: {
                    title: payload.title,
                    body: payload.body,
                    priority: 'high',
                    defaultSound: true,
                    channelId: 'hconnect_messages'
                },
                collapseKey
            },
            // Web push configuration
            webpush: {
                headers: {
                    Urgency: 'high',
                    TTL: '86400' // 24 hours
                },
                fcmOptions: {
                    link: payload.data.targetUrl
                },
                notification: {
                    title: payload.title,
                    body: payload.body,
                    requireInteraction: true,
                    renotify: true,
                    tag: collapseKey
                }
            },
            // iOS/APNS configuration - CRITICAL for reliability
            apns: {
                headers: {
                    'apns-priority': '10', // Maximum priority - wakes device immediately
                    'apns-push-type': 'alert', // Alert type ensures notification is displayed
                    'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400), // 24 hour expiration
                    'apns-collapse-id': collapseKey.slice(0, 64) // iOS collapse ID max 64 chars
                },
                payload: {
                    aps: {
                        alert: {
                            title: payload.title,
                            body: payload.body
                        },
                        sound: 'default',
                        badge: 1,
                        'mutable-content': 1, // Allows notification service extension to modify
                        'content-available': 1, // Enables background processing
                        'interruption-level': 'time-sensitive' // iOS 15+ - breaks through Focus mode
                    },
                    // Custom data for the app
                    messageId: payload.data?.messageId ?? null,
                    targetUrl: payload.data?.targetUrl ?? null,
                    mentionType: payload.data?.mentionType ?? null,
                    serverId: payload.data?.serverId ?? null,
                    channelId: payload.data?.channelId ?? null,
                    dmId: payload.data?.dmId ?? null
                }
            }
        }).then((response) => {
            // Log detailed results for debugging
            const successCount = response.successCount;
            const failureCount = response.failureCount;
            firebase_functions_1.logger.info('[push] FCM multicast result', {
                successCount,
                failureCount,
                totalTokens: fcmTokens.length,
                messageId: payload.data?.messageId ?? null
            });
            // Log individual failures for debugging
            if (failureCount > 0) {
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        firebase_functions_1.logger.warn('[push] FCM token delivery failed', {
                            tokenIndex: idx,
                            tokenPreview: `${fcmTokens[idx]?.slice(0, 10)}...`,
                            errorCode: resp.error?.code,
                            errorMessage: resp.error?.message
                        });
                    }
                });
            }
            return response;
        });
        tasks.push(fcmTask);
    }
    if (safariSubscriptions.length) {
        if (!WEB_PUSH_AVAILABLE) {
            firebase_functions_1.logger.warn('Safari web push subscriptions present but VAPID keys missing', {
                count: safariSubscriptions.length
            });
        }
        else {
            // Enhanced Safari/iOS Web Push payload
            const safariPayload = JSON.stringify({
                notification: {
                    title: payload.title,
                    body: payload.body,
                    icon: '/Logo_transparent.png',
                    badge: '/Logo_transparent.png',
                    tag: payload.data?.dmId
                        ? `dm-${payload.data.dmId}`
                        : payload.data?.channelId
                            ? `channel-${payload.data.serverId}-${payload.data.channelId}`
                            : 'hconnect-message',
                    renotify: true,
                    requireInteraction: true,
                    silent: false
                },
                data: payload.data
            });
            safariSubscriptions.forEach((subscription) => {
                tasks.push(sendSafariWebPush(subscription, safariPayload));
            });
        }
    }
    try {
        await Promise.all(tasks);
        firebase_functions_1.logger.info('[push] sendPushToTokens completed', {
            totalTokens: deviceTokens.length,
            durationMs: Date.now() - startedAt,
            messageId: payload.data?.messageId ?? null
        });
    }
    catch (err) {
        firebase_functions_1.logger.error('Failed to send push payload', err);
    }
}
async function sendSafariWebPush(subscription, body) {
    if (!subscription?.endpoint) {
        firebase_functions_1.logger.warn('[push] Safari subscription missing endpoint');
        return;
    }
    if (!subscription.keys?.auth || !subscription.keys?.p256dh) {
        firebase_functions_1.logger.warn('[push] Safari web push subscription missing keys', {
            endpoint: subscription.endpoint.slice(0, 50) + '...',
            hasAuth: Boolean(subscription.keys?.auth),
            hasP256dh: Boolean(subscription.keys?.p256dh)
        });
        return;
    }
    try {
        firebase_functions_1.logger.info('[push] Sending Safari web push', {
            endpointPreview: subscription.endpoint.slice(0, 50) + '...'
        });
        // Use high urgency and long TTL for iOS reliability
        const pushOptions = {
            TTL: 86400, // 24 hours
            urgency: 'high',
            topic: 'app.hconnect.messages' // Optional: helps with iOS grouping
        };
        await web_push_1.default.sendNotification({
            endpoint: subscription.endpoint,
            keys: {
                auth: subscription.keys.auth,
                p256dh: subscription.keys.p256dh
            },
            expirationTime: subscription.expirationTime ?? null
        }, body, pushOptions);
        firebase_functions_1.logger.info('[push] Safari web push sent successfully', {
            endpointPreview: subscription.endpoint.slice(-20)
        });
    }
    catch (err) {
        const errorCode = err?.statusCode;
        firebase_functions_1.logger.error('[push] Safari web push send failed', {
            endpoint: subscription.endpoint.slice(-20),
            statusCode: errorCode,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        });
        // Status code 410 means the subscription is no longer valid
        if (errorCode === 410) {
            firebase_functions_1.logger.warn('[push] Safari subscription expired (410 Gone)', {
                endpoint: subscription.endpoint.slice(-20)
            });
        }
    }
}
async function deliverToRecipients(recipients, message, context) {
    const roleNames = context.roleNames ?? {};
    const authorName = pickAuthorName(message);
    const preview = previewFromMessage(message);
    firebase_functions_1.logger.info('[notify] deliverToRecipients', {
        recipientCount: recipients.length,
        messageId: context.messageId,
        serverId: context.serverId ?? null,
        channelId: context.channelId ?? null,
        dmId: context.dmId ?? null
    });
    await Promise.all(recipients.map(async (recipient) => {
        const deviceTokens = await (0, settings_1.fetchDeviceTokens)(recipient.uid);
        firebase_functions_1.logger.info('[notify] Processing recipient', {
            uid: recipient.uid,
            mentionType: recipient.mentionType,
            deviceTokenCount: deviceTokens.length,
            messageId: context.messageId
        });
        const title = context.dmId
            ? describeDmTitle(context.dm ?? null, authorName)
            : describeTitle(context);
        const roleName = recipient.roleId ? roleNames[recipient.roleId] : null;
        const label = mentionLabel(recipient.mentionType, roleName);
        const body = label ? `${label} ${authorName}: ${preview}` : `${authorName}: ${preview}`;
        const activityId = await writeActivityEntry(recipient.uid, recipient, message, context, title, body, deviceTokens.length > 0);
        const pushLikelyReachable = hasLikelyReachablePush(deviceTokens);
        const emailResult = await maybeSendEmailNotification({
            recipient,
            context,
            authorName,
            preview,
            deviceTokenCount: deviceTokens.length,
            hasLikelyReachablePush: pushLikelyReachable
        });
        if (emailResult.attempted) {
            firebase_functions_1.logger.info('[notify] Email fallback considered', {
                uid: recipient.uid,
                mentionType: recipient.mentionType,
                sent: emailResult.sent,
                reason: emailResult.reason ?? null,
                to: emailResult.to ?? null,
                messageId: context.messageId
            });
        }
        if (!deviceTokens.length) {
            firebase_functions_1.logger.info('[notify] No device tokens for recipient', {
                uid: recipient.uid,
                mentionType: recipient.mentionType,
                messageId: context.messageId,
                emailAttempted: emailResult.attempted,
                emailSent: emailResult.sent
            });
            return;
        }
        const data = {
            title,
            body,
            mentionType: recipient.mentionType,
            messageId: context.messageId,
            activityId,
            origin: 'push',
            targetUrl: buildDeepLink(context)
        };
        if (context.serverId)
            data.serverId = context.serverId;
        if (context.channelId)
            data.channelId = context.channelId;
        if (context.threadId)
            data.threadId = context.threadId;
        if (context.dmId)
            data.dmId = context.dmId;
        if (recipient.roleId)
            data.roleId = recipient.roleId;
        await sendPushToTokens(deviceTokens, { title, body, data });
    }));
}
async function sendTestPushForUid(uid, deviceId) {
    firebase_functions_1.logger.info('[testPush] Fetching device tokens', { uid, deviceId });
    const deviceTokens = await (0, settings_1.fetchDeviceTokens)(uid, deviceId);
    firebase_functions_1.logger.info('[testPush] Device token check complete', { uid, count: deviceTokens.length, deviceId });
    if (!deviceTokens.length) {
        firebase_functions_1.logger.warn('[testPush] No tokens found for user device', { uid, deviceId });
        return { sent: 0, reason: 'device_not_registered' };
    }
    const title = 'hConnect test notification';
    const body = 'Push notifications are working on this device.';
    const messageId = `test-${Date.now()}`;
    firebase_functions_1.logger.info('[testPush] Prepared payload metadata', {
        uid,
        deviceId,
        tokenCount: deviceTokens.length,
        messageId
    });
    try {
        firebase_functions_1.logger.info('[testPush] Sending push payload', { uid, count: deviceTokens.length });
        await sendPushToTokens(deviceTokens, {
            title,
            body,
            data: {
                title,
                body,
                origin: 'push',
                mentionType: 'direct',
                targetUrl: '/?origin=push',
                messageId,
                testDeviceId: deviceId
            }
        });
        firebase_functions_1.logger.info('[testPush] Push send call completed', { uid, count: deviceTokens.length });
    }
    catch (error) {
        firebase_functions_1.logger.error('[testPush] Failed to send push payload', { uid, error });
        throw error;
    }
    return { sent: deviceTokens.length, messageId };
}
function messageFromEvent(event) {
    const data = event.data?.data();
    return data ? data : null;
}
async function handleServerMessage(event) {
    const { serverId, channelId, messageId } = event.params;
    if (!serverId || !channelId || !messageId)
        return;
    const message = messageFromEvent(event);
    if (!message)
        return;
    const authorId = normalizeUid(message.authorId || message.uid);
    if (!authorId)
        return;
    firebase_functions_1.logger.info('[notify] handleServerMessage triggered', {
        serverId,
        channelId,
        messageId,
        authorId
    });
    const [serverSnap, channelSnap] = await Promise.all([
        firebase_1.db.doc(`servers/${serverId}`).get(),
        firebase_1.db.doc(`servers/${serverId}/channels/${channelId}`).get()
    ]);
    const channel = channelSnap.data() ?? null;
    if (channel?.type === 'voice') {
        firebase_functions_1.logger.info('[notify] Skipping voice channel', { serverId, channelId });
        return;
    }
    const server = serverSnap.data() ?? null;
    // Get channel access info for filtering members
    const channelAllowedRoleIds = Array.isArray(channel?.allowedRoleIds) ? channel.allowedRoleIds : null;
    const defaultRoleId = server?.defaultRoleId ?? server?.everyoneRoleId ?? null;
    const memberCache = new ServerMemberCache(serverId);
    const candidates = await computeServerCandidates({
        message,
        serverId,
        channelId,
        authorId,
        memberCache,
        channelAllowedRoleIds,
        defaultRoleId
    });
    firebase_functions_1.logger.info('[notify] Candidates computed', {
        serverId,
        channelId,
        messageId,
        candidateCount: candidates.length,
        mentionTypes: candidates.map(c => c.mentionType)
    });
    if (!candidates.length) {
        firebase_functions_1.logger.info('[notify] No candidates found', { serverId, channelId, messageId });
        return;
    }
    const roleIds = candidates
        .map((candidate) => candidate.roleId)
        .filter((value) => Boolean(value));
    const roleNames = await fetchRoleNames(serverId, roleIds);
    const recipients = await filterCandidates(candidates, {
        serverId,
        channelId,
        threadId: null,
        isDM: false
    });
    firebase_functions_1.logger.info('[notify] Recipients after filtering', {
        serverId,
        channelId,
        messageId,
        candidateCount: candidates.length,
        recipientCount: recipients.length,
        recipientTypes: recipients.map(r => r.mentionType)
    });
    if (!recipients.length) {
        firebase_functions_1.logger.info('[notify] No recipients after filtering', { serverId, channelId, messageId });
        return;
    }
    await deliverToRecipients(recipients, message, {
        serverId,
        channelId,
        threadId: null,
        messageId,
        server,
        channel,
        roleNames
    });
}
async function handleThreadMessage(event) {
    const { serverId, channelId, threadId, messageId } = event.params;
    if (!serverId || !channelId || !threadId || !messageId)
        return;
    const message = messageFromEvent(event);
    if (!message)
        return;
    const authorId = normalizeUid(message.authorId || message.uid);
    if (!authorId)
        return;
    firebase_functions_1.logger.info('[notify] handleThreadMessage triggered', {
        serverId,
        channelId,
        threadId,
        messageId,
        authorId
    });
    const [serverSnap, channelSnap, threadSnap] = await Promise.all([
        firebase_1.db.doc(`servers/${serverId}`).get(),
        firebase_1.db.doc(`servers/${serverId}/channels/${channelId}`).get(),
        firebase_1.db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}`).get()
    ]);
    const server = serverSnap.data() ?? null;
    const channel = channelSnap.data() ?? null;
    const thread = threadSnap.data() ?? null;
    // Get channel access info for filtering members
    const channelAllowedRoleIds = Array.isArray(channel?.allowedRoleIds) ? channel.allowedRoleIds : null;
    const defaultRoleId = server?.defaultRoleId ?? server?.everyoneRoleId ?? null;
    const memberCache = new ServerMemberCache(serverId);
    const candidates = await computeServerCandidates({
        message,
        serverId,
        channelId,
        authorId,
        memberCache,
        channelAllowedRoleIds,
        defaultRoleId
    });
    firebase_functions_1.logger.info('[notify] Thread candidates computed', {
        serverId,
        channelId,
        threadId,
        messageId,
        candidateCount: candidates.length
    });
    if (!candidates.length) {
        firebase_functions_1.logger.info('[notify] No thread candidates found', { serverId, channelId, threadId, messageId });
        return;
    }
    const roleIds = candidates
        .map((candidate) => candidate.roleId)
        .filter((value) => Boolean(value));
    const roleNames = await fetchRoleNames(serverId, roleIds);
    const recipients = await filterCandidates(candidates, {
        serverId,
        channelId,
        threadId,
        isDM: false
    });
    firebase_functions_1.logger.info('[notify] Thread recipients after filtering', {
        serverId,
        channelId,
        threadId,
        messageId,
        candidateCount: candidates.length,
        recipientCount: recipients.length
    });
    if (!recipients.length) {
        firebase_functions_1.logger.info('[notify] No thread recipients after filtering', { serverId, channelId, threadId, messageId });
        return;
    }
    await deliverToRecipients(recipients, message, {
        serverId,
        channelId,
        threadId,
        messageId,
        server,
        channel,
        thread,
        roleNames
    });
}
function computeDmCandidates(dm, authorId) {
    const participants = resolveDmParticipants(dm);
    return participants
        .map((uid) => normalizeUid(uid))
        .filter((uid) => Boolean(uid) && uid !== authorId)
        .map((uid) => ({ uid, mentionType: 'dm' }));
}
/**
 * Upsert DM rail entry for a participant.
 * This ensures the DM appears in their sidebar list.
 */
async function upsertDMRailForParticipant(threadId, uid, participants, lastMessage) {
    const others = participants.filter((p) => p !== uid);
    const otherUid = others.length === 1 ? others[0] : null;
    const payload = {
        threadId,
        otherUid,
        participants,
        lastMessage: lastMessage ?? null,
        hidden: false,
        updatedAt: firestore_1.FieldValue.serverTimestamp()
    };
    // Fetch other participant's profile for display metadata
    if (otherUid) {
        try {
            const profSnap = await firebase_1.db.doc(`profiles/${otherUid}`).get();
            if (profSnap.exists) {
                const data = profSnap.data() ?? {};
                const name = data.name ?? data.displayName ?? null;
                const email = data.email ?? null;
                const photoURL = data.cachedPhotoURL ?? data.photoURL ?? data.authPhotoURL ?? null;
                if (name)
                    payload.otherDisplayName = name;
                if (email)
                    payload.otherEmail = email;
                if (photoURL)
                    payload.otherPhotoURL = photoURL;
            }
        }
        catch (err) {
            firebase_functions_1.logger.warn('[upsertDMRailForParticipant] Failed to fetch profile', { otherUid, err });
        }
    }
    try {
        await firebase_1.db.doc(`profiles/${uid}/dms/${threadId}`).set(payload, { merge: true });
    }
    catch (err) {
        firebase_functions_1.logger.error('[upsertDMRailForParticipant] Failed to upsert rail entry', { uid, threadId, err });
    }
}
/**
 * Upsert DM rail entries for all participants (server-side with admin privileges).
 */
async function upsertDMRailForAllParticipants(threadId, participants, lastMessage) {
    await Promise.all(participants.map((uid) => upsertDMRailForParticipant(threadId, uid, participants, lastMessage)));
}
async function handleDmMessage(event) {
    const { threadID, messageId } = event.params;
    const dmId = threadID;
    if (!dmId || !messageId)
        return;
    const message = messageFromEvent(event);
    if (!message)
        return;
    const authorId = normalizeUid(message.authorId || message.uid);
    if (!authorId)
        return;
    const dmSnap = await firebase_1.db.doc(`dms/${dmId}`).get();
    if (!dmSnap.exists)
        return;
    const dm = dmSnap.data() ?? null;
    const participants = resolveDmParticipants(dm);
    // Compute last message preview
    const lastMessage = previewFromMessage(message);
    // CRITICAL: Update DM rail for ALL participants so the conversation appears in their sidebar.
    // This runs server-side with admin privileges, bypassing client-side Firestore rules
    // that prevent User A from writing to User B's profiles/{userB}/dms subcollection.
    if (participants.length > 0) {
        try {
            await upsertDMRailForAllParticipants(dmId, participants, lastMessage);
            firebase_functions_1.logger.info('[handleDmMessage] Updated DM rail for all participants', {
                dmId,
                participants,
                messageId
            });
        }
        catch (err) {
            firebase_functions_1.logger.error('[handleDmMessage] Failed to update DM rail', { dmId, participants, err });
        }
    }
    // Proceed with notification delivery
    const candidates = computeDmCandidates(dm, authorId);
    firebase_functions_1.logger.info('[notify] handleDmMessage candidates', {
        dmId,
        messageId,
        authorId,
        candidateCount: candidates.length,
        candidateUids: candidates.map(c => c.uid)
    });
    if (!candidates.length) {
        firebase_functions_1.logger.info('[notify] No DM candidates found', { dmId, messageId });
        return;
    }
    const recipients = await filterCandidates(candidates, {
        isDM: true
    });
    firebase_functions_1.logger.info('[notify] handleDmMessage recipients after filtering', {
        dmId,
        messageId,
        candidateCount: candidates.length,
        recipientCount: recipients.length
    });
    if (!recipients.length) {
        firebase_functions_1.logger.info('[notify] No DM recipients after filtering', { dmId, messageId });
        return;
    }
    await deliverToRecipients(recipients, message, {
        dmId,
        messageId,
        dm
    });
}
//# sourceMappingURL=notifications.js.map