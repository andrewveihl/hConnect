<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import GifPicker from './GifPicker.svelte';
  import EmojiPicker from './EmojiPicker.svelte';
  import PollBuilder from '$lib/components/forms/PollBuilder.svelte';
  import FormBuilder from '$lib/components/forms/FormBuilder.svelte';

  type MentionCandidate = {
    uid: string;
    label: string;
    handle: string;
    avatar: string | null;
    search: string;
    aliases: string[];
  };

  type MentionRecord = {
    uid: string;
    handle: string;
    label: string;
  };

  const canonical = (value: string) =>
    (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const initialsFor = (value: string) => {
    const words = (value ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (!words.length) return '?';
    return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || '?';
  };

  export let placeholder: string = 'Message #channel';
  export let disabled = false;
  export let mentionOptions: MentionCandidate[] = [];

  export let onSend: (payload: { text: string; mentions?: MentionRecord[] }) => void = () => {};
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
  let showEmoji = false;
  let emojiSupported = false;
  let emojiTriggerEl: HTMLDivElement | null = null;
  let disposeEmojiOutside: (() => void) | null = null;
  let fileEl: HTMLInputElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;

  let mentionActive = false;
  let mentionFiltered: MentionCandidate[] = [];
  let mentionIndex = 0;
  let mentionQuery = '';
  let mentionStart = -1;
  let mentionLookup = new Map<string, MentionCandidate>();
  let mentionAliasLookup = new Map<string, MentionCandidate>();
  const mentionDraft = new Map<string, MentionRecord>();

  $: mentionLookup = new Map(
    mentionOptions.map((option) => [option.handle.toLowerCase(), option])
  );
  $: mentionAliasLookup = new Map(
    mentionOptions.flatMap((option) =>
      option.aliases.map((alias) => [alias, option] as [string, MentionCandidate])
    )
  );
  $: if (!mentionOptions.length) {
    mentionDraft.clear();
    closeMentionMenu();
  }

  function submit(e?: Event) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const mentions = collectMentions(text);
    const payload = { text: trimmed, mentions };
    onSend(payload);
    dispatch('send', payload);
    text = '';
    mentionDraft.clear();
    closeMentionMenu();
  }

  function onKeydown(e: KeyboardEvent) {
    if (mentionActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionIndex = (mentionIndex + 1) % mentionFiltered.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIndex = (mentionIndex - 1 + mentionFiltered.length) % mentionFiltered.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const choice = mentionFiltered[mentionIndex] ?? mentionFiltered[0];
        if (choice) void insertMention(choice);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMentionMenu();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function pickFiles() {
    fileEl?.click();
    popOpen = false;
  }

  function onFilesChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    onUpload(files);
    dispatch('upload', files);
    input.value = '';
  }

  function handleInput() {
    refreshMentionDraft();
    if (!mentionOptions.length) return;
    updateMentionState();
  }

  function handleSelectionChange() {
    if (!mentionOptions.length) return;
    requestAnimationFrame(() => updateMentionState());
  }

  function collectMentions(value: string): MentionRecord[] {
    const collected = new Map<string, MentionRecord>();
    mentionDraft.forEach((record) => {
      if (value.includes(record.handle)) collected.set(record.uid, record);
    });

    const regex = /@([a-z0-9._-]{2,64})/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value))) {
      const raw = match[1] ?? '';
      const byHandle = mentionLookup.get(raw.toLowerCase());
      const byAlias = mentionAliasLookup.get(canonical(raw));
      const candidate = byHandle ?? byAlias;
      if (candidate) {
        const record: MentionRecord = {
          uid: candidate.uid,
          handle: `@${candidate.handle}`,
          label: candidate.label
        };
        collected.set(candidate.uid, record);
      }
    }

    return Array.from(collected.values());
  }

  function refreshMentionDraft() {
    if (!mentionDraft.size) return;
    for (const [uid, record] of mentionDraft) {
      if (!text.includes(record.handle)) {
        mentionDraft.delete(uid);
      }
    }
  }

  function updateMentionState() {
    if (!inputEl || !mentionOptions.length || disabled) {
      closeMentionMenu();
      return;
    }

    const caret = inputEl.selectionStart ?? text.length;
    const prefix = text.slice(0, caret);
    const atIndex = prefix.lastIndexOf('@');

    if (atIndex === -1) {
      closeMentionMenu();
      return;
    }

    const prevChar = atIndex > 0 ? prefix.charAt(atIndex - 1) : ' ';
    if (/\S/.test(prevChar) && !/[\(\[\{]/.test(prevChar)) {
      closeMentionMenu();
      return;
    }

    const fragment = prefix.slice(atIndex + 1);
    if (fragment.includes(' ') || fragment.includes('\n') || fragment.includes('\t')) {
      closeMentionMenu();
      return;
    }

    mentionStart = atIndex;
    mentionQuery = fragment.toLowerCase();
    const canonicalQuery = canonical(fragment);

    const filtered = mentionOptions.filter((option) => {
      if (!mentionQuery) return true;
      const handleMatch = option.handle.toLowerCase().startsWith(mentionQuery);
      const labelMatch = option.label.toLowerCase().includes(mentionQuery);
      const aliasMatch = canonicalQuery
        ? option.aliases.some((alias) => alias.startsWith(canonicalQuery))
        : false;
      return handleMatch || labelMatch || aliasMatch;
    });

    mentionFiltered = filtered.slice(0, 8);
    if (!mentionFiltered.length) {
      closeMentionMenu();
      return;
    }

    mentionActive = true;
    mentionIndex = Math.min(mentionIndex, mentionFiltered.length - 1);
  }

  async function insertMention(option: MentionCandidate) {
    if (mentionStart < 0) return;
    const caret = inputEl?.selectionStart ?? text.length;
    const before = text.slice(0, mentionStart);
    const after = text.slice(caret);
    const handleText = `@${option.handle}`;
    text = `${before}${handleText} `;
    mentionDraft.set(option.uid, { uid: option.uid, handle: handleText, label: option.label });
    await tick();
    const nextCaret = before.length + handleText.length + 1;
    inputEl?.setSelectionRange(nextCaret, nextCaret);
    closeMentionMenu();
    refreshMentionDraft();
  }

  function closeMentionMenu() {
    mentionActive = false;
    mentionFiltered = [];
    mentionIndex = 0;
    mentionQuery = '';
    mentionStart = -1;
  }

  const openGif = () => {
    showGif = true;
    popOpen = false;
  };

  const openEmoji = () => {
    if (disabled || !emojiSupported) return;
    showEmoji = !showEmoji;
    if (showEmoji) popOpen = false;
  };
  const openPoll = () => {
    showPoll = true;
    popOpen = false;
  };
  const openForm = () => {
    showForm = true;
    popOpen = false;
  };

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

  async function insertEmoji(symbol: string) {
    if (!inputEl) return;
    const start = inputEl.selectionStart ?? text.length;
    const end = inputEl.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    text = `${before}${symbol}${after}`;
    await tick();
    const nextCaret = before.length + symbol.length;
    inputEl.focus();
    inputEl.setSelectionRange(nextCaret, nextCaret);
    refreshMentionDraft();
    handleSelectionChange();
  }

  function onEmojiPicked(symbol: string) {
    void insertEmoji(`${symbol} `);
    showEmoji = false;
  }

  function registerEmojiOutsideWatcher() {
    if (typeof document === 'undefined') return null;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!emojiTriggerEl) return;
      if (emojiTriggerEl.contains(target)) return;
      showEmoji = false;
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }

  $: {
    disposeEmojiOutside?.();
    disposeEmojiOutside = showEmoji ? registerEmojiOutsideWatcher() : null;
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px) and (pointer:fine)');
    const update = () => {
      emojiSupported = mq.matches;
      if (!emojiSupported) showEmoji = false;
    };
    update();
    mq.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
      disposeEmojiOutside?.();
    };
  });

  function onEsc(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (mentionActive) {
      closeMentionMenu();
      return;
    }
    if (showGif || showPoll || showForm || showEmoji) {
      showGif = showPoll = showForm = showEmoji = false;
    } else {
      popOpen = false;
    }
  }
