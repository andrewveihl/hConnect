# hConnect — AI Agent Guidelines

## Architecture

SvelteKit SPA (`ssr=false`, `adapter-static`) with Firebase Auth + Firestore. Tailwind CSS v4 via Vite plugin. Svelte 5 with `experimental.async` enabled.

**Layer separation is strict:**

- `src/lib/firebase/` — Firebase SDK initialization only (app, auth, firestore instances). No business logic.
- `src/lib/data/` — Reactive data classes that wrap Firestore subscriptions. **All Firestore reads and writes MUST go through these classes.** Components never import from `firebase/firestore` directly.
- `src/routes/` — UI components consume data classes via getters; never call Firestore APIs.

## Data Layer Pattern (CRITICAL)

Every data class in `src/lib/data/` follows this exact pattern using `createSubscriber` from `svelte/reactivity`:

```ts
import { createSubscriber } from 'svelte/reactivity'
import { collection, onSnapshot } from 'firebase/firestore'
import { firestore } from '../firebase/firestore'

export class ExampleState {
	#data?: ExampleType[]
	#subscribe: VoidFunction

	constructor(parentId: string) {
		this.#subscribe = createSubscriber((update) => {
			const col = collection(firestore, 'parent', parentId, 'children')
			return onSnapshot(col, (snap) => {
				this.#data = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }))
				update()
			})
		})
	}

	get current() {
		this.#subscribe()
		return this.#data
	}

	// Write methods go here (addDoc, updateDoc, deleteDoc)
}
```

### Rules for new data classes

1. **Private state + `createSubscriber`**: Store data in `#private` fields. Wrap `onSnapshot` inside `createSubscriber`, call `update()` on changes, return the unsubscribe function.
2. **Getter calls `#subscribe()`**: The `get current()` (or similar) getter must call `this.#subscribe()` before returning state. This registers the reactive dependency.
3. **Lazy & auto-cleaning**: Firestore listeners activate only when a component reads the getter in a reactive context. `createSubscriber` unsubscribes automatically when no consumers remain.
4. **Module-level singletons** for global state (e.g., `export const user = new UserState()`). Parameterized state (channels, messages) is instantiated in components via `$derived(new ChannelsState(server_id))`.
5. **Reactive re-subscription**: When constructor args depend on reactive values, wrap instantiation in `$derived` — the old instance is discarded and its subscription cleaned up automatically.
6. **Nested subscriptions** (see `profile.svelte.ts`): When one query depends on another's results, manage inner/outer unsubscribes explicitly in the `createSubscriber` cleanup return.
7. **No `$effect` for subscriptions** — always use `createSubscriber`. `$effect` is only for DOM side-effects in components.
8. **File naming**: Data classes use `.svelte.ts` extension (required for `$derived` and runes in non-component files).

## Firestore Data Model

```
servers/{server_id}           — name, icon, ...
  channels/{channel_id}       — name, ...
    messages/{message_id}     — text, author { displayName, photoURL }, createdAt
profiles/{uid}
  servers/{server_id}         — membership docs (IDs reference servers collection)
```

Collections are lowercase and plural. Documents map with `{ ...doc.data(), id: doc.id }`.

## Firestore Initialization

Firestore uses `persistentLocalCache` with `persistentSingleTabManager({ forceOwnership: true })` for offline support. Do not reconfigure this.

## Component Patterns

- `Auth.svelte` gates the app: renders children only when authenticated, login screen when not, nothing while loading (`user.current === undefined`).
- Route components create parameterized data instances: `const channels = $derived(new ChannelsState(page.params.server_id))`.
- Access data via `.current` getter (returns `undefined` while loading, array when loaded).

## Build & Dev Commands

| Command       | Purpose                           |
| ------------- | --------------------------------- |
| `pnpm dev`    | Dev server (HTTPS via mkcert)     |
| `pnpm build`  | Static production build           |
| `pnpm check`  | TypeScript + Svelte type checking |
| `pnpm lint`   | Prettier check                    |
| `pnpm format` | Prettier format                   |

No test framework is configured. Run `pnpm check` to validate changes.

## Code Style

- TypeScript strict mode, Prettier formatting
- Barrel exports via `index.ts` in `src/lib/data/` and `src/lib/components/`
- Import Firebase instances from `$lib/firebase`, data classes from `$lib/data`
- Tailwind CSS classes directly in markup (no CSS modules)
