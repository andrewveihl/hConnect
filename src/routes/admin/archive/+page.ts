import type { PageLoad } from './$types';
import type { ArchiveTab } from '$lib/admin/types';
import type { ArchiveEntry } from '$lib/admin/archive';
import { fetchArchiveEntries } from '$lib/admin/archive';

const TABS: ArchiveTab[] = ['servers', 'channels', 'messages', 'dms', 'attachments'];

export const load: PageLoad = async ({ parent }) => {
	const parentData = await parent();
	const entries = await Promise.all(TABS.map((tab) => fetchArchiveEntries(tab)));

	const initialArchive = TABS.reduce<Record<ArchiveTab, ArchiveEntry[]>>(
		(acc, tab, idx) => {
			acc[tab] = entries[idx] ?? [];
			return acc;
		},
		{} as Record<ArchiveTab, ArchiveEntry[]>
	);

	return {
		initialArchive,
		user: parentData.user
	};
};
