import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import {
	collection,
	collectionGroup,
	getDocs
} from 'firebase/firestore';

export type RecentTicket = {
	id: string;
	serverId: string;
	serverName: string;
	channelId: string;
	summary: string | null;
	status: string;
	typeTag: string | null;
	authorName: string | null;
	createdAt: Date | null;
	lastMessageAt: Date | null;
	messageCount: number;
	staffMemberIds: string[];
};

export type ServerInfo = {
	id: string;
	name: string;
};

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const db = getDb();

	// Get all servers for name mapping
	const serversSnapshot = await getDocs(collection(db, 'servers'));
	const serverMap = new Map<string, { id: string; name: string }>();
	
	for (const doc of serversSnapshot.docs) {
		const data = doc.data();
		serverMap.set(doc.id, {
			id: doc.id,
			name: data.name ?? 'Unknown Server'
		});
	}

	// Get all tickets using collectionGroup
	const allTicketsSnapshot = await getDocs(collectionGroup(db, 'ticketAiIssues'));
	
	const tickets: RecentTicket[] = [];

	for (const doc of allTicketsSnapshot.docs) {
		const data = doc.data();
		// Extract serverId from path: servers/{serverId}/ticketAiIssues/{issueId}
		const pathParts = doc.ref.path.split('/');
		const serverIdx = pathParts.indexOf('servers');
		const serverId = serverIdx !== -1 ? pathParts[serverIdx + 1] : null;
		
		if (!serverId) continue;

		const serverInfo = serverMap.get(serverId);
		const createdAt = data.createdAt?.toDate?.() ?? null;
		const lastMessageAt = data.lastMessageAt?.toDate?.() ?? null;
		
		tickets.push({
			id: doc.id,
			serverId,
			serverName: serverInfo?.name ?? 'Unknown',
			channelId: data.channelId ?? '',
			summary: data.summary ?? null,
			status: data.status ?? 'opened',
			typeTag: data.typeTag ?? null,
			authorName: data.authorName ?? null,
			createdAt,
			lastMessageAt,
			messageCount: data.messageCount ?? 0,
			staffMemberIds: data.staffMemberIds ?? []
		});
	}

	// Sort tickets by createdAt desc
	tickets.sort((a, b) => {
		const aTime = a.createdAt?.getTime() ?? 0;
		const bTime = b.createdAt?.getTime() ?? 0;
		return bTime - aTime;
	});

	// Build server list for filters
	const servers: ServerInfo[] = [...serverMap.values()].sort((a, b) => 
		a.name.localeCompare(b.name)
	);

	return {
		allTickets: tickets,
		servers
	};
};
