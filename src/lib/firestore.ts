import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { getDb } from '$lib/firebase/index';
import { getAuth } from 'firebase/auth';
import type { User, Server, Channel, Message, Membership, UserRole } from '$lib/types';

// ============ AUTH ============

export async function signUp(email: string, password: string, displayName?: string): Promise<User> {
  const auth = getAuth();
  const db = getDb();

  const userCred = await createUserWithEmailAndPassword(auth, email, password);
  const userId = userCred.user.uid;

  const user: User = {
    id: userId,
    email,
    displayName: displayName || email.split('@')[0],
    createdAt: Date.now()
  };

  await setDoc(doc(db, 'users', userId), user);
  return user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const auth = getAuth();
  const db = getDb();

  const userCred = await signInWithEmailAndPassword(auth, email, password);
  const userId = userCred.user.uid;

  const userDoc = await getDoc(doc(db, 'users', userId));
  if (!userDoc.exists()) {
    throw new Error('User profile not found');
  }

  return userDoc.data() as User;
}

export async function signOut(): Promise<void> {
  const auth = getAuth();
  await firebaseSignOut(auth);
}

// ============ USERS ============

export async function getUser(userId: string): Promise<User | null> {
  const db = getDb();
  const docSnap = await getDoc(doc(db, 'users', userId));
  return docSnap.exists() ? (docSnap.data() as User) : null;
}

export function watchUser(userId: string, callback: (user: User | null) => void) {
  const db = getDb();
  return onSnapshot(doc(db, 'users', userId), (docSnap) => {
    callback(docSnap.exists() ? (docSnap.data() as User) : null);
  });
}

// ============ SERVERS ============

export async function createServer(
  name: string,
  description?: string,
  icon?: string,
  ownerId?: string
): Promise<Server> {
  const db = getDb();
  const auth = getAuth();

  const userId = ownerId || auth.currentUser?.uid;
  if (!userId) throw new Error('User must be authenticated');

  const serverId = doc(collection(db, 'servers')).id;
  const server: Server = {
    id: serverId,
    name,
    description,
    icon,
    ownerId: userId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const batch = writeBatch(db);

  // Create server
  batch.set(doc(db, 'servers', serverId), server);

  // Create owner membership
  const membershipId = doc(collection(db, 'servers', serverId, 'memberships')).id;
  batch.set(doc(db, 'servers', serverId, 'memberships', membershipId), {
    id: membershipId,
    serverId,
    userId,
    role: 'owner' as UserRole,
    joinedAt: Date.now()
  });

  // Create default channels
  const generalChannelId = doc(collection(db, 'servers', serverId, 'channels')).id;
  batch.set(doc(db, 'servers', serverId, 'channels', generalChannelId), {
    id: generalChannelId,
    serverId,
    name: 'general',
    type: 'text',
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as Channel);

  const announcementsChannelId = doc(collection(db, 'servers', serverId, 'channels')).id;
  batch.set(doc(db, 'servers', serverId, 'channels', announcementsChannelId), {
    id: announcementsChannelId,
    serverId,
    name: 'announcements',
    type: 'text',
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as Channel);

  await batch.commit();
  return server;
}

export async function getServer(serverId: string): Promise<Server | null> {
  const db = getDb();
  const docSnap = await getDoc(doc(db, 'servers', serverId));
  return docSnap.exists() ? (docSnap.data() as Server) : null;
}

export async function getUserServers(userId: string): Promise<Server[]> {
  const db = getDb();
  const membershipsSnap = await getDocs(
    query(
      collection(db, 'servers'),
      where('ownerId', '==', userId)
    )
  );

  const servers = membershipsSnap.docs.map((doc) => doc.data() as Server);
  return servers.sort((a, b) => b.createdAt - a.createdAt);
}

export function watchUserServers(userId: string, callback: (servers: Server[]) => void) {
  const db = getDb();
  return onSnapshot(
    query(collection(db, 'servers'), where('ownerId', '==', userId)),
    (snapshot) => {
      const servers = snapshot.docs.map((doc) => doc.data() as Server).sort((a, b) => b.createdAt - a.createdAt);
      callback(servers);
    }
  );
}

export async function updateServer(
  serverId: string,
  updates: Partial<Server>
): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, 'servers', serverId), {
    ...updates,
    updatedAt: serverTimestamp()
  });
}

// ============ CHANNELS ============

