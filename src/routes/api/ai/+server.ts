import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const OPENAI_KEY = env.OPENAI_API_KEY ?? env.OPENAI_KEY ?? env.PRIVATE_OPENAI_KEY ?? '';
const OPENAI_MODEL = env.OPENAI_MODEL ?? 'gpt-4o-mini';
const OPENAI_BASE = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

const MAX_CONTEXT_CHARS = 1200;
const MAX_TYPED_CHARS = 400;

type ReplyPayload = {
	intent: 'reply';
	message?: {
		text?: string | null;
		preview?: string | null;
		author?: string | null;
		type?: string | null;
	};
	threadLabel?: string | null;
};

type PredictPayload = {
	intent: 'predict';
	text?: string;
	count?: number;
	platform?: 'desktop' | 'mobile';
};

type AnnouncementPayload = {
	intent: 'announcement';
	category?: 'update' | 'feature' | 'maintenance' | 'security' | 'general';
	version?: string | null;
	features: string[];
	tone?: 'formal' | 'friendly' | 'exciting' | null;
	appName?: string;
};

type RequestBody = ReplyPayload | PredictPayload | AnnouncementPayload;

const clampText = (value: unknown, max = MAX_CONTEXT_CHARS) => {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

async function callOpenAI(
	messages: Array<{ role: 'system' | 'user'; content: string }>,
	params?: Record<string, unknown>
) {
	if (!OPENAI_KEY) {
		throw new Error('OpenAI API key missing');
	}
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 15000);

	const body = {
		model: OPENAI_MODEL,
		temperature: 0.4,
		max_completion_tokens: 120,
		messages,
		...params
	};

	try {
		const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_KEY}`
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || `OpenAI error (${response.status})`);
		}

		const data = await response.json();
		const choice = data?.choices?.[0]?.message?.content;
		if (!choice) return '';
		if (typeof choice === 'string') return choice.trim();
		if (Array.isArray(choice)) {
			return choice
				.map((chunk: any) =>
					typeof chunk?.text === 'string' ? chunk.text : typeof chunk === 'string' ? chunk : ''
				)
				.join('')
				.trim();
		}
		return '';
	} finally {
		clearTimeout(timeoutId);
	}
}

function describeMessageForPrompt(message?: ReplyPayload['message']) {
	if (!message) return '';
	const text = clampText(message.text ?? message.preview ?? '', MAX_CONTEXT_CHARS);
	if (text) return text;
	const type = (message.type ?? '').toLowerCase();
	switch (type) {
		case 'gif':
			return 'The other person sent a GIF.';
		case 'file':
			return 'The other person shared a file attachment.';
		case 'poll':
			return 'They posted a poll.';
		case 'form':
			return 'They shared a form.';
		default:
			return 'The other person reacted without text.';
	}
}

async function generateReplySuggestion(body: ReplyPayload) {
	const author = clampText(body.message?.author ?? '', 120) || 'the other person';
	const text = describeMessageForPrompt(body.message);
	const threadLabel = clampText(body.threadLabel ?? '', 120);
	if (!text) {
		throw new Error('Missing message text.');
	}
	const systemPrompt =
		'You are a concise but friendly assistant that helps craft direct message replies. Keep answers under 45 words, stay casual-professional, and never add markdown, emojis, or extra salutations. Reply with only the suggested response.';
	const contextLines = [
		threadLabel ? `Conversation notes: ${threadLabel}` : null,
		`Message from ${author}: """${text}"""`,
		'Task: Suggest a thoughtful reply in first person.'
	]
		.filter(Boolean)
		.join('\n');
	return callOpenAI(
		[
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: contextLines }
		],
		{ max_completion_tokens: 120, temperature: 0.5 }
	);
}

function normalizePredictionArray(raw: string, count: number) {
	const cleaned = raw.trim();
	if (!cleaned) return [];
	try {
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed)) {
			return parsed
				.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
				.filter(Boolean)
				.slice(0, count);
		}
		if (Array.isArray(parsed?.options)) {
			return parsed.options
				.map((entry: any) => (typeof entry === 'string' ? entry.trim() : ''))
				.filter(Boolean)
				.slice(0, count);
		}
	} catch {
		// fall through to regex split
	}
	return cleaned
		.split(/[\n,|]+/)
		.map((part) => part.trim().replace(/^[-•\d.]+\s*/, ''))
		.filter(Boolean)
		.slice(0, count);
}

async function generatePredictions(body: PredictPayload) {
	const text = clampText(body.text ?? '', MAX_TYPED_CHARS);
	if (!text) return [];
	const count = Math.min(
		Math.max(Number(body.count) || (body.platform === 'mobile' ? 3 : 1), 1),
		5
	);
	const systemPrompt = `You autocomplete casual chat messages one word or very short phrase at a time. Return ${count} likely continuations for the next ${count === 1 ? 'word or short phrase' : 'words'} as a JSON array of plain strings. No commentary. Keep each option under four words.`;
	const userPrompt = `Typed so far: """${text}"""\nReturn the ${count} most likely next tokens.`;
	const raw = await callOpenAI(
		[
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		],
		{ max_completion_tokens: 40, temperature: 0.3 }
	);
	return normalizePredictionArray(raw, count);
}

async function generateAnnouncement(body: AnnouncementPayload) {
	const appName = body.appName || 'hConnect';
	const category = body.category || 'general';
	const version = body.version || null;
	const features = body.features || [];

	if (features.length === 0) {
		throw new Error('At least one feature is required to generate an announcement.');
	}

	const categoryContext: Record<string, string> = {
		update: 'app update',
		feature: 'new feature release',
		maintenance: 'maintenance notice',
		security: 'security update',
		general: 'announcement'
	};

	const systemPrompt = `You are a release notes writer for ${appName}, a team collaboration and communication app. Your job is to transform developer commit messages and technical notes into user-friendly release notes.

IMPORTANT GUIDELINES:
1. INTERPRET commit messages - they are often shorthand. "fix navbar" → "Fixed navigation menu issues"
2. GROUP related changes - multiple commits about the same feature should become one bullet
3. TRANSLATE technical jargon - "refactor store" → "Improved app performance", "fix SSR hydration" → "Fixed page loading issues"
4. SKIP internal/dev-only changes - things like "update deps", "lint fixes", "merge main" should be omitted or summarized as "Various improvements"
5. FOCUS on user impact - what does this change MEAN for users?

OUTPUT FORMAT:
- Title: 3-6 words, can include emoji, should capture the main theme (e.g., "🚀 Faster & More Reliable" or "Voice Chat Improvements")
- Body: Use **bold** for feature names, bullet points with "-", 1-2 sentences per item max
- Keep total length reasonable (100-200 words)

EXAMPLE INPUT:
- fix mobile nav z-index
- add voice call reconnection
- update firebase deps  
- fix SSR hydration error
- improve call quality codec

EXAMPLE OUTPUT:
{"title": "🎯 Smoother Calls & Navigation", "message": "**Voice Calls** - Improved audio quality and automatic reconnection when your connection drops\n\n**Navigation** - Fixed mobile menu overlay issues\n\n**Performance** - Various under-the-hood improvements for a snappier experience"}

Return ONLY valid JSON: {"title": "...", "message": "..."}`;

	const featureList = features.map(f => `- ${f}`).join('\n');
	const userPrompt = `Transform these ${category === 'general' ? 'changes' : categoryContext[category] + ' notes'} for ${appName}${version ? ` v${version}` : ''} into user-friendly release notes:

${featureList}

Remember: Interpret and group related changes, skip internal-only items, focus on user impact. JSON only.`;

	const raw = await callOpenAI(
		[
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		],
		{ max_completion_tokens: 400, temperature: 0.6 }
	);

	// Parse the response
	const cleaned = raw.trim();
	try {
		const parsed = JSON.parse(cleaned);
		return {
			title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
			message: typeof parsed.message === 'string' ? parsed.message.trim() : ''
		};
	} catch {
		// Try to extract from markdown code block
		const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1].trim());
				return {
					title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
					message: typeof parsed.message === 'string' ? parsed.message.trim() : ''
				};
			} catch {
				// Fall through
			}
		}
		throw new Error('Failed to parse AI response as JSON.');
	}
}

export async function POST({ request }: { request: Request }) {
	if (!OPENAI_KEY) {
		return json(
			{ error: 'OpenAI API key missing. Set OPENAI_API_KEY in the environment.' },
			{ status: 501 }
		);
	}

	let body: RequestBody;
	try {
		body = (await request.json()) as RequestBody;
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || typeof body.intent !== 'string') {
		return json({ error: 'Missing intent.' }, { status: 400 });
	}

	try {
		if (body.intent === 'reply') {
			const suggestion = await generateReplySuggestion(body);
			return json({ suggestion: suggestion?.trim() ?? '' });
		}
		if (body.intent === 'predict') {
			const suggestions = await generatePredictions(body);
			return json({ suggestions });
		}
		if (body.intent === 'announcement') {
			const result = await generateAnnouncement(body as AnnouncementPayload);
			return json(result);
		}
		return json({ error: 'Unsupported intent.' }, { status: 400 });
	} catch (error) {
		console.error('[ai] suggestion error', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to reach AI service.' },
			{ status: 500 }
		);
	}
}
