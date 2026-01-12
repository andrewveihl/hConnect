/**
 * Store for managing floating action button (FAB) snap zones.
 * Allows floating elements to snap to designated zones on the left rail.
 * Supports stacking - when one FAB is snapped, a new zone appears above it.
 */
import { writable, get, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { featureFlagsStore } from '$lib/admin/featureFlags';
import { user } from '$lib/stores/user';
import { ensureFirebaseReady, getDb } from '$lib/firebase';

export interface SnapZone {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** If this zone is occupied by a snapped FAB */
	occupiedBy?: string | null;
	/** Order in the stack (0 = bottom/base zone) */
	stackOrder?: number;
}

/** Information about a registered FAB */
export interface RegisteredFab {
	id: string;
	label: string;
	icon: string;
}

export interface FabSnapState {
	zones: SnapZone[];
	activeZoneId: string | null;
	/** Track which FABs are currently snapped and their order */
	snappedFabs: { fabId: string; zoneId: string; order: number }[];
	/** Track all registered (available) FABs */
	registeredFabs: RegisteredFab[];
}

const SNAP_THRESHOLD_PX = 150; // Increased for easier debugging - can reduce later
const SNAP_STORAGE_PREFIX = 'hconnect:fab-snap:';
const FAB_ZONE_SPACING = 56; // Vertical spacing between stacked snap zones (matches rail-button: 48px + 8px gap)
const FAB_SNAP_SYNC_EVENT = 'fabSnapStateSynced';

type LocalSnapState = {
	snapped: boolean;
	zoneId: string | null;
	updatedAt: number;
};

// Store for FAB snapping disabled setting from feature flags
const fabSnappingDisabledStore = writable<boolean>(false);
let featureFlagsUnsub: (() => void) | null = null;

/**
 * Initialize the feature flags listener for FAB snapping
 */
export function initFabSnappingSettings() {
	if (!browser || featureFlagsUnsub) return;
	
	const flags = featureFlagsStore();
	featureFlagsUnsub = flags.subscribe((flagValues) => {
		fabSnappingDisabledStore.set(flagValues?.disableFabSnapping === true);
	});
}

/**
 * Check if FAB snapping is disabled
 */
export const isFabSnappingDisabled: Readable<boolean> = { subscribe: fabSnappingDisabledStore.subscribe };

function parseUpdatedAt(value: unknown): number {
	if (!value) return 0;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	const asAny = value as { toMillis?: () => number };
	if (typeof asAny?.toMillis === 'function') return asAny.toMillis();
	return 0;
}

function normalizeRemoteSnapState(value: unknown): LocalSnapState | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as { snapped?: unknown; zoneId?: unknown; updatedAt?: unknown };
	const zoneId = typeof raw.zoneId === 'string' ? raw.zoneId : null;
	const snapped = raw.snapped === true && !!zoneId;
	return {
		snapped,
		zoneId: snapped ? zoneId : null,
		updatedAt: parseUpdatedAt(raw.updatedAt)
	};
}

