/**
 * Store for managing floating action button (FAB) snap zones.
 * Allows floating elements to snap to designated zones on the left rail.
 * Supports stacking - when one FAB is snapped, a new zone appears above it.
 */
import { writable, get, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { featureFlagsStore } from '$lib/admin/featureFlags';

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

export interface FabSnapState {
	zones: SnapZone[];
	activeZoneId: string | null;
	/** Track which FABs are currently snapped and their order */
	snappedFabs: { fabId: string; zoneId: string; order: number }[];
}

const SNAP_THRESHOLD_PX = 100; // Increased from 60px for easier snapping
const SNAP_STORAGE_PREFIX = 'hconnect:fab-snap:';
const FAB_ZONE_SPACING = 56; // Vertical spacing between stacked snap zones (matches rail-button: 48px + 8px gap)

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

function createFabSnapStore() {
	const { subscribe, update } = writable<FabSnapState>({
		zones: [],
		activeZoneId: null,
		snappedFabs: []
	});

	return {
		subscribe,

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
			if (!browser) return false;
			try {
				const raw = localStorage.getItem(`${SNAP_STORAGE_PREFIX}${fabId}`);
				if (!raw) return false;
				const parsed = JSON.parse(raw);
				return parsed?.snapped === true;
			} catch {
				return false;
			}
		},

		/**
		 * Get the zone ID a FAB was snapped to
		 */
		getSnappedZoneId(fabId: string): string | null {
			if (!browser) return null;
			try {
				const raw = localStorage.getItem(`${SNAP_STORAGE_PREFIX}${fabId}`);
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				return parsed?.zoneId ?? null;
			} catch {
				return null;
			}
		},

		/**
		 * Save snap state for a FAB
		 */
		setSnapped(fabId: string, snapped: boolean, zoneId?: string) {
			if (!browser) return;
			try {
				localStorage.setItem(
					`${SNAP_STORAGE_PREFIX}${fabId}`,
					JSON.stringify({ snapped, zoneId: snapped ? zoneId : null })
				);
			} catch {
				// ignore
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
