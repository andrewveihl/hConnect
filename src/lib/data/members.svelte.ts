import { createSubscriber } from 'svelte/reactivity'
import { collection, doc, onSnapshot } from 'firebase/firestore'
import { firestore } from '../firebase/firestore'

export interface Member {
	id: string
	uid: string
	displayName?: string
	photoURL?: string
	roleIds?: string[]
	nickname?: string
	name?: string
	email?: string
	role?: string
}

export class MembersState {
	#members?: Member[]
	#subscribe: VoidFunction

	constructor(server_id: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'servers', server_id, 'members')

			// Track per-member profile subscriptions
			const profileUnsubs = new Map<string, VoidFunction>()
			const profileData = new Map<string, Record<string, any>>()
			let rawMembers: { id: string; uid: string; [key: string]: any }[] = []

			const merge = () => {
				this.#members = rawMembers.map((m) => {
					const profile = profileData.get(m.uid)
					return {
						...m,
						displayName: m.nickname ?? profile?.displayName ?? profile?.name ?? m.displayName ?? m.name,
						photoURL: profile?.cachedPhotoURL ?? profile?.customPhotoURL ?? profile?.photoURL ?? m.photoURL,
						email: profile?.email ?? m.email
					} as Member
				})
				update()
			}

			const unsubMembers = onSnapshot(col, (snap) => {
				rawMembers = snap.docs.map((d) => ({
					...d.data(),
					id: d.id,
					uid: d.data().uid ?? d.id
				}))

				const currentUids = new Set(rawMembers.map((m) => m.uid))

				// Remove profile subs for members who left
				for (const [uid, unsub] of profileUnsubs) {
					if (!currentUids.has(uid)) {
						unsub()
						profileUnsubs.delete(uid)
						profileData.delete(uid)
					}
				}

				// Add profile subs for new members
				for (const uid of currentUids) {
					if (!profileUnsubs.has(uid)) {
						const profileDoc = doc(firestore, 'profiles', uid)
						const unsub = onSnapshot(profileDoc, (profileSnap) => {
							if (profileSnap.exists()) {
								profileData.set(uid, profileSnap.data())
							}
							merge()
						})
						profileUnsubs.set(uid, unsub)
					}
				}

				merge()
			})

			return () => {
				unsubMembers()
				for (const unsub of profileUnsubs.values()) unsub()
				profileUnsubs.clear()
				profileData.clear()
			}
		})
	}

	get current() {
		this.#subscribe()
		return this.#members
	}
}
