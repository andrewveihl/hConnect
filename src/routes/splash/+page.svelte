<script lang="ts">
	import { onMount } from 'svelte';
	import SplashScreen from '$lib/components/app/SplashScreen.svelte';

	let isDemoReady = $state(true); // Controls the splash visibility for this dedicated demo page
	let timer: ReturnType<typeof setTimeout> | null = null;

	const playDemo = () => {
		if (timer) {
			clearTimeout(timer);
		}
		isDemoReady = false;
		timer = setTimeout(() => {
			isDemoReady = true;
		}, 2000);
	};

	onMount(() => {
		playDemo();
		return () => {
			if (timer) clearTimeout(timer);
		};
	});
</script>

<div class="splash-demo">
	<SplashScreen isAppReady={isDemoReady} />

	<section class="splash-demo__panel">
		<h1>hConnect Splash Demo</h1>
		<p>
			This route lets you replay the animated splash screen without reloading the entire app. Use it
			to preview tweaks before shipping to production.
		</p>
		<button type="button" class="splash-demo__button" onclick={playDemo}>
			Replay Splash Animation
		</button>
	</section>
</div>
