import { createSubscriber } from 'svelte/reactivity'
import { collection, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firestore } from '../firebase/firestore'

export class MessagesState {
	#messages?: any[]
	#subscribe: VoidFunction

	constructor(server_id: string, channel_id: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'servers', server_id, 'channels', channel_id, 'messages')
			const q = query(col, limitToLast(50), orderBy('createdAt', 'asc'))
			return onSnapshot(q, (snap) => {
				this.#messages = snap.docs.map((doc) => {
					return { ...doc.data(), id: doc.id }
				})
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#messages
	}
}
