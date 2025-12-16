import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import {
	collection,
	getCountFromServer,
	getDocs,
	limit,
	orderBy,
	query,
	where,
	Timestamp
} from 'firebase/firestore';

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const database = getDb();

	const now = new Date();
	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	// Get counts
	const [
		totalServers,
		totalUsers,
		totalDms,
		totalLogs,
		totalClientErrors,
		recentLogs,
		recentErrors
	] = await Promise.all([
		getCountFromServer(collection(database, 'servers')),
		getCountFromServer(collection(database, 'profiles')),
		getCountFromServer(collection(database, 'dms')),
		getCountFromServer(collection(database, 'logs')),
		getCountFromServer(collection(database, 'clientErrors')),
		getCountFromServer(
			query(collection(database, 'logs'), where('createdAt', '>=', Timestamp.fromDate(oneDayAgo)))
		),
		getCountFromServer(
			query(
				collection(database, 'clientErrors'),
				where('createdAt', '>=', Timestamp.fromDate(oneDayAgo))
			)
		)
	]);

	// Get recent error samples
	const errorSamplesSnap = await getDocs(
		query(collection(database, 'clientErrors'), orderBy('createdAt', 'desc'), limit(5))
	);

	const errorSamples = errorSamplesSnap.docs.map((doc) => {
		const data = doc.data();
		return {
			id: doc.id,
			message: data.message ?? 'Unknown error',
			source: data.source ?? null,
			path: data.path ?? null,
			createdAt: data.createdAt?.toDate?.() ?? null
		};
	});

	return {
		metrics: {
			totalServers: totalServers.data().count ?? 0,
			totalUsers: totalUsers.data().count ?? 0,
			totalDms: totalDms.data().count ?? 0,
			totalLogs: totalLogs.data().count ?? 0,
			totalClientErrors: totalClientErrors.data().count ?? 0,
			logsLast24h: recentLogs.data().count ?? 0,
			errorsLast24h: recentErrors.data().count ?? 0
		},
		errorSamples,
		generatedAt: now.toISOString()
	};
};
