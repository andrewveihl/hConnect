/**
 * Touch gesture handling for mobile navigation
 * Provides swipe detection similar to Discord mobile app
 */

export interface SwipeGestureConfig {
	/** Minimum distance in pixels to register as a swipe */
	minDistance?: number;
	/** Maximum time in milliseconds for a swipe */
	maxDuration?: number;
	/** Vertical threshold - max pixels for vertical drift to still register as horizontal swipe */
	verticalThreshold?: number;
}

export interface SwipeListener {
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	onSwipeUp?: () => void;
	onSwipeDown?: () => void;
}

const DEFAULT_CONFIG: Required<SwipeGestureConfig> = {
	minDistance: 50,
	maxDuration: 500,
	verticalThreshold: 100
};

interface TouchTracker {
	startX: number;
	startY: number;
	startTime: number;
}

/**
 * Setup touch gesture listeners for swipe navigation
 * Returns a cleanup function to remove all listeners
 */
export function setupSwipeGestures(
	element: HTMLElement | Window,
	listeners: SwipeListener,
	config: SwipeGestureConfig = {}
): () => void {
	const finalConfig = { ...DEFAULT_CONFIG, ...config };
	let tracker: TouchTracker | null = null;

	const handleTouchStart = (e: TouchEvent) => {
		if (e.touches.length !== 1) return;
		const touch = e.touches[0];
		tracker = {
			startX: touch.clientX,
			startY: touch.clientY,
			startTime: Date.now()
		};
	};

	const handleTouchEnd = (e: TouchEvent) => {
		if (!tracker) return;
		if (e.changedTouches.length !== 1) {
			tracker = null;
			return;
		}

		const touch = e.changedTouches[0];
		const endX = touch.clientX;
		const endY = touch.clientY;
		const duration = Date.now() - tracker.startTime;

		const deltaX = endX - tracker.startX;
		const deltaY = endY - tracker.startY;
		const absDeltaX = Math.abs(deltaX);
		const absDeltaY = Math.abs(deltaY);

		tracker = null;

		// Check if swipe duration is within limits
		if (duration > finalConfig.maxDuration) return;

		// Check if vertical movement is within threshold (for horizontal swipes)
		if (absDeltaX > absDeltaY + finalConfig.verticalThreshold) {
			if (absDeltaX > finalConfig.minDistance) {
				if (deltaX > 0) {
					listeners.onSwipeRight?.();
				} else {
					listeners.onSwipeLeft?.();
				}
			}
		}

		// Check if horizontal movement is within threshold (for vertical swipes)
		if (absDeltaY > absDeltaX + finalConfig.verticalThreshold) {
			if (absDeltaY > finalConfig.minDistance) {
				if (deltaY > 0) {
					listeners.onSwipeDown?.();
				} else {
					listeners.onSwipeUp?.();
				}
			}
		}
	};

	const target = element instanceof Window ? document.documentElement : element;
	target.addEventListener('touchstart', handleTouchStart, { passive: true });
	target.addEventListener('touchend', handleTouchEnd, { passive: true });

	return () => {
		target.removeEventListener('touchstart', handleTouchStart);
		target.removeEventListener('touchend', handleTouchEnd);
	};
}

/**
 * Get viewport width accounting for mobile orientation
 */
export function getViewportWidth(): number {
	return Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
}

/**
 * Get viewport height accounting for safe area and keyboard
 */
export function getViewportHeight(): number {
	return Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
}

/**
 * Detect if device is in portrait orientation
 */
export function isPortraitOrientation(): boolean {
	return getViewportHeight() > getViewportWidth();
}

/**
 * Get safe area insets (notch, home indicator, etc)
 */
export function getSafeAreaInsets(): {
	top: number;
	right: number;
	bottom: number;
	left: number;
} {
	const computedStyle = getComputedStyle(document.documentElement);

	const parseInset = (varName: string): number => {
		const value = computedStyle.getPropertyValue(varName).trim();
		// Handle env() values
		const match = value.match(/(\d+)px/);
		return match ? parseInt(match[1], 10) : 0;
	};

	return {
		top: parseInset('--safe-area-top'),
		right: parseInset('--safe-area-right'),
		bottom: parseInset('--safe-area-bottom'),
		left: parseInset('--safe-area-left')
	};
}

/**
 * Enable notch-aware safe area on an element
 * Adds safe area padding if CSS variables are not available
 */
export function applySafeAreaPadding(
	element: HTMLElement,
	sides: ('top' | 'right' | 'bottom' | 'left')[] = ['top', 'bottom']
): void {
	const insets = getSafeAreaInsets();

	sides.forEach((side) => {
		const paddingKey =
			`padding${side.charAt(0).toUpperCase() + side.slice(1)}` as keyof CSSStyleDeclaration;
		const insetValue = insets[side as keyof typeof insets];
		if (insetValue > 0) {
			(element.style as any)[paddingKey] = `${insetValue}px`;
		}
	});
}

/**
 * Prevent rubber-band scrolling and momentum scrolling on iOS
 * Useful for fixed overlays
 */
export function preventIOSBounceScroll(element: HTMLElement): () => void {
	let lastY = 0;

	const handleTouchStart = (e: TouchEvent) => {
		lastY = e.touches[0].clientY;
	};

	const handleTouchMove = (e: TouchEvent) => {
		const currentY = e.touches[0].clientY;
		const isScrollable = element.scrollHeight > element.clientHeight;
		const isAtTop = element.scrollTop === 0;
		const isAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight;

		if (isAtTop && currentY > lastY) {
			// Trying to scroll up at top
			e.preventDefault();
		} else if (isAtBottom && currentY < lastY) {
			// Trying to scroll down at bottom
			e.preventDefault();
		}

		lastY = currentY;
	};

	element.addEventListener('touchstart', handleTouchStart, { passive: true });
	element.addEventListener('touchmove', handleTouchMove, { passive: false });

	return () => {
		element.removeEventListener('touchstart', handleTouchStart);
		element.removeEventListener('touchmove', handleTouchMove);
	};
}
