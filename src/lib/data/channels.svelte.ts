import { createSubscriber } from 'svelte/reactivity'
import { collection, onSnapshot } from 'firebase/firestore'
import { firestore } from '../firebase/firestore'

export class ChannelsState {
	#channels?: any[]
	#subscribe: VoidFunction

	constructor(server_id: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'servers', server_id, 'channels')
			return onSnapshot(col, (snap) => {
				this.#channels = snap.docs.map((doc) => {
					return { ...doc.data(), id: doc.id }
				})
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#channels
	}
}
