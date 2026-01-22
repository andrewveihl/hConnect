import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import {
	collection,
	collectionGroup,
	getDocs,
	query,
	where,
	orderBy,
	limit,
	getCountFromServer,
	Timestamp
} from 'firebase/firestore';

export type SupportStats = {
	totalTickets: number;
	openTickets: number;
	inProgressTickets: number;
	closedTickets: number;
	totalServersWithSupport: number;
	ticketsLast24h: number;
	ticketsLast7d: number;
	avgResponseTimeMs: number | null;
	avgResolutionTimeMs: number | null;
};

export type ServerSupportInfo = {
	id: string;
	name: string;
	icon: string | null;
	enabled: boolean;
	totalTickets: number;
	openTickets: number;
	inProgressTickets: number;
	closedTickets: number;
	lastTicketAt: Date | null;
};

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

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const db = getDb();

	const now = Date.now();
	const oneDayAgo = Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
	const sevenDaysAgo = Timestamp.fromMillis(now - 7 * 24 * 60 * 60 * 1000);

	// Get all servers with ticketAiSettings
	const serversSnapshot = await getDocs(collection(db, 'servers'));
	const serverMap = new Map<string, { id: string; name: string; icon: string | null }>();
	
	for (const doc of serversSnapshot.docs) {
		const data = doc.data();
		serverMap.set(doc.id, {
			id: doc.id,
			name: data.name ?? 'Unknown Server',
			icon: data.icon ?? null
		});
	}

	// Get all ticketAiSettings to find servers with support enabled
	const settingsSnapshot = await getDocs(collectionGroup(db, 'ticketAiSettings'));
	const enabledServerIds = new Set<string>();
	
	for (const doc of settingsSnapshot.docs) {
		const data = doc.data();
		if (data.enabled) {
			// Extract serverId from path: servers/{serverId}/ticketAiSettings/current
			const pathParts = doc.ref.path.split('/');
			const serverIdx = pathParts.indexOf('servers');
			if (serverIdx !== -1 && pathParts[serverIdx + 1]) {
				enabledServerIds.add(pathParts[serverIdx + 1]);
			}
		}
	}

	// Get all tickets using collectionGroup
	const allTicketsSnapshot = await getDocs(collectionGroup(db, 'ticketAiIssues'));
	
	const tickets: RecentTicket[] = [];
	const serverTicketCounts = new Map<string, {
		total: number;
		open: number;
		inProgress: number;
		closed: number;
		lastTicketAt: Date | null;
	}>();

	let totalResponseTimeMs = 0;
	let responseTimeCount = 0;
	let totalResolutionTimeMs = 0;
	let resolutionTimeCount = 0;
	let ticketsLast24h = 0;
	let ticketsLast7d = 0;

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

		// Count by server
		if (!serverTicketCounts.has(serverId)) {
			serverTicketCounts.set(serverId, {
				total: 0,
				open: 0,
				inProgress: 0,
				closed: 0,
				lastTicketAt: null
			});
		}
		const counts = serverTicketCounts.get(serverId)!;
		counts.total++;
		
		if (data.status === 'opened') counts.open++;
		else if (data.status === 'in_progress') counts.inProgress++;
		else if (data.status === 'closed') counts.closed++;

		if (createdAt && (!counts.lastTicketAt || createdAt > counts.lastTicketAt)) {
			counts.lastTicketAt = createdAt;
		}

		// Time-based stats
		if (createdAt) {
			const createdAtMs = createdAt.getTime();
			if (createdAtMs > oneDayAgo.toMillis()) ticketsLast24h++;
			if (createdAtMs > sevenDaysAgo.toMillis()) ticketsLast7d++;
		}

		// Response/resolution time stats
		if (data.timeToFirstResponseMs && data.timeToFirstResponseMs > 0) {
			totalResponseTimeMs += data.timeToFirstResponseMs;
			responseTimeCount++;
		}
		if (data.timeToResolutionMs && data.timeToResolutionMs > 0) {
			totalResolutionTimeMs += data.timeToResolutionMs;
			resolutionTimeCount++;
		}
	}

	// Sort tickets by createdAt desc
	tickets.sort((a, b) => {
		const aTime = a.createdAt?.getTime() ?? 0;
		const bTime = b.createdAt?.getTime() ?? 0;
		return bTime - aTime;
	});

	// Calculate stats
	const stats: SupportStats = {
		totalTickets: tickets.length,
		openTickets: tickets.filter(t => t.status === 'opened').length,
		inProgressTickets: tickets.filter(t => t.status === 'in_progress').length,
		closedTickets: tickets.filter(t => t.status === 'closed').length,
		totalServersWithSupport: enabledServerIds.size,
		ticketsLast24h,
		ticketsLast7d,
		avgResponseTimeMs: responseTimeCount > 0 ? totalResponseTimeMs / responseTimeCount : null,
		avgResolutionTimeMs: resolutionTimeCount > 0 ? totalResolutionTimeMs / resolutionTimeCount : null
	};

	// Build server support info
	const servers: ServerSupportInfo[] = [];
	for (const [serverId, counts] of serverTicketCounts) {
		const serverInfo = serverMap.get(serverId);
		servers.push({
			id: serverId,
			name: serverInfo?.name ?? 'Unknown',
			icon: serverInfo?.icon ?? null,
			enabled: enabledServerIds.has(serverId),
			totalTickets: counts.total,
			openTickets: counts.open,
			inProgressTickets: counts.inProgress,
			closedTickets: counts.closed,
			lastTicketAt: counts.lastTicketAt
		});
	}

	// Sort servers by total tickets desc
	servers.sort((a, b) => b.totalTickets - a.totalTickets);

	return {
		stats,
		servers,
		recentTickets: tickets.slice(0, 50),
		allTickets: tickets
	};
};
