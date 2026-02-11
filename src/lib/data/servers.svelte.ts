import { createSubscriber } from 'svelte/reactivity'
import { firestore } from '../firebase/firestore'
import { collection, onSnapshot } from 'firebase/firestore'

export class ServersState {
	#servers?: any[]
	#subscribe: VoidFunction

	constructor() {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'servers')
			return onSnapshot(col, (snap) => {
				this.#servers = snap.docs.map((doc) => {
					return { ...doc.data(), id: doc.id }
				})
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#servers
	}
}

export const servers = new ServersState()
