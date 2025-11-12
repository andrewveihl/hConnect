import express from 'express';
import { initializeApp as initAdminApp, applicationDefault, cert, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body.', detail: err.message });
  }
  return next(err);
});

const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS ?? '';
const allowedOrigins = allowedOriginsEnv
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOriginSet = new Set(
  [...allowedOrigins, ...DEV_CORS_ORIGINS].map((entry) => entry.toLowerCase())
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin?.toLowerCase();
  const allowOrigin =
    allowedOriginSet.size === 0
      ? origin ?? '*'
      : normalizedOrigin && allowedOriginSet.has(normalizedOrigin)
      ? origin
      : null;

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

const OPENAI_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_KEY ||
  process.env.PRIVATE_OPENAI_KEY ||
  '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const ARCHIVE_THREADS_TOKEN =
  process.env.ARCHIVE_THREADS_TOKEN ||
  process.env.THREAD_JOB_TOKEN ||
  process.env.JOB_SHARED_SECRET ||
  '';
const ARCHIVE_THREADS_LIMIT = Math.min(Math.max(Number(process.env.ARCHIVE_THREADS_LIMIT) || 50, 1), 500);

const MAX_CONTEXT_CHARS = 1200;
const MAX_TYPED_CHARS = 400;
const MAX_CONTEXT_MESSAGES = 10;
const MAX_REWRITE_CHARS = 800;
const MAX_THREAD_SUMMARY_MESSAGES = 20;
const MAX_THREAD_SUMMARY_POINTS = 4;
const DEFAULT_THREAD_IDLE_HOURS = 6;

const REWRITE_MODE_CONFIG = {
  rephrase: {
    label: 'Rephrase',
    description: 'Say the same thing with new wording while keeping the tone neutral.',
    count: 2
  },
  shorten: {
    label: 'Shorten',
    description: 'Cut the text roughly in half while preserving the core meaning.',
    count: 1
  },
  elaborate: {
    label: 'Elaborate',
    description: 'Add one or two helpful sentences of context.',
    count: 1
  },
  formal: {
    label: 'More formal',
    description: 'Sound polished and professional without being stiff.',
    count: 1
  },
  casual: {
    label: 'More casual',
    description: 'Loosen the tone so it feels like a friendly Discord DM.',
    count: 1
  },
  bulletize: {
    label: 'Bulletize',
    description: 'Convert the message into 3-5 short bullet points using "- " prefixes.',
    count: 1
  },
  summarize: {
    label: 'Summarize',
    description: 'Summarize the draft into 2 concise sentences highlighting key points.',
    count: 1
  }
};

let adminDb = null;

function resolveServiceAccount() {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ??
    process.env.FIREBASE_SERVICE_ACCOUNT ??
    null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('[threads] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', error);
    return null;
  }
}

function ensureAdminDb() {
  if (adminDb) return adminDb;
  try {
    const existing = getAdminApps();
    if (existing.length) {
      adminDb = getAdminFirestore(existing[0]);
      return adminDb;
    }
    const serviceAccount = resolveServiceAccount();
    if (serviceAccount) {
      initAdminApp({
        credential: cert(serviceAccount),
        projectId:
          process.env.FIREBASE_PROJECT_ID ||
          serviceAccount.project_id ||
          process.env.GCLOUD_PROJECT ||
          process.env.GOOGLE_CLOUD_PROJECT
      });
    } else {
      initAdminApp({
        credential: applicationDefault(),
        projectId:
          process.env.FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          process.env.GOOGLE_CLOUD_PROJECT
      });
    }
    adminDb = getAdminFirestore();
    return adminDb;
  } catch (error) {
    console.error('[threads] Failed to initialize Firestore admin', error);
    throw error;
  }
}

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('backend up'));

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Hello from Cloud Run!' });
});

