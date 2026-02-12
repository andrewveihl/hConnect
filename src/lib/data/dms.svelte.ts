import { createSubscriber } from 'svelte/reactivity'
import {
	collection,
	doc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	where,
} from 'firebase/firestore'
import { firestore } from '../firebase/firestore'
import { user, type UserState } from './user.svelte'
import type { User } from 'firebase/auth'

export interface DMRailEntry {
	id: string
	threadId: string
	otherUid: string | null
	otherDisplayName?: string | null
	otherPhotoURL?: string | null
	participants: string[]
	lastMessage: string | null
	updatedAt?: any
	hidden?: boolean
	isGroup?: boolean
	groupName?: string | null
	iconURL?: string | null
}

export interface UnreadDMRailEntry extends DMRailEntry {
	unreadCount: number
}

class UnreadDMsState {
	#entries?: UnreadDMRailEntry[]
	#subscribe: VoidFunction

	constructor(authUser: User | null | undefined) {
		this.#subscribe = createSubscriber((update) => {
			if (!authUser) return

			let innerUnsubs: VoidFunction[] = []
			const railEntries: DMRailEntry[] = []
			const unreadCounts = new Map<string, number>()

			const rebuild = () => {
				this.#entries = railEntries
					.filter((entry) => (unreadCounts.get(entry.threadId) ?? 0) > 0)
					.map((entry) => ({
						...entry,
						unreadCount: unreadCounts.get(entry.threadId) ?? 0,
					}))
					.sort((a, b) => {
						const aTime = a.updatedAt?.toMillis?.() ?? 0
						const bTime = b.updatedAt?.toMillis?.() ?? 0
						return bTime - aTime
					})
				update()
			}

			// Outer: subscribe to the user's DM rail at profiles/{uid}/dms
			const railCol = collection(firestore, 'profiles', authUser.uid, 'dms')
			const railQuery = query(railCol, orderBy('updatedAt', 'desc'))
			const outerUnsub = onSnapshot(
				railQuery,
				(snap) => {
					innerUnsubs.forEach((u) => u())
					innerUnsubs = []
					railEntries.length = 0
					unreadCounts.clear()

					const visibleDocs = snap.docs.filter((d) => !d.data().hidden)

					visibleDocs.forEach((d) => {
						const data = d.data()
						const entry: DMRailEntry = {
							id: d.id,
							threadId: data.threadId ?? d.id,
							otherUid: data.otherUid ?? null,
							otherDisplayName: data.otherDisplayName ?? null,
							otherPhotoURL: data.otherPhotoURL ?? null,
							participants: data.participants ?? [],
							lastMessage: data.lastMessage ?? null,
							updatedAt: data.updatedAt ?? null,
							isGroup: data.isGroup ?? false,
							groupName: data.groupName ?? null,
							iconURL: data.iconURL ?? null,
						}
						railEntries.push(entry)
						// Fetch other user's profile as fallback for photo/name
						if (entry.otherUid && !entry.isGroup) {
							const profileRef = doc(firestore, 'profiles', entry.otherUid)
							const profileUnsub = onSnapshot(profileRef, (profileSnap) => {
								const profile = profileSnap.data()
								if (profile) {
									if (!entry.otherPhotoURL) {
										entry.otherPhotoURL = profile.photoURL ?? profile.avatar ?? null
									}
									if (!entry.otherDisplayName) {
										entry.otherDisplayName = profile.displayName ?? profile.name ?? null
									}
									rebuild()
								}
							})
							innerUnsubs.push(profileUnsub)
						}
						// Inner: subscribe to read cursor + messages to compute unread count
						const readRef = doc(firestore, 'dms', entry.threadId, 'reads', authUser.uid)
						let msgUnsub: VoidFunction | undefined

						const readUnsub = onSnapshot(readRef, (readSnap) => {
							msgUnsub?.()
							const lastReadAt = readSnap.data()?.lastReadAt ?? null

							const msgsCol = collection(firestore, 'dms', entry.threadId, 'messages')
							const msgsQuery = lastReadAt
								? query(msgsCol, where('createdAt', '>', lastReadAt), orderBy('createdAt', 'asc'))
								: query(msgsCol)

							msgUnsub = onSnapshot(msgsQuery, (msgsSnap) => {
								const count = msgsSnap.docs.filter((m) => {
									const msgUid = m.data().uid ?? m.data().authorId ?? null
									return msgUid !== authUser.uid
								}).length
								unreadCounts.set(entry.threadId, count)
								rebuild()
							})
						})

						innerUnsubs.push(readUnsub)
						innerUnsubs.push(() => msgUnsub?.())
					})

					rebuild()
				},
				(error) => {
					console.error('dm rail subscription error:', error)
				},
			)

			return () => {
				innerUnsubs.forEach((u) => u())
				outerUnsub()
			}
		})
	}

	get current() {
		this.#subscribe()
		return this.#entries
	}
}

export class DMState {
	#entries: UnreadDMsState

	constructor(private readonly user: UserState) {
		this.#entries = $derived(new UnreadDMsState(user.current))
	}

	get channels() {
		return this.#entries.current ?? []
	}

	getOtherParticipant(entry: UnreadDMRailEntry): { uid: string; displayName: string; photoURL: string | null } | undefined {
		if (entry.isGroup) {
			return entry.groupName
				? { uid: entry.threadId, displayName: entry.groupName, photoURL: entry.iconURL ?? null }
				: undefined
		}

		if (!entry.otherUid) return undefined

		return {
			uid: entry.otherUid,
			displayName: entry.otherDisplayName ?? 'Unknown',
			photoURL: entry.otherPhotoURL ?? null,
		}
	}

	async markRead(threadId: string) {
		const uid = this.user.current?.uid
		if (!uid) return

		const readRef = doc(firestore, 'dms', threadId, 'reads', uid)
		await setDoc(readRef, { lastReadAt: serverTimestamp(), lastReadMessageId: null }, { merge: true })
	}
}

export const dms = new DMState(user)
