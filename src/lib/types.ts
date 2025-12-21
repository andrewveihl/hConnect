/**
 * hConnect data types and schemas
 */

export type UserRole = 'owner' | 'admin' | 'member';

export interface User {
	id: string;
	email: string;
	displayName?: string;
	photoURL?: string;
	createdAt: number;
}

export interface Server {
	id: string;
	name: string;
	description?: string;
	icon?: string;
	ownerId: string;
	createdAt: number;
	updatedAt: number;
}

export interface Membership {
	id: string;
	serverId: string;
	userId: string;
	role: UserRole;
	joinedAt: number;
}

export interface Channel {
	id: string;
	serverId: string;
	name: string;
	topic?: string;
	type: 'text' | 'voice';
	category?: string;
	categoryId?: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ChannelCategory {
	id: string;
	serverId: string;
	name: string;
	position: number;
	collapsed?: boolean;
	createdAt: number;
	updatedAt?: number;
}

export interface Message {
	id: string;
	channelId: string;
	serverId: string;
	userId: string;
	content: string;
	createdAt: number;
	updatedAt: number;
	edited: boolean;
}

export interface Presence {
	userId: string;
	status: 'online' | 'offline' | 'idle';
	lastSeen: number;
}

/**
 * Firestore collection paths:
 * /users/{userId}
 * /servers/{serverId}
 * /servers/{serverId}/channels/{channelId}
 * /servers/{serverId}/channels/{channelId}/messages/{messageId}
 * /servers/{serverId}/memberships/{userId}
 */
