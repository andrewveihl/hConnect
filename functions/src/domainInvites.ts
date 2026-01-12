import { auth, db } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

type ServerDoc = {
  name?: string | null;
  icon?: string | null;
  owner?: string | null;
  settings?: {
    inviteAutomation?: {
      enabled?: boolean;
      domains?: string[];
      sentUids?: Record<string, boolean>;
    };
  };
};

const callableConfig = {
  region: 'us-central1',
  invoker: 'public' as const,
  cors: [
    'https://hconnect-6212b.web.app',
    'https://hconnect-6212b.firebaseapp.com',
    'https://hconnect.healthspaces.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]
};

export const requestDomainAutoInvite = onCall(callableConfig, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to request domain invites.');
  }

  const domain = await resolveUserDomain(uid);
  if (!domain) {
    logger.debug('[requestDomainAutoInvite] Missing domain for user', { uid });
    return { ok: false, reason: 'no_domain' };
  }

  const serverSnapshots = await db
    .collection('servers')
    .where('settings.inviteAutomation.enabled', '==', true)
    .where('settings.inviteAutomation.domains', 'array-contains', domain)
    .limit(25)
    .get();

  if (serverSnapshots.empty) {
    return { ok: true, invitedServers: [] };
  }

  const invitedServers: string[] = [];

  for (const serverDoc of serverSnapshots.docs) {
    const serverId = serverDoc.id;
    const data = serverDoc.data() as ServerDoc;
    const settings = data.settings?.inviteAutomation;
    if (!settings?.enabled || !Array.isArray(settings.domains) || !settings.domains.includes(domain)) continue;

    const memberSnap = await db.doc(`servers/${serverId}/members/${uid}`).get();
    if (memberSnap.exists) continue;

    const inviteRef = db.doc(`invites/${serverId}__${uid}`);
    const inviteSnap = await inviteRef.get();
    if (inviteSnap.exists) continue;

    const defaultChannel = await findDefaultChannel(serverId);
    if (!defaultChannel) {
      logger.warn('[requestDomainAutoInvite] No channel available for server', { serverId });
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
      createdAt: FieldValue.serverTimestamp()
    };

    try {
      await inviteRef.set(payload);
      await db.doc(`servers/${serverId}`).update({
        [`settings.inviteAutomation.sentUids.${uid}`]: true
      });
      invitedServers.push(serverId);
      logger.info('[requestDomainAutoInvite] Created invite', { serverId, uid });
    } catch (error) {
      logger.error('[requestDomainAutoInvite] Failed to create invite', { serverId, uid, error });
    }
  }

  return { ok: true, invitedServers };
});

async function resolveUserDomain(uid: string): Promise<string | null> {
  const profileSnap = await db.doc(`profiles/${uid}`).get();
  const emailFromProfile = (profileSnap.data() as any)?.email;
  const domainFromProfile = extractDomain(emailFromProfile);
  if (domainFromProfile) return domainFromProfile;
  try {
    const userRecord = await auth.getUser(uid);
    return extractDomain(userRecord.email);
  } catch (error) {
    logger.warn('[requestDomainAutoInvite] Unable to fetch auth record for user', { uid, error });
    return null;
  }
}

function extractDomain(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const [, domainRaw] = value.toLowerCase().split('@');
  if (!domainRaw) return null;
  const trimmed = domainRaw.trim();
  return trimmed.length ? trimmed : null;
}

async function findDefaultChannel(
  serverId: string
): Promise<{ id: string; name: string } | null> {
  const channelsSnap = await db
    .collection(`servers/${serverId}/channels`)
    .orderBy('position')
    .limit(25)
    .get();

  if (channelsSnap.empty) return null;

  const docs = channelsSnap.docs;
  const textChannel = docs.find((docSnap) => {
    const data = docSnap.data() as any;
    return (data?.type ?? 'text') === 'text';
  });

  const target = textChannel ?? docs[0];
  const data = target.data() as any;
  return {
    id: target.id,
    name: typeof data?.name === 'string' && data.name.trim().length ? data.name : 'general'
  };
}
