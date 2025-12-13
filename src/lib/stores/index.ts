import { writable, derived } from 'svelte/store';
import type { User, Server, Channel, Message, Membership, Presence } from '$lib/types';

// Auth state
export const authUser = writable<User | null>(null);
export const authLoading = writable(true);

// Server state
export const currentServerId = writable<string | null>(null);
export const servers = writable<Server[]>([]);
export const serverMemberships = writable<Membership[]>([]);

// Channel state
export const currentChannelId = writable<string | null>(null);
export const channels = writable<Channel[]>([]);
export const channelUnreadCounts = writable<Record<string, number>>({});

// Message state
export const messages = writable<Message[]>([]);
export const messagesByChannelId = derived(
  messages,
  ($messages) => {
    const grouped: Record<string, Message[]> = {};
    $messages.forEach((msg) => {
      if (!grouped[msg.channelId]) grouped[msg.channelId] = [];
      grouped[msg.channelId].push(msg);
    });
    return grouped;
  }
);

// Members state
export const channelMembers = writable<(User & { role: string; status: string })[]>([]);
export const presence = writable<Presence[]>([]);

// UI state
export const sidebarOpen = writable(false);
export const showMembersPane = writable(true);
export const showCreateServerModal = writable(false);
export const showCreateChannelModal = writable(false);
export const showServerSettings = writable(false);

// Derived stores
export const isAuthenticated = derived(authUser, ($user) => $user !== null);
export const currentServer = derived(
  [currentServerId, servers],
  ([$id, $servers]) => $servers.find((s) => s.id === $id) || null
);
export const currentChannel = derived(
  [currentChannelId, channels],
  ([$id, $channls]) => $channls.find((c) => c.id === $id) || null
);
