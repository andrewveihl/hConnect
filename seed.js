/**
 * Seed script for hConnect
 * Creates initial server and channels for testing
 * 
 * Usage: node seed.js
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  writeBatch
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function seed() {
  try {
    console.log('🌱 Starting hConnect seed...\n');

    // Get current user
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ Not authenticated. Please sign in first.');
      process.exit(1);
    }

    const userId = user.uid;
    console.log(`✅ Using user: ${user.email}`);

    // Create main server
    const serverId = doc(collection(db, 'servers')).id;
    const serverData = {
      id: serverId,
      name: 'Healthspaces-Purple',
      description: 'Main community server for Healthspaces-Purple',
      icon: 'HP',
      ownerId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const batch = writeBatch(db);

    // Add server
    batch.set(doc(db, 'servers', serverId), serverData);
    console.log(`✅ Created server: ${serverData.name}`);

    // Add owner membership
    const membershipId = doc(collection(db, 'servers', serverId, 'memberships')).id;
    batch.set(doc(db, 'servers', serverId, 'memberships', membershipId), {
      id: membershipId,
      serverId,
      userId,
      role: 'owner',
      joinedAt: Date.now()
    });
    console.log(`✅ Added owner membership`);

    // Create channels
    const channels = [
      { name: 'general', topic: 'General discussion', type: 'text' },
      { name: 'announcements', topic: 'Server announcements', type: 'text' },
      { name: 'introductions', topic: 'Introduce yourself!', type: 'text' },
      { name: 'random', topic: 'Off-topic fun', type: 'text' },
      { name: 'voice-lounge', topic: 'General voice chat', type: 'voice' }
    ];

    channels.forEach((ch) => {
      const channelId = doc(collection(db, 'servers', serverId, 'channels')).id;
      batch.set(doc(db, 'servers', serverId, 'channels', channelId), {
        id: channelId,
        serverId,
        name: ch.name,
        topic: ch.topic,
        type: ch.type,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      console.log(`  ✅ Created #${ch.name}`);
    });

    // Commit all changes
    await batch.commit();

    console.log('\n✨ Seed completed successfully!');
    console.log(`\n📱 Server ID: ${serverId}`);
    console.log('🚀 You can now start chatting in hConnect!\n');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

seed();
