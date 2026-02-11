import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { createSubscriber } from 'svelte/reactivity'
import { auth } from '../firebase/auth'

export class UserState {
	#user: User | null | undefined
	#subscribe: VoidFunction

	constructor() {
		this.#subscribe = createSubscriber((update) => {
			return onAuthStateChanged(auth, (user) => {
				this.#user = user
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#user
	}

	async signin() {
		await signInWithPopup(auth, new GoogleAuthProvider())
	}

	async signout() {
		await signOut(auth)
	}
}

export const user = new UserState()
