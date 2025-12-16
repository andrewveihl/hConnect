import { writable } from 'svelte/store';

export type AdminToast = {
	id: string;
	message: string;
	type?: 'success' | 'error' | 'info' | 'warning';
	duration?: number;
};

const { subscribe, update } = writable<AdminToast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const adminToasts = { subscribe };

const randomId = () => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2, 10);
};

export function showAdminToast(payload: Omit<AdminToast, 'id'> & { id?: string }) {
	const id = payload.id ?? randomId();
	const duration = payload.duration ?? (payload.type === 'error' ? 6000 : 3500);
	update((rows) => [...rows, { ...payload, id, duration }]);
	if (duration > 0) {
		const timer = setTimeout(() => dismissAdminToast(id), duration);
		timers.set(id, timer);
	}
}

export function dismissAdminToast(id: string) {
	update((rows) => rows.filter((toast) => toast.id !== id));
	const timer = timers.get(id);
	if (timer) {
		clearTimeout(timer);
		timers.delete(id);
	}
}
