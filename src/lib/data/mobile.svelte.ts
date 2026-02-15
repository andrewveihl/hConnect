/**
 * MobileState — reactive mobile UI state.
 *
 * Uses createSubscriber to expose reactive getters that track:
 * - viewport breakpoint (mobile / small-mobile)
 * - visual viewport height & keyboard offset
 * - dock & rail visibility
 *
 * Singleton instance exported as `mobile`.
 */
import { createSubscriber } from 'svelte/reactivity'

const MOBILE_BP = 768

export class MobileState {
	#isMobile = $state(false)
	#appHeight = $state(typeof window !== 'undefined' ? window.innerHeight : 0)
	#keyboardOpen = $state(false)
	#keyboardHeight = $state(0)
	#subscribe: VoidFunction

	constructor() {
		this.#subscribe = createSubscriber((update) => {
			if (typeof window === 'undefined') return

			const checkBreakpoint = () => {
				this.#isMobile = window.innerWidth < MOBILE_BP
				update()
			}
			checkBreakpoint()

			const updateHeight = () => {
				const vh =
					window.visualViewport?.height ??
					document.documentElement.clientHeight ??
					window.innerHeight
				this.#appHeight = vh
				document.documentElement.style.setProperty('--app-height', `${vh}px`)
				update()
			}
			updateHeight()

			const updateKeyboard = () => {
				if (!window.visualViewport) return
				const diff = window.innerHeight - window.visualViewport.height
				const threshold = 100
				this.#keyboardOpen = diff > threshold
				this.#keyboardHeight = diff > threshold ? diff : 0
				document.documentElement.style.setProperty(
					'--chat-keyboard-offset',
					`${this.#keyboardHeight}px`
				)
				updateHeight()
			}

			window.addEventListener('resize', checkBreakpoint)
			window.addEventListener('resize', updateHeight)
			window.addEventListener('orientationchange', updateHeight)
			window.visualViewport?.addEventListener('resize', updateKeyboard)
			window.visualViewport?.addEventListener('scroll', updateKeyboard)

			return () => {
				window.removeEventListener('resize', checkBreakpoint)
				window.removeEventListener('resize', updateHeight)
				window.removeEventListener('orientationchange', updateHeight)
				window.visualViewport?.removeEventListener('resize', updateKeyboard)
				window.visualViewport?.removeEventListener('scroll', updateKeyboard)
			}
		})
	}

	#read() {
		this.#subscribe()
	}

	get isMobile() {
		this.#read()
		return this.#isMobile
	}

	get appHeight() {
		this.#read()
		return this.#appHeight
	}

	get keyboardOpen() {
		this.#read()
		return this.#keyboardOpen
	}

	get keyboardHeight() {
		this.#read()
		return this.#keyboardHeight
	}

	/** True when the bottom dock should be visible */
	get dockVisible() {
		this.#read()
		return this.#isMobile && !this.#keyboardOpen
	}

	/** Rail is always visible on desktop; on mobile, always visible (panels cover it) */
	get railVisible() {
		this.#read()
		return true
	}

	/** Stub — always false (no overlay system currently active) */
	get hasOverlay() {
		return false
	}
}

export const mobile = new MobileState()
