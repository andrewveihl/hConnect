<script lang="ts">
  export let placeholder = 'Message #general';
  export let onSend: (text: string) => Promise<void> | void;
  let text = '';
  async function submit() { const t = text.trim(); if (!t) return; await onSend?.(t); text = ''; }
  function keydown(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }
</script>

<div class="p-3 bg-[#313338] border-t border-black/40">
  <div class="flex gap-2 items-end">
    <textarea class="input h-24 resize-none flex-1" bind:value={text} on:keydown={keydown} placeholder={placeholder} />
    <button class="btn btn-primary h-10" on:click={submit}><i class="bx bx-send"></i></button>
  </div>
  <div class="text-xs text-white/50 mt-1">Tip: paste a <code>.gif</code> URL to embed</div>
</div>
