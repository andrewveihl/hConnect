import { browser } from '$app/environment';

type KeybindDefinitionBase = {
	id: string;
	group: string;
	label: string;
	description?: string;
	defaultBinding: string | null;
	/** If true, this keybind requires modifier keys even when in an editable field */
	global?: boolean;
};

export const keybindDefinitions = [
	// ─────────────────────────────────────────────────────────────────────────────
	// GENERAL
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'openSettings',
		group: 'General',
		label: 'Open Settings',
		description: 'Open the user settings panel.',
		defaultBinding: 'Ctrl+,',
		global: true
	},
	{
		id: 'openKeybinds',
		group: 'General',
		label: 'Open Keybinds',
		description: 'Jump straight to the keybinds tab.',
		defaultBinding: 'Ctrl+Shift+K',
		global: true
	},
	{
		id: 'closeModal',
		group: 'General',
		label: 'Close Modal / Cancel',
		description: 'Close any open modal or cancel the current action.',
		defaultBinding: 'Esc',
		global: true
	},
	{
		id: 'quickSwitcher',
		group: 'General',
		label: 'Quick Switcher',
		description: 'Open the quick switcher to jump to any channel, DM, or server.',
		defaultBinding: 'Ctrl+K',
		global: true
	},
	{
		id: 'search',
		group: 'General',
		label: 'Search',
		description: 'Open the search bar.',
		defaultBinding: 'Ctrl+F',
		global: true
	},
	{
		id: 'markAsRead',
		group: 'General',
		label: 'Mark As Read',
		description: 'Mark the current channel or server as read.',
		defaultBinding: 'Esc',
		global: false
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// NAVIGATION
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'openServers',
		group: 'Navigation',
		label: 'Go to Servers',
		description: 'Jump to the servers list.',
		defaultBinding: 'Ctrl+Shift+H',
		global: true
	},
	{
		id: 'openDMs',
		group: 'Navigation',
		label: 'Go to Direct Messages',
		description: 'Jump to your DM list.',
		defaultBinding: 'Ctrl+Shift+E',
		global: true
	},
	{
		id: 'goBack',
		group: 'Navigation',
		label: 'Navigate Back',
		description: 'Navigate back in history.',
		defaultBinding: 'Alt+Left',
		global: true
	},
	{
		id: 'goForward',
		group: 'Navigation',
		label: 'Navigate Forward',
		description: 'Navigate forward in history.',
		defaultBinding: 'Alt+Right',
		global: true
	},
	{
		id: 'nextChannel',
		group: 'Navigation',
		label: 'Next Channel',
		description: 'Jump to the next channel in the list.',
		defaultBinding: 'Alt+Down',
		global: true
	},
	{
		id: 'prevChannel',
		group: 'Navigation',
		label: 'Previous Channel',
		description: 'Jump to the previous channel in the list.',
		defaultBinding: 'Alt+Up',
		global: true
	},
	{
		id: 'nextUnreadChannel',
		group: 'Navigation',
		label: 'Next Unread Channel',
		description: 'Jump to the next channel with unread messages.',
		defaultBinding: 'Alt+Shift+Down',
		global: true
	},
	{
		id: 'prevUnreadChannel',
		group: 'Navigation',
		label: 'Previous Unread Channel',
		description: 'Jump to the previous channel with unread messages.',
		defaultBinding: 'Alt+Shift+Up',
		global: true
	},
	{
		id: 'nextServer',
		group: 'Navigation',
		label: 'Next Server',
		description: 'Switch to the next server.',
		defaultBinding: 'Ctrl+Alt+Down',
		global: true
	},
	{
		id: 'prevServer',
		group: 'Navigation',
		label: 'Previous Server',
		description: 'Switch to the previous server.',
		defaultBinding: 'Ctrl+Alt+Up',
		global: true
	},
	{
		id: 'jumpToServer1',
		group: 'Navigation',
		label: 'Jump to Server 1',
		description: 'Switch to the first server in your list.',
		defaultBinding: 'Ctrl+1',
		global: true
	},
	{
		id: 'jumpToServer2',
		group: 'Navigation',
		label: 'Jump to Server 2',
		description: 'Switch to the second server in your list.',
		defaultBinding: 'Ctrl+2',
		global: true
	},
	{
		id: 'jumpToServer3',
		group: 'Navigation',
		label: 'Jump to Server 3',
		description: 'Switch to the third server in your list.',
		defaultBinding: 'Ctrl+3',
		global: true
	},
	{
		id: 'jumpToServer4',
		group: 'Navigation',
		label: 'Jump to Server 4',
		description: 'Switch to the fourth server in your list.',
		defaultBinding: 'Ctrl+4',
		global: true
	},
	{
		id: 'jumpToServer5',
		group: 'Navigation',
		label: 'Jump to Server 5',
		description: 'Switch to the fifth server in your list.',
		defaultBinding: 'Ctrl+5',
		global: true
	},
	{
		id: 'jumpToServer6',
		group: 'Navigation',
		label: 'Jump to Server 6',
		description: 'Switch to the sixth server in your list.',
		defaultBinding: 'Ctrl+6',
		global: true
	},
	{
		id: 'jumpToServer7',
		group: 'Navigation',
		label: 'Jump to Server 7',
		description: 'Switch to the seventh server in your list.',
		defaultBinding: 'Ctrl+7',
		global: true
	},
	{
		id: 'jumpToServer8',
		group: 'Navigation',
		label: 'Jump to Server 8',
		description: 'Switch to the eighth server in your list.',
		defaultBinding: 'Ctrl+8',
		global: true
	},
	{
		id: 'jumpToServer9',
		group: 'Navigation',
		label: 'Jump to Server 9',
		description: 'Switch to the ninth server in your list.',
		defaultBinding: 'Ctrl+9',
		global: true
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// CHANNELS & THREADS
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'openLatestThread',
		group: 'Channels',
		label: 'Open Latest Thread',
		description: 'Jump to the most recent active thread.',
		defaultBinding: 'T',
		global: false
	},
	{
		id: 'toggleMemberList',
		group: 'Channels',
		label: 'Toggle Member List',
		description: 'Show or hide the member sidebar.',
		defaultBinding: 'Ctrl+U',
		global: true
	},
	{
		id: 'togglePinnedMessages',
		group: 'Channels',
		label: 'Toggle Pinned Messages',
		description: 'Show or hide pinned messages.',
		defaultBinding: 'Ctrl+P',
		global: true
	},
	{
		id: 'createThread',
		group: 'Channels',
		label: 'Create Thread',
		description: 'Start a new thread from the selected message.',
		defaultBinding: null,
		global: false
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// MESSAGING
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'focusChatInput',
		group: 'Messaging',
		label: 'Focus Chat Input',
		description: 'Jump to the message input box.',
		defaultBinding: 'Tab',
		global: false
	},
	{
		id: 'uploadFile',
		group: 'Messaging',
		label: 'Upload File',
		description: 'Open file upload dialog.',
		defaultBinding: 'Ctrl+Shift+U',
		global: true
	},
	{
		id: 'editLastMessage',
		group: 'Messaging',
		label: 'Edit Last Message',
		description: 'Edit your most recent message.',
		defaultBinding: 'ArrowUp',
		global: false
	},
	{
		id: 'replyToMessage',
		group: 'Messaging',
		label: 'Reply to Message',
		description: 'Reply to the selected message.',
		defaultBinding: 'R',
		global: false
	},
	{
		id: 'reactToMessage',
		group: 'Messaging',
		label: 'React to Message',
		description: 'Add a reaction to the selected message.',
		defaultBinding: '+',
		global: false
	},
	{
		id: 'deleteMessage',
		group: 'Messaging',
		label: 'Delete Message',
		description: 'Delete the selected message.',
		defaultBinding: 'Backspace',
		global: false
	},
	{
		id: 'copyMessageText',
		group: 'Messaging',
		label: 'Copy Message Text',
		description: 'Copy the text of the selected message.',
		defaultBinding: 'Ctrl+C',
		global: false
	},
	{
		id: 'scrollToOldest',
		group: 'Messaging',
		label: 'Jump to Oldest Messages',
		description: 'Scroll to the beginning of the channel.',
		defaultBinding: 'Home',
		global: false
	},
	{
		id: 'scrollToNewest',
		group: 'Messaging',
		label: 'Jump to Newest Messages',
		description: 'Scroll to the most recent messages.',
		defaultBinding: 'End',
		global: false
	},
	{
		id: 'pageUp',
		group: 'Messaging',
		label: 'Page Up',
		description: 'Scroll up one page of messages.',
		defaultBinding: 'PageUp',
		global: false
	},
	{
		id: 'pageDown',
		group: 'Messaging',
		label: 'Page Down',
		description: 'Scroll down one page of messages.',
		defaultBinding: 'PageDown',
		global: false
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// TEXT FORMATTING (in message input)
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'formatBold',
		group: 'Text Formatting',
		label: 'Bold',
		description: 'Make selected text bold.',
		defaultBinding: 'Ctrl+B',
		global: false
	},
	{
		id: 'formatItalic',
		group: 'Text Formatting',
		label: 'Italic',
		description: 'Make selected text italic.',
		defaultBinding: 'Ctrl+I',
		global: false
	},
	{
		id: 'formatUnderline',
		group: 'Text Formatting',
		label: 'Underline',
		description: 'Underline selected text.',
		defaultBinding: 'Ctrl+U',
		global: false
	},
	{
		id: 'formatStrikethrough',
		group: 'Text Formatting',
		label: 'Strikethrough',
		description: 'Strike through selected text.',
		defaultBinding: 'Ctrl+Shift+X',
		global: false
	},
	{
		id: 'formatCode',
		group: 'Text Formatting',
		label: 'Inline Code',
		description: 'Format selected text as inline code.',
		defaultBinding: 'Ctrl+E',
		global: false
	},
	{
		id: 'formatCodeBlock',
		group: 'Text Formatting',
		label: 'Code Block',
		description: 'Format selected text as a code block.',
		defaultBinding: 'Ctrl+Shift+C',
		global: false
	},
	{
		id: 'insertEmoji',
		group: 'Text Formatting',
		label: 'Emoji Picker',
		description: 'Open the emoji picker.',
		defaultBinding: 'Ctrl+E',
		global: false
	},
	{
		id: 'insertMention',
		group: 'Text Formatting',
		label: 'Mention User',
		description: 'Insert an @mention.',
		defaultBinding: '@',
		global: false
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// SETTINGS
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'openServerSettings',
		group: 'Settings',
		label: 'Open Server Settings',
		description: 'Open settings for the active server.',
		defaultBinding: 'Ctrl+Shift+G',
		global: true
	},
	{
		id: 'openVoiceSettings',
		group: 'Settings',
		label: 'Open Voice Settings',
		description: 'Jump to Voice & Video preferences.',
		defaultBinding: null,
		global: true
	},
	{
		id: 'openNotificationSettings',
		group: 'Settings',
		label: 'Open Notification Settings',
		description: 'Jump to notification preferences.',
		defaultBinding: null,
		global: true
	},
	{
		id: 'openAppearanceSettings',
		group: 'Settings',
		label: 'Open Appearance Settings',
		description: 'Jump to theme controls.',
		defaultBinding: null,
		global: true
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// VOICE
	// ─────────────────────────────────────────────────────────────────────────────
	{
		id: 'toggleMute',
		group: 'Voice',
		label: 'Toggle Mute',
		description: 'Mute or unmute your microphone.',
		defaultBinding: 'Ctrl+Shift+M',
		global: true
	},
	{
		id: 'toggleDeafen',
		group: 'Voice',
		label: 'Toggle Deafen',
		description: 'Deafen or undeafen audio.',
		defaultBinding: 'Ctrl+Shift+D',
		global: true
	},
	{
		id: 'toggleVideo',
		group: 'Voice',
		label: 'Toggle Video',
		description: 'Turn camera on or off.',
		defaultBinding: 'Ctrl+Shift+V',
		global: true
	},
	{
		id: 'toggleScreenShare',
		group: 'Voice',
		label: 'Toggle Screen Share',
		description: 'Start or stop screen sharing.',
		defaultBinding: 'Ctrl+Shift+S',
		global: true
	},
	{
		id: 'leaveVoice',
		group: 'Voice',
		label: 'Disconnect from Voice',
		description: 'Leave the current voice channel.',
		defaultBinding: 'Ctrl+Shift+L',
		global: true
	},
	{
		id: 'showVoicePanel',
		group: 'Voice',
		label: 'Show Voice Panel',
		description: 'Bring the voice panel back into view.',
		defaultBinding: null,
		global: true
	},
	{
		id: 'openVoicePanelSettings',
		group: 'Voice',
		label: 'Open Voice Panel Settings',
		description: 'Open settings from the active call.',
		defaultBinding: null,
		global: true
	},
	{
		id: 'pushToTalk',
		group: 'Voice',
		label: 'Push to Talk',
		description: 'Hold to transmit voice (if push-to-talk is enabled).',
		defaultBinding: null,
		global: true
	},
	{
		id: 'pushToMute',
		group: 'Voice',
		label: 'Push to Mute',
		description: 'Hold to mute your microphone.',
		defaultBinding: null,
		global: true
	}
] as const satisfies ReadonlyArray<KeybindDefinitionBase>;

