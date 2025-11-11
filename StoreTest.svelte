<script>
  import { writable } from 'svelte/store';
  const count = writable(0);
  $effect(() => {
    const id = setInterval(() => {
      count.update((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<p>{$count}</p>
