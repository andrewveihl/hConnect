<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import LocalGifPicker from './LocalGifPicker.svelte';
  import PollBuilder from './PollBuilder.svelte';
  import FormBuilder from './FormBuilder.svelte';

  export let placeholder: string = 'Message #channel';
  export let disabled = false;

  // Callbacks (optional; we also dispatch events)
  export let onSend: (text: string) => void = () => {};
  export let onUpload: (files: File[]) => void = () => {};
  export let onSendGif: (url: string) => void = () => {};
  export let onCreatePoll: (poll: { question: string; options: string[] }) => void = () => {};
  export let onCreateForm: (form: { title: string; questions: string[] }) => void = () => {};

  const dispatch = createEventDispatcher();

  let text = '';
  let popOpen = false;
  let showGif = false;
  let showPoll = false;
  let showForm = false;
  let fileEl: HTMLInputElement | null = null;

  function submit(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    dispatch('send', t);
    text = '';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function pickFiles() { fileEl?.click(); popOpen = false; }
  function onFilesChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    onUpload(files);
    dispatch('upload', files);
    input.value = '';
  }

  const openGif  = () => { showGif  = true; popOpen = false; };
  const openPoll = () => { showPoll = true; popOpen = false; };
  const openForm = () => { showForm = true; popOpen = false; };

  function onGifPicked(url: string) {
    onSendGif(url);
    dispatch('sendGif', url);
    showGif = false;
  }
  function onPollCreate(poll: { question: string; options: string[] }) {
    onCreatePoll(poll);
    dispatch('createPoll', poll);
    showPoll = false;
  }
  function onFormCreate(form: { title: string; questions: string[] }) {
    onCreateForm(form);
    dispatch('createForm', form);
    showForm = false;
  }

  function onEsc(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (showGif || showPoll || showForm) {
      showGif = showPoll = showForm = false;
    } else {
      popOpen = false;
    }
  }
</script>

<svelte:window on:keydown={onEsc} />

<!-- Keep relative so the popover anchors above the + -->
<form on:submit|preventDefault={submit} class="relative flex items-center gap-2">
  <!-- Plus -->
  <div class="relative">
    <button
      type="button"
      class="rounded-md px-2 py-2 hover:bg-white/10 disabled:opacity-60"
      aria-haspopup="menu"
      aria-expanded={popOpen}
      aria-label="Add…"
      title="Add…"
      on:click={() => (popOpen = !popOpen)}
      disabled={disabled}
    >
      <span class="inline-block text-xl leading-none">＋</span>
    </button>

    {#if popOpen}
      <div
        class="absolute bottom-full left-0 mb-2 z-50 w-56 rounded-xl border border-white/10 bg-[#1f2430]/95 backdrop-blur-xl shadow-2xl p-1"
        role="menu"
      >
        <div class="px-3 py-2 text-xs uppercase tracking-wide text-white/60">Add to message</div>
        <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10" role="menuitem" on:click={openGif}>🖼️ GIF</button>
        <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10" role="menuitem" on:click={pickFiles}>📎 Upload files</button>
        <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10" role="menuitem" on:click={openPoll}>📊 Poll</button>
        <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10" role="menuitem" on:click={openForm}>📝 Form</button>
      </div>
    {/if}

    <!-- hidden file input -->
    <input class="hidden" type="file" multiple bind:this={fileEl} on:change={onFilesChange} />
  </div>

  <!-- Text -->
  <input
    class="input flex-1 bg-[#383a40] border border-black/40 rounded-md px-3 py-2 placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
    type="text"
    bind:value={text}
    placeholder={placeholder}
    on:keydown={onKeydown}
    {disabled}
    aria-label="Message input"
  />

  <!-- Send -->
  <button
    class="bg-[#5865f2] hover:bg-[#4752c4] rounded-md px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
    type="submit"
    disabled={disabled || !text.trim()}
    aria-label="Send message"
    title="Send"
  >
    Send
  </button>
</form>

<!-- Modals -->
{#if showGif}
  <LocalGifPicker on:close={() => (showGif = false)} on:pick={(e) => onGifPicked(e.detail)} />
{/if}
{#if showPoll}
  <PollBuilder on:close={() => (showPoll = false)} on:create={(e) => onPollCreate(e.detail)} />
{/if}
{#if showForm}
  <FormBuilder on:close={() => (showForm = false)} on:create={(e) => onFormCreate(e.detail)} />
{/if}