/** Group order for displaying keybinds in UI */
export const keybindGroupOrder = [
	'General',
	'Navigation',
	'Channels',
	'Messaging',
	'Text Formatting',
	'Voice',
	'Settings'
] as const;

export type KeybindActionId = (typeof keybindDefinitions)[number]['id'];
export type KeybindDefinition = (typeof keybindDefinitions)[number];
export type KeybindMap = Record<KeybindActionId, string | null>;

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type ModifierKey = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, ModifierKey> = {
	ctrl: 'Ctrl',
	control: 'Ctrl',
	alt: 'Alt',
	option: 'Alt',
	shift: 'Shift',
	meta: 'Meta',
	cmd: 'Meta',
	command: 'Meta',
	win: 'Meta'
};

const KEY_ALIASES: Record<string, string> = {
	' ': 'Space',
	spacebar: 'Space',
	escape: 'Esc',
	esc: 'Esc',
	arrowup: 'ArrowUp',
	up: 'ArrowUp',
	arrowdown: 'ArrowDown',
	down: 'ArrowDown',
	arrowleft: 'ArrowLeft',
	left: 'ArrowLeft',
	arrowright: 'ArrowRight',
	right: 'ArrowRight',
	pageup: 'PageUp',
	pagedown: 'PageDown',
	backspace: 'Backspace',
	delete: 'Delete',
	insert: 'Insert',
	enter: 'Enter',
	return: 'Enter',
	tab: 'Tab',
	home: 'Home',
	end: 'End',
	capslock: 'CapsLock',
	printscreen: 'PrintScreen',
	scrolllock: 'ScrollLock',
	pause: 'Pause'
};

