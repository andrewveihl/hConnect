import { createSubscriber } from 'svelte/reactivity'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firestore } from '../firebase/firestore'

export class CategoriesState {
	#categories?: any[]
	#subscribe: VoidFunction

	constructor(server_id: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'servers', server_id, 'categories')
			const q = query(col, orderBy('position'))
			return onSnapshot(q, (snap) => {
				this.#categories = snap.docs.map((doc) => {
					return { ...doc.data(), id: doc.id }
				})
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#categories
	}
}
