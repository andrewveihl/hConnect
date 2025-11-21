"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestDomainAutoInvite = void 0;
const firebase_1 = require("./firebase");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const callableConfig = {
    region: 'us-central1',
    invoker: 'public',
    cors: ['https://hconnect-6212b.web.app', 'https://hconnect-6212b.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173']
};
exports.requestDomainAutoInvite = (0, https_1.onCall)(callableConfig, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in to request domain invites.');
    }
    const domain = await resolveUserDomain(uid);
    if (!domain) {
        firebase_functions_1.logger.debug('[requestDomainAutoInvite] Missing domain for user', { uid });
        return { ok: false, reason: 'no_domain' };
    }
    const serverSnapshots = await firebase_1.db
        .collection('servers')
        .where('settings.inviteAutomation.enabled', '==', true)
        .where('settings.inviteAutomation.domains', 'array-contains', domain)
        .limit(25)
        .get();
    if (serverSnapshots.empty) {
        return { ok: true, invitedServers: [] };
    }
    const invitedServers = [];
    for (const serverDoc of serverSnapshots.docs) {
        const serverId = serverDoc.id;
        const data = serverDoc.data();
        const settings = data.settings?.inviteAutomation;
        if (!settings?.enabled || !Array.isArray(settings.domains) || !settings.domains.includes(domain))
            continue;
        const memberSnap = await firebase_1.db.doc(`servers/${serverId}/members/${uid}`).get();
        if (memberSnap.exists)
            continue;
        const inviteRef = firebase_1.db.doc(`invites/${serverId}__${uid}`);
        const inviteSnap = await inviteRef.get();
        if (inviteSnap.exists)
            continue;
        const defaultChannel = await findDefaultChannel(serverId);
        if (!defaultChannel) {
            firebase_functions_1.logger.warn('[requestDomainAutoInvite] No channel available for server', { serverId });
            continue;
        }
        const payload = {
            toUid: uid,
            fromUid: data.owner ?? 'system',
            fromDisplayName: data.name ?? serverId,
            serverId,
            serverName: data.name ?? serverId,
            serverIcon: data.icon ?? null,
            channelId: defaultChannel.id,
            channelName: defaultChannel.name,
            type: 'domain-auto',
            status: 'pending',
            createdAt: firestore_1.FieldValue.serverTimestamp()
        };
        try {
            await inviteRef.set(payload);
            await firebase_1.db.doc(`servers/${serverId}`).update({
                [`settings.inviteAutomation.sentUids.${uid}`]: true
            });
            invitedServers.push(serverId);
            firebase_functions_1.logger.info('[requestDomainAutoInvite] Created invite', { serverId, uid });
        }
        catch (error) {
            firebase_functions_1.logger.error('[requestDomainAutoInvite] Failed to create invite', { serverId, uid, error });
        }
    }
    return { ok: true, invitedServers };
});
async function resolveUserDomain(uid) {
    const profileSnap = await firebase_1.db.doc(`profiles/${uid}`).get();
    const emailFromProfile = profileSnap.data()?.email;
    const domainFromProfile = extractDomain(emailFromProfile);
    if (domainFromProfile)
        return domainFromProfile;
    try {
        const userRecord = await firebase_1.auth.getUser(uid);
        return extractDomain(userRecord.email);
    }
    catch (error) {
        firebase_functions_1.logger.warn('[requestDomainAutoInvite] Unable to fetch auth record for user', { uid, error });
        return null;
    }
}
function extractDomain(value) {
    if (!value || typeof value !== 'string')
        return null;
    const [, domainRaw] = value.toLowerCase().split('@');
    if (!domainRaw)
        return null;
    const trimmed = domainRaw.trim();
    return trimmed.length ? trimmed : null;
}
async function findDefaultChannel(serverId) {
    const channelsSnap = await firebase_1.db
        .collection(`servers/${serverId}/channels`)
        .orderBy('position')
        .limit(25)
        .get();
    if (channelsSnap.empty)
        return null;
    const docs = channelsSnap.docs;
    const textChannel = docs.find((docSnap) => {
        const data = docSnap.data();
        return (data?.type ?? 'text') === 'text';
    });
    const target = textChannel ?? docs[0];
    const data = target.data();
    return {
        id: target.id,
        name: typeof data?.name === 'string' && data.name.trim().length ? data.name : 'general'
    };
}
//# sourceMappingURL=domainInvites.js.map