</script>

<svelte:window on:keydown={onEsc} />

<form on:submit|preventDefault={submit} class="relative flex items-center gap-2">
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
      <div class="chat-input-popover" role="menu">
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

    <input class="hidden" type="file" multiple bind:this={fileEl} on:change={onFilesChange} />
  </div>

  <div class="flex-1 relative">
    <textarea
      class="input textarea flex-1 rounded-full bg-[#383a40] border border-black/40 px-4 py-2 placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      rows="1"
      bind:this={inputEl}
      bind:value={text}
      placeholder={placeholder}
      on:keydown={onKeydown}
      on:input={handleInput}
      on:keyup={handleSelectionChange}
      on:click={handleSelectionChange}
      {disabled}
      aria-label="Message input"
    />

    {#if mentionActive}
      <div class="mention-menu" role="listbox">
        <div class="mention-menu__header">Tag someone</div>
        <div class="mention-menu__list">
          {#each mentionFiltered as option, idx}
            <button
              type="button"
              class={`mention-menu__item ${idx === mentionIndex ? 'is-active' : ''}`}
              role="option"
              aria-selected={idx === mentionIndex}
              on:mousedown|preventDefault={() => insertMention(option)}
              on:mouseenter={() => (mentionIndex = idx)}
            >
              <span class="mention-menu__avatar">
                {#if option.avatar}
                  <img src={option.avatar} alt={option.label} loading="lazy" />
                {:else}
                  <span>{initialsFor(option.label)}</span>
                {/if}
              </span>
              <span class="mention-menu__meta">
                <span class="mention-menu__label">{option.label}</span>
                <span class="mention-menu__handle">@{option.handle}</span>
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="chat-input__actions">
    {#if emojiSupported}
      <div class="emoji-trigger" bind:this={emojiTriggerEl}>
        <button
          type="button"
          class="emoji-button"
          on:click={openEmoji}
          disabled={disabled}
          aria-label="Insert emoji"
          title="Insert emoji"
        >
          <i class="bx bx-smile text-xl leading-none"></i>
        </button>
        {#if showEmoji}
          <EmojiPicker on:close={() => (showEmoji = false)} on:pick={(e) => onEmojiPicked(e.detail)} />
        {/if}
      </div>
    {/if}
    <button
      class="chat-send-button"
      type="submit"
      disabled={disabled || !text.trim()}
      aria-label="Send message"
      title="Send"
    >
      Send
    </button>
  </div>
</form>

{#if showGif}
  <GifPicker on:close={() => (showGif = false)} on:pick={(e) => onGifPicked(e.detail)} />
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

  .textarea {
    width: 100%;
    min-height: 2.6rem;
    max-height: 9.5rem;
    resize: none;
    line-height: 1.4;
    font-family: inherit;
  }

  .mention-menu {
    position: absolute;
    z-index: 70;
    left: 0;
    top: calc(100% + 0.5rem);
    width: min(22rem, 100%);
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel) 95%, transparent);
    box-shadow: var(--shadow-elevated);
    overflow: hidden;
    backdrop-filter: blur(18px);
  }

  .mention-menu__header {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-55);
    padding: 0.45rem 0.85rem 0.35rem;
  }

  .mention-menu__list {
    display: grid;
    max-height: 16rem;
    overflow-y: auto;
  }

  .mention-menu__item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 0.85rem;
    background: transparent;
    border: 0;
    text-align: left;
    transition: background 140ms ease, color 140ms ease;
    color: inherit;
    cursor: pointer;
  }

  .mention-menu__item.is-active,
  .mention-menu__item:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-text-primary);
  }

  .mention-menu__avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    overflow: hidden;
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .mention-menu__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mention-menu__meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .mention-menu__label {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mention-menu__handle {
    font-size: 0.7rem;
    color: var(--text-60);
  }

  .chat-input__actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .emoji-trigger {
    position: relative;
  }

  .emoji-trigger :global(.emoji-panel) {
    position: absolute;
    bottom: calc(100% + 0.5rem);
    right: 0;
    z-index: 40;
  }

  .emoji-button {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 999px;
    border: 1px solid var(--button-ghost-border);
    background: var(--button-ghost-bg);
    color: var(--button-ghost-text);
    display: grid;
    place-items: center;
    transition: background 150ms ease, border 150ms ease, transform 120ms ease;
  }

  .emoji-button:hover:not(:disabled),
  .emoji-button:focus-visible:not(:disabled) {
    background: var(--button-ghost-hover);
    border-color: color-mix(in srgb, var(--button-ghost-border) 65%, transparent);
    outline: none;
  }

  .emoji-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-send-button {
    border-radius: var(--radius-pill);
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: 600;
    padding: 0.55rem 1.4rem;
    transition: background 150ms ease, transform 120ms ease;
  }

  .chat-send-button:hover:not(:disabled),
  .chat-send-button:focus-visible:not(:disabled) {
    background: var(--button-primary-hover);
    transform: translateY(-1px);
    outline: none;
  }

  .chat-send-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
</style>