const SYMBOL_ALIASES: Record<string, string> = {
	'+': 'Plus',
	'-': 'Minus',
	'=': 'Equals',
	',': 'Comma',
	'.': 'Period',
	'/': 'Slash',
	';': 'Semicolon',
	"'": 'Quote',
	'`': 'Backtick',
	'[': 'BracketLeft',
	']': 'BracketRight',
	'\\': 'Backslash'
};

const DISPLAY_ALIASES: Record<string, string> = {
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	PageUp: 'Page Up',
	PageDown: 'Page Down',
	Esc: 'Esc',
	Space: 'Space'
};

function normalizeModifierToken(token: string): ModifierKey | null {
	const key = token.trim().toLowerCase();
	return MODIFIER_ALIASES[key] ?? null;
}

function normalizeKeyLabel(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const lower = trimmed.toLowerCase();
	if (MODIFIER_ALIASES[lower]) return null;

	if (SYMBOL_ALIASES[trimmed]) return SYMBOL_ALIASES[trimmed];
	if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];

	if (trimmed.length === 1) return trimmed.toUpperCase();
	if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();

	return trimmed;
}

function buildKeybind(modifiers: ModifierKey[], key: string): string {
	const ordered = MODIFIER_ORDER.filter((mod) => modifiers.includes(mod));
	return [...ordered, key].join('+');
}

