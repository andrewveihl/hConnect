<script lang="ts">
  // Props expected by your page
  export let placeholder: string = 'Message #channel';
  export let onSend: (text: string) => void = () => {};
  export let disabled: boolean = false; // optional external control

  let text = '';

  function submit(e: Event) {
    e.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    text = '';
  }

  // Optional: submit on Enter, allow Shift+Enter for newline (if you switch to textarea later)
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  }
</script>

<!-- Container stays visible regardless of chat history -->
<form on:submit|preventDefault={submit} class="flex items-center gap-2">
  <!-- Input -->
  <input
    class="input flex-1 bg-[#383a40] border border-black/40 rounded-md px-3 py-2 placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
    type="text"
    bind:value={text}
    placeholder={placeholder}
    on:keydown={onKeydown}
    {disabled}
    aria-label="Message input"
  />

  <!-- Send button -->
  <button
    class="btn btn-primary bg-[#5865f2] hover:bg-[#4752c4] rounded-md px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
    type="submit"
    disabled={disabled || !text.trim()}
    aria-label="Send message"
    title="Send"
  >
    Send
  </button>
</form>
