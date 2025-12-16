// src/routes/(app)/servers/[serverID]/+page.ts
export const ssr = false;
export const prerender = false;

import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	// Normalize different param casings/names to a single `serverId`
	const serverId =
		(params as Record<string, string | undefined>).serverID ??
		(params as Record<string, string | undefined>).serversID ??
		(params as Record<string, string | undefined>).serverId ??
		null;

	return { serverId };
};
