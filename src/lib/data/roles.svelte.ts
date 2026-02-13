import { createSubscriber } from 'svelte/reactivity'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firestore } from '../firebase/firestore'

export interface Role {
	id: string
	name: string
	color?: string | null
	position?: number
	showInMemberList?: boolean
	mentionable?: boolean
	isEveryoneRole?: boolean
}

export class RolesState {
	#roles?: Role[]
	#subscribe: VoidFunction

	constructor(server_id: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'servers', server_id, 'roles')
			const q = query(col, orderBy('position'))
			return onSnapshot(q, (snap) => {
				this.#roles = snap.docs.map((doc) => ({
					...doc.data(),
					id: doc.id
				})) as Role[]
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#roles
	}
}