export function normalizeKeybindString(binding: string | null | undefined): string | null {
	if (binding == null) return null;
	if (typeof binding !== 'string') return null;
	const trimmed = binding.trim();
	if (!trimmed) return null;

	const tokens = trimmed.split('+').map((token) => token.trim()).filter(Boolean);
	const modifiers = new Set<ModifierKey>();
	let key: string | null = null;

	for (const token of tokens) {
		const mod = normalizeModifierToken(token);
		if (mod) {
			modifiers.add(mod);
			continue;
		}
		const normalizedKey = normalizeKeyLabel(token);
		if (!normalizedKey) continue;
		if (key && key !== normalizedKey) return null;
		key = normalizedKey;
	}

	if (!key) return null;
	return buildKeybind(Array.from(modifiers), key);
}

export const defaultKeybinds: KeybindMap = keybindDefinitions.reduce((acc, def) => {
	acc[def.id] =
		def.defaultBinding == null
			? null
			: normalizeKeybindString(def.defaultBinding) ?? def.defaultBinding;
	return acc;
}, {} as KeybindMap);

export function keybindFromEvent(event: KeyboardEvent): string | null {
	if (event.key === 'Unidentified' || event.key === 'Dead') return null;
	if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
		return null;
	}

	const key = normalizeKeyLabel(event.key);
	if (!key) return null;

	const modifiers: ModifierKey[] = [];
	if (event.ctrlKey) modifiers.push('Ctrl');
	if (event.altKey) modifiers.push('Alt');
	if (event.shiftKey) modifiers.push('Shift');
	if (event.metaKey) modifiers.push('Meta');

	return buildKeybind(modifiers, key);
}