app.post('/api/archiveThreads', async (req, res) => {
  if (!ARCHIVE_THREADS_TOKEN) {
    return res
      .status(501)
      .json({ error: 'ARCHIVE_THREADS_TOKEN not configured. Set ARCHIVE_THREADS_TOKEN to enable.' });
  }

  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const providedToken =
    bearer ||
    (typeof req.body?.token === 'string' ? req.body.token : null) ||
    (typeof req.query?.token === 'string' ? req.query.token : null);
  if (providedToken !== ARCHIVE_THREADS_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let db;
  try {
    db = ensureAdminDb();
  } catch (error) {
    console.error('[threads] admin init failed', error);
    return res.status(500).json({ error: 'Firestore admin not initialized.' });
  }

  try {
    const now = Date.now();
    const snap = await db
      .collectionGroup('threads')
      .where('status', '==', 'active')
      .where('autoArchiveAt', '<=', now)
      .orderBy('autoArchiveAt', 'asc')
      .limit(ARCHIVE_THREADS_LIMIT)
      .get();

    if (snap.empty) {
      return res.json({ archived: 0, checked: 0 });
    }

    const batch = db.batch();
    snap.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        status: 'archived',
        archivedAt: FieldValue.serverTimestamp(),
        archiveReason: 'ttl_expired'
      });
    });
    await batch.commit();
    return res.json({ archived: snap.size, checked: snap.size });
  } catch (error) {
    console.error('[threads] archive job failed', error);
    return res.status(500).json({
      error: 'Failed to archive threads.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

const clampText = (value, max = MAX_CONTEXT_CHARS) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

async function callOpenAI(messages, params = {}) {
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
        .map((chunk) =>
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

function describeMessageForPrompt(message) {
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

function normalizeConversationContext(rawContext, limit = MAX_CONTEXT_MESSAGES) {
  if (!Array.isArray(rawContext) || !rawContext.length) return [];
  const normalized = rawContext
    .map((entry) => {
      const summary = describeMessageForPrompt(entry);
      if (!summary) return null;
      const author =
        clampText(
          entry?.author ??
            entry?.authorName ??
            entry?.from ??
            entry?.displayName ??
            entry?.name ??
            '',
          60
        ) || 'Someone';
      const condensed = summary.replace(/\s+/g, ' ').replace(/["“”]/g, '"').trim();
      if (!condensed) return null;
      return { author, text: clampText(condensed, MAX_CONTEXT_CHARS) };
    })
    .filter(Boolean);
  if (!normalized.length) return [];
  return normalized.slice(-limit);
}

function formatContextLines(entries) {
  if (!entries.length) return '';
  return entries
    .map((entry, index) => `${index + 1}. ${entry.author}: "${entry.text}"`)
    .join('\n');
}

function millisFromDate(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  try {
    const parsed = new Date(value);
    const time = parsed.getTime();
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

function normalizeSummaryResponse(raw, fallback = []) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      const candidate = text.replace(/^```json/i, '').replace(/```$/, '');
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
  }
  const base = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  if (!Array.isArray(base)) return [];
  return base
    .map((entry, index) => {
      const title = clampText(entry?.title ?? entry?.headline ?? '', 140);
      const details = clampText(entry?.details ?? entry?.summary ?? entry?.note ?? '', 360);
      const messageId =
        clampText(entry?.messageId ?? entry?.id ?? entry?.message ?? '', 120) ||
        clampText(fallback[index]?.id ?? '', 120) ||
        null;
      if (!title || !details) return null;
      return { title, details, messageId };
    })
    .filter(Boolean)
    .slice(0, MAX_THREAD_SUMMARY_POINTS);
}

async function generateReplySuggestion(body) {
  const author = clampText(body.message?.author ?? '', 120) || 'the other person';
  const text = describeMessageForPrompt(body.message);
  const threadLabel = clampText(body.threadLabel ?? '', 120);
  const recentContext = normalizeConversationContext(body.context);
  if (!text) {
    throw new Error('Missing message text.');
  }
  const systemPrompt =
    'You help teammates craft quick Discord-style replies. Keep answers under 45 words, plain text (no markdown/emojis), first-person, and sound like a thoughtful human without extra salutations.';
  const contextLines = [
    threadLabel ? `Conversation notes: ${threadLabel}` : null,
    recentContext.length
      ? `Recent chat (${recentContext.length}):\n${formatContextLines(recentContext)}`
      : null,
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

function normalizePredictionArray(raw, count) {
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
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
        .slice(0, count);
    }
  } catch {
    // fall through to regex split
  }
  return cleaned
    .split(/[\n,|]+/)
    .map((part) => part.trim().replace(/^[-–—•\d.]+\s*/, ''))
    .filter(Boolean)
    .slice(0, count);
}

async function generatePredictions(body) {
  const text = clampText(body.text ?? '', MAX_TYPED_CHARS);
  if (!text) return [];
  const count = Math.min(Math.max(Number(body.count) || (body.platform === 'mobile' ? 3 : 1), 1), 5);
  const systemPrompt = `You autocomplete Discord-style chat messages one word or short phrase at a time. Return ${count} likely continuations as a JSON array of plain strings. Keep each option under four words, no emojis or markdown, and keep the tone conversational.`;
  const userPrompt = `Channel draft so far: """${text}"""\nReturn the ${count} most likely next tokens.`;
  const raw = await callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { max_completion_tokens: 40, temperature: 0.3 }
  );
  return normalizePredictionArray(raw, count);
}

async function generateRewriteSuggestions(body) {
  const text = clampText(body.text ?? '', MAX_REWRITE_CHARS);
  if (!text) {
    throw new Error('Missing draft text to rewrite.');
  }
  const mode = clampText(body.mode ?? '', 40).toLowerCase() || 'rephrase';
  const config = REWRITE_MODE_CONFIG[mode] ?? REWRITE_MODE_CONFIG.rephrase;
  const count = Math.min(Math.max(Number(body.count) || config.count || 1, 1), 3);
  const threadLabel = clampText(body.threadLabel ?? '', 120);
  const recentContext = normalizeConversationContext(body.context);
  const systemPrompt =
    'You are an assistant helping teammates polish Discord messages. Keep outputs under 80 words, plain text (no markdown/emojis), and stay true to the author\'s intent.';
  const guidance = [
    `Mode: ${config.label}`,
    config.description,
    'Do not invent facts or names.'
  ]
    .filter(Boolean)
    .join(' ');
  const userPrompt = [
    threadLabel ? `Channel: ${threadLabel}` : null,
    recentContext.length
      ? `Recent chat (${recentContext.length}):\n${formatContextLines(recentContext)}`
      : null,
    `Original draft:\n"""${text}"""`,
    `Guidelines: ${guidance}`,
    `Return ${count} option${count > 1 ? 's' : ''} as a JSON array of plain strings.`
  ]
    .filter(Boolean)
    .join('\n\n');
  const raw = await callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { max_completion_tokens: 220, temperature: 0.65 }
  );
  return normalizePredictionArray(raw, count);
}

async function generateThreadSummary(body) {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const cleaned = rawMessages
    .map((entry) => {
      const id = clampText(entry?.id ?? entry?.messageId ?? '', 120);
      const author = clampText(entry?.author ?? entry?.displayName ?? entry?.name ?? '', 80) || 'Someone';
      const text = clampText(entry?.text ?? entry?.content ?? entry?.preview ?? '', MAX_CONTEXT_CHARS);
      if (!text) return null;
      return {
        id: id || null,
        author,
        text,
        createdAt: millisFromDate(entry?.createdAt) ?? null
      };
    })
    .filter(Boolean);
  const subset = cleaned.slice(-MAX_THREAD_SUMMARY_MESSAGES);
  if (!subset.length) {
    throw new Error('No messages provided for summary.');
  }
  const idleHours = Math.max(Number(body.idleHours) || DEFAULT_THREAD_IDLE_HOURS, 0);
  const idleNote = idleHours > 0 ? `The thread has been idle for about ${idleHours.toFixed(1)} hours.` : '';
  const instructions = [
    idleNote,
    'Summaries should feel like a Discord thread recap, covering decisions, blockers, and next steps.',
    'Each bullet must reference one concrete messageId from the thread.',
    'Respond as JSON array of up to 4 objects: [{"title":"","details":"","messageId":""}].',
    'Tone should be neutral and action-oriented, plain text only.'
  ]
    .filter(Boolean)
    .join(' ');
  const transcript = subset
    .map((entry, index) => {
      const timestamp = entry.createdAt ? new Date(entry.createdAt).toISOString() : 'recent';
      const ref = entry.id ? `(${entry.id})` : `(msg${index + 1})`;
      return `${index + 1}. ${entry.author} ${ref} @ ${timestamp}: ${entry.text}`;
    })
    .join('\n');
  const systemPrompt =
    'You are a chief of staff summarizing async chat threads for the morning shift. Extract 2-4 punchy highlights with owners and outcomes.';
  const raw = await callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${instructions}\n\nThread transcript:\n${transcript}`
      }
    ],
    { max_completion_tokens: 300, temperature: 0.35 }
  );
  return normalizeSummaryResponse(raw, subset);
}

const aiRouter = express.Router();

aiRouter.options('/', (_req, res) => res.sendStatus(204));

aiRouter.get('/', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST for /api/ai.' });
});

aiRouter.post('/', async (req, res) => {
  if (!OPENAI_KEY) {
    return res.status(501).json({ error: 'OpenAI API key missing. Set OPENAI_API_KEY in the environment.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.intent !== 'string') {
    return res.status(400).json({ error: 'Missing intent.' });
  }

  try {
    if (body.intent === 'reply') {
      const suggestion = await generateReplySuggestion(body);
      return res.json({ suggestion: suggestion?.trim() ?? '' });
    }
    if (body.intent === 'predict') {
      const suggestions = await generatePredictions(body);
      return res.json({ suggestions });
    }
    if (body.intent === 'rewrite') {
      const options = await generateRewriteSuggestions(body);
      return res.json({ options });
    }
    if (body.intent === 'thread-summary') {
      const summary = await generateThreadSummary(body);
      return res.json({ summary });
    }
    return res.status(400).json({ error: 'Unsupported intent.' });
  } catch (error) {
    console.error('[ai] suggestion error', error);
    const message = error instanceof Error ? error.message : 'Failed to reach AI service.';
    return res.status(500).json({ error: message });
  }
});

aiRouter.all('*', (_req, res) => res.status(404).json({ error: 'Not found.' }));

console.log('[ai] registering /api/ai routes');
app.use('/api/ai', aiRouter);

const describeRoutes = () =>
  app._router?.stack
    ?.filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer.route.methods || {})
        .map((method) => method.toUpperCase())
        .join('|');
      return `${methods} ${layer.route.path}`;
    });

app.use((err, _req, res, _next) => {
  console.error('[ai] unhandled error', err);
  res
    .status(500)
    .json({ error: 'Unexpected server error. Check Cloud Run logs for details.', detail: err?.message ?? null });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, '0.0.0.0', () => {
  const routes = describeRoutes() ?? [];
  console.log(`listening on ${port}`);
  console.log('registered routes:', routes);
});
