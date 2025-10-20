<script lang="ts">
  export let placeholder = 'Message…';
  export let onSend: (text: string) => void = () => {};
  let value = '';
  function send() {
    const v = value.trim(); if (!v) return;
    onSend(v); value = '';
  }
</script>

<div class="border-t border-white/10 p-3">
  <div class="rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
    <div class="flex items-center gap-2 px-2 py-1.5 border-b border-white/10">
      <button class="rounded-md px-2 py-1 text-sm bg-white/10 hover:bg-white/15">😊</button>
      <button class="rounded-md px-2 py-1 text-sm bg-white/10 hover:bg-white/15">＋</button>
      <div class="ml-auto text-white/40 text-xs pr-2">Ctrl+Enter to send</div>
    </div>
    <div class="flex items-center gap-2 px-3 py-2">
      <input
        class="flex-1 bg-transparent py-2 outline-none placeholder:text-white/40"
        bind:value
        on:keydown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) && (e.preventDefault(), send())}
        {placeholder}
      />
      <button class="rounded-lg bg-white text-slate-900 text-sm px-3 py-1.5" on:click={send}>Send</button>
    </div>
  </div>
</div>
