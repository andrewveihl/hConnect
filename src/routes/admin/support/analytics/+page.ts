import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, collectionGroup, getDocs, Timestamp } from 'firebase/firestore';

export type AnalyticsData = {
	// Time-based metrics
	ticketsByDay: Array<{ date: string; count: number }>;
	ticketsByWeek: Array<{ week: string; count: number }>;
	ticketsByMonth: Array<{ month: string; count: number }>;
	
	// Status distribution
	statusDistribution: {
		opened: number;
		in_progress: number;
		closed: number;
	};
	
	// Type distribution
	typeDistribution: {
		bug: number;
		feature_request: number;
		question: number;
		other: number;
		unknown: number;
	};
	
	// Server rankings
	topServersByTickets: Array<{ serverId: string; serverName: string; count: number }>;
	topServersByOpenTickets: Array<{ serverId: string; serverName: string; count: number }>;
	
	// Response time metrics
	avgResponseTimeMs: number | null;
	avgResolutionTimeMs: number | null;
	medianResponseTimeMs: number | null;
	medianResolutionTimeMs: number | null;
	
	// Activity metrics
	activeStaffCount: number;
	ticketsWithMultipleStaff: number;
	reopenedTickets: number;
	
	// AI Classification (estimated based on ticket creation patterns)
	estimatedAiClassifications: number;
};

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const db = getDb();

	// Get all servers for name mapping
	const serversSnapshot = await getDocs(collection(db, 'servers'));
	const serverMap = new Map<string, string>();
	for (const doc of serversSnapshot.docs) {
		serverMap.set(doc.id, doc.data().name ?? 'Unknown');
	}

	// Get all tickets
	const ticketsSnapshot = await getDocs(collectionGroup(db, 'ticketAiIssues'));
	
	// Initialize counters
	const ticketsByDay = new Map<string, number>();
	const ticketsByWeek = new Map<string, number>();
	const ticketsByMonth = new Map<string, number>();
	const serverTicketCounts = new Map<string, number>();
	const serverOpenCounts = new Map<string, number>();
	const responseTimes: number[] = [];
	const resolutionTimes: number[] = [];
	const activeStaff = new Set<string>();
	
	const statusDistribution = { opened: 0, in_progress: 0, closed: 0 };
	const typeDistribution = { bug: 0, feature_request: 0, question: 0, other: 0, unknown: 0 };
	let ticketsWithMultipleStaff = 0;
	let reopenedTickets = 0;

	// Process tickets
	for (const doc of ticketsSnapshot.docs) {
		const data = doc.data();
		const pathParts = doc.ref.path.split('/');
		const serverIdx = pathParts.indexOf('servers');
		const serverId = serverIdx !== -1 ? pathParts[serverIdx + 1] : null;
		
		if (!serverId) continue;

		// Count by server
		serverTicketCounts.set(serverId, (serverTicketCounts.get(serverId) ?? 0) + 1);
		if (data.status === 'opened' || data.status === 'in_progress') {
			serverOpenCounts.set(serverId, (serverOpenCounts.get(serverId) ?? 0) + 1);
		}

		// Status distribution
		if (data.status === 'opened') statusDistribution.opened++;
		else if (data.status === 'in_progress') statusDistribution.in_progress++;
		else if (data.status === 'closed') statusDistribution.closed++;

		// Type distribution
		switch (data.typeTag) {
			case 'bug': typeDistribution.bug++; break;
			case 'feature_request': typeDistribution.feature_request++; break;
			case 'question': typeDistribution.question++; break;
			case 'other': typeDistribution.other++; break;
			default: typeDistribution.unknown++; break;
		}

		// Time-based groupings
		const createdAt = data.createdAt?.toDate?.();
		if (createdAt) {
			const dateKey = createdAt.toISOString().split('T')[0];
			ticketsByDay.set(dateKey, (ticketsByDay.get(dateKey) ?? 0) + 1);
			
			// Week key (ISO week)
			const weekStart = new Date(createdAt);
			weekStart.setDate(weekStart.getDate() - weekStart.getDay());
			const weekKey = weekStart.toISOString().split('T')[0];
			ticketsByWeek.set(weekKey, (ticketsByWeek.get(weekKey) ?? 0) + 1);
			
			// Month key
			const monthKey = createdAt.toISOString().slice(0, 7);
			ticketsByMonth.set(monthKey, (ticketsByMonth.get(monthKey) ?? 0) + 1);
		}

		// Response times
		if (data.timeToFirstResponseMs && data.timeToFirstResponseMs > 0) {
			responseTimes.push(data.timeToFirstResponseMs);
		}
		if (data.timeToResolutionMs && data.timeToResolutionMs > 0) {
			resolutionTimes.push(data.timeToResolutionMs);
		}

		// Staff tracking
		if (data.staffMemberIds?.length > 0) {
			data.staffMemberIds.forEach((id: string) => activeStaff.add(id));
			if (data.staffMemberIds.length > 1) {
				ticketsWithMultipleStaff++;
			}
		}

		// Reopened tracking
		if (data.reopenedAfterClose) {
			reopenedTickets++;
		}
	}

	// Calculate medians
	const calculateMedian = (arr: number[]): number | null => {
		if (arr.length === 0) return null;
		const sorted = [...arr].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	};

	// Calculate averages
	const calculateAvg = (arr: number[]): number | null => {
		if (arr.length === 0) return null;
		return arr.reduce((a, b) => a + b, 0) / arr.length;
	};

	// Sort and format time-based data
	const sortedDays = [...ticketsByDay.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.slice(-30)
		.map(([date, count]) => ({ date, count }));

	const sortedWeeks = [...ticketsByWeek.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.slice(-12)
		.map(([week, count]) => ({ week, count }));

	const sortedMonths = [...ticketsByMonth.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.slice(-12)
		.map(([month, count]) => ({ month, count }));

	// Top servers
	const topServersByTickets = [...serverTicketCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([serverId, count]) => ({
			serverId,
			serverName: serverMap.get(serverId) ?? 'Unknown',
			count
		}));

	const topServersByOpenTickets = [...serverOpenCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([serverId, count]) => ({
			serverId,
			serverName: serverMap.get(serverId) ?? 'Unknown',
			count
		}));

	const analytics: AnalyticsData = {
		ticketsByDay: sortedDays,
		ticketsByWeek: sortedWeeks,
		ticketsByMonth: sortedMonths,
		statusDistribution,
		typeDistribution,
		topServersByTickets,
		topServersByOpenTickets,
		avgResponseTimeMs: calculateAvg(responseTimes),
		avgResolutionTimeMs: calculateAvg(resolutionTimes),
		medianResponseTimeMs: calculateMedian(responseTimes),
		medianResolutionTimeMs: calculateMedian(resolutionTimes),
		activeStaffCount: activeStaff.size,
		ticketsWithMultipleStaff,
		reopenedTickets,
		estimatedAiClassifications: ticketsSnapshot.size // Each ticket = 1 AI classification at minimum
	};

	return { analytics };
};
