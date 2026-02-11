import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore'
import { app } from './app'

export const firestore = initializeFirestore(app, {
	localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) }),
})
