import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { error } from '@sveltejs/kit';
import type { IssueStatus, TicketAiType } from '$lib/firestore/ticketAi';

export type TicketDetail = {
	id: string;
	serverId: string;
	serverName: string;
	serverIcon: string | null;
	channelId: string;
	threadId: string;
	parentMessageId: string | null;
	status: IssueStatus;
	statusTimeline: Array<{ status: IssueStatus; at: Date }>;
	summary: string | null;
	typeTag: TicketAiType | null;
	createdAt: Date | null;
	lastMessageAt: Date | null;
	closedAt: Date | null;
	firstStaffResponseAt: Date | null;
	timeToFirstResponseMs: number | null;
	timeToResolutionMs: number | null;
	staffMemberIds: string[];
	messageCount: number;
	staffMessageCount: number;
	clientMessageCount: number;
	reopenedAfterClose: boolean;
	authorName: string | null;
	authorId: string | null;
};

export type TicketMessage = {
	id: string;
	content: string;
	authorId: string;
	authorName: string | null;
	authorAvatar: string | null;
	isStaff: boolean;
	createdAt: Date | null;
	attachments: Array<{ url: string; name: string }>;
};

export const load: PageLoad = async ({ params }) => {
	const { serverId, ticketId } = params;

	await ensureFirebaseReady();
	const db = getDb();

	// Get server info
	const serverDoc = await getDoc(doc(db, 'servers', serverId));
	if (!serverDoc.exists()) {
		throw error(404, 'Server not found');
	}
	const serverData = serverDoc.data();

	// Get ticket
	const ticketDoc = await getDoc(doc(db, 'servers', serverId, 'ticketAiIssues', ticketId));
	if (!ticketDoc.exists()) {
		throw error(404, 'Ticket not found');
	}
	const ticketData = ticketDoc.data();

	// Parse status timeline
	const statusTimeline: Array<{ status: IssueStatus; at: Date }> = [];
	if (ticketData.statusTimeline && Array.isArray(ticketData.statusTimeline)) {
		for (const entry of ticketData.statusTimeline) {
			statusTimeline.push({
				status: entry.status,
				at: entry.at?.toDate?.() ?? new Date()
			});
		}
	}

	const ticket: TicketDetail = {
		id: ticketId,
		serverId,
		serverName: serverData.name ?? 'Unknown Server',
		serverIcon: serverData.icon ?? null,
		channelId: ticketData.channelId ?? '',
		threadId: ticketData.threadId ?? '',
		parentMessageId: ticketData.parentMessageId ?? null,
		status: ticketData.status ?? 'opened',
		statusTimeline,
		summary: ticketData.summary ?? null,
		typeTag: ticketData.typeTag ?? null,
		createdAt: ticketData.createdAt?.toDate?.() ?? null,
		lastMessageAt: ticketData.lastMessageAt?.toDate?.() ?? null,
		closedAt: ticketData.closedAt?.toDate?.() ?? null,
		firstStaffResponseAt: ticketData.firstStaffResponseAt?.toDate?.() ?? null,
		timeToFirstResponseMs: ticketData.timeToFirstResponseMs ?? null,
		timeToResolutionMs: ticketData.timeToResolutionMs ?? null,
		staffMemberIds: ticketData.staffMemberIds ?? [],
		messageCount: ticketData.messageCount ?? 0,
		staffMessageCount: ticketData.staffMessageCount ?? 0,
		clientMessageCount: ticketData.clientMessageCount ?? 0,
		reopenedAfterClose: ticketData.reopenedAfterClose ?? false,
		authorName: ticketData.authorName ?? null,
		authorId: ticketData.authorId ?? null
	};

	// Get messages for the ticket (if stored)
	const messages: TicketMessage[] = [];
	try {
		const messagesRef = collection(db, 'servers', serverId, 'ticketAiIssues', ticketId, 'messages');
		const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
		const messagesSnapshot = await getDocs(messagesQuery);

		for (const msgDoc of messagesSnapshot.docs) {
			const msgData = msgDoc.data();
			messages.push({
				id: msgDoc.id,
				content: msgData.content ?? '',
				authorId: msgData.authorId ?? '',
				authorName: msgData.authorName ?? null,
				authorAvatar: msgData.authorAvatar ?? null,
				isStaff: msgData.isStaff ?? false,
				createdAt: msgData.createdAt?.toDate?.() ?? null,
				attachments: msgData.attachments ?? []
			});
		}
	} catch (e) {
		// Messages subcollection might not exist
		console.warn('Could not fetch messages:', e);
	}

	return {
		ticket,
		messages
	};
};
