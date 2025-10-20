<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';
  import { getFirebase } from '$lib/firebase';
  import { onAuthStateChanged } from 'firebase/auth';

  onMount(() => {
    const { auth } = getFirebase();
    const unsub = onAuthStateChanged(auth, (u) => user.set(u));
    return () => unsub();
  });
</script>

<!-- Full-screen app surface (no header) -->
<div class="min-h-dvh bg-[rgb(3,7,18)] text-white">
  <slot />
</div>
