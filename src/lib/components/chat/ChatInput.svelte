<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import LocalGifPicker from './LocalGifPicker.svelte';
  import PollBuilder from '$lib/components/forms/PollBuilder.svelte';
  import FormBuilder from '$lib/components/forms/FormBuilder.svelte';

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
      class="rounded-full px-3 py-2 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60 transition-colors"
      aria-haspopup="menu"
      aria-expanded={popOpen}
      aria-label="Add to message"
      title="Add to message"
      on:click={() => (popOpen = !popOpen)}
      disabled={disabled}
    >
      <i class="bx bx-plus text-xl leading-none" aria-hidden="true"></i>
    </button>

    {#if popOpen}
      <div
        class="chat-input-popover"
        role="menu"
      >
        <div class="chat-input-popover__header">Add to message</div>
        <div class="chat-input-menu">
          <button class="chat-input-menu__item" role="menuitem" on:click={openGif}>
            <span class="chat-input-menu__icon">
              <i class="bx bx-film" aria-hidden="true"></i>
            </span>
            <div class="chat-input-menu__content">
              <span class="chat-input-menu__title">Add GIF</span>
              <span class="chat-input-menu__subtitle">Share a fun animated moment.</span>
            </div>
          </button>
          <button class="chat-input-menu__item" role="menuitem" on:click={pickFiles}>
            <span class="chat-input-menu__icon">
              <i class="bx bx-paperclip" aria-hidden="true"></i>
            </span>
            <div class="chat-input-menu__content">
              <span class="chat-input-menu__title">Upload files</span>
              <span class="chat-input-menu__subtitle">Send documents, audio, or images.</span>
            </div>
          </button>
          <button class="chat-input-menu__item" role="menuitem" on:click={openPoll}>
            <span class="chat-input-menu__icon">
              <i class="bx bx-pie-chart-alt" aria-hidden="true"></i>
            </span>
            <div class="chat-input-menu__content">
              <span class="chat-input-menu__title">Create poll</span>
              <span class="chat-input-menu__subtitle">Let everyone vote on an option.</span>
            </div>
          </button>
          <button class="chat-input-menu__item" role="menuitem" on:click={openForm}>
            <span class="chat-input-menu__icon">
              <i class="bx bx-detail" aria-hidden="true"></i>
            </span>
            <div class="chat-input-menu__content">
              <span class="chat-input-menu__title">Create form</span>
              <span class="chat-input-menu__subtitle">Collect structured responses.</span>
            </div>
          </button>
        </div>
      </div>
    {/if}

    <!-- hidden file input -->
    <input class="hidden" type="file" multiple bind:this={fileEl} on:change={onFilesChange} />
  </div>

  <!-- Text -->
  <input
    class="input flex-1 rounded-full bg-[#383a40] border border-black/40 px-4 py-2 placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
    type="text"
    bind:value={text}
    placeholder={placeholder}
    on:keydown={onKeydown}
    {disabled}
    aria-label="Message input"
  />

  <!-- Send -->
  <button
    class="rounded-full bg-[#5865f2] hover:bg-[#4752c4] px-5 py-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
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

<style>
  .chat-input-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 0.5rem;
    width: min(20rem, 80vw);
    z-index: 50;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    backdrop-filter: blur(18px);
    box-shadow: var(--shadow-elevated);
    padding: 0.75rem 0.6rem;
    color: var(--color-text-primary);
  }

  .chat-input-popover__header {
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-60);
    padding: 0 0.35rem 0.5rem;
  }

  .chat-input-menu {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .chat-input-menu__item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    padding: 0.55rem 0.6rem;
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    color: inherit;
    text-align: left;
    transition: transform 120ms ease, border 120ms ease, background 120ms ease;
  }

  .chat-input-menu__item:hover {
    background: color-mix(in srgb, var(--color-panel) 94%, transparent);
    border-color: color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    transform: translateY(-1px);
  }

  .chat-input-menu__icon {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: var(--radius-md);
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-accent);
    font-size: 1.1rem;
  }

  .chat-input-menu__content {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .chat-input-menu__title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-text-primary);
  }

  .chat-input-menu__subtitle {
    font-size: 0.72rem;
    color: var(--text-60);
  }

  :global(:root[data-theme='light']) .chat-input-popover {
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    border-color: color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    box-shadow: 0 18px 32px rgba(25, 34, 42, 0.18);
  }

  :global(:root[data-theme='light']) .chat-input-menu__item {
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
  }

  :global(:root[data-theme='light']) .chat-input-menu__item:hover {
    background: color-mix(in srgb, var(--color-panel) 100%, transparent);
  }

  :global(:root[data-theme='light']) .chat-input-menu__icon {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
</style>
