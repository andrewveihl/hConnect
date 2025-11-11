import express from 'express';

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

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowOrigin =
    allowedOrigins.length === 0
      ? origin ?? '*'
      : origin && allowedOrigins.some((allowed) => allowed === origin)
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

const MAX_CONTEXT_CHARS = 1200;
const MAX_TYPED_CHARS = 400;

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('backend up'));

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Hello from Cloud Run!' });
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

async function generateReplySuggestion(body) {
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
    return res.status(400).json({ error: 'Unsupported intent.' });
  } catch (error) {
    console.error('[ai] suggestion error', error);
    const message = error instanceof Error ? error.message : 'Failed to reach AI service.';
    return res.status(500).json({ error: message });
  }
});

aiRouter.all('*', (_req, res) => res.status(404).json({ error: 'Not found.' }));

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
