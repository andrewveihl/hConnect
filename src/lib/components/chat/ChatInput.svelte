<script lang="ts">
	import { run, preventDefault } from 'svelte/legacy';

	import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	import GifPicker from './GifPicker.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import MentionMenu from './MentionMenu.svelte';
	import ChatAddonsPopover from './ChatAddonsPopover.svelte';
	import type {
		MentionCandidate as MentionCandidateType,
		MentionRecord as MentionRecordType
	} from './MentionMenu.svelte';
	import type { RewriteMode, PopoverPlacement } from './ChatAddonsPopover.svelte';
	import PollBuilder from '$lib/components/forms/PollBuilder.svelte';
	import FormBuilder from '$lib/components/forms/FormBuilder.svelte';
	import type { ReplyReferenceInput } from '$lib/firestore/messages';
	import { looksLikeImage, formatBytes } from '$lib/utils/fileType';
	import {
		requestReplySuggestion,
		requestPredictions,
		requestRewriteSuggestions
	} from '$lib/api/ai';
	import type { ReplyMessageContext } from '$lib/api/ai';
	import { mobileDockSuppressed } from '$lib/stores/ui';
	import { SPECIAL_MENTION_IDS } from '$lib/data/specialMentions';
	import { featureFlags } from '$lib/stores/featureFlags';
	import { playSound } from '$lib/utils/sounds';

	// Use types from the new separated components
	type MentionCandidate = MentionCandidateType;
	type MentionRecord = MentionRecordType;

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
		processing: boolean;
		progress: number;
	};

	type PopoverPlacement = {
		left: string;
		bottom: string;
		top?: string;
		width: string;
		maxHeight: string;
	};

	const canonical = (value: string) =>
		(value ?? '')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');

	const clampValue = (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max);

	const initialsFor = (value: string) => {
		const words = (value ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
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

	const rewriteActions: Array<{
		id: RewriteMode;
		label: string;
		icon: string;
		description: string;
	}> = [
		{
			id: 'rephrase',
			label: 'Rephrase',
			icon: 'bx-wand',
			description: 'Same meaning, fresher wording.'
		},
		{
			id: 'shorten',
			label: 'Shorten',
			icon: 'bx-cut',
			description: 'Trim it down to the essentials.'
		},
		{
			id: 'elaborate',
			label: 'Elaborate',
			icon: 'bx-expand',
			description: 'Add a bit more helpful detail.'
		},
		{
			id: 'formal',
			label: 'More formal',
			icon: 'bx-briefcase',
			description: 'Polish it for announcements.'
		},
		{
			id: 'casual',
			label: 'More casual',
			icon: 'bx-coffee',
			description: 'Relaxed tone for friends.'
		},
		{
			id: 'bulletize',
			label: 'Bulletize',
			icon: 'bx-list-ul',
			description: 'Break it into quick bullets.'
		},
		{
			id: 'summarize',
			label: 'Summarize',
			icon: 'bx-notepad',
			description: 'Recap the draft in a blurb.'
		}
	];

	const rewriteActionLookup = new Map<RewriteMode, (typeof rewriteActions)[number]>(
		rewriteActions.map((action) => [action.id, action])
	);

	function mentionScore(option: MentionCandidate, rawQuery: string, canonicalQuery: string) {
		if (!rawQuery) return 0;
		const lower = rawQuery.toLowerCase();
		
		const handle = (option.handle ?? '').toLowerCase();
		const label = (option.label ?? '').toLowerCase();
		
		// For special mentions (@everyone, @here), only match if the query matches the handle/label directly
		// Check for special kind OR special uid pattern
		const isSpecial = option.kind === 'special' || (option.uid ?? '').startsWith('special:');
		if (isSpecial) {
			// Must start with the query - "e" matches "everyone", "a" does not
			if (handle.startsWith(lower) || label.startsWith(lower)) {
				return 10;
			}
			return 0; // Don't show special mentions if query doesn't match handle/label
		}
		
		// For regular members/roles
		let score = 0;
		
		if (handle.startsWith(lower)) score += 5;
		else if (handle.includes(lower)) score += 2;
		
		if (label.startsWith(lower)) score += 4;
		else if (label.includes(lower)) score += 1;
		
		// Only check aliases for non-special mentions
		if (canonicalQuery && Array.isArray(option.aliases)) {
			const aliasHit = option.aliases.some((alias) => alias.startsWith(canonicalQuery));
			if (aliasHit) score += 3;
		}
		
		if (option.kind === 'member') score += 0.1;
		if (option.kind === 'role') score += 0.05;
		
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
		/** If false, the mobile dock won't be suppressed when the input is focused. Default: true */
		suppressDockOnFocus?: boolean;
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
		suppressDockOnFocus = true,
		onSend = () => {},
		onUpload = () => {},
		onSendGif = () => {},
		onCreatePoll = () => {},
		onCreateForm = () => {}
	}: Props = $props();

	const dispatch = createEventDispatcher();

	let text = $state('');
	let popOpen = $state(false);
	let plusTriggerEl: HTMLButtonElement | null = $state(null);
	let popoverEl: HTMLDivElement | null = $state(null);
	let popoverPlacement: PopoverPlacement = $state({
		left: '0.75rem',
		bottom: '5rem',
		top: 'auto',
		width: 'min(20rem, 90vw)',
		maxHeight: 'min(65vh, 26rem)'
	});
	let popoverOutsideCleanup: (() => void) | null = null;
	let showGif = $state(false);
	let showPoll = $state(false);
	let showForm = $state(false);
	let showEmoji = $state(false);
	let emojiSupported = $state(false);
	let emojiTriggerEl: HTMLDivElement | null = $state(null);
	let emojiPickerEl: HTMLDivElement | null = $state(null);
	let disposeEmojiOutside: (() => void) | null = $state(null);
	let fileEl: HTMLInputElement | null = $state(null);
	let inputEl: HTMLTextAreaElement | null = $state(null);
	let rootEl: HTMLDivElement | null = $state(null);
	let formEl: HTMLFormElement | null = $state(null);
	let attachments: AttachmentDraft[] = $state([]);
	let dragActive = $state(false);
	let dragDepth = 0;
	let platform: 'desktop' | 'mobile' = $state('desktop');
	const attachmentsProcessing = $derived.by(() => attachments.some((item) => item.processing));
	const sendDisabled = $derived.by(
		() => disabled || attachmentsProcessing || (!text.trim() && attachments.length === 0)
	);
	const showMobileSend = $derived.by(() => platform === 'mobile' && text.trim().length > 0);
	let inputFocused = false;
	let keyboardInsetFrame: number | null = null;
	let syncKeyboardInset: (() => void) | null = null;
	let dockSuppressionActive = false;
	let dockReleaseTimer: ReturnType<typeof setTimeout> | null = null;

	let mentionActive = $state(false);
	let mentionFiltered: MentionCandidate[] = $state([]);
	let mentionIndex = $state(0);
	let mentionQuery = '';
	let mentionStart = -1;
	let mentionLookup = $state(new Map<string, MentionCandidate>());
	let mentionAliasLookup = $state(new Map<string, MentionCandidate>());
	const mentionDraft = new Map<string, MentionRecord>();
	let mentionMenuPosition = $state({ left: '0px', bottom: '5rem', top: 'auto', maxHeight: '16rem' });
	let emojiPickerPosition = $state({
		left: 'auto',
		right: '12px',
		bottom: '5rem',
		top: 'auto',
		maxHeight: '440px'
	});

	type TextSegment =
		| { type: 'text'; content: string }
		| { type: 'mention'; content: string; record: MentionRecord };
	let textSegments = $state<TextSegment[]>([]);
	const hasMentions = $derived(textSegments.some((s) => s.type === 'mention'));

	const featureFlagStore = featureFlags;
	const aiPlatformEnabled = $derived(Boolean($featureFlagStore.enableAIFeatures));
	const aiSuggestionsEnabled = $derived(Boolean($featureFlagStore.enableAISuggestedReplies));
	const aiPredictionsEnabled = $derived(Boolean($featureFlagStore.enableAIPredictions));
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
	let predictionAbort: AbortController | null = null;
	let predictionTimer: ReturnType<typeof setTimeout> | null = null;
	let predictionScroll = $state(0);
	let predictionBoxStyle = $state('');
	let predictionContentEl: HTMLDivElement | null = $state(null);
	let predictionVerticalPadding = 0;
	let suggestedGhostEl: HTMLDivElement | null = $state(null);
	let suggestedGhostHeight = $state(0);
	let lastPredictionSeed = '';
	let aiContextWindow: ReplyMessageContext[] = $state([]);
	let rewriteMenuOpen = $state(false);
	let rewriteMode: RewriteMode | null = $state(null);
	let rewriteDefaultMode: RewriteMode = $state('rephrase');
	let rewriteOptions: string[] = $state([]);
	let rewriteIndex = $state(0);
	let rewriteLoading = $state(false);
	let rewriteError: string | null = $state(null);
	let rewriteAbort: AbortController | null = null;
	let rewriteSeed = '';
	let suggestionTapPrimed = false;
	let textareaExpanded = $state(false);

	const aiAssistAllowed = $derived(
		Boolean(aiAssistEnabled && aiServiceAvailable && aiPlatformEnabled)
	);
	const aiSuggestionCoachAllowed = $derived(Boolean(aiAssistAllowed && aiSuggestionsEnabled));
	const isDesktop = $derived(platform === 'desktop');
	const isReplying = $derived(Boolean(replyTarget?.messageId));
	const mobileSuggestionContext = $derived(
		replySource ?? replyTarget ?? defaultSuggestionSource ?? null
	);
	const showReplyCoach = $derived(Boolean(aiSuggestionCoachAllowed && isDesktop && isReplying));
	const showGeneralCoach = $derived(
		Boolean(
			aiSuggestionCoachAllowed &&
			!isDesktop &&
			isReplying &&
			mobileSuggestionContext &&
			!text.trim()
		)
	);
	const showReplyGhost = $derived(Boolean(showReplyCoach && !text.trim()));
	const showSuggestionGhost = $derived(Boolean(showGeneralCoach || showReplyGhost));
	const canUseReplySuggestion = $derived(Boolean(showReplyGhost && pickString(aiReplySuggestion)));
	const showInlinePrediction = $derived(Boolean(aiAssistAllowed && aiPredictionsEnabled));
	const hasInlinePrediction = $derived(Boolean(showInlinePrediction && aiInlineSuggestion));
	const canUseGeneralSuggestion = $derived(
		Boolean(showGeneralCoach && pickString(aiGeneralSuggestion))
	);
	const rewriteEligible = $derived(
		Boolean(aiAssistAllowed && text.trim().length >= MIN_REWRITE_LENGTH)
	);
	const showRewriteCoach = $derived(
		Boolean(
			aiAssistAllowed && rewriteMode && (rewriteLoading || rewriteError || rewriteOptions.length)
		)
	);
	const activeRewrite = $derived(
		rewriteOptions.length
			? (rewriteOptions[Math.min(rewriteIndex, rewriteOptions.length - 1)] ?? '')
			: ''
	);
	const rewriteModeLabel = $derived(
		rewriteMode
			? (rewriteActionLookup.get(rewriteMode)?.label ?? 'Rewrite')
			: (rewriteActionLookup.get(rewriteDefaultMode)?.label ?? 'Rewrite')
	);
	const rewriteModeIcon = $derived(
		rewriteMode
			? (rewriteActionLookup.get(rewriteMode)?.icon ?? 'bx-wand')
			: (rewriteActionLookup.get(rewriteDefaultMode)?.icon ?? 'bx-wand')
	);

	const REPLY_PREVIEW_LIMIT = 160;
	const KEYBOARD_OFFSET_VAR = '--chat-keyboard-offset';
	const SAFE_AREA_VAR = '--chat-safe-area-bottom';
	const KEYBOARD_MOBILE_MAX_WIDTH = 900;
	const KEYBOARD_ACTIVATION_THRESHOLD = 80;
	const PROCESSING_MIN_MS = 450;
	const PROCESSING_MAX_MS = 1800;
	const PROCESSING_BYTES_PER_MS = 1500;
	const attachmentTimers = new Map<string, ReturnType<typeof setInterval>>();
	const createAttachmentId = () => {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `draft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)
			.toString(36)
			.padStart(4, '0')}`;
	};

	const buildAttachmentDraft = (file: File, processing = false): AttachmentDraft => {
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
			previewUrl,
			processing,
			progress: processing ? 0 : 100
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

	const updateAttachment = (
		id: string,
		updater: (entry: AttachmentDraft) => AttachmentDraft
	) => {
		attachments = attachments.map((entry) => (entry.id === id ? updater(entry) : entry));
	};

	const stopAttachmentProcessing = (id: string) => {
		const timer = attachmentTimers.get(id);
		if (timer) {
			clearInterval(timer);
			attachmentTimers.delete(id);
		}
	};

	const estimateProcessingDuration = (file: File) => {
		const size = file?.size ?? 0;
		if (!size) return PROCESSING_MIN_MS;
		const raw = Math.round(size / PROCESSING_BYTES_PER_MS);
		return Math.min(PROCESSING_MAX_MS, Math.max(PROCESSING_MIN_MS, raw));
	};

	const startAttachmentProcessing = (id: string, durationMs: number) => {
		stopAttachmentProcessing(id);
		const started = Date.now();
		const tick = () => {
			const elapsed = Date.now() - started;
			const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
			updateAttachment(id, (entry) => ({
				...entry,
				progress,
				processing: progress < 100
			}));
			if (progress >= 100) {
				stopAttachmentProcessing(id);
			}
		};
		tick();
		const timer = setInterval(tick, 60);
		attachmentTimers.set(id, timer);
	};

	function queueAttachments(files: File[], options: { animate?: boolean } = {}) {
		const selection = files.filter((file): file is File => file instanceof File);
		if (!selection.length) return;
		const shouldAnimate = Boolean(options.animate);
		const drafts = selection.map((file) => buildAttachmentDraft(file, shouldAnimate));
		attachments = [...attachments, ...drafts];
		if (shouldAnimate) {
			drafts.forEach((draft) => {
				startAttachmentProcessing(draft.id, estimateProcessingDuration(draft.file));
			});
		}
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
		stopAttachmentProcessing(id);
		if (target) revokeAttachmentPreview(target);
		attachments = attachments.filter((item) => item.id !== id);
	}

	function clearAttachments() {
		attachments.forEach((entry) => stopAttachmentProcessing(entry.id));
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
		if (attachmentsProcessing) return;
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
			playSound('message-send');
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
			playSound('message-send');
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
		if (!mentionActive && e.key === 'Tab' && !e.shiftKey) {
			if (showReplyGhost && canUseReplySuggestion) {
				e.preventDefault();
				applyReplySuggestion();
				return;
			}
			if (canUseGeneralSuggestion) {
				e.preventDefault();
				applyGeneralSuggestion();
				return;
			}
			if (showInlinePrediction && aiInlineSuggestion) {
				e.preventDefault();
				acceptInlineSuggestion();
				return;
			}
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
		// Only check data.items if data.files is empty to avoid duplicates
		// (browsers often provide the same file in both locations)
		const itemFiles =
			directFiles.length > 0
				? []
				: Array.from(data.items ?? [])
						.map((item) => (item.kind === 'file' ? item.getAsFile() : null))
						.filter((file): file is File => file instanceof File);
		const merged = dedupeFiles([...directFiles, ...itemFiles]);
		if (!merged.length) return;
		queueAttachments(merged);
	}

	const hasFileTransfer = (event: DragEvent) => {
		const transfer = event.dataTransfer;
		if (!transfer) return false;
		if (transfer.files && transfer.files.length > 0) return true;
		const types = Array.from(transfer.types ?? []);
		if (types.length === 0) return true;
		if (types.includes('Files')) return true;
		if (types.some((type) => type.toLowerCase().includes('file'))) return true;
		const items = Array.from(transfer.items ?? []);
		return items.some((item) => item.kind === 'file');
	};

	function handleDragEnter(event: DragEvent) {
		if (!isDesktop || disabled) return;
		if (!hasFileTransfer(event)) return;
		event.preventDefault();
		dragDepth += 1;
		dragActive = true;
	}

	function handleDragOver(event: DragEvent) {
		if (!isDesktop || disabled) return;
		if (!hasFileTransfer(event)) return;
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		dragActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		if (!isDesktop || disabled) return;
		if (!dragActive) return;
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) {
			dragActive = false;
		}
	}

	function handleDrop(event: DragEvent) {
		if (!isDesktop || disabled) return;
		if (!hasFileTransfer(event)) return;
		event.preventDefault();
		dragDepth = 0;
		dragActive = false;
		const dropped = Array.from(event.dataTransfer?.files ?? []);
		if (!dropped.length) return;
		queueAttachments(dedupeFiles(dropped), { animate: true });
		inputEl?.focus();
	}

	function handleFieldDragEnter(event: DragEvent) {
		event.stopPropagation();
		handleDragEnter(event);
	}

	function handleFieldDragOver(event: DragEvent) {
		event.stopPropagation();
		handleDragOver(event);
	}

	function handleFieldDragLeave(event: DragEvent) {
		event.stopPropagation();
		handleDragLeave(event);
	}

	function handleFieldDrop(event: DragEvent) {
		event.stopPropagation();
		handleDrop(event);
	}

	function handleInput() {
		suggestionTapPrimed = false;
		refreshMentionDraft();
		if (mentionOptions.length) {
			updateMentionState();
		}
		syncTextareaSize();
		syncPredictionOverlay();
	}

	function syncTextareaSize() {
		if (typeof window === 'undefined' || !inputEl) return;
		const node = inputEl;
		const computed = window.getComputedStyle(node);
		const minHeight = parseFloat(computed.minHeight || '0') || 0;
		const maxHeightValue = computed.maxHeight;
		const maxHeight =
			!maxHeightValue || maxHeightValue === 'none'
				? Number.POSITIVE_INFINITY
				: parseFloat(maxHeightValue);
		node.style.height = 'auto';
		const scrollHeight = node.scrollHeight;
		const textHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
		const ghostHeight = showSuggestionGhost
			? Math.max(minHeight, Math.min(suggestedGhostHeight || 0, maxHeight))
			: 0;
		const inlinePredictionHeight =
			showInlinePrediction && aiInlineSuggestion && predictionContentEl
				? Math.max(
						minHeight,
						Math.min((predictionContentEl.scrollHeight || 0) + predictionVerticalPadding, maxHeight)
					)
				: 0;
		const nextHeight = Math.max(textHeight, ghostHeight || 0, inlinePredictionHeight || 0);
		node.style.height = `${nextHeight}px`;
		textareaExpanded = nextHeight > minHeight + 2;
		if (scrollHeight > nextHeight) {
			node.style.overflowY = 'auto';
		} else {
			node.style.overflowY = 'hidden';
		}
	}

	function syncPredictionOverlay() {
		if (!inputEl) {
			predictionScroll = 0;
			return;
		}
		predictionScroll = inputEl.scrollTop ?? 0;
	}

	function handleTextareaScroll() {
		syncPredictionOverlay();
	}

	function schedulePredictionResize() {
		if (typeof window === 'undefined') return;
		void tick().then(() => {
			syncTextareaSize();
			syncPredictionOverlay();
		});
	}

	function syncPredictionBoxStyle() {
		if (typeof window === 'undefined' || !inputEl) {
			predictionBoxStyle = '';
			return;
		}
		const computed = window.getComputedStyle(inputEl);
		const paddingTop = parseFloat(computed.paddingTop || '0') || 0;
		const paddingBottom = parseFloat(computed.paddingBottom || '0') || 0;
		predictionVerticalPadding = paddingTop + paddingBottom;
		const padding = `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`;
		predictionBoxStyle = [
			`padding:${padding}`,
			`font-family:${computed.fontFamily}`,
			`font-size:${computed.fontSize}`,
			`font-weight:${computed.fontWeight}`,
			`font-style:${computed.fontStyle}`,
			`line-height:${computed.lineHeight}`,
			`letter-spacing:${computed.letterSpacing}`
		].join(';');
	}

	function handleSelectionChange() {
		if (!mentionOptions.length) return;
		requestAnimationFrame(() => updateMentionState());
	}

	function syncSuggestedGhostHeight() {
		if (!showSuggestionGhost) {
			suggestedGhostHeight = 0;
			return;
		}
		suggestedGhostHeight = suggestedGhostEl?.scrollHeight ?? 0;
	}

	onMount(() => {
		if (typeof window === 'undefined') return;
		const handleResize = () => {
			syncTextareaSize();
			syncPredictionBoxStyle();
		};
		handleResize();
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});

	$effect(() => {
		text;
		syncTextareaSize();
		syncPredictionOverlay();
	});

	$effect(() => {
		const node = inputEl;
		if (!node) {
			predictionBoxStyle = '';
			return;
		}
		syncPredictionBoxStyle();
		if (typeof window === 'undefined' || typeof window.ResizeObserver === 'undefined') return;
		const observer = new window.ResizeObserver(() => {
			syncPredictionBoxStyle();
			if (typeof requestAnimationFrame === 'function') {
				requestAnimationFrame(() => syncTextareaSize());
			} else {
				syncTextareaSize();
			}
		});
		observer.observe(node);
		return () => observer.disconnect();
	});

	$effect(() => {
		syncSuggestedGhostHeight();
		syncTextareaSize();
		if (!showSuggestionGhost) return;
		if (typeof window === 'undefined' || typeof window.ResizeObserver === 'undefined') return;
		const target = suggestedGhostEl;
		if (!target) return;
		const observer = new window.ResizeObserver(() => {
			syncSuggestedGhostHeight();
			if (typeof requestAnimationFrame === 'function') {
				requestAnimationFrame(() => syncTextareaSize());
			} else {
				syncTextareaSize();
			}
		});
		observer.observe(target);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!showSuggestionGhost) {
			suggestionTapPrimed = false;
		}
	});

	$effect(() => {
		popoverOutsideCleanup?.();
		popoverOutsideCleanup = popOpen ? registerPopoverOutsideWatcher() : null;
		if (!popOpen) {
			closeRewriteMenu();
		}
	});

	$effect(() => {
		if (!popOpen && platform === 'mobile' && !inputFocused) {
			releaseDockSuppression();
		}
	});

	$effect(() => {
		if (isDesktop && !disabled) return;
		dragDepth = 0;
		dragActive = false;
	});

	$effect(() => {
		if (!popOpen) return;
		platform;
		attachments;
		textareaExpanded;
		void tick().then(() => syncPopoverPosition());
	});

	$effect(() => {
		if (!popOpen) return;
		syncPopoverPosition();
		if (typeof window === 'undefined') return;
		const handleReposition = () => syncPopoverPosition();
		const viewport = window.visualViewport;
		window.addEventListener('resize', handleReposition);
		window.addEventListener('scroll', handleReposition, true);
		viewport?.addEventListener('resize', handleReposition);
		viewport?.addEventListener('scroll', handleReposition);
		return () => {
			window.removeEventListener('resize', handleReposition);
			window.removeEventListener('scroll', handleReposition, true);
			viewport?.removeEventListener('resize', handleReposition);
			viewport?.removeEventListener('scroll', handleReposition);
		};
	});

	$effect(() => {
		if (!mentionActive) return;
		syncMentionMenuPosition();
		if (typeof window === 'undefined') return;
		const handleReposition = () => syncMentionMenuPosition();
		const viewport = window.visualViewport;
		window.addEventListener('resize', handleReposition);
		window.addEventListener('scroll', handleReposition, true);
		viewport?.addEventListener('resize', handleReposition);
		viewport?.addEventListener('scroll', handleReposition);
		return () => {
			window.removeEventListener('resize', handleReposition);
			window.removeEventListener('scroll', handleReposition, true);
			viewport?.removeEventListener('resize', handleReposition);
			viewport?.removeEventListener('scroll', handleReposition);
		};
	});

	$effect(() => {
		if (!showEmoji) return;
		syncEmojiPickerPosition();
		if (typeof window === 'undefined') return;
		const handleReposition = () => syncEmojiPickerPosition();
		const viewport = window.visualViewport;
		window.addEventListener('resize', handleReposition);
		window.addEventListener('scroll', handleReposition, true);
		viewport?.addEventListener('resize', handleReposition);
		viewport?.addEventListener('scroll', handleReposition);
		return () => {
			window.removeEventListener('resize', handleReposition);
			window.removeEventListener('scroll', handleReposition, true);
			viewport?.removeEventListener('resize', handleReposition);
			viewport?.removeEventListener('scroll', handleReposition);
		};
	});

	function engageDockSuppression() {
		if (platform !== 'mobile') return;
		if (!suppressDockOnFocus) return; // Skip dock suppression if disabled via prop
		if (dockReleaseTimer) {
			clearTimeout(dockReleaseTimer);
			dockReleaseTimer = null;
		}
		if (dockSuppressionActive) return;
		dockSuppressionActive = true;
		mobileDockSuppressed.claim();
	}

	function releaseDockSuppression(immediate = false) {
		if (!dockSuppressionActive) return;
		const release = () => {
			dockSuppressionActive = false;
			mobileDockSuppressed.release();
		};
		if (dockReleaseTimer) {
			clearTimeout(dockReleaseTimer);
			dockReleaseTimer = null;
		}
		if (immediate || platform !== 'mobile') {
			release();
			return;
		}
		dockReleaseTimer = setTimeout(release, 140);
	}

	function handleTextareaFocus() {
		inputFocused = true;
		syncKeyboardInset?.();
		engageDockSuppression();
		dispatch('focusInput');
	}

	function handleTextareaBlur() {
		inputFocused = false;
		syncKeyboardInset?.();
		releaseDockSuppression();
		suggestionTapPrimed = false;
		dispatch('blurInput');
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

	function parseTextSegments(value: string): TextSegment[] {
		if (!value) return [];

		// Collect all mentions for lookup
		const mentionRecords = new Map<string, MentionRecord>();
		mentionDraft.forEach((record) => {
			if (value.includes(record.handle)) {
				mentionRecords.set(record.handle.toLowerCase(), record);
			}
		});

		// Also check for mentions that match by handle/alias
		const regex = /@([a-z0-9._-]{2,64})/gi;
		let match: RegExpExecArray | null;
		const tempValue = value;
		while ((match = regex.exec(tempValue))) {
			const raw = match[1] ?? '';
			const fullHandle = `@${raw}`;
			if (mentionRecords.has(fullHandle.toLowerCase())) continue;

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
				mentionRecords.set(record.handle.toLowerCase(), record);
			}
		}

		if (mentionRecords.size === 0) {
			return [{ type: 'text', content: value }];
		}

		// Build segments by finding mentions in order
		const segments: TextSegment[] = [];
		let remaining = value;
		let lastIndex = 0;

		// Create a pattern that matches any of the mention handles
		const handles = Array.from(mentionRecords.keys()).map((h) =>
			h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		);
		const mentionPattern = new RegExp(`(${handles.join('|')})`, 'gi');

		let segMatch: RegExpExecArray | null;
		while ((segMatch = mentionPattern.exec(value))) {
			const matchedHandle = segMatch[1];
			const record = mentionRecords.get(matchedHandle.toLowerCase());

			// Add text before this mention
			if (segMatch.index > lastIndex) {
				segments.push({ type: 'text', content: value.slice(lastIndex, segMatch.index) });
			}

			// Add the mention segment
			if (record) {
				segments.push({ type: 'mention', content: matchedHandle, record });
			} else {
				segments.push({ type: 'text', content: matchedHandle });
			}

			lastIndex = segMatch.index + matchedHandle.length;
		}

		// Add remaining text after last mention
		if (lastIndex < value.length) {
			segments.push({ type: 'text', content: value.slice(lastIndex) });
		}

		return segments;
	}

	function contextIdOf(source: any): string | null {
		const raw = source?.id ?? source?.messageId ?? null;
		if (typeof raw === 'string' && raw.trim().length) return raw.trim();
		return null;
	}

	function buildMessagePayload(source: any): ReplyMessageContext | null {
		if (!source) return null;
		const text =
			pickString(source?.text) ?? pickString(source?.content) ?? pickString(source?.preview ?? '');
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
		const source = mobileSuggestionContext;
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
		schedulePredictionResize();
	}

	function queuePrediction() {
		if (!showInlinePrediction) return;
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
		if (!showInlinePrediction) return;
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
			aiInlineSuggestion = showInlinePrediction ? (suggestions[0] ?? '') : '';
			schedulePredictionResize();
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			const message = error instanceof Error ? error.message : String(error);
			if (/openai api key missing/i.test(message)) {
				aiServiceAvailable = false;
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
		schedulePredictionResize();
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
		suggestionTapPrimed = false;
		return true;
	}

	function activeSuggestionText() {
		if (!showSuggestionGhost) return null;
		if (showReplyGhost) return pickString(aiReplySuggestion);
		if (showGeneralCoach) return pickString(aiGeneralSuggestion);
		return null;
	}

	function handleTextareaPointerDown(event: PointerEvent) {
		if (platform !== 'mobile') return;
		const suggestion = activeSuggestionText();
		if (!suggestion || text.trim().length) {
			suggestionTapPrimed = false;
			return;
		}
		if (!suggestionTapPrimed) {
			suggestionTapPrimed = true;
			return;
		}
		event.preventDefault();
		suggestionTapPrimed = false;
		insertSuggestionText(suggestion);
	}

	function handlePredictionPointer(event: PointerEvent) {
		if (platform !== 'mobile') return;
		if (!aiInlineSuggestion) return;
		event.preventDefault();
		acceptInlineSuggestion();
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
			rewriteError =
				mode === 'rephrase' ? 'Draft is too short to rephrase.' : 'Type a bit more first.';
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
			// When no query, only show members (not special mentions like @everyone/@here)
			filtered = mentionOptions
				.filter((opt) => opt.kind !== 'special')
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
		void tick().then(() => syncMentionMenuPosition());
	}

	async function insertMention(option: MentionCandidate) {
		if (mentionStart < 0) return;
		const caret = inputEl?.selectionStart ?? text.length;
		const before = text.slice(0, mentionStart);
		const after = text.slice(caret);
		const displayName = option.label?.trim()?.length ? option.label.trim() : option.handle;
		const handleText = `@${displayName}`;
		const needsSpaceBeforeAfter = after.length > 0 && !/^\s/.test(after);
		const suffix = after.length ? `${needsSpaceBeforeAfter ? ' ' : ''}${after}` : ' ';
		text = `${before}${handleText}${suffix}`;
		mentionDraft.set(option.uid, {
			uid: option.uid,
			handle: handleText,
			label: option.label,
			color: option.color ?? null,
			kind: option.kind
		});
		await tick();
		const insertedSpace = after.length === 0 || needsSpaceBeforeAfter ? 1 : 0;
		const nextCaret = before.length + handleText.length + insertedSpace;
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
		if (showEmoji) {
			popOpen = false;
			void tick().then(() => syncEmojiPickerPosition());
		}
	};
	const openPoll = () => {
		showPoll = true;
		popOpen = false;
	};
	const openForm = () => {
		showForm = true;
		popOpen = false;
	};

	function togglePopover(event?: Event) {
		event?.preventDefault?.();
		event?.stopPropagation?.();
		if (disabled) return;
		popOpen = !popOpen;
		if (popOpen) {
			showEmoji = false;
			engageDockSuppression();
			void tick().then(() => syncPopoverPosition());
		} else if (!inputFocused) {
			releaseDockSuppression();
		}
	}

	function onGifPicked(url: string) {
		const payload = { url, replyTo: replyTarget ?? undefined };
		onSendGif(payload);
		dispatch('sendGif', payload);
		playSound('message-send');
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
			// Check if click is inside the trigger button or the picker
			if (emojiTriggerEl?.contains(target)) return;
			if (emojiPickerEl?.contains(target)) return;
			// If picker hasn't mounted yet, don't close (prevents immediate close on open click)
			if (!emojiPickerEl) return;
			showEmoji = false;
		};
		// Delay adding listener to avoid catching the same click that opened the picker
		const timeoutId = setTimeout(() => {
			document.addEventListener('pointerdown', handler);
		}, 0);
		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener('pointerdown', handler);
		};
	}

	function registerPopoverOutsideWatcher() {
		if (typeof document === 'undefined') return null;
		const handler = (event: MouseEvent) => {
			const target = event.target as Node;
			if (popoverEl?.contains(target) || plusTriggerEl?.contains(target)) return;
			popOpen = false;
		};
		document.addEventListener('pointerdown', handler);
		return () => document.removeEventListener('pointerdown', handler);
	}

	/**
	 * Position the plus menu popover.
	 * CSS bottom = distance from viewport's bottom edge to the popup's bottom edge
	 * We want the popup's bottom edge to be just above the chat input's top edge
	 */
	function syncPopoverPosition() {
		if (typeof window === 'undefined') return;

		const vv = window.visualViewport;
		const vh = vv ? vv.height : window.innerHeight;
		const vw = vv ? vv.width : window.innerWidth;
		const offsetX = vv?.offsetLeft ?? 0;
		const offsetY = vv?.offsetTop ?? 0;
		const width = Math.min(platform === 'mobile' ? 280 : 320, vw - 16);
		const gap = 8;
		const pad = 8;

		const anchor = plusTriggerEl ?? rootEl;
		if (!anchor) {
			popoverPlacement = {
				left: `${pad}px`,
				bottom: '70px',
				width: `${width}px`,
				maxHeight: '350px'
			};
			return;
		}

		const rect = anchor.getBoundingClientRect();
		const leftWithinViewport = rect.left - offsetX;

		// Available space
		const spaceAbove = rect.top - offsetY - gap - pad;
		const spaceBelow = vh - (rect.bottom - offsetY) - gap - pad;
		const placeBelow = spaceBelow > spaceAbove;

		let maxHeight: number;
		let top: number | null = null;

		if (placeBelow) {
			maxHeight = Math.min(400, Math.max(160, spaceBelow));
			top = rect.bottom - offsetY + gap;
		} else {
			maxHeight = Math.min(400, Math.max(160, spaceAbove));
			top = Math.max(pad, rect.top - offsetY - maxHeight - gap);
		}

		// Ensure we don't exceed viewport vertically
		const availableBelow = vh - top - pad;
		maxHeight = Math.min(maxHeight, availableBelow);

		// Center the popover on the trigger, clamped to viewport (visual viewport space)
		let left = leftWithinViewport + rect.width / 2 - width / 2;
		left = Math.max(pad, Math.min(left, vw - width - pad));
		// Convert back to layout coordinates by adding viewport offset
		left += offsetX;

		popoverPlacement = {
			left: `${Math.round(left)}px`,
			top: top !== null ? `${Math.round(top + offsetY)}px` : 'auto',
			bottom: 'auto',
			width: `${width}px`,
			maxHeight: `${Math.round(maxHeight)}px`
		};
	}

	/**
	 * Position the mention/tag menu.
	 */
	function syncMentionMenuPosition() {
		if (typeof window === 'undefined') return;

		const vv = window.visualViewport;
		const vh = vv ? vv.height : window.innerHeight;
		const vw = vv ? vv.width : window.innerWidth;
		const layoutHeight = window.innerHeight;
		const offsetX = vv?.offsetLeft ?? 0;
		const offsetY = vv?.offsetTop ?? 0;
		const menuWidth = Math.min(280, vw - 16);
		const gap = 2;
		const pad = 8;

		const anchor = inputEl ?? rootEl;
		if (!anchor) {
			mentionMenuPosition = { left: `${pad}px`, top: `${pad + offsetY}px`, bottom: 'auto', maxHeight: '200px' };
			return;
		}

		const rect = anchor.getBoundingClientRect();
		const leftWithinViewport = rect.left - offsetX;

		// Choose above/below based on available space in visual viewport
		const horizontalOffset = 4;
		const verticalOffset = 0;
		const spaceAbove = rect.top - offsetY - gap - pad;
		const spaceBelow = vh - (rect.bottom - offsetY) - gap - pad;
		const placeBelow = spaceBelow >= spaceAbove;

		let maxHeight: number;
		let top: number | null = null;
		let bottom: number | null = null;

		if (placeBelow) {
			maxHeight = Math.min(260, Math.max(140, spaceBelow));
			top = rect.bottom - offsetY + gap + verticalOffset;
		} else {
			maxHeight = Math.min(260, Math.max(140, spaceAbove));
			bottom = layoutHeight - rect.top + gap + verticalOffset;
		}

		// Clamp to viewport height
		if (top !== null) {
			const availableBelow = vh - top - pad;
			maxHeight = Math.max(120, Math.min(maxHeight, availableBelow));
		} else {
			maxHeight = Math.max(120, Math.min(maxHeight, spaceAbove));
		}

		// Align to anchor's left edge (like Discord), with a slight inset, clamped to viewport width
		let left = leftWithinViewport + horizontalOffset;
		left = Math.max(pad, Math.min(left, vw - menuWidth - pad));
		left += offsetX;

		mentionMenuPosition = {
			left: `${Math.round(left)}px`,
			top: top !== null ? `${Math.round(top + offsetY)}px` : 'auto',
			bottom: bottom !== null ? `${Math.round(bottom)}px` : 'auto',
			maxHeight: `${Math.round(maxHeight)}px`
		};
	}

	/**
	 * Position the emoji picker.
	 */
	function syncEmojiPickerPosition() {
		if (typeof window === 'undefined') return;

		const vv = window.visualViewport;
		const vh = vv ? vv.height : window.innerHeight;
		const vw = vv ? vv.width : window.innerWidth;
		const offsetX = vv?.offsetLeft ?? 0;
		const offsetY = vv?.offsetTop ?? 0;
		const pickerWidth = Math.min(320, vw - 16);
		const gap = 8;
		const pad = 8;

		const anchor = emojiTriggerEl ?? rootEl;
		if (!anchor) {
			emojiPickerPosition = {
				left: 'auto',
				right: `${pad}px`,
				bottom: '70px',
				top: 'auto',
				maxHeight: '380px'
			};
			return;
		}

		const rect = anchor.getBoundingClientRect();
		const leftWithinViewport = rect.left - offsetX;
		const rightWithinViewport = rect.right - offsetX;

		// Available space
		const spaceAbove = rect.top - offsetY - gap - pad;
		const spaceBelow = vh - (rect.bottom - offsetY) - gap - pad;
		const placeBelow = spaceBelow > spaceAbove;

		let maxHeight: number;
		let top: number;

		if (placeBelow) {
			maxHeight = Math.min(380, Math.max(180, spaceBelow));
			top = rect.bottom - offsetY + gap;
		} else {
			maxHeight = Math.min(380, Math.max(180, spaceAbove));
			top = Math.max(pad, rect.top - offsetY - maxHeight - gap);
		}

		// Available height
		const availableBelow = vh - top - pad;
		maxHeight = Math.max(100, Math.min(400, Math.min(maxHeight, availableBelow)));

		// Prefer centering on trigger but clamp within viewport
		let left = leftWithinViewport + rect.width / 2 - pickerWidth / 2;
		left = Math.max(pad, Math.min(left, vw - pickerWidth - pad));
		left += offsetX;

		emojiPickerPosition = {
			left: `${Math.round(left)}px`,
			right: 'auto',
			bottom: 'auto',
			top: `${Math.round(top + offsetY)}px`,
			maxHeight: `${Math.round(maxHeight)}px`
		};
	}

	onMount(() => {
		if (typeof window === 'undefined') return;
		// Enable emoji picker on desktop screens (min 768px width)
		const mq = window.matchMedia('(min-width: 768px)');
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
				let offset = 0;
				if (inputFocused && window.innerWidth <= KEYBOARD_MOBILE_MAX_WIDTH) {
					const occupied = Math.round(window.innerHeight - (viewport.height + viewport.offsetTop));
					const diff = Math.max(0, occupied);
					offset = diff > KEYBOARD_ACTIVATION_THRESHOLD ? diff : 0;
				}
				root.style.setProperty(KEYBOARD_OFFSET_VAR, offset ? `${offset}px` : '0px');
				root.style.setProperty(SAFE_AREA_VAR, offset ? '0px' : 'env(safe-area-inset-bottom, 0px)');
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
			root.style.setProperty(SAFE_AREA_VAR, 'env(safe-area-inset-bottom, 0px)');
			syncKeyboardInset = null;
		};
	});

	onMount(() => {
		if (typeof window === 'undefined') return;
		const coarse = window.matchMedia('(pointer:coarse)');
		const update = () => {
			const prefersCoarse = coarse.matches;
			const narrow = window.innerWidth <= 768;
			const nextPlatform = prefersCoarse || narrow ? 'mobile' : 'desktop';
			if (platform !== nextPlatform) {
				platform = nextPlatform;
				if (nextPlatform === 'desktop') {
					releaseDockSuppression(true);
				}
			} else {
				platform = nextPlatform;
			}
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
		if (predictionTimer) {
			clearTimeout(predictionTimer);
			predictionTimer = null;
		}
		if (dockReleaseTimer) {
			clearTimeout(dockReleaseTimer);
			dockReleaseTimer = null;
		}
		if (dockSuppressionActive) {
			dockSuppressionActive = false;
			mobileDockSuppressed.release();
		}
		popoverOutsideCleanup?.();
		popoverOutsideCleanup = null;
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
		mentionLookup = new Map(mentionOptions.map((option) => [option.handle.toLowerCase(), option]));
	});
	run(() => {
		mentionAliasLookup = new Map(
			mentionOptions.flatMap((option) =>
				option.aliases.map((alias) => [alias, option] as [string, MentionCandidate])
			)
		);
	});
	run(() => {
		// Update text segments whenever text or mention lookups change
		textSegments = parseTextSegments(text);
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
		if (showInlinePrediction) {
			queuePrediction();
		}
	});
</script>

<svelte:window onkeydown={onEsc} />

<div
	class="chat-input-root"
	class:chat-input-root--dragging={dragActive}
	class:chat-input-root--expanded={textareaExpanded}
	bind:this={rootEl}
	ondragenter={handleDragEnter}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	role="region"
>
	<div class="chat-input-overlays">
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
							<button
								type="button"
								class="ai-card__button ai-card__button--primary"
								onclick={retryRewrite}
							>
								Try again
							</button>
							<button type="button" class="ai-card__button" onclick={dismissRewrite}>
								Dismiss
							</button>
						</div>
					{:else if activeRewrite}
						<p class="ai-card__text">{activeRewrite}</p>
						<div class="ai-card__actions ai-card__actions--triple">
							<button
								type="button"
								class="ai-card__button ai-card__button--primary"
								onclick={acceptRewrite}
							>
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
	</div>

	{#if dragActive && isDesktop}
		<div class="chat-input-dropzone" aria-hidden="true">
			<i class="bx bx-cloud-upload" aria-hidden="true"></i>
			<span>Drag file here</span>
		</div>
	{/if}

	<div class="chat-input-stack">
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
							{#if attachment.processing}
								<div
									class="chat-attachment__progress"
									role="progressbar"
									aria-valuemin="0"
									aria-valuemax="100"
									aria-valuenow={attachment.progress}
								>
									<span style={`width: ${Math.max(8, attachment.progress)}%`}></span>
								</div>
								<div class="chat-attachment__status">Preparing {attachment.progress}%</div>
							{/if}
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

		<form
			bind:this={formEl}
			onsubmit={preventDefault(submit)}
			class="relative flex items-center gap-2 chat-input__form"
		>
			<div
				class="chat-input__action-column"
				class:chat-input__action-column--mobile={platform === 'mobile'}
				class:chat-input__action-column--mobile-anchored={platform === 'mobile' && textareaExpanded}
			>
				<div class="chat-input__primary-action">
					<button
						type="button"
						class="chat-input__plus-button"
						aria-haspopup="menu"
						aria-expanded={popOpen}
						aria-label="Add to message"
						title="Add to message"
						onclick={togglePopover}
						{disabled}
						bind:this={plusTriggerEl}
					>
						<i class="bx bx-plus" aria-hidden="true"></i>
					</button>

					{#if popOpen}
						<div
							class="chat-input-popover__backdrop"
							role="button"
							tabindex="0"
							aria-label="Close add menu"
							onclick={() => (popOpen = false)}
							onkeydown={(event) => {
								if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									popOpen = false;
								}
							}}
						></div>
					{/if}

					<input class="hidden" type="file" multiple bind:this={fileEl} onchange={onFilesChange} />
				</div>
			</div>

			<div class="flex-1 relative chat-input__field">
				{#if replyTarget}
					<div class="reply-banner" role="status">
						<div class="reply-banner__indicator" aria-hidden="true"></div>
						<div class="reply-banner__body">
							<div class="reply-banner__label">Replying to</div>
							<div class="reply-banner__name">{replyRecipientLabel(replyTarget)}</div>
							<div class="reply-banner__preview">{replyPreviewText(replyTarget)}</div>
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

				<div class="chat-input__editor">
					<div class="chat-input__textarea-wrapper">
						<textarea
							class="input textarea flex-1 rounded-full border border-black/40 px-4 py-2 placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] {hasMentions ? 'has-mentions' : ''}"
							rows="1"
							bind:this={inputEl}
							bind:value={text}
							placeholder={showSuggestionGhost ? '' : placeholder}
							ondragenter={handleFieldDragEnter}
							ondragover={handleFieldDragOver}
							ondragleave={handleFieldDragLeave}
							ondrop={handleFieldDrop}
							onpointerdown={handleTextareaPointerDown}
							onkeydown={onKeydown}
							oninput={handleInput}
							onpaste={handlePaste}
							onkeyup={handleSelectionChange}
							onclick={handleSelectionChange}
							onfocus={handleTextareaFocus}
							onblur={handleTextareaBlur}
							onscroll={handleTextareaScroll}
							{disabled}
							aria-label="Message input"
						></textarea>

						{#if textSegments.some((s) => s.type === 'mention')}
							<div
								class="chat-input__mention-overlay"
								aria-hidden="true"
								style={`transform: translateY(-${predictionScroll}px);`}
							>
								{#each textSegments as segment}
									{#if segment.type === 'mention'}
										<span
											class="chat-input__mention-tag"
											class:chat-input__mention-tag--role={segment.record.kind === 'role'}
											class:chat-input__mention-tag--special={segment.record.kind === 'special'}
											style={segment.record.kind === 'role' && segment.record.color
												? `--mention-color: ${segment.record.color}`
												: ''}>{segment.content}</span
										>
									{:else}
										<span class="chat-input__mention-text">{segment.content}</span>
									{/if}
								{/each}
							</div>
						{/if}

						{#if showSuggestionGhost}
							{@const isReplySuggestion = showReplyGhost}
							<button
								type="button"
								class="chat-input__suggested-refresh"
								onclick={isReplySuggestion
									? regenerateReplySuggestion
									: regenerateGeneralSuggestion}
								aria-label="Refresh suggested reply"
								title="Refresh suggested reply"
								disabled={isReplySuggestion ? aiReplyLoading : aiGeneralLoading}
							>
								<i class="bx bx-refresh" aria-hidden="true"></i>
							</button>
							<div
								class="chat-input__suggested-ghost"
								aria-live="polite"
								bind:this={suggestedGhostEl}
								style={predictionBoxStyle}
							>
								<div class="chat-input__suggested-line">
									<span class="chat-input__suggested-prefix">
										{#if isReplySuggestion}
											Reply to {replyRecipientLabel(replyTarget) || 'member'}
										{:else}
											{placeholder ?? 'Message'}
										{/if}
									</span>
									{#if isReplySuggestion}
										{#if aiReplyLoading}
											<span class="chat-input__suggested-status">Drafting a suggestion...</span>
										{:else if aiReplyError}
											<span class="chat-input__suggested-status chat-input__suggested-status--error"
												>{aiReplyError}</span
											>
										{:else if aiReplySuggestion}
											<span class="chat-input__suggested-text">{aiReplySuggestion}</span>
										{:else}
											<span class="chat-input__suggested-status">Tap refresh to get a draft.</span>
										{/if}
									{:else if aiGeneralLoading}
										<span class="chat-input__suggested-status">Drafting a reply...</span>
									{:else if aiGeneralError}
										<span class="chat-input__suggested-status chat-input__suggested-status--error"
											>{aiGeneralError}</span
										>
									{:else if aiGeneralSuggestion}
										<span class="chat-input__suggested-text">{aiGeneralSuggestion}</span>
									{:else}
										<span class="chat-input__suggested-status">Press refresh for a new idea.</span>
									{/if}
								</div>
								{#if isReplySuggestion ? aiReplySuggestion : aiGeneralSuggestion}
									<span class="chat-input__suggested-hint">
										{platform === 'mobile' ? 'Tap again to use' : 'Press Tab to use'}
									</span>
								{/if}
							</div>
						{/if}

						{#if hasInlinePrediction || showMobileSend}
							<div
								class="chat-input__prediction"
								class:chat-input__prediction--touch={hasInlinePrediction && platform === 'mobile'}
								aria-hidden={hasInlinePrediction && platform !== 'mobile' ? 'true' : undefined}
								style={predictionBoxStyle}
								onpointerdown={handlePredictionPointer}
							>
								{#if hasInlinePrediction}
									{@const overlayText = text || '\u00a0'}
									<div
										class="chat-input__prediction-content"
										bind:this={predictionContentEl}
										style={`transform: translateY(-${predictionScroll}px);`}
									>
										<span class="chat-input__prediction-shadow">{overlayText}</span>
										<span class="chat-input__prediction-hint">{aiInlineSuggestion}</span>
									</div>
								{/if}

								{#if showMobileSend}
									<button
										type="submit"
										class="chat-input__mobile-send"
										class:chat-input__mobile-send--expanded={textareaExpanded}
										disabled={sendDisabled}
										aria-label="Send message"
										title="Send message"
										onpointerdown={(event) => event.stopPropagation()}
									>
										<i class="bx bx-up-arrow-alt" aria-hidden="true"></i>
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<MentionMenu
					active={mentionActive}
					options={mentionFiltered}
					selectedIndex={mentionIndex}
					position={mentionMenuPosition}
					specialMentionIds={SPECIAL_MENTION_IDS}
					onSelect={insertMention}
					onHover={(idx) => (mentionIndex = idx)}
				/>
			</div>

			<div class="chat-input__actions" class:chat-input__actions--anchored={textareaExpanded}>
				{#if emojiSupported}
					<div class="emoji-trigger" bind:this={emojiTriggerEl}>
						<button
							type="button"
							class="emoji-button"
							onclick={openEmoji}
							{disabled}
							aria-label="Insert emoji"
							title="Insert emoji"
						>
							<i class="bx bx-smile text-xl leading-none"></i>
						</button>
					</div>
				{/if}

				<button
					class="chat-send-button"
					class:chat-send-button--anchored={textareaExpanded}
					type="submit"
					disabled={sendDisabled}
					aria-label="Send message"
					title="Send"
				>
					Send
				</button>
			</div>
		</form>
	</div>
</div>

{#if showEmoji}
	<div
		class="emoji-picker-wrapper"
		bind:this={emojiPickerEl}
		style:left={emojiPickerPosition.left}
		style:right={emojiPickerPosition.right}
		style:bottom={emojiPickerPosition.bottom}
		style:top={emojiPickerPosition.top}
		style:max-height={emojiPickerPosition.maxHeight}
	>
		<EmojiPicker
			variant="compact"
			on:close={() => (showEmoji = false)}
			on:pick={(e) => onEmojiPicked(e.detail)}
		/>
	</div>
{/if}

{#if showGif}
	<GifPicker on:close={() => (showGif = false)} on:pick={(e) => onGifPicked(e.detail)} />
{/if}
{#if showPoll}
	<PollBuilder on:close={() => (showPoll = false)} on:create={(e) => onPollCreate(e.detail)} />
{/if}
{#if showForm}
	<FormBuilder on:close={() => (showForm = false)} on:create={(e) => onFormCreate(e.detail)} />
{/if}

<ChatAddonsPopover
	open={popOpen}
	{platform}
	placement={popoverPlacement}
	{aiAssistAllowed}
	{rewriteEligible}
	{rewriteLoading}
	{rewriteMode}
	{rewriteActions}
	onOpenGif={openGif}
	onPickFiles={pickFiles}
	onOpenPoll={openPoll}
	onOpenForm={openForm}
	onRewriteAction={handleRewriteAction}
	onClose={() => (popOpen = false)}
	bind:popoverEl
/>

<!-- svelte-ignore css_unused_selector -->
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

	.chat-attachment__progress {
		width: 100%;
		height: 0.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
		overflow: hidden;
		margin-top: 0.25rem;
	}

	.chat-attachment__progress span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(
			90deg,
			var(--color-accent),
			color-mix(in srgb, var(--color-accent) 70%, #fff)
		);
		transition: width 60ms linear;
	}

	.chat-attachment__status {
		font-size: 0.68rem;
		color: var(--text-55);
		margin-top: 0.15rem;
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
		transition:
			color 120ms ease,
			background 120ms ease;
	}

	.chat-attachment__remove:hover,
	.chat-attachment__remove:focus-visible {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
		outline: none;
	}

	.chat-input-popover {
		position: fixed;
		width: 20rem;
		max-width: calc(100vw - 2rem);
		max-height: min(50vh, 24rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		z-index: 999999;
		border-radius: 1.25rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: var(--color-panel);
		backdrop-filter: blur(24px);
		box-shadow:
			0 -10px 40px rgba(0, 0, 0, 0.5),
			0 0 0 1px rgba(255, 255, 255, 0.05) inset;
		padding: 0.85rem 0.75rem;
		color: var(--color-text-primary);
	}

	.chat-input-popover--mobile {
		width: 18rem;
		max-width: calc(100vw - 2rem);
		max-height: min(50vh, 22rem);
	}

	.chat-input-popover__backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 999998;
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
		transition:
			transform 120ms ease,
			border 120ms ease,
			background 120ms ease;
	}

	.chat-input-menu__item:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-panel) 88%);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.chat-input-menu__item:active {
		transform: translateY(0);
	}

	.chat-input-menu__icon {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
		font-size: 1.15rem;
		transition: all 150ms ease;
	}

	.chat-input-menu__item:hover .chat-input-menu__icon {
		background: color-mix(in srgb, var(--color-accent) 28%, transparent);
		transform: scale(1.05);
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

	:global(:root[data-theme-tone='light']) .chat-input-popover {
		background: color-mix(in srgb, var(--color-panel) 98%, transparent);
		border-color: color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		box-shadow: 0 18px 32px rgba(25, 34, 42, 0.18);
	}

	:global(:root[data-theme-tone='light']) .chat-input-menu__item {
		background: color-mix(in srgb, var(--color-panel) 96%, transparent);
	}

	:global(:root[data-theme-tone='light']) .chat-input-menu__item:hover {
		background: color-mix(in srgb, var(--color-panel) 100%, transparent);
	}

	:global(:root[data-theme-tone='light']) .chat-input-menu__icon {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}

	.chat-input-root {
		position: relative;
		display: flex;
		flex-direction: column;
		z-index: 10;
	}

	.chat-input-root--dragging {
		z-index: 20;
	}

	.chat-input-dropzone {
		position: absolute;
		inset: -0.35rem;
		border-radius: var(--radius-xl);
		border: 2px dashed color-mix(in srgb, var(--color-accent) 70%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-accent);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		font-weight: 600;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
		pointer-events: none;
		z-index: 30;
	}

	.chat-input-dropzone i {
		font-size: 1.15rem;
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
		position: relative;
		z-index: 10;
	}

	.chat-input__action-column {
		position: relative;
		display: flex;
		align-items: center;
		flex-shrink: 0;
		transition:
			align-self 120ms ease,
			transform 120ms ease;
		z-index: 20;
	}

	.chat-input__primary-action {
		position: relative;
		display: flex;
		z-index: 25;
	}

	.chat-input__plus-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		background: color-mix(in srgb, var(--color-panel) 85%, transparent);
		color: var(--color-text-primary);
		font-size: 1.25rem;
		transition: all 150ms ease;
		position: relative;
		z-index: 15;
		flex-shrink: 0;
	}

	.chat-input__plus-button:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 20%, var(--color-panel) 80%);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		color: var(--color-accent);
		transform: scale(1.05);
	}

	.chat-input__plus-button:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 50%, transparent);
		border-color: var(--color-accent);
	}

	.chat-input__plus-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.chat-input__plus-button i {
		line-height: 1;
		transition: transform 150ms ease;
	}

	.chat-input__plus-button:hover:not(:disabled) i {
		transform: rotate(90deg);
	}

	.reply-banner {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.8rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 25%, var(--color-border-subtle) 50%);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-panel) 90%);
		box-shadow: none;
		margin-bottom: 0.4rem;
	}

	.reply-banner__indicator {
		width: 3px;
		align-self: stretch;
		border-radius: 999px;
		background: var(--color-accent);
	}

	.reply-banner__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.reply-banner__label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--color-accent) 70%, var(--text-60) 30%);
		font-weight: 600;
	}

	.reply-banner__name {
		font-weight: 600;
		color: var(--text-90);
		font-size: 0.8rem;
	}

	.reply-banner__preview {
		font-size: 0.78rem;
		color: var(--text-60);
		font-style: normal;
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
		transition:
			background 150ms ease,
			border 150ms ease,
			color 150ms ease;
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

	.reply-banner__close {
		border: 0;
		background: transparent;
		color: var(--text-50);
		padding: 0.2rem;
		border-radius: 0.35rem;
		line-height: 1;
		display: grid;
		place-items: center;
		font-size: 1.1rem;
		transition:
			color 100ms ease,
			background 100ms ease;
	}

	.reply-banner__close:hover,
	.reply-banner__close:focus-visible {
		color: var(--text-90);
		background: color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		outline: none;
	}

	.textarea {
		width: 100%;
		min-height: 2.6rem;
		max-height: min(40vh, 20rem);
		resize: none;
		line-height: 1.4;
		font-family: inherit;
		overflow-y: hidden;
	}

	.mention-menu {
		position: fixed;
		z-index: 999998;
		width: min(22rem, calc(100vw - 2rem));
		border-radius: var(--radius-lg);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-panel) 95%, transparent);
		box-shadow: var(--shadow-elevated);
		overflow: hidden;
		backdrop-filter: blur(18px);
		display: flex;
		flex-direction: column;
	}

	.mention-menu__header {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-55);
		padding: 0.45rem 0.85rem 0.35rem;
		flex-shrink: 0;
	}

	.mention-menu__list {
		display: grid;
		flex: 1;
		min-height: 0;
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
		transition:
			background 140ms ease,
			color 140ms ease;
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

	.mention-menu__avatar--special {
		background: linear-gradient(140deg, rgba(56, 189, 248, 0.18), rgba(249, 115, 22, 0.28));
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
	}

	.mention-menu__avatar-special {
		font-size: 1.05rem;
		font-weight: 700;
		color: color-mix(in srgb, var(--color-accent) 90%, #fff);
	}

	.mention-menu__role-swatch {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
	}

	.mention-menu__item--special {
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
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
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
	}

	.mention-menu__pill--special {
		color: #fff;
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
	}

	.mention-menu__hint {
		font-size: 0.7rem;
		color: var(--text-60);
		line-height: 1.2;
	}

	.chat-input__field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.chat-input__editor {
		position: relative;
	}

	.chat-input__textarea-wrapper {
		position: relative;
		width: 100%;
	}

	.chat-input__textarea-wrapper textarea {
		position: relative;
		z-index: 1;
		width: 100%;
		padding: 0.55rem 1rem;
		min-height: 2.8rem;
		line-height: 1.4;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
		background: color-mix(in srgb, var(--color-panel) 80%, #1a1d21);
		color: var(--text-100);
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25);
	}

	.chat-input__textarea-wrapper textarea::placeholder {
		line-height: 1.4;
		color: var(--text-50);
	}

	.chat-input-root--expanded .chat-input__textarea-wrapper textarea,
	.chat-input-root--expanded .chat-input__mention-overlay {
		border-radius: 1.1rem;
	}

	.chat-input__textarea-wrapper textarea.has-mentions {
		color: transparent;
		caret-color: var(--text-100);
		background: transparent;
	}

	.chat-input__mention-overlay {
		position: absolute;
		inset: 0;
		padding: 0.55rem 1rem;
		pointer-events: none;
		font-family: inherit;
		font-size: inherit;
		line-height: 1.4;
		overflow: hidden;
		z-index: 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--text-100);
		background: color-mix(in srgb, var(--color-panel) 80%, #1a1d21);
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
	}

	.chat-input__mention-text {
		color: var(--text-100);
	}

	.chat-input__mention-tag {
		display: inline;
		font-weight: inherit;
		color: #2fd8c8;
		background: color-mix(in srgb, #2fd8c8 18%, transparent);
		border-radius: 4px;
		padding: 0;
		margin: 0;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
		box-shadow: 0 0 0 0.12rem color-mix(in srgb, #2fd8c8 18%, transparent);
	}

	.chat-input__mention-tag--role {
		color: var(--mention-color, #2fd8c8);
		background: color-mix(in srgb, var(--mention-color, #2fd8c8) 18%, transparent);
		box-shadow: 0 0 0 0.12rem
			color-mix(in srgb, var(--mention-color, #2fd8c8) 18%, transparent);
	}

	.chat-input__mention-tag--special {
		color: #38bdf8;
		background: color-mix(in srgb, #38bdf8 18%, transparent);
		box-shadow: 0 0 0 0.12rem color-mix(in srgb, #38bdf8 18%, transparent);
	}

	.chat-input__prediction {
		position: absolute;
		inset: 0;
		padding: 0.5rem 1rem;
		pointer-events: none;
		font-family: inherit;
		font-size: inherit;
		line-height: 1.4;
		overflow: hidden;
		z-index: 2;
	}

	.chat-input__prediction--touch {
		pointer-events: auto;
		cursor: pointer;
	}

	.chat-input__prediction-content {
		white-space: pre-wrap;
		word-break: break-word;
	}

	.chat-input__prediction-shadow {
		color: transparent;
	}

	.chat-input__prediction-hint {
		color: color-mix(in srgb, var(--color-text-primary) 45%, transparent);
	}

	.chat-input__suggested-ghost {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		pointer-events: none;
		font-size: 0.95rem;
		line-height: 1.4;
		color: color-mix(in srgb, var(--color-text-primary) 30%, transparent);
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding-bottom: 0.3rem;
	}

	.chat-input__suggested-line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: baseline;
	}

	.chat-input__suggested-prefix {
		color: var(--text-55);
		font-weight: 500;
		white-space: nowrap;
	}

	.chat-input__suggested-text {
		color: color-mix(in srgb, var(--color-text-primary) 65%, transparent);
	}

	.chat-input__suggested-hint {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-50);
	}

	.chat-input__suggested-status {
		color: var(--text-55);
	}

	.chat-input__suggested-status--error {
		color: var(--color-danger, #ff9999);
	}

	.chat-input__suggested-refresh {
		position: absolute;
		top: 0.35rem;
		right: 0.65rem;
		width: 1.5rem;
		height: 1.5rem;
		border: none;
		background: transparent;
		color: color-mix(in srgb, var(--color-text-primary) 65%, transparent);
		display: grid;
		place-items: center;
		z-index: 6;
		padding: 0;
	}

	.chat-input__suggested-refresh:hover,
	.chat-input__suggested-refresh:focus-visible {
		color: var(--color-accent);
		outline: none;
	}

	.chat-input__suggested-refresh:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.chat-input__suggested-refresh i {
		font-size: 0.95rem;
	}

	@media (max-width: 640px) {
		.chat-input__field {
			gap: 0.45rem;
			min-width: 0;
			max-width: 100%;
		}

		.chat-input__textarea-wrapper textarea {
			border-radius: 1.2rem;
			padding-inline: 1rem;
		}

		.chat-input__suggested-ghost {
			padding-right: 2.5rem;
		}

		.chat-input__suggested-hint {
			font-size: 0.7rem;
		}

		.reply-banner {
			padding: 0.4rem 0.5rem;
			gap: 0.45rem;
			margin-bottom: 0.3rem;
			border-radius: 0.65rem;
			max-width: 100%;
			min-width: 0;
			overflow: hidden;
		}

		.reply-banner__body {
			min-width: 0;
			overflow: hidden;
		}

		.reply-banner__label {
			font-size: 0.6rem;
		}

		.reply-banner__name {
			font-size: 0.75rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.reply-banner__preview {
			font-size: 0.7rem;
			max-width: 100%;
		}

		.reply-banner__close {
			flex-shrink: 0;
			width: 1.5rem;
			height: 1.5rem;
			min-width: 1.5rem;
		}

		.ai-card {
			border-radius: 1rem;
			padding: 0.85rem;
			gap: 0.5rem;
		}

		.ai-card__body {
			gap: 0.4rem;
		}

		.rewrite-menu__item {
			gap: 0.45rem;
			padding: 0.35rem 0.4rem;
		}

		.rewrite-menu__icon {
			width: 1.9rem;
			height: 1.9rem;
		}
	}

	.chat-input__actions {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		align-self: center;
		transition:
			align-self 120ms ease,
			padding-bottom 120ms ease;
		position: relative;
		z-index: 20;
	}

	.chat-input__actions--anchored {
		align-self: flex-end;
		align-items: flex-end;
		padding-bottom: 0.2rem;
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
		transition:
			background 140ms ease,
			border 140ms ease;
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
		z-index: 100;
	}

	.emoji-picker-wrapper {
		position: fixed;
		z-index: 999997;
		overflow: hidden;
		border-radius: 1rem;
		display: flex;
		flex-direction: column;
		width: min(320px, calc(100vw - 0.75rem));
		max-width: calc(100vw - 0.75rem);
		height: min(420px, 75vh);
		max-height: min(420px, 75vh);
		overflow: hidden;
	}

	.emoji-picker-wrapper :global(.emoji-panel) {
		width: 100% !important;
		max-width: 100% !important;
		max-height: 100% !important;
		height: 100% !important;
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
		transition:
			background 150ms ease,
			border 150ms ease,
			transform 120ms ease;
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
		transition:
			background 150ms ease,
			transform 120ms ease,
			margin 120ms ease;
		align-self: center;
		transform: translateY(-0.15rem);
	}

	.chat-send-button--anchored {
		align-self: flex-end;
		transform: translateY(0);
		margin-bottom: 0.12rem;
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

	.chat-input__mobile-send {
		position: absolute;
		bottom: 50%;
		right: 0.4rem;
		top: auto;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		border: none;
		background: var(--color-accent);
		color: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		box-shadow: none;
		transition:
			transform 120ms ease,
			opacity 120ms ease,
			background 120ms ease;
		z-index: 3;
		pointer-events: auto;
		transform: translateY(40%);
	}

	.chat-input__mobile-send:disabled {
		opacity: 0.35;
		background: var(--text-30);
		cursor: not-allowed;
	}

	.chat-input__mobile-send--expanded {
		bottom: 0.8rem;
		transform: none;
	}

	.chat-input__mobile-send:not(:disabled):active {
		transform: translateY(40%) scale(0.9);
		background: color-mix(in srgb, var(--color-accent) 85%, #000 15%);
	}

	.chat-input__mobile-send--expanded:not(:disabled):active {
		transform: scale(0.9);
	}

	.chat-input__mobile-send i {
		line-height: 1;
		font-weight: 700;
	}

	@media (max-width: 767px) {
		.textarea {
			max-height: min(32vh, 14rem);
		}

		.chat-send-button {
			display: none;
		}

		.chat-input__action-column--mobile {
			position: static;
			align-self: center;
			display: flex;
			align-items: center;
			padding-right: 0.15rem;
			z-index: 5;
			transition:
				align-self 120ms ease,
				padding-bottom 120ms ease,
				transform 120ms ease;
			transform: translateY(-0.15rem);
		}

		.chat-input__action-column--mobile-anchored {
			align-self: flex-end;
			padding-bottom: 0.15rem;
			transform: translateY(0);
		}

		.chat-input__action-column--mobile .chat-input__primary-action {
			width: auto;
			height: auto;
		}

		.chat-input__action-column--mobile .chat-input__plus-button {
			width: 2.75rem;
			height: 2.75rem;
			font-size: 1.35rem;
			border-width: 1.5px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		}

		.chat-input__textarea-wrapper textarea {
			padding-top: 0.35rem;
			padding-bottom: 0.35rem;
			padding-right: 3.5rem;
			min-height: 2.25rem;
			line-height: 1.35;
		}
	}

	@media (min-width: 768px) {
		.chat-input__mobile-send {
			display: none;
		}
	}
</style>
