export type DMRailEntry = {
	id: string;
	participants?: string[];
	otherUid?: string | null;
	lastMessage?: string | null;
	updatedAt?: any;
	hidden?: boolean;
	isGroup?: boolean;
	groupName?: string | null;
	[key: string]: unknown;
};

export const dmRailCache = new Map<string, DMRailEntry[]>();
