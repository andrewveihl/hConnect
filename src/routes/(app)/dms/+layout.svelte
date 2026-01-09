<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/stores/user';

	import { requestDMNotificationPermission, enableDMNotifications } from '$lib/notify/dms';

	interface Props {
		children?: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	let stopNotify: (() => void) | null = null;
	onMount(() => {
		(async () => {
			try {
				await requestDMNotificationPermission();
			} catch {
				// ignore permission errors
			}
		})();

		const unsubUser = user.subscribe((u) => {
			stopNotify?.();
			if (u?.uid) stopNotify = enableDMNotifications(u.uid);
			else stopNotify = null;
		});

		return () => {
			unsubUser();
			stopNotify?.();
		};
	});
</script>

<div class="flex-1 h-full flex flex-col overflow-hidden panel">
	{@render children?.()}
</div>