export function matchKeybind(event: KeyboardEvent, binding: string | null | undefined): boolean {
	const normalized = normalizeKeybindString(binding);
	if (!normalized) return false;
	return keybindFromEvent(event) === normalized;
}

export function mergeKeybinds(input: Record<string, unknown> | null | undefined): KeybindMap {
	const next: KeybindMap = { ...defaultKeybinds };
	const source = input ?? {};
	keybindDefinitions.forEach((def) => {
		const raw = (source as Record<string, unknown>)[def.id];
		if (raw === null) {
			next[def.id] = null;
			return;
		}
		if (typeof raw === 'string') {
			if (!raw.trim()) {
				next[def.id] = null;
				return;
			}
			const normalized = normalizeKeybindString(raw);
			if (normalized) {
				next[def.id] = normalized;
			}
		}
	});
	return next;
}

function isMacPlatform(): boolean {
	if (!browser) return false;
	return /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? navigator.userAgent);
}

export function formatKeybindForDisplay(binding: string | null | undefined): string {
	if (!binding) return 'Unassigned';
	const tokens = binding.split('+');
	const isMac = isMacPlatform();
	return tokens
		.map((token) => {
			if (token === 'Meta') return isMac ? 'Cmd' : 'Meta';
			if (token === 'Alt') return isMac ? 'Option' : 'Alt';
			if (token === 'Ctrl') return isMac ? 'Ctrl' : 'Ctrl';
			if (token === 'Shift') return 'Shift';
			return DISPLAY_ALIASES[token] ?? token;
		})
		.join(' + ');
}

export function isEditableTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	return !!el.closest?.('[contenteditable="true"]');
}

/** Get a keybind definition by ID */
export function getKeybindDef(id: KeybindActionId): KeybindDefinition | undefined {
	return keybindDefinitions.find((def) => def.id === id);
}

/** Check if a keybind is global (should work even when focused on input) */
export function isGlobalKeybind(id: KeybindActionId): boolean {
	const def = getKeybindDef(id);
	return def?.global ?? false;
}

/** Get keybinds grouped by their group, in order */
export function getGroupedKeybinds(): Array<{ group: string; items: KeybindDefinition[] }> {
	const map = new Map<string, KeybindDefinition[]>();
	keybindDefinitions.forEach((def) => {
		const list = map.get(def.group) ?? [];
		list.push(def);
		map.set(def.group, list);
	});
	return keybindGroupOrder
		.filter((group) => map.has(group))
		.map((group) => ({ group, items: map.get(group) ?? [] }));
}

/** Count how many keybinds have a binding assigned */
export function countAssignedKeybinds(keybinds: KeybindMap): number {
	return Object.values(keybinds).filter(Boolean).length;
}

/** Find conflicts (multiple actions with the same binding) */
export function findConflicts(keybinds: KeybindMap): Map<KeybindActionId, KeybindActionId[]> {
	const bindingMap = new Map<string, KeybindActionId[]>();
	keybindDefinitions.forEach((def) => {
		const binding = keybinds[def.id];
		if (!binding) return;
		const list = bindingMap.get(binding) ?? [];
		bindingMap.set(binding, [...list, def.id]);
	});
	const conflicts = new Map<KeybindActionId, KeybindActionId[]>();
	bindingMap.forEach((ids) => {
		if (ids.length < 2) return;
		ids.forEach((id) => {
			conflicts.set(
				id,
				ids.filter((entry) => entry !== id)
			);
		});
	});
	return conflicts;
}
