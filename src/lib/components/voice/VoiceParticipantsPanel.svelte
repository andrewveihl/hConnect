<script lang="ts">
	import { run } from 'svelte/legacy';

	import { onDestroy } from 'svelte';
	import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getDb } from '$lib/firebase';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';

	interface Props {
		serverId?: string | null;
		channelId?: string | null;
	}

	type Participant = {
		uid: string;
		displayName: string;
		photoURL: string | null;
		hasAudio: boolean;
		hasVideo: boolean;
		screenSharing: boolean;
		status: 'active' | 'left' | 'removed';
		joinedAt?: any;
	};

	let { serverId = null, channelId = null }: Props = $props();
	let participants: Participant[] = $state([]);
	let unsub: Unsubscribe | null = null;

	function initials(name: string | null | undefined) {
		if (!name) return '?';
		const trimmed = name.trim();
		if (!trimmed) return '?';
		return trimmed.charAt(0).toUpperCase();
	}

	run(() => {
		unsub?.();
		participants = [];
		if (!serverId || !channelId) return;
		const db = getDb();
		const callDoc = doc(db, 'servers', serverId, 'channels', channelId, 'calls', 'live');
		const ref = collection(callDoc, 'participants');
		unsub = onSnapshot(ref, (snap) => {
			participants = snap.docs
				.map((entry) => {
					const data = entry.data() as any;
					return {
						uid: data.uid ?? entry.id,
						displayName: data.displayName ?? 'Member',
						photoURL: resolveProfilePhotoURL(data),
						hasAudio: data.hasAudio ?? true,
						hasVideo: data.hasVideo ?? false,
						screenSharing: data.screenSharing ?? false,
						status: data.status ?? 'active',
						joinedAt: data.joinedAt ?? null
					} as Participant;
				})
				.filter((p) => p.status !== 'left')
				.sort((a, b) => {
					const aTime = a.joinedAt?.toMillis?.() ?? 0;
					const bTime = b.joinedAt?.toMillis?.() ?? 0;
					return bTime - aTime;
				});
		});
	});

	onDestroy(() => {
		unsub?.();
	});
</script>

<section class="flex min-h-0 flex-col gap-3" aria-label="Call members">
	<header class="flex items-center justify-between text-[color:var(--color-text-primary)]">
		<div class="flex items-center gap-2 text-sm font-semibold">
			<i class="bx bx-user-voice text-lg text-[color:var(--color-text-secondary)]"></i>
			<span>In call</span>
		</div>
		<span
			class="grid h-7 min-w-[28px] place-items-center rounded-full bg-[color:var(--color-panel-muted)] px-2 text-sm font-semibold text-[color:var(--color-text-primary)]"
		>
			{participants.length}
		</span>
	</header>

	{#if !participants.length}
		<div
			class="grid place-items-center gap-2 rounded-xl border border-dashed border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)]/70 px-4 py-6 text-[color:var(--color-text-secondary)]"
		>
			<i class="bx bx-planet text-xl"></i>
			<span class="text-sm font-semibold">Waiting for people to join.</span>
		</div>
	{:else}
		<ul class="flex flex-col gap-2 overflow-y-auto">
			{#each participants as participant (participant.uid)}
				<li
					class="flex items-center gap-3 rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)]/70 px-3 py-2"
				>
					<div
						class="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]"
					>
						{#if participant.photoURL}
							<img
								src={participant.photoURL}
								alt={participant.displayName}
								class="h-full w-full object-cover"
								loading="lazy"
							/>
						{:else}
							<span class="text-sm font-semibold">{initials(participant.displayName)}</span>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div
							class="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-text-primary)]"
						>
							<span class="truncate" title={participant.displayName}>{participant.displayName}</span
							>
							{#if participant.screenSharing}
								<span
									class="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-100"
								>
									Live
								</span>
							{/if}
						</div>
						<div
							class="mt-1 flex items-center gap-2 text-xs text-[color:var(--color-text-secondary)]"
						>
							<span
								class={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${participant.hasAudio ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}
							>
								<i class={`bx ${participant.hasAudio ? 'bx-microphone' : 'bx-microphone-off'}`}></i>
								<span>{participant.hasAudio ? 'Mic on' : 'Muted'}</span>
							</span>
							<span
								class={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${participant.hasVideo ? 'bg-sky-500/15 text-sky-200' : 'bg-rose-500/15 text-rose-200'}`}
							>
								<i class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off'}`}></i>
								<span>{participant.hasVideo ? 'Video' : 'Camera off'}</span>
							</span>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
