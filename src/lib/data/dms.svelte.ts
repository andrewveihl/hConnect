import { createSubscriber } from 'svelte/reactivity'
import {
	addDoc,
	collection,
	doc,
	limitToLast,
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

/* ── Helper: parse a Firestore doc into a DMRailEntry ── */
function docToEntry(d: import('firebase/firestore').QueryDocumentSnapshot): DMRailEntry {
	const data = d.data()
	return {
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
}

/* ── Helper: subscribe to profile fallback for name/photo ── */
function enrichEntry(entry: DMRailEntry, onUpdate: () => void): VoidFunction | undefined {
	if (!entry.otherUid || entry.isGroup) return undefined
	const profileRef = doc(firestore, 'profiles', entry.otherUid)
	return onSnapshot(profileRef, (snap) => {
		const profile = snap.data()
		if (!profile) return
		if (!entry.otherPhotoURL) {
			entry.otherPhotoURL = profile.photoURL ?? profile.avatar ?? null
		}
		if (!entry.otherDisplayName) {
			entry.otherDisplayName = profile.displayName ?? profile.name ?? null
		}
		onUpdate()
	})
}

/* ── Sort entries newest-first by updatedAt ── */
function sortByTime<T extends DMRailEntry>(list: T[]): T[] {
	return [...list].sort((a, b) => {
		const aTime = a.updatedAt?.toMillis?.() ?? 0
		const bTime = b.updatedAt?.toMillis?.() ?? 0
		return bTime - aTime
	})
}

/* ─── All DMs (for the sidebar list) ─── */
class AllDMsState {
	#entries?: DMRailEntry[]
	#subscribe: VoidFunction

	constructor(authUser: User | null | undefined) {
		this.#subscribe = createSubscriber((update) => {
			if (!authUser) return

			let innerUnsubs: VoidFunction[] = []
			const entries: DMRailEntry[] = []

			const rebuild = () => {
				this.#entries = sortByTime(entries)
				update()
			}

			const railCol = collection(firestore, 'profiles', authUser.uid, 'dms')
			const outerUnsub = onSnapshot(
				query(railCol, orderBy('updatedAt', 'desc')),
				(snap) => {
					innerUnsubs.forEach((u) => u())
					innerUnsubs = []
					entries.length = 0

					for (const d of snap.docs) {
						if (d.data().hidden) continue
						const entry = docToEntry(d)
						entries.push(entry)
						const unsub = enrichEntry(entry, rebuild)
						if (unsub) innerUnsubs.push(unsub)
					}
					rebuild()
				},
				(err) => console.error('dm all-list subscription error:', err),
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

/* ─── Unread DMs (for the server rail) ─── */
class UnreadDMsState {
	#entries?: UnreadDMRailEntry[]
	#subscribe: VoidFunction

	constructor(authUser: User | null | undefined) {
		this.#subscribe = createSubscriber((update) => {
			if (!authUser) return

			let innerUnsubs: VoidFunction[] = []
			const entries: DMRailEntry[] = []
			const unreadCounts = new Map<string, number>()

			const rebuild = () => {
				this.#entries = sortByTime(
					entries
						.filter((e) => (unreadCounts.get(e.threadId) ?? 0) > 0)
						.map((e) => ({ ...e, unreadCount: unreadCounts.get(e.threadId) ?? 0 })),
				)
				update()
			}

			const railCol = collection(firestore, 'profiles', authUser.uid, 'dms')
			const outerUnsub = onSnapshot(
				query(railCol, orderBy('updatedAt', 'desc')),
				(snap) => {
					innerUnsubs.forEach((u) => u())
					innerUnsubs = []
					entries.length = 0
					unreadCounts.clear()

					for (const d of snap.docs) {
						if (d.data().hidden) continue
						const entry = docToEntry(d)
						entries.push(entry)

						// Profile enrichment
						const profileUnsub = enrichEntry(entry, rebuild)
						if (profileUnsub) innerUnsubs.push(profileUnsub)

						// Unread count: read cursor → message count
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
									const uid = m.data().uid ?? m.data().authorId ?? null
									return uid !== authUser.uid
								}).length
								unreadCounts.set(entry.threadId, count)
								rebuild()
							})
						})

						innerUnsubs.push(readUnsub)
						innerUnsubs.push(() => msgUnsub?.())
					}
					rebuild()
				},
				(err) => console.error('dm unread subscription error:', err),
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

/* ─── DM Messages (for a single thread) ─── */
export class DMMessagesState {
	#messages?: any[]
	#subscribe: VoidFunction

	constructor(threadId: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'dms', threadId, 'messages')
			const q = query(col, limitToLast(50), orderBy('createdAt', 'asc'))
			return onSnapshot(q, (snap) => {
				this.#messages = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#messages
	}
}

/* ─── Public facade ─── */
export class DMState {
	#unread: UnreadDMsState
	#all: AllDMsState

	constructor(private readonly user: UserState) {
		this.#unread = $derived(new UnreadDMsState(user.current))
		this.#all = $derived(new AllDMsState(user.current))
	}

	/** Only unread DM entries (for the server rail badges) */
	get channels() {
		return this.#unread.current ?? []
	}

	/** All visible DM entries (for the sidebar list) */
	get all() {
		return this.#all.current
	}

	getOtherParticipant(
		entry: DMRailEntry,
	): { uid: string; displayName: string; photoURL: string | null } | undefined {
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

	async sendMessage(threadId: string, text: string) {
		const authUser = this.user.current
		if (!authUser || !text.trim()) return
		const col = collection(firestore, 'dms', threadId, 'messages')
		await addDoc(col, {
			text: text.trim(),
			uid: authUser.uid,
			author: {
				displayName: authUser.displayName ?? 'Unknown',
				photoURL: authUser.photoURL ?? null,
			},
			createdAt: serverTimestamp(),
		})
	}
}

export const dms = new DMState(user)