export async function createChannel(
  serverId: string,
  name: string,
  type: 'text' | 'voice' = 'text',
  category?: string
): Promise<Channel> {
  const db = getDb();

  const channelId = doc(collection(db, 'servers', serverId, 'channels')).id;
  const channel: Channel = {
    id: channelId,
    serverId,
    name,
    type,
    category,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await setDoc(doc(db, 'servers', serverId, 'channels', channelId), channel);
  return channel;
}

export async function getServerChannels(serverId: string): Promise<Channel[]> {
  const db = getDb();
  const snapshot = await getDocs(
    query(
      collection(db, 'servers', serverId, 'channels'),
      orderBy('createdAt', 'asc')
    )
  );
  return snapshot.docs.map((doc) => doc.data() as Channel);
}

export function watchServerChannels(serverId: string, callback: (channels: Channel[]) => void) {
  const db = getDb();
  return onSnapshot(
    query(
      collection(db, 'servers', serverId, 'channels'),
      orderBy('createdAt', 'asc')
    ),
    (snapshot) => {
      const channels = snapshot.docs.map((doc) => doc.data() as Channel);
      callback(channels);
    }
  );
}

export async function deleteChannel(serverId: string, channelId: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'servers', serverId, 'channels', channelId));
}

// ============ MESSAGES ============

export async function sendMessage(
  serverId: string,
  channelId: string,
  content: string,
  userId?: string
): Promise<Message> {
  const db = getDb();
  const auth = getAuth();

  const sender = userId || auth.currentUser?.uid;
  if (!sender) throw new Error('User must be authenticated');

  const messageId = doc(collection(db, 'servers', serverId, 'channels', channelId, 'messages')).id;
  const message: Message = {
    id: messageId,
    channelId,
    serverId,
    userId: sender,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    edited: false
  };

  await setDoc(
    doc(db, 'servers', serverId, 'channels', channelId, 'messages', messageId),
    message
  );

  return message;
}

export async function getChannelMessages(
  serverId: string,
  channelId: string,
  limitCount = 50
): Promise<Message[]> {
  const db = getDb();
  const snapshot = await getDocs(
    query(
      collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(limitCount)
    )
  );
  return snapshot.docs.map((doc) => doc.data() as Message);
}

export function watchChannelMessages(
  serverId: string,
  channelId: string,
  callback: (messages: Message[]) => void
) {
  const db = getDb();
  return onSnapshot(
    query(
      collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
      orderBy('createdAt', 'asc')
    ),
    (snapshot) => {
      const messages = snapshot.docs.map((doc) => doc.data() as Message);
      callback(messages);
    }
  );
}

export async function updateMessage(
  serverId: string,
  channelId: string,
  messageId: string,
  content: string
): Promise<void> {
  const db = getDb();
  await updateDoc(
    doc(db, 'servers', serverId, 'channels', channelId, 'messages', messageId),
    {
      content,
      edited: true,
      updatedAt: serverTimestamp()
    }
  );
}

export async function deleteMessage(
  serverId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'servers', serverId, 'channels', channelId, 'messages', messageId));
}

// ============ MEMBERSHIPS ============

export async function getMemberships(serverId: string): Promise<Membership[]> {
  const db = getDb();
  const snapshot = await getDocs(
    collection(db, 'servers', serverId, 'memberships')
  );
  return snapshot.docs.map((doc) => doc.data() as Membership);
}

export function watchMemberships(serverId: string, callback: (memberships: Membership[]) => void) {
  const db = getDb();
  return onSnapshot(
    collection(db, 'servers', serverId, 'memberships'),
    (snapshot) => {
      const memberships = snapshot.docs.map((doc) => doc.data() as Membership);
      callback(memberships);
    }
  );
}

export async function addMember(
  serverId: string,
  userId: string,
  role: UserRole = 'member'
): Promise<Membership> {
  const db = getDb();

  const membershipId = doc(collection(db, 'servers', serverId, 'memberships')).id;
  const membership: Membership = {
    id: membershipId,
    serverId,
    userId,
    role,
    joinedAt: Date.now()
  };

  await setDoc(doc(db, 'servers', serverId, 'memberships', membershipId), membership);
  return membership;
}

export async function updateMemberRole(
  serverId: string,
  membershipId: string,
  role: UserRole
): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, 'servers', serverId, 'memberships', membershipId), { role });
}

export async function removeMember(serverId: string, membershipId: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'servers', serverId, 'memberships', membershipId));
}
