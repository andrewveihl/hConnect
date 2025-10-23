// src/lib/db/invites.ts
import { getDb } from '$lib/firebase';
import {
  doc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';

export type ChannelInvite = {
  id: string;                // invite doc id
  serverId: string;
  serverName: string;
  serverIcon?: string | null; // include when you create invites if you have it
  channelId: string;
  channelName: string;
  invitedBy: string;
  status: 'pending' | 'accepted' | 'declined';
};

type AcceptParams = {
  meUid: string;          // current user uid
  invite: ChannelInvite;  // loaded invite doc
};

export async function acceptInvite({ meUid, invite }: AcceptParams) {
  const db = getDb();
  const { id, serverId, channelId, serverName, serverIcon } = invite;

  // 1) mark invite accepted
  await updateDoc(doc(db, 'users', meUid, 'invites', id), {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
  });

  // 2) add me to SERVER members with baseline perms
  await setDoc(
    doc(db, 'servers', serverId, 'members', meUid),
    {
      role: 'member',
      perms: {
        viewChannels: true,
        sendMessages: true,
        // add more defaults your app expects, e.g.:
        // readMessageHistory: true,
      },
      joinedAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 3) add me to the invited CHANNEL members
  await setDoc(
    doc(db, 'servers', serverId, 'channels', channelId, 'members', meUid),
    {
      joinedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 4) (recommended) mirror for the left rail: /profiles/{me}/servers/{serverId}
  await setDoc(
    doc(db, 'profiles', meUid, 'servers', serverId),
    {
      serverId,
      name: serverName,
      icon: serverIcon ?? null,
      joinedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function declineInvite(meUid: string, inviteId: string) {
  const db = getDb();
  await updateDoc(doc(db, 'users', meUid, 'invites', inviteId), {
    status: 'declined',
    declinedAt: serverTimestamp(),
  });
}
