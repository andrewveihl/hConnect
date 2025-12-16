import { writable, type Writable } from 'svelte/store';

type SuppressionStore = {
	subscribe: Writable<boolean>['subscribe'];
	claim: () => void;
	release: () => void;
	reset: () => void;
};

function createSuppressionStore(): SuppressionStore {
	const { subscribe, set } = writable(false);
	let locks = 0;

	return {
		subscribe,
		claim() {
			locks += 1;
			if (locks === 1) set(true);
		},
		release() {
			if (locks === 0) return;
			locks -= 1;
			if (locks === 0) set(false);
		},
		reset() {
			locks = 0;
			set(false);
		}
	};
}

export const mobileDockSuppressed = createSuppressionStore();
