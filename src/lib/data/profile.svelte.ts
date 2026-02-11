import { createSubscriber } from 'svelte/reactivity'
import { firestore } from '../firebase/firestore'
import { collection, onSnapshot, where, query } from 'firebase/firestore'
import { user, type UserState } from './user.svelte'
import type { User } from 'firebase/auth'

class ServersState {
	#servers?: any[]
	#subscribe: VoidFunction

	constructor(user: User | null | undefined) {
		this.#subscribe = createSubscriber((update) => {
			if (!user) return

			let unsub_inner: VoidFunction | undefined

			const col = collection(firestore, 'profiles', user?.uid, 'servers')
			const ubsub_outer = onSnapshot(col, (snap) => {
				unsub_inner?.()
				unsub_inner = undefined

				const server_ids = snap.docs.map((doc) => doc.id)

				if (server_ids) {
					const col = collection(firestore, 'servers')
					const q = query(col, where('__name__', 'in', server_ids))
					unsub_inner = onSnapshot(q, (snap) => {
						this.#servers = snap.docs.map((doc) => {
							return { ...doc.data(), id: doc.id }
						})
						update()
					})
				} else {
					this.#servers = []
					update()
				}
			})

			return () => {
				unsub_inner?.()
				ubsub_outer()
			}
		})
	}

	get current() {
		this.#subscribe()
		return this.#servers
	}
}

export class ProfileState {
	#servers: ServersState

	constructor(private readonly user: UserState) {
		this.#servers = $derived(new ServersState(user.current))
	}

	get servers() {
		return this.#servers.current
	}
}

export const profile = new ProfileState(user)
