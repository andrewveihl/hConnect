import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import {
	collection,
	collectionGroup,
	getDocs,
	doc,
	getDoc,
	query,
	where,
	orderBy
} from 'firebase/firestore';

export type ServerSupportConfig = {
	id: string;
	name: string;
	icon: string | null;
	ownerId: string;
	ownerName: string | null;
	enabled: boolean;
	monitoredChannelIds: string[];
	monitoredChannelNames: string[];
	staffDomains: string[];
	staffMemberIds: string[];
	retention: string;
	scheduleEnabled: boolean;
	scheduleFrequency: string | null;
	ticketStats: {
		total: number;
		open: number;
		inProgress: number;
		closed: number;
	};
};

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const db = getDb();

	// Get all servers
	const serversSnapshot = await getDocs(collection(db, 'servers'));
	const serverConfigs: ServerSupportConfig[] = [];

	// Get all ticket settings
	const settingsSnapshot = await getDocs(collectionGroup(db, 'ticketAiSettings'));
	const settingsMap = new Map<string, any>();
	
	for (const settingDoc of settingsSnapshot.docs) {
		const pathParts = settingDoc.ref.path.split('/');
		const serverIdx = pathParts.indexOf('servers');
		if (serverIdx !== -1 && pathParts[serverIdx + 1]) {
			settingsMap.set(pathParts[serverIdx + 1], settingDoc.data());
		}
	}

	// Get all tickets for stats
	const ticketsSnapshot = await getDocs(collectionGroup(db, 'ticketAiIssues'));
	const ticketCountsMap = new Map<string, { total: number; open: number; inProgress: number; closed: number }>();
	
	for (const ticketDoc of ticketsSnapshot.docs) {
		const pathParts = ticketDoc.ref.path.split('/');
		const serverIdx = pathParts.indexOf('servers');
		if (serverIdx !== -1 && pathParts[serverIdx + 1]) {
			const serverId = pathParts[serverIdx + 1];
			if (!ticketCountsMap.has(serverId)) {
				ticketCountsMap.set(serverId, { total: 0, open: 0, inProgress: 0, closed: 0 });
			}
			const counts = ticketCountsMap.get(serverId)!;
			counts.total++;
			const status = ticketDoc.data().status;
			if (status === 'opened') counts.open++;
			else if (status === 'in_progress') counts.inProgress++;
			else if (status === 'closed') counts.closed++;
		}
	}

	// Build server configs
	for (const serverDoc of serversSnapshot.docs) {
		const serverData = serverDoc.data();
		const settings = settingsMap.get(serverDoc.id);
		const ticketStats = ticketCountsMap.get(serverDoc.id) ?? { total: 0, open: 0, inProgress: 0, closed: 0 };

		// Get channel names for monitored channels
		let monitoredChannelNames: string[] = [];
		if (settings?.monitoredChannelIds?.length > 0) {
			try {
				const channelsSnapshot = await getDocs(
					query(
						collection(db, 'servers', serverDoc.id, 'channels'),
						where('__name__', 'in', settings.monitoredChannelIds.slice(0, 10))
					)
				);
				monitoredChannelNames = channelsSnapshot.docs.map(d => d.data().name ?? 'Unknown');
			} catch {
				// Ignore errors
			}
		}

		// Get owner name
		let ownerName: string | null = null;
		if (serverData.ownerId) {
			try {
				const ownerDoc = await getDoc(doc(db, 'profiles', serverData.ownerId));
				if (ownerDoc.exists()) {
					ownerName = ownerDoc.data().displayName ?? ownerDoc.data().name ?? null;
				}
			} catch {
				// Ignore
			}
		}

		serverConfigs.push({
			id: serverDoc.id,
			name: serverData.name ?? 'Unknown Server',
			icon: serverData.icon ?? null,
			ownerId: serverData.ownerId ?? '',
			ownerName,
			enabled: settings?.enabled ?? false,
			monitoredChannelIds: settings?.monitoredChannelIds ?? [],
			monitoredChannelNames,
			staffDomains: settings?.staffDomains ?? [],
			staffMemberIds: settings?.staffMemberIds ?? [],
			retention: settings?.retention ?? 'forever',
			scheduleEnabled: settings?.schedule?.enabled ?? false,
			scheduleFrequency: settings?.schedule?.frequency ?? null,
			ticketStats
		});
	}

	// Sort by ticket count desc
	serverConfigs.sort((a, b) => b.ticketStats.total - a.ticketStats.total);

	return {
		servers: serverConfigs
	};
};
