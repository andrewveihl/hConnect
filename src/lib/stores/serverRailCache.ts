export type ServerRailEntry = {
	id: string;
	name: string;
	icon?: string | null;
	position?: number | null;
	joinedAt?: number | null;
};

export const serverRailCache = new Map<string, ServerRailEntry[]>();
