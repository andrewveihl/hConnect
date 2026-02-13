import { createSubscriber } from 'svelte/reactivity'
import {
	addDoc,
	collection,
	limitToLast,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp
} from 'firebase/firestore'
import { firestore } from '../firebase/firestore'
import { user } from './user.svelte'

export class MessagesState {
	#messages?: any[]
	#subscribe: VoidFunction
	#serverId: string
	#channelId: string

	constructor(server_id: string, channel_id: string) {
		this.#serverId = server_id
		this.#channelId = channel_id
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

	async sendMessage(text: string) {
		const authUser = user.current
		if (!authUser || !text.trim()) return
		const col = collection(firestore, 'servers', this.#serverId, 'channels', this.#channelId, 'messages')
		await addDoc(col, {
			text: text.trim(),
			uid: authUser.uid,
			author: {
				displayName: authUser.displayName ?? 'Unknown',
				photoURL: authUser.photoURL ?? null
			},
			createdAt: serverTimestamp()
		})
	}
}