function readLocalSnapState(fabId: string): LocalSnapState | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(`${SNAP_STORAGE_PREFIX}${fabId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<LocalSnapState>;
		const snapped = parsed.snapped === true;
		const zoneId = typeof parsed.zoneId === 'string' ? parsed.zoneId : null;
		return {
			snapped,
			zoneId: snapped ? zoneId : null,
			updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0
		};
	} catch {
		return null;
	}
}

function readAllLocalSnapStates(): Record<string, LocalSnapState> {
	if (!browser) return {};
	const states: Record<string, LocalSnapState> = {};
	try {
		for (let i = 0; i < localStorage.length; i += 1) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(SNAP_STORAGE_PREFIX)) continue;
			const fabId = key.slice(SNAP_STORAGE_PREFIX.length);
			const state = readLocalSnapState(fabId);
			if (state) states[fabId] = state;
		}
	} catch {
		return states;
	}
	return states;
}

function writeLocalSnapState(fabId: string, state: LocalSnapState) {
	if (!browser) return;
	try {
		localStorage.setItem(`${SNAP_STORAGE_PREFIX}${fabId}`, JSON.stringify(state));
	} catch {
		// ignore
	}
}

async function writeRemoteSnapStates(uid: string, entries: Record<string, LocalSnapState>) {
	if (!browser || !uid) return;
	const fabIds = Object.keys(entries);
	if (!fabIds.length) return;
	try {
		await ensureFirebaseReady();
		const { setDoc, doc, serverTimestamp } = await import('firebase/firestore');
		const db = getDb();
		const profileRef = doc(db, 'profiles', uid);
		const payload: Record<string, unknown> = {};
		for (const fabId of fabIds) {
			const state = entries[fabId];
			payload[`settings.fabDock.${fabId}`] = {
				snapped: state.snapped,
				zoneId: state.zoneId ?? null,
				updatedAt: serverTimestamp()
			};
		}
		await setDoc(profileRef, payload, { merge: true });
	} catch (error) {
		console.warn('[fabSnap] Failed to sync snap state to Firestore:', error);
	}
}

let fabSnapUserUnsub: (() => void) | null = null;
let fabSnapProfileUnsub: (() => void) | null = null;
let fabSnapSyncToken = 0;

/**
 * Sync snap state with Firestore so it persists across devices.
 */
export function initFabSnapSync() {
	if (!browser || fabSnapUserUnsub) return;

	fabSnapUserUnsub = user.subscribe((currentUser) => {
		if (fabSnapProfileUnsub) {
			fabSnapProfileUnsub();
			fabSnapProfileUnsub = null;
		}

		if (!currentUser?.uid) return;

		const token = (fabSnapSyncToken += 1);
		void (async () => {
			try {
				await ensureFirebaseReady();
				if (fabSnapSyncToken !== token) return;
				const { doc, onSnapshot } = await import('firebase/firestore');
				const db = getDb();
				const profileRef = doc(db, 'profiles', currentUser.uid);

				fabSnapProfileUnsub = onSnapshot(
					profileRef,
					(snap) => {
						if (!snap.exists()) return;
						const data = snap.data() as Record<string, any>;
						const remoteDock = data?.settings?.fabDock;
						const remoteStates =
							remoteDock && typeof remoteDock === 'object' ? (remoteDock as Record<string, unknown>) : {};
						const localStates = readAllLocalSnapStates();
						const updatedFabIds: string[] = [];

						for (const [fabId, remoteValue] of Object.entries(remoteStates)) {
							const remoteState = normalizeRemoteSnapState(remoteValue);
							if (!remoteState) continue;

							const localState = localStates[fabId];
							if (!localState || remoteState.updatedAt > localState.updatedAt) {
								writeLocalSnapState(fabId, remoteState);
								if (!remoteState.snapped) {
									fabSnapStore.releaseZone(fabId);
								}
								updatedFabIds.push(fabId);
							}
						}

						if (updatedFabIds.length && browser) {
							window.dispatchEvent(
								new CustomEvent(FAB_SNAP_SYNC_EVENT, { detail: { fabIds: updatedFabIds } })
							);
						}

						if (snap.metadata.hasPendingWrites) return;

						const toPush: Record<string, LocalSnapState> = {};
						for (const [fabId, localState] of Object.entries(localStates)) {
							const remoteState = normalizeRemoteSnapState(remoteStates[fabId]);
							if (!remoteState || localState.updatedAt > remoteState.updatedAt) {
								toPush[fabId] = localState;
							}
						}
						void writeRemoteSnapStates(currentUser.uid, toPush);
					},
					(error) => {
						console.warn('[fabSnap] Failed to subscribe to snap state:', error);
					}
				);
			} catch (error) {
				console.warn('[fabSnap] Failed to initialize snap sync:', error);
			}
		})();
	});
}

function createFabSnapStore() {
	const { subscribe, update } = writable<FabSnapState>({
		zones: [],
		activeZoneId: null,
		snappedFabs: [],
		registeredFabs: []
	});

	return {
		subscribe,

		/**
		 * Register a FAB as available (called by each FAB component on mount)
		 */
		registerFab(fab: RegisteredFab) {
			update((state) => {
				const existing = state.registeredFabs.findIndex((f) => f.id === fab.id);
				if (existing >= 0) {
					state.registeredFabs[existing] = fab;
				} else {
					state.registeredFabs.push(fab);
				}
				// Dispatch event so tray knows to update slots
				if (browser) {
					window.dispatchEvent(new CustomEvent('fabRegistryChanged', { detail: { count: state.registeredFabs.length } }));
				}
				return { ...state };
			});
		},

		/**
		 * Unregister a FAB (called on unmount)
		 */
		unregisterFab(fabId: string) {
			update((state) => {
				state.registeredFabs = state.registeredFabs.filter((f) => f.id !== fabId);
				// Dispatch event so tray knows to update slots
				if (browser) {
					window.dispatchEvent(new CustomEvent('fabRegistryChanged', { detail: { count: state.registeredFabs.length } }));
				}
				return { ...state };
			});
		},

		/**
		 * Get all registered FABs
		 */
		getRegisteredFabs(): RegisteredFab[] {
			return get({ subscribe }).registeredFabs;
		},

		/**
		 * Register a snap zone (called by LeftPane or other containers)
		 */
		registerZone(zone: SnapZone) {
			update((state) => {
				const existing = state.zones.findIndex((z) => z.id === zone.id);
				if (existing >= 0) {
					state.zones[existing] = { ...zone, stackOrder: 0, occupiedBy: state.zones[existing].occupiedBy };
				} else {
					state.zones.push({ ...zone, stackOrder: 0, occupiedBy: null });
				}
				return { ...state };
			});
		},

		/**
		 * Ensure a stacked zone exists for a saved snap ID.
		 */
		ensureZone(zoneId: string) {
			if (!zoneId.includes('-stack-')) return;
			update((state) => {
				if (state.zones.find((z) => z.id === zoneId)) return state;

				const [baseZoneId, orderRaw] = zoneId.split('-stack-');
				const stackOrder = Number.parseInt(orderRaw ?? '', 10);
				if (!Number.isFinite(stackOrder) || stackOrder <= 0) return state;

				const baseZone = state.zones.find((z) => z.id === baseZoneId);
				if (!baseZone) return state;

				for (let order = 1; order <= stackOrder; order += 1) {
					const stackedId = `${baseZoneId}-stack-${order}`;
					if (state.zones.find((z) => z.id === stackedId)) continue;
					state.zones.push({
						id: stackedId,
						x: baseZone.x,
						y: baseZone.y - (FAB_ZONE_SPACING * order),
						width: baseZone.width,
						height: baseZone.height,
						occupiedBy: null,
						stackOrder: order
					});
				}

				return { ...state };
			});
		},

		/**
		 * Unregister a snap zone
		 */
		unregisterZone(id: string) {
			update((state) => ({
				...state,
				zones: state.zones.filter((z) => z.id !== id && !z.id.startsWith(`${id}-stack-`))
			}));
		},

		/**
		 * Update zone position (e.g., on resize or when DMs change)
		 * Dispatches 'fabSnapZoneUpdated' event to notify snapped FABs
		 */
		updateZone(id: string, rect: { x: number; y: number; width: number; height: number }) {
			update((state) => {
				const zone = state.zones.find((z) => z.id === id);
				if (zone) {
					zone.x = rect.x;
					zone.y = rect.y;
					zone.width = rect.width;
					zone.height = rect.height;
				}
				// Also update stacked zones
				state.zones.forEach((z) => {
					if (z.id.startsWith(`${id}-stack-`)) {
						const stackOrder = z.stackOrder ?? 1;
						z.x = rect.x;
						z.y = rect.y - (FAB_ZONE_SPACING * stackOrder);
						z.width = rect.width;
						z.height = rect.height;
					}
				});
				return { ...state };
			});
			
			// Notify snapped FABs that zones have moved
			if (browser) {
				window.dispatchEvent(new CustomEvent('fabSnapZoneUpdated', { detail: { baseZoneId: id } }));
			}
		},

		/**
		 * Check if a position is within snap range of any zone.
		 * Returns the zone to snap to, or null if not close enough.
		 * Prefers unoccupied zones.
		 */
		findSnapZone(x: number, y: number, excludeFabId?: string): SnapZone | null {
			const state = get({ subscribe });
			let bestZone: SnapZone | null = null;
			let bestDistance = Infinity;

			for (const zone of state.zones) {
				// Skip zones occupied by other FABs (but allow the requesting FAB's own zone)
				if (zone.occupiedBy && zone.occupiedBy !== excludeFabId) continue;

				const centerX = zone.x + zone.width / 2;
				const centerY = zone.y + zone.height / 2;
				const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
				
				if (distance < SNAP_THRESHOLD_PX && distance < bestDistance) {
					bestDistance = distance;
					bestZone = zone;
				}
			}
			return bestZone;
		},

		/**
		 * Get the snap position for a FAB (center of the zone)
		 */
		getSnapPosition(zone: SnapZone, fabSize: number): { x: number; y: number } {
			return {
				x: zone.x + (zone.width - fabSize) / 2,
				y: zone.y + (zone.height - fabSize) / 2
			};
		},

		/**
		 * Mark a zone as occupied by a FAB and create a new zone above it
		 */
		occupyZone(zoneId: string, fabId: string) {
			update((state) => {
				const zone = state.zones.find((z) => z.id === zoneId);
				if (!zone) return state;

				// Mark zone as occupied
				zone.occupiedBy = fabId;

				// Track this snapped FAB
				const existingSnap = state.snappedFabs.findIndex((s) => s.fabId === fabId);
				if (existingSnap >= 0) {
					state.snappedFabs[existingSnap] = { fabId, zoneId, order: zone.stackOrder ?? 0 };
				} else {
					state.snappedFabs.push({ fabId, zoneId, order: zone.stackOrder ?? 0 });
				}

				// Find the base zone (non-stacked) to determine where to add new zone
				const baseZoneId = zoneId.includes('-stack-') ? zoneId.split('-stack-')[0] : zoneId;
				const baseZone = state.zones.find((z) => z.id === baseZoneId);
				if (!baseZone) return state;

				// Find highest stack order among occupied zones
				const occupiedStackOrders = state.zones
					.filter((z) => z.id === baseZoneId || z.id.startsWith(`${baseZoneId}-stack-`))
					.filter((z) => z.occupiedBy)
					.map((z) => z.stackOrder ?? 0);
				const maxOccupiedOrder = occupiedStackOrders.length > 0 ? Math.max(...occupiedStackOrders) : -1;

				// Create new zone above the highest occupied one if needed
				const newStackOrder = maxOccupiedOrder + 1;
				const newZoneId = `${baseZoneId}-stack-${newStackOrder}`;
				
				// Check if this zone already exists
				const existingStackZone = state.zones.find((z) => z.id === newZoneId);
				if (!existingStackZone) {
					state.zones.push({
						id: newZoneId,
						x: baseZone.x,
						y: baseZone.y - (FAB_ZONE_SPACING * newStackOrder),
						width: baseZone.width,
						height: baseZone.height,
						occupiedBy: null,
						stackOrder: newStackOrder
					});
				}

				return { ...state };
			});
		},

		/**
		 * Release a zone when a FAB is unsnapped
		 */
		releaseZone(fabId: string) {
			update((state) => {
				// Find and release the zone
				const zone = state.zones.find((z) => z.occupiedBy === fabId);
				if (zone) {
					zone.occupiedBy = null;
				}

				// Remove from snapped FABs list
				state.snappedFabs = state.snappedFabs.filter((s) => s.fabId !== fabId);

				// Clean up empty stacked zones (keep base zone and any occupied ones)
				state.zones = state.zones.filter((z) => {
					if (!z.id.includes('-stack-')) return true; // Keep base zones
					if (z.occupiedBy) return true; // Keep occupied zones
					// Remove unoccupied stack zones that are higher than needed
					const baseZoneId = z.id.split('-stack-')[0];
					const occupiedInStack = state.zones.filter(
						(oz) => (oz.id === baseZoneId || oz.id.startsWith(`${baseZoneId}-stack-`)) && oz.occupiedBy
					);
					const maxOccupiedOrder = occupiedInStack.length > 0 
						? Math.max(...occupiedInStack.map((oz) => oz.stackOrder ?? 0))
						: -1;
					// Keep only one zone above the highest occupied
					return (z.stackOrder ?? 0) <= maxOccupiedOrder + 1;
				});

				return { ...state };
			});
		},

		/**
		 * Check if a FAB is currently snapped to the rail
		 */
		isSnappedToRail(fabId: string): boolean {
			const state = readLocalSnapState(fabId);
			return state?.snapped === true;
		},

		/**
		 * Get the zone ID a FAB was snapped to
		 */
		getSnappedZoneId(fabId: string): string | null {
			const state = readLocalSnapState(fabId);
			return state?.zoneId ?? null;
		},

		/**
		 * Save snap state for a FAB
		 */
		setSnapped(fabId: string, snapped: boolean, zoneId?: string) {
			const nextState: LocalSnapState = {
				snapped,
				zoneId: snapped ? zoneId ?? null : null,
				updatedAt: Date.now()
			};
			writeLocalSnapState(fabId, nextState);

			const currentUser = get(user);
			if (currentUser?.uid) {
				void writeRemoteSnapStates(currentUser.uid, { [fabId]: nextState });
			}
		},

		/**
		 * Get all zones
		 */
		getZones(): SnapZone[] {
			return get({ subscribe }).zones;
		},

		/**
		 * Get snapped FABs
		 */
		getSnappedFabs(): { fabId: string; zoneId: string; order: number }[] {
			return get({ subscribe }).snappedFabs;
		}
	};
}

export const fabSnapStore = createFabSnapStore();
