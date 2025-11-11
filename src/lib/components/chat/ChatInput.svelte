<script lang="ts">
  import { run, preventDefault } from 'svelte/legacy';

  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import GifPicker from './GifPicker.svelte';
  import EmojiPicker from './EmojiPicker.svelte';
  import PollBuilder from '$lib/components/forms/PollBuilder.svelte';
  import FormBuilder from '$lib/components/forms/FormBuilder.svelte';
  import type { ReplyReferenceInput } from '$lib/firestore/messages';
  import { looksLikeImage, formatBytes } from '$lib/utils/fileType';
  import { requestReplySuggestion, requestPredictions, requestRewriteSuggestions } from '$lib/api/ai';
  import type { ReplyMessageContext } from '$lib/api/ai';

  type MentionCandidate = {
    uid: string;
    label: string;
    handle: string;
    avatar: string | null;
    search: string;
    aliases: string[];
    kind?: 'member' | 'role';
    color?: string | null;
  };

  type MentionRecord = {
    uid: string;
    handle: string;
    label: string;
    color?: string | null;
    kind?: 'member' | 'role';
  };

  type ReplyablePayload<T> = T & { replyTo?: ReplyReferenceInput | null };
  type UploadRequest = { files: File[]; replyTo?: ReplyReferenceInput | null };
  type AttachmentDraft = {
    id: string;
    file: File;
    name: string;
    size?: number;
    contentType?: string | null;
    isImage: boolean;
    previewUrl: string | null;
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

  const pickString = (value: unknown) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '';
  };

  type RewriteMode =
    | 'rephrase'
    | 'shorten'
    | 'elaborate'
    | 'formal'
    | 'casual'
    | 'bulletize'
    | 'summarize';

  const MAX_AI_CONTEXT = 10;
  const MIN_REWRITE_LENGTH = 20;

  const rewriteActions: Array<{ id: RewriteMode; label: string; icon: string; description: string }> = [
    { id: 'rephrase', label: 'Rephrase', icon: 'bx-wand', description: 'Same meaning, fresher wording.' },
    { id: 'shorten', label: 'Shorten', icon: 'bx-cut', description: 'Trim it down to the essentials.' },
    { id: 'elaborate', label: 'Elaborate', icon: 'bx-expand', description: 'Add a bit more helpful detail.' },
    { id: 'formal', label: 'More formal', icon: 'bx-briefcase', description: 'Polish it for announcements.' },
    { id: 'casual', label: 'More casual', icon: 'bx-coffee', description: 'Relaxed tone for friends.' },
    { id: 'bulletize', label: 'Bulletize', icon: 'bx-list-ul', description: 'Break it into quick bullets.' },
    { id: 'summarize', label: 'Summarize', icon: 'bx-notepad', description: 'Recap the draft in a blurb.' }
  ];

  const rewriteActionLookup = new Map<RewriteMode, (typeof rewriteActions)[number]>(
    rewriteActions.map((action) => [action.id, action])
  );

  function mentionScore(option: MentionCandidate, rawQuery: string, canonicalQuery: string) {
    if (!rawQuery) return 0;
    const lower = rawQuery.toLowerCase();
    let score = 0;
    const handle = option.handle.toLowerCase();
    if (handle.startsWith(lower)) score += 5;
    else if (handle.includes(lower)) score += 2;
    const label = option.label.toLowerCase();
    if (label.startsWith(lower)) score += 4;
    else if (label.includes(lower)) score += 1;
    if (canonicalQuery) {
      const aliasHit = option.aliases.some((alias) => alias.startsWith(canonicalQuery));
      if (aliasHit) score += 3;
    }
    if (option.kind === 'member') score += 0.1;
    return score;
  }


  interface Props {
    placeholder?: string;
    disabled?: boolean;
    mentionOptions?: MentionCandidate[];
    replyTarget?: ReplyReferenceInput | null;
    replySource?: any | null;
    defaultSuggestionSource?: any | null;
    conversationContext?: any[] | null;
    aiAssistEnabled?: boolean;
    threadLabel?: string | null;
    onSend?: (payload: ReplyablePayload<{ text: string; mentions?: MentionRecord[] }>) => void;
    onUpload?: (payload: UploadRequest) => void;
    onSendGif?: (payload: ReplyablePayload<{ url: string }>) => void;
    onCreatePoll?: (payload: ReplyablePayload<{ question: string; options: string[] }>) => void;
    onCreateForm?: (payload: ReplyablePayload<{ title: string; questions: string[] }>) => void;
  }

  let {
    placeholder = 'Message #channel',
    disabled = false,
    mentionOptions = [],
    replyTarget = null,
    replySource = null,
    defaultSuggestionSource = null,
    conversationContext = [],
    aiAssistEnabled = false,
    threadLabel = '',
    onSend = () => {},
    onUpload = () => {},
    onSendGif = () => {},
    onCreatePoll = () => {},
    onCreateForm = () => {}
  }: Props = $props();

  const dispatch = createEventDispatcher();

  let text = $state('');
  let popOpen = $state(false);
  let showGif = $state(false);
  let showPoll = $state(false);
  let showForm = $state(false);
  let showEmoji = $state(false);
  let emojiSupported = $state(false);
  let emojiTriggerEl: HTMLDivElement | null = $state(null);
  let disposeEmojiOutside: (() => void) | null = $state(null);
  let fileEl: HTMLInputElement | null = $state(null);
  let inputEl: HTMLTextAreaElement | null = $state(null);
  let attachments: AttachmentDraft[] = $state([]);
  let inputFocused = false;
  let keyboardInsetFrame: number | null = null;
  let syncKeyboardInset: (() => void) | null = null;

  let mentionActive = $state(false);
  let mentionFiltered: MentionCandidate[] = $state([]);
  let mentionIndex = $state(0);
  let mentionQuery = '';
  let mentionStart = -1;
  let mentionLookup = $state(new Map<string, MentionCandidate>());
  let mentionAliasLookup = $state(new Map<string, MentionCandidate>());
  const mentionDraft = new Map<string, MentionRecord>();

  let platform: 'desktop' | 'mobile' = 'desktop';
  let aiServiceAvailable = $state(true);
  let aiReplySuggestion = $state<string | null>(null);
  let aiReplyLoading = $state(false);
  let aiReplyError: string | null = $state(null);
  let replySuggestionAbort: AbortController | null = null;
  let lastReplySuggestionId: string | null = null;

  let aiGeneralSuggestion = $state<string | null>(null);
  let aiGeneralLoading = $state(false);
  let aiGeneralError: string | null = $state(null);
  let generalSuggestionAbort: AbortController | null = null;
  let lastGeneralSuggestionId: string | null = null;

  let aiInlineSuggestion = $state('');
  let aiPredictionLoading = $state(false);
  let aiPredictionError: string | null = $state(null);
  let predictionAbort: AbortController | null = null;
  let predictionTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPredictionSeed = '';
  let aiContextWindow: ReplyMessageContext[] = $state([]);
  let rewriteMenuOpen = $state(false);
  let rewriteMenuEl: HTMLDivElement | null = $state(null);
  let rewriteMenuButton: HTMLButtonElement | null = $state(null);
  let disposeRewriteOutside: (() => void) | null = $state(null);
  let rewriteMode: RewriteMode | null = $state(null);
  let rewriteDefaultMode: RewriteMode = $state('rephrase');
  let rewriteOptions: string[] = $state([]);
  let rewriteIndex = $state(0);
  let rewriteLoading = $state(false);
  let rewriteError: string | null = $state(null);
  let rewriteAbort: AbortController | null = null;
  let rewriteSeed = '';
  let rewriteHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let rewriteHoldTriggered = false;

  const aiAssistAllowed = $derived(Boolean(aiAssistEnabled && aiServiceAvailable));
  const isDesktop = $derived(platform === 'desktop');
  const showReplyCoach = $derived(Boolean(aiAssistAllowed && isDesktop && replyTarget?.messageId));
  const showGeneralCoach = $derived(Boolean(aiAssistAllowed && !replyTarget && defaultSuggestionSource && !text.trim()));
  const showDesktopPrediction = $derived(Boolean(aiAssistAllowed && isDesktop));
  const rewriteEligible = $derived(Boolean(aiAssistAllowed && text.trim().length >= MIN_REWRITE_LENGTH));
  const showRewriteCoach = $derived(
    Boolean(aiAssistAllowed && rewriteMode && (rewriteLoading || rewriteError || rewriteOptions.length))
  );
  const activeRewrite = $derived(
    rewriteOptions.length ? rewriteOptions[Math.min(rewriteIndex, rewriteOptions.length - 1)] ?? '' : ''
  );
  const rewriteModeLabel = $derived(
    rewriteMode
      ? rewriteActionLookup.get(rewriteMode)?.label ?? 'Rewrite'
      : rewriteActionLookup.get(rewriteDefaultMode)?.label ?? 'Rewrite'
  );
  const rewriteModeIcon = $derived(
    rewriteMode
      ? rewriteActionLookup.get(rewriteMode)?.icon ?? 'bx-wand'
      : rewriteActionLookup.get(rewriteDefaultMode)?.icon ?? 'bx-wand'
  );

  const REPLY_PREVIEW_LIMIT = 160;
  const KEYBOARD_OFFSET_VAR = '--chat-keyboard-offset';
  const KEYBOARD_MOBILE_MAX_WIDTH = 900;
  const KEYBOARD_ACTIVATION_THRESHOLD = 80;
  const createAttachmentId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `draft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)
      .toString(36)
      .padStart(4, '0')}`;
  };

  const buildAttachmentDraft = (file: File): AttachmentDraft => {
    const isImage = looksLikeImage({ name: file?.name, type: file?.type });
    const previewUrl =
      isImage && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null;
    return {
      id: createAttachmentId(),
      file,
      name: file?.name || 'Attachment',
      size: file?.size,
      contentType: file?.type ?? null,
      isImage,
      previewUrl
    };
  };

  const revokeAttachmentPreview = (entry: AttachmentDraft | null | undefined) => {
    if (entry?.previewUrl) {
      try {
        URL.revokeObjectURL(entry.previewUrl);
      } catch {
        // ignore
      }
    }
  };

  function queueAttachments(files: File[]) {
    const selection = files.filter((file): file is File => file instanceof File);
    if (!selection.length) return;
    const drafts = selection.map((file) => buildAttachmentDraft(file));
    attachments = [...attachments, ...drafts];
  }

  const dedupeFiles = (list: File[]) => {
    const result: File[] = [];
    const seen = new Set<string>();
    for (const file of list) {
      if (!(file instanceof File)) continue;
      const key = `${file.name ?? 'unknown'}|${file.size ?? 0}|${file.lastModified ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(file);
    }
    return result;
  };

  function removeAttachment(id: string) {
    const target = attachments.find((item) => item.id === id);
    if (target) revokeAttachmentPreview(target);
    attachments = attachments.filter((item) => item.id !== id);
  }

  function clearAttachments() {
    attachments.forEach((entry) => revokeAttachmentPreview(entry));
    attachments = [];
  }

  function clipReply(value: string | null | undefined, limit = REPLY_PREVIEW_LIMIT) {
    if (!value) return '';
    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  }

  function replyRecipientLabel(target: ReplyReferenceInput | null) {
    if (!target) return '';
    return target.authorName || target.authorId || 'Member';
  }

  function replyPreviewText(target: ReplyReferenceInput | null) {
    if (!target) return '';
    const value = clipReply(target.preview ?? target.text ?? '');
    if (value) return value;
    switch (target.type) {
      case 'gif':
        return 'GIF';
      case 'file':
        return 'File';
      case 'poll':
        return 'Poll';
      case 'form':
        return 'Form';
      default:
        return 'Message';
    }
  }

  async function cancelReply() {
    dispatch('cancelReply');
    await tick();
    inputEl?.focus();
  }


  function submit(e?: Event) {
    e?.preventDefault();
    if (disabled) return;
    const trimmed = text.trim();
    const hasText = Boolean(trimmed);
    const hasAttachments = attachments.length > 0;
    if (!hasText && !hasAttachments) return;
    const replyRef = replyTarget ?? null;

    if (hasText) {
      const mentions = collectMentions(text);
      const payload = {
        text: trimmed,
        mentions,
        replyTo: replyRef ?? undefined
      };
      onSend(payload);
      dispatch('send', payload);
      text = '';
      clearRewriteState(true);
      clearPredictions();
      lastPredictionSeed = '';
      mentionDraft.clear();
      closeMentionMenu();
    }

    if (hasAttachments) {
      const payload: UploadRequest = {
        files: attachments.map((item) => item.file),
        replyTo: replyRef
      };
      onUpload(payload);
      dispatch('upload', payload);
      clearAttachments();
    }

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => {
        inputEl?.focus();
      });
    } else {
      setTimeout(() => inputEl?.focus(), 0);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!mentionActive && showDesktopPrediction && aiInlineSuggestion && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      acceptInlineSuggestion();
      return;
    }

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
    popOpen = false;
    fileEl?.click();
  }

  function onFilesChange(e: Event) {
    const input = e.target as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (!files.length) return;
    if (disabled) {
      if (input) input.value = '';
      return;
    }
    queueAttachments(files);
    if (input) {
      input.value = '';
    }
  }

  function handlePaste(event: ClipboardEvent) {
    if (disabled) return;
    const data = event.clipboardData;
    if (!data) return;
    const directFiles = Array.from(data.files ?? []);
    const itemFiles = Array.from(data.items ?? [])
      .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
      .filter((file): file is File => file instanceof File);
    const merged = dedupeFiles([...directFiles, ...itemFiles]);
    if (!merged.length) return;
    queueAttachments(merged);
  }

  function handleInput() {
    refreshMentionDraft();
    if (mentionOptions.length) {
      updateMentionState();
    }
  }

  function handleSelectionChange() {
    if (!mentionOptions.length) return;
    requestAnimationFrame(() => updateMentionState());
  }

  function handleTextareaFocus() {
    inputFocused = true;
    syncKeyboardInset?.();
  }

  function handleTextareaBlur() {
    inputFocused = false;
    syncKeyboardInset?.();
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
          label: candidate.label,
          color: candidate.color ?? null,
          kind: candidate.kind
        };
        collected.set(candidate.uid, record);
      }
    }

    return Array.from(collected.values());
  }

  function contextIdOf(source: any): string | null {
    const raw = source?.id ?? source?.messageId ?? null;
    if (typeof raw === 'string' && raw.trim().length) return raw.trim();
    return null;
  }

  function buildMessagePayload(source: any): ReplyMessageContext | null {
    if (!source) return null;
    const text =
      pickString(source?.text) ??
      pickString(source?.content) ??
      pickString(source?.preview ?? '');
    const preview =
      pickString(source?.preview ?? '') ??
      pickString(source?.text ?? '') ??
      pickString(source?.content ?? '') ??
      '';
    const type = pickString(source?.type ?? '');
    const author =
      pickString(source?.displayName) ??
      pickString(source?.authorName) ??
      pickString(source?.author?.displayName) ??
      pickString(source?.name) ??
      null;
    if (!text && !preview && !type) return null;
    return {
      text: text || null,
      preview: preview || null,
      author,
      type: type || null
    };
  }

  function cancelReplySuggestion(clear = true) {
    replySuggestionAbort?.abort();
    replySuggestionAbort = null;
    if (clear) {
      aiReplyLoading = false;
      aiReplySuggestion = null;
      aiReplyError = null;
      lastReplySuggestionId = null;
    }
  }

  async function fetchReplyCoach(force = false) {
    if (!showReplyCoach) return;
    const contextSource = replySource ?? replyTarget ?? null;
    const messageId = contextIdOf(contextSource);
    if (!messageId) return;
    if (!force && messageId === lastReplySuggestionId && aiReplySuggestion) return;
    const payload = buildMessagePayload(contextSource);
    if (!payload) return;
    replySuggestionAbort?.abort();
    const controller = new AbortController();
    replySuggestionAbort = controller;
    aiReplyLoading = true;
    aiReplyError = null;
    try {
      const suggestion = await requestReplySuggestion(
        {
          message: payload,
          threadLabel: pickString(threadLabel) || null,
          context: aiContextWindow
        },
        controller.signal
      );
      if (replySuggestionAbort !== controller) return;
      aiReplySuggestion = suggestion || null;
      lastReplySuggestionId = messageId;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      aiReplyError = message;
      if (/openai api key missing/i.test(message)) {
        aiServiceAvailable = false;
      }
    } finally {
      if (replySuggestionAbort === controller) {
        aiReplyLoading = false;
      }
    }
  }

  function cancelGeneralSuggestion(clear = true) {
    generalSuggestionAbort?.abort();
    generalSuggestionAbort = null;
    if (clear) {
      aiGeneralLoading = false;
      aiGeneralSuggestion = null;
      aiGeneralError = null;
      lastGeneralSuggestionId = null;
    }
  }

  async function fetchGeneralSuggestion(force = false) {
    if (!showGeneralCoach) return;
    const source = defaultSuggestionSource;
    const messageId = contextIdOf(source);
    if (!messageId) return;
    if (!force && messageId === lastGeneralSuggestionId && aiGeneralSuggestion) return;
    const payload = buildMessagePayload(source);
    if (!payload) return;
    generalSuggestionAbort?.abort();
    const controller = new AbortController();
    generalSuggestionAbort = controller;
    aiGeneralLoading = true;
    aiGeneralError = null;
    try {
      const suggestion = await requestReplySuggestion(
        {
          message: payload,
          threadLabel: pickString(threadLabel) || null,
          context: aiContextWindow
        },
        controller.signal
      );
      if (generalSuggestionAbort !== controller) return;
      aiGeneralSuggestion = suggestion || null;
      lastGeneralSuggestionId = messageId;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      aiGeneralError = message;
      if (/openai api key missing/i.test(message)) {
        aiServiceAvailable = false;
      }
    } finally {
      if (generalSuggestionAbort === controller) {
        aiGeneralLoading = false;
      }
    }
  }

  function clearPredictions() {
    predictionAbort?.abort();
    predictionAbort = null;
    aiInlineSuggestion = '';
    aiPredictionError = null;
    aiPredictionLoading = false;
  }

  function queuePrediction() {
    if (!aiAssistAllowed || !showDesktopPrediction) return;
    if (predictionTimer) {
      clearTimeout(predictionTimer);
      predictionTimer = null;
    }
    if (!text.trim()) {
      clearPredictions();
      lastPredictionSeed = '';
      return;
    }
    predictionTimer = setTimeout(() => {
      predictionTimer = null;
      void fetchPrediction();
    }, 280);
  }

  async function fetchPrediction(force = false) {
    if (!aiAssistAllowed || !showDesktopPrediction) return;
    const seed = text;
    if (!seed.trim()) {
      clearPredictions();
      lastPredictionSeed = '';
      return;
    }
    if (!force && seed === lastPredictionSeed && aiInlineSuggestion) {
      return;
    }
    predictionAbort?.abort();
    const controller = new AbortController();
    predictionAbort = controller;
    aiPredictionLoading = true;
    aiPredictionError = null;
    try {
      const suggestions = await requestPredictions(
        {
          text: seed,
          platform
        },
        controller.signal
      );
      if (predictionAbort !== controller) return;
      lastPredictionSeed = seed;
      aiInlineSuggestion = showDesktopPrediction ? suggestions[0] ?? '' : '';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      aiPredictionError = message;
      if (/openai api key missing/i.test(message)) {
        aiServiceAvailable = false;
      }
    } finally {
      if (predictionAbort === controller) {
        aiPredictionLoading = false;
      }
    }
  }

  function appendSuggestion(next: string) {
    const value = pickString(next);
    if (!value) return;
    const needsSpace = text.length > 0 && !/\s$/.test(text);
    const base = needsSpace ? `${text} ${value}` : `${text}${value}`;
    text = `${base} `;
    lastPredictionSeed = '';
    queuePrediction();
    requestAnimationFrame(() => inputEl?.focus());
  }

  function acceptInlineSuggestion() {
    if (!aiInlineSuggestion) return;
    appendSuggestion(aiInlineSuggestion);
    aiInlineSuggestion = '';
  }

  function insertSuggestionText(source: string | null) {
    const suggestion = pickString(source);
    if (!suggestion) return false;
    if (!text.trim()) {
      text = `${suggestion} `;
    } else {
      const needsBreak = !text.endsWith('\n\n');
      text = `${text}${needsBreak ? '\n\n' : ''}${suggestion} `;
    }
    lastPredictionSeed = '';
    queuePrediction();
    requestAnimationFrame(() => inputEl?.focus());
    return true;
  }

  function applyReplySuggestion() {
    void insertSuggestionText(aiReplySuggestion);
  }

  function regenerateReplySuggestion() {
    lastReplySuggestionId = null;
    void fetchReplyCoach(true);
  }

  function applyGeneralSuggestion() {
    void insertSuggestionText(aiGeneralSuggestion);
  }

  function regenerateGeneralSuggestion() {
    lastGeneralSuggestionId = null;
    void fetchGeneralSuggestion(true);
  }

  function closeRewriteMenu() {
    rewriteMenuOpen = false;
    rewriteHoldTriggered = false;
    clearRewriteHoldTimer();
  }

  function clearRewriteState(clearMode = false) {
    rewriteAbort?.abort();
    rewriteAbort = null;
    rewriteLoading = false;
    rewriteError = null;
    rewriteOptions = [];
    rewriteIndex = 0;
    rewriteSeed = '';
    if (clearMode) {
      rewriteMode = null;
    }
  }

  function handleRewriteAction(mode: RewriteMode) {
    rewriteDefaultMode = mode;
    rewriteMode = mode;
    void runRewrite(mode, true);
    closeRewriteMenu();
  }

  async function runRewrite(mode: RewriteMode, force = false) {
    if (!aiAssistAllowed) {
      rewriteError = 'AI currently unavailable.';
      rewriteLoading = false;
      return;
    }
    const trimmed = text.trim();
    const minimum = mode === 'rephrase' ? 1 : MIN_REWRITE_LENGTH;
    if (!trimmed || trimmed.length < minimum) {
      rewriteError = mode === 'rephrase' ? 'Draft is too short to rephrase.' : 'Type a bit more first.';
      rewriteLoading = false;
      return;
    }
    if (!force && rewriteSeed === trimmed && rewriteOptions.length) {
      return;
    }
    rewriteAbort?.abort();
    const controller = new AbortController();
    rewriteAbort = controller;
    rewriteLoading = true;
    rewriteError = null;
    rewriteSeed = trimmed;
    rewriteOptions = [];
    rewriteIndex = 0;
    try {
      const options = await requestRewriteSuggestions(
        {
          text: trimmed,
          threadLabel: pickString(threadLabel) || null,
          context: aiContextWindow,
          mode
        },
        controller.signal
      );
      if (rewriteAbort !== controller) return;
      rewriteOptions = options;
      rewriteIndex = 0;
      if (!options.length) {
        rewriteError = 'No rewrite ready yet.';
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      rewriteError = message;
      if (/openai api key missing/i.test(message)) {
        aiServiceAvailable = false;
      }
    } finally {
      if (rewriteAbort === controller) {
        rewriteLoading = false;
      }
    }
  }

  function clearRewriteHoldTimer() {
    if (rewriteHoldTimer) {
      clearTimeout(rewriteHoldTimer);
      rewriteHoldTimer = null;
    }
  }

  function handleRewritePointerDown() {
    if (disabled || !aiAssistAllowed) return;
    rewriteHoldTriggered = false;
    clearRewriteHoldTimer();
    rewriteHoldTimer = setTimeout(() => {
      rewriteHoldTimer = null;
      rewriteHoldTriggered = true;
      rewriteMenuOpen = true;
    }, 450);
  }

  function handleRewritePointerUp() {
    clearRewriteHoldTimer();
  }

  function handleRewritePointerLeave() {
    clearRewriteHoldTimer();
  }

  function handleRewriteClick(event: MouseEvent) {
    if (rewriteHoldTriggered) {
      rewriteHoldTriggered = false;
      event.preventDefault();
      return;
    }
    if (!aiAssistAllowed) {
      event.preventDefault();
      return;
    }
    const mode = rewriteDefaultMode ?? 'rephrase';
    rewriteMode = mode;
    void runRewrite(mode, true);
    rewriteMenuOpen = false;
  }

  function acceptRewrite() {
    const proposal = pickString(activeRewrite);
    if (!proposal) return;
    text = proposal;
    clearRewriteState(true);
    lastPredictionSeed = '';
    queuePrediction();
    requestAnimationFrame(() => inputEl?.focus());
  }

  function dismissRewrite() {
    clearRewriteState(true);
  }

  function cycleRewriteOption() {
    if (rewriteOptions.length > 1) {
      rewriteIndex = (rewriteIndex + 1) % rewriteOptions.length;
    } else {
      void runRewrite(rewriteDefaultMode, true);
    }
  }

  function retryRewrite() {
    rewriteOptions = [];
    rewriteIndex = 0;
    rewriteError = null;
    rewriteSeed = '';
    void runRewrite(rewriteDefaultMode, true);
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

    let filtered: MentionCandidate[] = [];
    if (!mentionOptions.length) {
      filtered = [];
    } else if (!mentionQuery) {
      filtered = mentionOptions
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
        .slice(0, 3);
    } else {
      filtered = mentionOptions
        .map((option) => ({
          option,
          score: mentionScore(option, mentionQuery, canonicalQuery)
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) =>
          b.score !== a.score
            ? b.score - a.score
            : a.option.label.localeCompare(b.option.label, undefined, { sensitivity: 'base' })
        )
        .slice(0, 3)
        .map((entry) => entry.option);
    }

    mentionFiltered = filtered;
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
    mentionDraft.set(option.uid, {
      uid: option.uid,
      handle: handleText,
      label: option.label,
      color: option.color ?? null,
      kind: option.kind
    });
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
    const payload = { url, replyTo: replyTarget ?? undefined };
    onSendGif(payload);
    dispatch('sendGif', payload);
    showGif = false;
  }
  function onPollCreate(poll: { question: string; options: string[] }) {
    const payload = { ...poll, replyTo: replyTarget ?? undefined };
    onCreatePoll(payload);
    dispatch('createPoll', payload);
    showPoll = false;
  }
  function onFormCreate(form: { title: string; questions: string[] }) {
    const payload = { ...form, replyTo: replyTarget ?? undefined };
    onCreateForm(payload);
    dispatch('createForm', payload);
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
    queuePrediction();
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

  function registerRewriteOutsideWatcher() {
    if (typeof document === 'undefined') return null;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rewriteMenuEl?.contains(target) || rewriteMenuButton?.contains(target)) return;
      rewriteMenuOpen = false;
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
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

  onMount(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;

    const applyKeyboardInset = () => {
      if (keyboardInsetFrame) cancelAnimationFrame(keyboardInsetFrame);
      keyboardInsetFrame = requestAnimationFrame(() => {
        keyboardInsetFrame = null;
        if (!inputFocused || window.innerWidth > KEYBOARD_MOBILE_MAX_WIDTH) {
          root.style.setProperty(KEYBOARD_OFFSET_VAR, '0px');
          return;
        }
        const diff = Math.max(0, Math.round(window.innerHeight - viewport.height));
        const offset = diff > KEYBOARD_ACTIVATION_THRESHOLD ? diff : 0;
        root.style.setProperty(KEYBOARD_OFFSET_VAR, offset ? `${offset}px` : '0px');
      });
    };

    const handleViewportChange = () => applyKeyboardInset();
    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    syncKeyboardInset = applyKeyboardInset;
    applyKeyboardInset();

    return () => {
      viewport.removeEventListener('resize', handleViewportChange);
      viewport.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      if (keyboardInsetFrame) cancelAnimationFrame(keyboardInsetFrame);
      root.style.setProperty(KEYBOARD_OFFSET_VAR, '0px');
      syncKeyboardInset = null;
    };
  });

  onMount(() => {
    if (typeof window === 'undefined') return;
    const coarse = window.matchMedia('(pointer:coarse)');
    const update = () => {
      const prefersCoarse = coarse.matches;
      const narrow = window.innerWidth <= 768;
      platform = prefersCoarse || narrow ? 'mobile' : 'desktop';
    };
    update();
    window.addEventListener('resize', update);
    coarse.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      coarse.removeEventListener('change', update);
    };
  });

  onDestroy(() => {
    clearAttachments();
    cancelReplySuggestion();
    cancelGeneralSuggestion();
    clearPredictions();
    clearRewriteState(true);
    disposeRewriteOutside?.();
    clearRewriteHoldTimer();
    if (predictionTimer) {
      clearTimeout(predictionTimer);
      predictionTimer = null;
    }
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
  run(() => {
    mentionLookup = new Map(
      mentionOptions.map((option) => [option.handle.toLowerCase(), option])
    );
  });
  run(() => {
    mentionAliasLookup = new Map(
      mentionOptions.flatMap((option) =>
        option.aliases.map((alias) => [alias, option] as [string, MentionCandidate])
      )
    );
  });
  run(() => {
    if (!mentionOptions.length) {
      mentionDraft.clear();
      closeMentionMenu();
    }
  });
  run(() => {
    disposeEmojiOutside?.();
    disposeEmojiOutside = showEmoji ? registerEmojiOutsideWatcher() : null;
  });

  run(() => {
    const sources = Array.isArray(conversationContext) ? conversationContext : [];
    const normalized = sources
      .map((entry) => buildMessagePayload(entry))
      .filter((entry): entry is ReplyMessageContext => Boolean(entry));
    aiContextWindow = normalized.slice(-MAX_AI_CONTEXT);
  });

  run(() => {
    disposeRewriteOutside?.();
    disposeRewriteOutside = rewriteMenuOpen ? registerRewriteOutsideWatcher() : null;
  });

  run(() => {
    if (!aiAssistAllowed) {
      rewriteMenuOpen = false;
    }
  });

  run(() => {
    if (!rewriteEligible) {
      clearRewriteState(true);
    }
  });

  run(() => {
    if (!rewriteMode || rewriteLoading) return;
    if (rewriteSeed && text.trim() !== rewriteSeed) {
      rewriteOptions = [];
      rewriteIndex = 0;
      rewriteError = null;
    }
  });

  run(() => {
    if (showReplyCoach) {
      void fetchReplyCoach();
    } else {
      cancelReplySuggestion();
    }
  });

  run(() => {
    if (showGeneralCoach) {
      void fetchGeneralSuggestion();
    } else {
      cancelGeneralSuggestion();
    }
  });

  run(() => {
    if (!aiAssistAllowed) {
      cancelReplySuggestion();
      cancelGeneralSuggestion();
      clearPredictions();
      return;
    }
    if (!text.trim()) {
      clearPredictions();
      lastPredictionSeed = '';
      return;
    }
    if (showDesktopPrediction) {
      queuePrediction();
    }
  });
</script>

<svelte:window onkeydown={onEsc} />

<div class="chat-input-root">
  <div class="chat-input-overlays">
    {#if showGeneralCoach}
      <div class="ai-card ai-card--standalone ai-card--suggested" role="status">
        <div class="suggested-reply">
          <div class="suggested-reply__icon">
            <i class="bx bx-message-rounded-dots" aria-hidden="true"></i>
          </div>
          <div class="suggested-reply__content">
            <div class="suggested-reply__label">Suggested reply</div>
            {#if aiGeneralLoading}
              <div class="suggested-reply__status">Drafting a reply...</div>
            {:else if aiGeneralError}
              <div class="suggested-reply__status suggested-reply__status--error">{aiGeneralError}</div>
            {:else if aiGeneralSuggestion}
              <p class="suggested-reply__text">{aiGeneralSuggestion}</p>
            {:else}
              <div class="suggested-reply__status">No reply yet. Tap refresh.</div>
            {/if}
          </div>
          <div class="suggested-reply__actions">
            {#if aiGeneralError}
              <button type="button" class="ai-card__button" onclick={regenerateGeneralSuggestion}>
                Try again
              </button>
            {:else if aiGeneralSuggestion}
              <button
                type="button"
                class="ai-card__button ai-card__button--primary"
                onclick={applyGeneralSuggestion}
              >
                Use
              </button>
              <button type="button" class="ai-card__button" onclick={regenerateGeneralSuggestion}>
                Refresh
              </button>
            {:else if !aiGeneralLoading}
              <button type="button" class="ai-card__button" onclick={regenerateGeneralSuggestion}>
                Refresh
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if showRewriteCoach}
      <div class="ai-card ai-card--standalone ai-card--rewrite" role="status">
        <div class="ai-card__header">
          <div class="ai-card__badge">
            <i class="bx bx-wand" aria-hidden="true"></i>
            <span>Rewrite &mdash; {rewriteModeLabel}</span>
          </div>
          {#if rewriteOptions.length > 1}
            <div class="ai-card__meta">{rewriteIndex + 1}/{rewriteOptions.length}</div>
          {/if}
        </div>
        <div class="ai-card__body">
          {#if rewriteLoading && !activeRewrite}
            <div class="ai-card__status">Polishing your draft...</div>
          {:else if rewriteError}
            <div class="ai-card__status ai-card__status--error">{rewriteError}</div>
            <div class="ai-card__actions">
              <button type="button" class="ai-card__button ai-card__button--primary" onclick={retryRewrite}>
                Try again
              </button>
              <button type="button" class="ai-card__button" onclick={dismissRewrite}>
                Dismiss
              </button>
            </div>
          {:else if activeRewrite}
            <p class="ai-card__text">{activeRewrite}</p>
            <div class="ai-card__actions ai-card__actions--triple">
              <button type="button" class="ai-card__button ai-card__button--primary" onclick={acceptRewrite}>
                Replace draft
              </button>
              <button type="button" class="ai-card__button" onclick={dismissRewrite}>
                Keep mine
              </button>
              <button type="button" class="ai-card__button" onclick={cycleRewriteOption}>
                Another take
              </button>
            </div>
          {:else}
            <div class="ai-card__status">Hang tight while we polish that draft.</div>
          {/if}
        </div>
      </div>
    {/if}

    {#if showDesktopPrediction && (aiInlineSuggestion || aiPredictionLoading || aiPredictionError)}
      <button
        type="button"
        class={`ai-inline-hint ${aiPredictionLoading && !aiInlineSuggestion ? 'is-loading' : ''}`}
        onclick={acceptInlineSuggestion}
        disabled={!aiInlineSuggestion}
      >
        {#if aiInlineSuggestion}
          <span class="ai-inline-hint__label">Next</span>
          <span class="ai-inline-hint__text">{aiInlineSuggestion}</span>
          <span class="ai-inline-hint__meta">Press Tab</span>
        {:else if aiPredictionError}
          <span class="ai-inline-hint__status ai-inline-hint__status--error">AI paused</span>
        {:else}
          <span class="ai-inline-hint__status">Predicting...</span>
        {/if}
      </button>
    {/if}
  </div>

  <div class="chat-input-stack">
  {#if replyTarget}
    <div class="reply-banner" role="status">
      <div class="reply-banner__indicator" aria-hidden="true"></div>
      <div class="reply-banner__body">
        <div class="reply-banner__label">Replying to</div>
        <div class="reply-banner__name">{replyRecipientLabel(replyTarget)}</div>
        <div class="reply-banner__preview">{replyPreviewText(replyTarget)}</div>
        {#if showReplyCoach}
          <div class="ai-card ai-card--inline" role="status">
            <div class="ai-card__header">
              <div class="ai-card__badge">
                <i class="bx bx-sparkles" aria-hidden="true"></i>
                <span>Reply coach</span>
              </div>
              {#if !aiReplyLoading}
                <button type="button" class="ai-card__pill" onclick={regenerateReplySuggestion}>
                  Refresh
                </button>
              {/if}
            </div>
            <div class="ai-card__body">
              {#if aiReplyLoading}
                <div class="ai-card__status">Drafting a suggestion...</div>
              {:else if aiReplyError}
                <div class="ai-card__status ai-card__status--error">{aiReplyError}</div>
                <div class="ai-card__actions">
                  <button type="button" class="ai-card__button" onclick={regenerateReplySuggestion}>
                    Try again
                  </button>
                </div>
              {:else if aiReplySuggestion}
                <p class="ai-card__text">{aiReplySuggestion}</p>
                <div class="ai-card__actions">
                  <button type="button" class="ai-card__button ai-card__button--primary" onclick={applyReplySuggestion}>
                    Insert suggestion
                  </button>
                  <button type="button" class="ai-card__button" onclick={regenerateReplySuggestion}>
                    Another idea
                  </button>
                </div>
              {:else}
                <div class="ai-card__status">Tap refresh to get a draft.</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="reply-banner__close"
        onclick={cancelReply}
        aria-label="Cancel reply"
      >
        <i class="bx bx-x"></i>
      </button>
    </div>
  {/if}

  {#if attachments.length}
    <div class="chat-attachments" role="list">
      {#each attachments as attachment}
        {@const attachmentSize = formatBytes(attachment.size)}
        <div class="chat-attachment" role="listitem">
          {#if attachment.isImage && attachment.previewUrl}
            <div class="chat-attachment__thumb">
              <img src={attachment.previewUrl} alt={attachment.name} loading="lazy" />
            </div>
          {:else}
            <div class="chat-attachment__icon" aria-hidden="true">
              <i class="bx bx-paperclip"></i>
            </div>
          {/if}
          <div class="chat-attachment__meta">
            <div class="chat-attachment__name" title={attachment.name}>{attachment.name}</div>
            <div class="chat-attachment__info">
              <span>{attachment.contentType ?? (attachment.isImage ? 'Image' : 'File')}</span>
              {#if attachmentSize}
                <span aria-hidden="true">&bull;</span>
                <span>{attachmentSize}</span>
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="chat-attachment__remove"
            aria-label={`Remove ${attachment.name}`}
            onclick={() => removeAttachment(attachment.id)}
          >
            <i class="bx bx-x"></i>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <form onsubmit={preventDefault(submit)} class="relative flex items-center gap-2">
    <div class="relative">
      <button
        type="button"
        class="rounded-full px-3 py-2 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60 transition-colors"
        aria-haspopup="menu"
        aria-expanded={popOpen}
        aria-label="Add to message"
        title="Add to message"
        onclick={() => (popOpen = !popOpen)}
        disabled={disabled}
      >
        <i class="bx bx-plus text-xl leading-none" aria-hidden="true"></i>
      </button>

      {#if popOpen}
        <div class="chat-input-popover" role="menu">
          <div class="chat-input-popover__header">Add to message</div>
          <div class="chat-input-menu">
            <button class="chat-input-menu__item" role="menuitem" onclick={openGif}>
              <span class="chat-input-menu__icon">
                <i class="bx bx-film" aria-hidden="true"></i>
              </span>
              <div class="chat-input-menu__content">
                <span class="chat-input-menu__title">Add GIF</span>
                <span class="chat-input-menu__subtitle">Share a fun animated moment.</span>
              </div>
            </button>
            <button class="chat-input-menu__item" role="menuitem" onclick={pickFiles}>
              <span class="chat-input-menu__icon">
                <i class="bx bx-paperclip" aria-hidden="true"></i>
              </span>
              <div class="chat-input-menu__content">
                <span class="chat-input-menu__title">Upload files</span>
                <span class="chat-input-menu__subtitle">Send documents, audio, or images.</span>
              </div>
            </button>
            <button class="chat-input-menu__item" role="menuitem" onclick={openPoll}>
              <span class="chat-input-menu__icon">
                <i class="bx bx-pie-chart-alt" aria-hidden="true"></i>
              </span>
              <div class="chat-input-menu__content">
                <span class="chat-input-menu__title">Create poll</span>
                <span class="chat-input-menu__subtitle">Let everyone vote on an option.</span>
              </div>
            </button>
            <button class="chat-input-menu__item" role="menuitem" onclick={openForm}>
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

      <input class="hidden" type="file" multiple bind:this={fileEl} onchange={onFilesChange} />
    </div>

    <div class="flex-1 relative chat-input__field">

      <textarea
        class="input textarea flex-1 rounded-full bg-[#383a40] border border-black/40 px-4 py-2 placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        rows="1"
        bind:this={inputEl}
        bind:value={text}
        placeholder={placeholder}
        onkeydown={onKeydown}
        oninput={handleInput}
        onpaste={handlePaste}
        onkeyup={handleSelectionChange}
        onclick={handleSelectionChange}
        onfocus={handleTextareaFocus}
        onblur={handleTextareaBlur}
        {disabled}
        aria-label="Message input"
></textarea>

      {#if mentionActive}
        <div class="mention-menu" role="listbox">
          <div class="mention-menu__header">Tag someone or a role</div>
          <div class="mention-menu__list">
            {#each mentionFiltered as option, idx}
              <button
                type="button"
                class={`mention-menu__item ${option.kind === 'role' ? 'mention-menu__item--role' : ''} ${idx === mentionIndex ? 'is-active' : ''}`}
                role="option"
                aria-selected={idx === mentionIndex}
                onmousedown={preventDefault(() => insertMention(option))}
                onmouseenter={() => (mentionIndex = idx)}
              >
                <span class={`mention-menu__avatar ${option.kind === 'role' ? 'mention-menu__avatar--role' : ''}`}>
                  {#if option.kind === 'role'}
                    <span
                      class="mention-menu__role-swatch"
                      style={`background:${option.color ?? 'var(--color-accent)'}`}
                    ></span>
                  {:else if option.avatar}
                    <img src={option.avatar} alt={option.label} loading="lazy" />
                  {:else}
                    <span>{initialsFor(option.label)}</span>
                  {/if}
                </span>
                <span class="mention-menu__meta">
                  <span class="mention-menu__label">
                    {option.label}
                    {#if option.kind === 'role'}
                      <span
                        class="mention-menu__pill"
                        style={`color:${option.color ?? 'var(--color-accent)'}`}
                      >
                        Role
                      </span>
                    {/if}
                  </span>
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
            onclick={openEmoji}
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

      <div class="rewrite-trigger">
        <button
          type="button"
          class="rewrite-button"
          onclick={handleRewriteClick}
          onpointerdown={handleRewritePointerDown}
          onpointerup={handleRewritePointerUp}
          onpointerleave={handleRewritePointerLeave}
          onpointercancel={handleRewritePointerLeave}
          disabled={disabled || !aiAssistAllowed}
          aria-haspopup="menu"
          aria-expanded={rewriteMenuOpen}
          bind:this={rewriteMenuButton}
        >
          <i class={`bx ${rewriteModeIcon}`} aria-hidden="true"></i>
          <span>{rewriteModeLabel}</span>
        </button>
        {#if rewriteMenuOpen}
          <div class="rewrite-menu" bind:this={rewriteMenuEl} role="menu">
            <div class="rewrite-menu__header">Sound-check message</div>
            {#if !rewriteEligible}
              <div class="rewrite-menu__hint">Type a few more words to unlock rewrites.</div>
            {/if}
            <div class="rewrite-menu__list">
              {#each rewriteActions as action}
                {@const actionBusy = rewriteLoading && rewriteMode === action.id}
                <button
                  type="button"
                  role="menuitem"
                  class={`rewrite-menu__item ${!rewriteEligible ? 'is-disabled' : ''} ${actionBusy ? 'is-busy' : ''}`}
                  onclick={() => handleRewriteAction(action.id)}
                  disabled={!rewriteEligible || actionBusy}
                >
                  <span class="rewrite-menu__icon">
                    <i class={`bx ${action.icon}`} aria-hidden="true"></i>
                  </span>
                  <span class="rewrite-menu__content">
                    <span class="rewrite-menu__title">{action.label}</span>
                    <span class="rewrite-menu__description">{action.description}</span>
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <button
        class="chat-send-button"
        type="submit"
        disabled={disabled || (!text.trim() && attachments.length === 0)}
        aria-label="Send message"
        title="Send"
      >
        Send
      </button>
    </div>
  </form>
</div>
</div>

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
  .chat-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
    border-radius: var(--radius-xl);
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
  }

  .chat-attachment {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    max-width: 15rem;
    padding: 0.35rem 0.5rem 0.35rem 0.35rem;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel) 94%, transparent);
  }

  .chat-attachment__thumb,
  .chat-attachment__icon {
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-md);
    overflow: hidden;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    display: grid;
    place-items: center;
  }

  .chat-attachment__thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .chat-attachment__icon i {
    font-size: 1.3rem;
    color: var(--text-70);
  }

  .chat-attachment__meta {
    min-width: 0;
    flex: 1;
  }

  .chat-attachment__name {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-attachment__info {
    font-size: 0.75rem;
    color: var(--text-60);
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .chat-attachment__remove {
    border: none;
    background: transparent;
    color: var(--text-60);
    border-radius: 999px;
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition: color 120ms ease, background 120ms ease;
  }

  .chat-attachment__remove:hover,
  .chat-attachment__remove:focus-visible {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
    outline: none;
  }

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

  .chat-input-root {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .chat-input-overlays {
    position: absolute;
    left: 0;
    right: auto;
    bottom: calc(100% + 0.6rem);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    width: min(420px, 100%);
    pointer-events: none;
    align-items: flex-start;
  }

  .chat-input-overlays > * {
    pointer-events: auto;
  }

  .chat-input-stack {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .reply-banner {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.65rem 0.95rem;
    border-radius: 1.2rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.015);
  }

  .reply-banner__indicator {
    width: 0.3rem;
    align-self: stretch;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 70%, transparent);
  }

  .reply-banner__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .reply-banner__label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-55);
  }

  .reply-banner__name {
    font-weight: 600;
    color: var(--color-text-primary);
    font-size: 0.85rem;
  }

  .reply-banner__preview {
    font-size: 0.82rem;
    color: var(--text-70);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ai-card {
    border-radius: 1.1rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 18px 32px rgba(5, 8, 18, 0.32);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .ai-card--inline {
    margin-top: 0.65rem;
  }

  .ai-card--standalone {
    margin-bottom: 0.65rem;
  }

  .ai-card--rewrite {
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-panel) 85%, var(--color-accent) 18%),
      color-mix(in srgb, var(--color-panel-muted) 90%, transparent)
    );
    border-color: color-mix(in srgb, var(--color-border-subtle) 45%, var(--color-accent) 20%);
  }

  .ai-card--suggested {
    padding: 0.4rem 0.6rem;
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
    box-shadow: none;
  }

  .ai-card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ai-card__badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    padding: 0.22rem 0.75rem;
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-accent) 80%, white);
    background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  }

  .ai-card__badge i {
    font-size: 1rem;
  }

  .ai-card__pill {
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: transparent;
    color: var(--text-65);
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.22rem 0.9rem;
    font-weight: 650;
  }

  .ai-card__meta {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-55);
  }

  .ai-card__body {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .ai-card__text {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }

  .ai-card__status {
    font-size: 0.82rem;
    color: var(--text-65);
  }

  .ai-card__status--error {
    color: var(--color-danger, #ff9a9a);
  }

  .ai-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .ai-card__button {
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    background: transparent;
    color: var(--text-70);
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.42rem 1rem;
    transition: background 150ms ease, border 150ms ease, color 150ms ease;
  }

  .ai-card__button:hover,
  .ai-card__button:focus-visible {
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    outline: none;
  }

  .ai-card__button--primary {
    border-color: transparent;
    background: color-mix(in srgb, var(--color-accent) 70%, transparent);
    color: color-mix(in srgb, var(--color-panel-muted) 96%, white);
  }

  .suggested-reply {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .suggested-reply__icon {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    display: grid;
    place-items: center;
    color: var(--color-accent);
    flex-shrink: 0;
  }

  .suggested-reply__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .suggested-reply__label {
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-55);
  }

  .suggested-reply__text {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-text-primary);
  }

  .suggested-reply__status {
    font-size: 0.8rem;
    color: var(--text-60);
  }

  .suggested-reply__status--error {
    color: var(--color-danger, #ff8a8a);
  }

  .suggested-reply__actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .suggested-reply__actions .ai-card__button {
    padding: 0.3rem 0.85rem;
  }






  .reply-banner__close {
    border: 0;
    background: transparent;
    color: var(--text-60);
    padding: 0.15rem;
    border-radius: 999px;
    line-height: 1;
    display: grid;
    place-items: center;
  }

  .reply-banner__close:hover,
  .reply-banner__close:focus-visible {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-border-subtle) 35%, transparent);
    outline: none;
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
    right: auto;
    top: auto;
    bottom: calc(100% + 0.6rem);
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

  .mention-menu__avatar--role {
    padding: 0.2rem;
  }

  .mention-menu__role-swatch {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
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

  .mention-menu__pill {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    margin-left: 0.35rem;
  }

  .chat-input__field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .ai-inline-hint {
    align-self: flex-start;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    background: color-mix(in srgb, var(--color-panel) 70%, transparent);
    color: var(--text-70);
    font-size: 0.75rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.75rem;
    pointer-events: auto;
    z-index: 15;
  }

  .ai-inline-hint:disabled {
    opacity: 0.75;
    cursor: default;
  }

  .ai-inline-hint__label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.68rem;
    color: var(--text-55);
  }

  .ai-inline-hint__text {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .ai-inline-hint__meta {
    color: var(--text-50);
    font-size: 0.68rem;
  }

  .ai-inline-hint__status {
    font-size: 0.75rem;
    color: var(--text-55);
  }

  .ai-inline-hint__status--error {
    color: var(--color-danger, #ffb4b4);
  }



  .chat-input__actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .rewrite-trigger {
    position: relative;
  }

  .rewrite-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    color: var(--text-70);
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.4rem 0.9rem;
  }

  .rewrite-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .rewrite-button:not(:disabled):hover,
  .rewrite-button:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--color-panel-muted) 95%, transparent);
    outline: none;
  }

  .rewrite-menu {
    position: absolute;
    top: auto;
    bottom: calc(100% + 0.45rem);
    right: 0;
    width: min(18rem, 80vw);
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel) 94%, transparent);
    padding: 0.75rem;
    z-index: 60;
    box-shadow:
      0 14px 26px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }

  .rewrite-menu__header {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-55);
    margin-bottom: 0.4rem;
  }

  .rewrite-menu__hint {
    font-size: 0.78rem;
    color: var(--text-60);
    margin-bottom: 0.4rem;
  }

  .rewrite-menu__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .rewrite-menu__item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    border-radius: 0.85rem;
    border: 1px solid transparent;
    background: transparent;
    padding: 0.45rem 0.55rem;
    text-align: left;
    transition: background 140ms ease, border 140ms ease;
  }

  .rewrite-menu__item:not(:disabled):hover,
  .rewrite-menu__item:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    border-color: color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    outline: none;
  }

  .rewrite-menu__item:disabled,
  .rewrite-menu__item.is-disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .rewrite-menu__icon {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 0.9rem;
    background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
    display: grid;
    place-items: center;
    color: var(--color-accent);
  }

  .rewrite-menu__content {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    color: var(--color-text-primary);
  }

  .rewrite-menu__title {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .rewrite-menu__description {
    font-size: 0.77rem;
    color: var(--text-60);
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
