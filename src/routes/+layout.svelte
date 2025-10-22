<script lang="ts">
  import '../app.css';
  import { user as userStore } from '$lib/stores/user';

  export let data: { user: any };

  // Keep your global user store in sync for the rest of the app.
  $: userStore.set(data?.user ?? null);
</script>

<!-- App surface -->
<div class="min-h-dvh bg-[rgb(3,7,18)] text-white">
  <slot />
</div>
