import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';
import OpenAI from 'openai';

import { auth, db } from './firebase';

// OpenAI client for ticket classification
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ''
});

type IssueStatus = 'opened' | 'in_progress' | 'closed';

type TicketAiSettings = {
  enabled: boolean;
  monitoredChannelIds: string[];
  staffDomains: string[];
  staffMemberIds: string[];
  allowedRoleIds: string[];
  retention: 'forever' | '1y' | '90d';
  schedule?: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly';
    dayOfWeek?: number | null;
    timeUtc?: string | null;
    targetChannelId?: string | null;
  };
};

type ThreadMeta = {
  createdFromMessageId?: string | null;
  createdAt?: Timestamp | FirebaseFirestore.Timestamp | null;
  name?: string | null;
  preview?: string | null;
};

type MessageMeta = {
  createdAt?: Timestamp | FirebaseFirestore.Timestamp | null;
  text?: string | null;
  content?: string | null;
  plainTextContent?: string | null;
  uid?: string | null;
  authorId?: string | null;
  reactions?: Record<string, unknown> | null;
  type?: string | null;
  systemKind?: string | null;
  // File attachment fields
  file?: {
    name?: string | null;
    url?: string | null;
    contentType?: string | null;
    size?: number | null;
  } | null;
};

type IssueTimelineEntry = { status: IssueStatus; at: Timestamp };

type IssueDoc = {
  serverId: string;
  channelId: string;
  threadId: string;
  parentMessageId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  createdAt: Timestamp;
  rootCreatedAt: Timestamp;
  status: IssueStatus;
  statusTimeline: IssueTimelineEntry[];
  summary?: string | null;
  typeTag?: 'bug' | 'feature_request' | 'question' | 'other';
  reopenedAfterClose?: boolean;
  firstStaffResponseAt?: Timestamp | null;
  closedAt?: Timestamp | null;
  timeToFirstResponseMs?: number | null;
  timeToResolutionMs?: number | null;
  staffMemberIds?: string[];
  messageCount: number;
  staffMessageCount: number;
  clientMessageCount: number;
  lastMessageAt?: Timestamp | null;
  lastMessageText?: string | null;
  staffDomains?: string[];
  retention?: TicketAiSettings['retention'];
};

const SETTINGS_DOC_ID = 'current';
const RETENTION_WINDOWS: Record<string, number> = {
  forever: 0,
  '1y': 365 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000
};

const DEFAULT_SETTINGS: TicketAiSettings = {
  enabled: false,
  monitoredChannelIds: [],
  staffDomains: [],
  staffMemberIds: [],
  allowedRoleIds: [],
  retention: 'forever',
  schedule: {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 1,
    timeUtc: '09:00',
    targetChannelId: null
  }
};

/**
 * Use AI to determine if a message is a genuine IT support ticket.
 * Returns true if it's a support issue, false if it's casual/non-issue.
 */
async function isITSupportIssue(messageText: string): Promise<boolean> {
  if (!messageText || messageText.length < 3) return false;
  
  // Skip if no API key configured
  if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_KEY) {
    logger.warn('[ticketAi] No OpenAI API key - skipping AI classification');
    return true; // Default to creating ticket if no AI
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a classifier for an MSP (Managed Service Provider) IT support channel. 
Determine if the message is a genuine IT support request or issue that needs attention.

Reply ONLY with "YES" or "NO".

Say YES for:
- Computer/laptop/device problems
- Software issues or errors
- Network/internet/connectivity issues
- Printer problems
- Password/login/account issues
- Email problems
- Hardware malfunctions
- Security concerns
- Requests for IT help or assistance
- System errors or crashes
- Slow performance complaints
- Questions about IT policies or procedures

Say NO for:
- Casual greetings (hi, hello, good morning)
- Thank you messages
- Social chat unrelated to IT
- Random comments or jokes
- Single words or emojis without context
- Off-topic discussions
- Personal messages not about IT issues`
        },
        {
          role: 'user',
          content: messageText.slice(0, 500) // Limit to 500 chars
        }
      ]
    });

    const answer = response.choices[0]?.message?.content?.trim().toUpperCase() ?? '';
    const isIssue = answer.startsWith('YES');
    
    logger.debug('[ticketAi] AI classification', { 
      messagePreview: messageText.slice(0, 100), 
      answer, 
      isIssue 
    });
    
    return isIssue;
  } catch (err) {
    logger.error('[ticketAi] AI classification failed', { err });
    return true; // Default to creating ticket on error
  }
}

/**
 * Use AI Vision to analyze a screenshot and determine if it shows a PC/IT issue.
 * Returns { isIssue: boolean, description: string | null }
 */
async function analyzeScreenshotForITIssue(imageUrl: string): Promise<{ isIssue: boolean; description: string | null }> {
  if (!imageUrl) return { isIssue: false, description: null };
  
  // Skip if no API key configured
  if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_KEY) {
    logger.warn('[ticketAi] No OpenAI API key - skipping screenshot analysis');
    return { isIssue: false, description: null };
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',  // Use gpt-4o for vision capabilities
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are an IT support image analyzer for an MSP (Managed Service Provider).
Analyze the screenshot and determine if it shows a PC or IT-related issue that needs support attention.

Reply in this exact JSON format:
{"isIssue": true/false, "description": "brief description of issue or null"}

Say isIssue: true for screenshots showing:
- Error messages, blue screens (BSOD), crash dialogs
- Software errors or application failures
- Network connectivity issues or error icons
- Printer errors or hardware warnings
- Login/authentication problems
- System performance issues (task manager, high CPU/memory)
- Security warnings or virus alerts
- Email errors or Outlook issues
- Browser errors or connection problems
- Any technical error dialog or warning
- Device manager issues or driver problems

Say isIssue: false for:
- Normal desktop screenshots without errors
- Casual images, photos, memes
- Documents or spreadsheets without issues
- General screenshots not showing problems
- Social media content
- Non-technical images`
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'low' }
            },
            {
              type: 'text',
              text: 'Analyze this screenshot. Is it showing a PC/IT issue that needs support?'
            }
          ]
        }
      ]
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '';
    
    try {
      // Try to parse JSON response
      const parsed = JSON.parse(content);
      const isIssue = parsed.isIssue === true;
      const description = typeof parsed.description === 'string' ? parsed.description : null;
      
      logger.debug('[ticketAi] Screenshot analysis', { 
        imageUrl: imageUrl.slice(0, 100), 
        isIssue,
        description
      });
      
      return { isIssue, description };
    } catch {
      // Fallback: check if response contains "true" for isIssue
      const isIssue = content.toLowerCase().includes('"isisue": true') || 
                      content.toLowerCase().includes('"isisue":true');
      logger.debug('[ticketAi] Screenshot analysis (fallback parse)', { 
        imageUrl: imageUrl.slice(0, 100), 
        isIssue,
        rawContent: content.slice(0, 200)
      });
      return { isIssue, description: null };
    }
  } catch (err) {
    logger.error('[ticketAi] Screenshot analysis failed', { err, imageUrl: imageUrl.slice(0, 100) });
    return { isIssue: false, description: null };
  }
}

const normalizeList = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    set.add(trimmed);
  }
  return Array.from(set);
};

const normalizeDomain = (domain: string) => {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
};

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const retentionCutoff = (retention: TicketAiSettings['retention']): number | null => {
  const windowMs = RETENTION_WINDOWS[retention ?? 'forever'] ?? 0;
  if (!windowMs) return null;
  return Date.now() - windowMs;
};

async function fetchSettings(serverId: string): Promise<TicketAiSettings | null> {
  try {
    const snap = await db.doc(`servers/${serverId}/ticketAiSettings/${SETTINGS_DOC_ID}`).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return {
      ...DEFAULT_SETTINGS,
      enabled: !!data.enabled,
      monitoredChannelIds: normalizeList(data.monitoredChannelIds),
      staffDomains: normalizeList(data.staffDomains).map(normalizeDomain),
      staffMemberIds: normalizeList(data.staffMemberIds),
      allowedRoleIds: normalizeList(data.allowedRoleIds),
      retention: (data.retention as TicketAiSettings['retention']) ?? 'forever',
      schedule: {
        ...DEFAULT_SETTINGS.schedule,
        ...(data.schedule ?? {})
      }
    };
  } catch (err) {
    logger.error('[ticketAi] failed to fetch settings', { serverId, err });
    return null;
  }
}

async function fetchThread(serverId: string, channelId: string, threadId: string): Promise<ThreadMeta | null> {
  try {
    const snap = await db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}`).get();
    return snap.exists ? ((snap.data() as ThreadMeta) ?? null) : null;
  } catch (err) {
    logger.warn('[ticketAi] failed to fetch thread', { serverId, channelId, threadId, err });
    return null;
  }
}

async function fetchParentMessage(
  serverId: string,
  channelId: string,
  messageId: string | null | undefined
): Promise<{ createdAt: Timestamp | FirebaseFirestore.Timestamp | null; text?: string | null } | null> {
  if (!messageId) return null;
  try {
    const snap = await db.doc(`servers/${serverId}/channels/${channelId}/messages/${messageId}`).get();
    return snap.exists ? ((snap.data() as any) ?? null) : null;
  } catch (err) {
    logger.warn('[ticketAi] failed to fetch parent message', { serverId, channelId, messageId, err });
    return null;
  }
}

async function resolveUserEmail(uid?: string | null): Promise<string | null> {
  if (!uid) return null;
  try {
    const userRecord = await auth.getUser(uid);
    const email = userRecord.email ?? null;
    return email ? email.toLowerCase() : null;
  } catch (err) {
    logger.debug('[ticketAi] failed to fetch user email', { uid, err });
    return null;
  }
}

const isStaffEmail = (email: string | null, domains: string[]) => {
  if (!email) return false;
  const lower = email.toLowerCase();
  return domains.some((domain) => lower.endsWith(normalizeDomain(domain)));
};

const isStaffMember = (uid: string | null | undefined, staffMemberIds: string[]) => {
  if (!uid) return false;
  return staffMemberIds.includes(uid);
};

const hasCheckmark = (reactions: Record<string, unknown> | null | undefined) => {
  if (!reactions || typeof reactions !== 'object') return false;
  return Object.keys(reactions).some((key) => key.includes('✅') || key.toLowerCase().includes('white_check_mark'));
};

const normalizeText = (text?: string | null) => (typeof text === 'string' ? text.trim() : '');

const shouldCloseFromText = (text: string) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    /\b(resolved|fixed|all set|sorted|done|closing|close|closed)\b/.test(lower) ||
    /(^|\s)(thanks|thank you|appreciate it)(!|\s|$)/.test(lower)
  );
};

const inferTypeTag = (texts: string[]): IssueDoc['typeTag'] => {
  const joined = texts.map((t) => normalizeText(t).toLowerCase()).join(' ');
  if (!joined) return 'other';
  if (/(bug|error|crash|broken|fail)/.test(joined)) return 'bug';
  if (/(feature|request|enhancement|improve)/.test(joined)) return 'feature_request';
  if (/(how|help|can i|what|why|\?)/.test(joined)) return 'question';
  return 'other';
};

const buildSummary = (parentText: string, latestText: string, fallbackName?: string | null) => {
  const root = normalizeText(parentText);
  const latest = normalizeText(latestText);
  if (root && latest && root !== latest) return `${root.slice(0, 96)} — ${latest.slice(0, 96)}`;
  if (root) return root.slice(0, 160);
  if (latest) return latest.slice(0, 160);
  return fallbackName ?? 'Issue thread';
};

const timelineWith = (timeline: IssueTimelineEntry[], status: IssueStatus, at: Timestamp) => {
  if (!timeline.length || timeline[timeline.length - 1].status !== status) {
    timeline.push({ status, at });
  }
  return timeline;
};

const msDiff = (from: Date | null, to: Date | null) => {
  if (!from || !to) return null;
  const diff = to.getTime() - from.getTime();
  return diff >= 0 ? diff : null;
};

export async function handleTicketAiThreadMessage(
  event: FirestoreEvent<QueryDocumentSnapshot>
): Promise<void> {
  const { serverId, channelId, threadId, messageId } = event.params as Record<string, string>;
  const snap = event.data;
  if (!snap || !serverId || !channelId || !threadId || !messageId) return;

  const message = snap.data() as MessageMeta;
  if (!message || message.systemKind || message.type === 'system') return;

  const settings = await fetchSettings(serverId);
  if (!settings?.enabled) return;
  if (!settings.monitoredChannelIds.includes(channelId)) return;

  const msgDate = toDate(message.createdAt) ?? new Date(event.time?.valueOf() ?? Date.now());
  const cutoff = retentionCutoff(settings.retention);
  if (cutoff && msgDate.getTime() < cutoff) {
    logger.debug('[ticketAi] skipping message outside retention window', { serverId, channelId, threadId, messageId });
    return;
  }

  const thread = await fetchThread(serverId, channelId, threadId);
  if (!thread) return;

  const parent = await fetchParentMessage(serverId, channelId, thread.createdFromMessageId ?? null);
  const rootCreated = toDate(parent?.createdAt ?? thread.createdAt) ?? msgDate;
  const parentText = normalizeText(parent?.text ?? thread.preview ?? thread.name ?? '');
  const messageText = normalizeText(
    message.text ?? message.content ?? message.plainTextContent ?? ''
  );
  const email = await resolveUserEmail(message.uid ?? message.authorId ?? null);
  const isStaff =
    isStaffMember(message.uid ?? message.authorId ?? null, settings.staffMemberIds) ||
    isStaffEmail(email, settings.staffDomains);
  const closeSignal = shouldCloseFromText(messageText) || hasCheckmark(message.reactions ?? null);

  // Check if there's an existing channel message ticket we should update instead
  const parentMessageId = thread.createdFromMessageId ?? null;
  let channelMessageTicketRef: FirebaseFirestore.DocumentReference | null = null;
  let channelMessageTicket: IssueDoc | null = null;
  
  if (parentMessageId) {
    channelMessageTicketRef = db.doc(`servers/${serverId}/ticketAiIssues/${parentMessageId}`);
    const channelTicketSnap = await channelMessageTicketRef.get();
    if (channelTicketSnap.exists) {
      channelMessageTicket = channelTicketSnap.data() as IssueDoc;
    }
  }

  // Use channel message ticket if it exists, otherwise use/create thread ticket
  const issueRef = channelMessageTicketRef && channelMessageTicket 
    ? channelMessageTicketRef 
    : db.doc(`servers/${serverId}/ticketAiIssues/${threadId}`);
  const existing = channelMessageTicket ?? (await (async () => {
    const snap = await db.doc(`servers/${serverId}/ticketAiIssues/${threadId}`).get();
    return snap.exists ? (snap.data() as IssueDoc) : null;
  })());

  const createdAt = existing?.createdAt ?? Timestamp.fromDate(rootCreated);
  const rootTimestamp = existing?.rootCreatedAt ?? Timestamp.fromDate(rootCreated);
  const lastStatus = (existing?.status ?? 'opened') as IssueStatus;

  const statusTimeline: IssueTimelineEntry[] = Array.isArray(existing?.statusTimeline)
    ? [...existing!.statusTimeline]
    : [];
  if (!statusTimeline.length) {
    statusTimeline.push({ status: 'opened', at: rootTimestamp });
  }

  let status: IssueStatus = lastStatus;
  let reopenedAfterClose = existing?.reopenedAfterClose ?? false;
  let firstStaffResponseAt = existing?.firstStaffResponseAt ?? null;
  let closedAt = existing?.closedAt ?? null;
  let timeToFirstResponseMs = existing?.timeToFirstResponseMs ?? null;
  let timeToResolutionMs = existing?.timeToResolutionMs ?? null;
  
  // Track which staff members have responded to this ticket
  const ticketStaffMemberIds = new Set<string>(existing?.staffMemberIds ?? []);
  const responderId = message.uid ?? message.authorId ?? null;

  if (status === 'closed') {
    reopenedAfterClose = true;
  } else if (status === 'opened' && isStaff) {
    status = 'in_progress';
    firstStaffResponseAt = firstStaffResponseAt ?? Timestamp.fromDate(msgDate);
    timeToFirstResponseMs = timeToFirstResponseMs ?? msDiff(rootCreated, msgDate);
    timelineWith(statusTimeline, 'in_progress', Timestamp.fromDate(msgDate));
  }
  
  // Add staff member to the ticket's assigned staff list
  if (isStaff && responderId) {
    ticketStaffMemberIds.add(responderId);
  }

  if (closeSignal) {
    status = 'closed';
    closedAt = closedAt ?? Timestamp.fromDate(msgDate);
    timeToResolutionMs = timeToResolutionMs ?? msDiff(rootCreated, msgDate);
    timelineWith(statusTimeline, 'closed', Timestamp.fromDate(msgDate));
  }

  const summaryCandidate = buildSummary(parentText, messageText, thread.name ?? 'Issue thread');
  const typeTag = existing?.typeTag ?? inferTypeTag([parentText, messageText]);

  const payload: IssueDoc = {
    serverId,
    channelId,
    threadId,
    parentMessageId: thread.createdFromMessageId ?? null,
    createdAt,
    rootCreatedAt: rootTimestamp,
    status,
    statusTimeline,
    summary: summaryCandidate,
    typeTag,
    reopenedAfterClose,
    firstStaffResponseAt,
    closedAt,
    timeToFirstResponseMs: timeToFirstResponseMs ?? null,
    timeToResolutionMs: timeToResolutionMs ?? null,
    messageCount: (existing?.messageCount ?? 0) + 1,
    staffMessageCount: (existing?.staffMessageCount ?? 0) + (isStaff ? 1 : 0),
    clientMessageCount: (existing?.clientMessageCount ?? 0) + (isStaff ? 0 : 1),
    lastMessageAt: Timestamp.fromDate(msgDate),
    lastMessageText: messageText || (existing?.lastMessageText ?? null),
    staffDomains: settings.staffDomains,
    staffMemberIds: Array.from(ticketStaffMemberIds),
    retention: settings.retention
  };

  try {
    await issueRef.set(
      {
        ...payload,
        updatedAt: Timestamp.now(),
        lastEmailUsed: email ?? null
      },
      { merge: true }
    );
  } catch (err) {
    logger.error('[ticketAi] failed to upsert issue', {
      serverId,
      channelId,
      threadId,
      messageId,
      err
    });
  }
}

/**
 * Handle channel messages (not in threads) for Ticket AI.
 * Creates tickets directly from channel messages in monitored channels.
 */
export async function handleTicketAiChannelMessage(
  event: FirestoreEvent<QueryDocumentSnapshot>
): Promise<void> {
  const { serverId, channelId, messageId } = event.params as Record<string, string>;
  const snap = event.data;
  if (!snap || !serverId || !channelId || !messageId) return;

  const message = snap.data() as MessageMeta;
  if (!message || message.systemKind || message.type === 'system') return;

  const settings = await fetchSettings(serverId);
  if (!settings?.enabled) return;
  if (!settings.monitoredChannelIds.includes(channelId)) return;

  const msgDate = toDate(message.createdAt) ?? new Date(event.time?.valueOf() ?? Date.now());
  const cutoff = retentionCutoff(settings.retention);
  if (cutoff && msgDate.getTime() < cutoff) {
    logger.debug('[ticketAi] skipping channel message outside retention window', { serverId, channelId, messageId });
    return;
  }

  // Check if sender is staff - skip creating ticket if staff member
  const email = await resolveUserEmail(message.uid ?? message.authorId ?? null);
  const isStaff =
    isStaffMember(message.uid ?? message.authorId ?? null, settings.staffMemberIds) ||
    isStaffEmail(email, settings.staffDomains);

  // Don't create tickets for staff messages
  if (isStaff) {
    logger.debug('[ticketAi] skipping channel message from staff', { serverId, channelId, messageId });
    return;
  }

  const messageText = normalizeText(
    message.text ?? message.content ?? message.plainTextContent ?? ''
  );

  // Check for image attachment
  const hasImageAttachment = message.type === 'file' && 
    message.file?.url && 
    (message.file.contentType?.startsWith('image/') || 
     /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(message.file.name ?? ''));
  
  let screenshotAnalysis: { isIssue: boolean; description: string | null } | null = null;
  
  // If there's an image, analyze it for IT issues
  if (hasImageAttachment && message.file?.url) {
    screenshotAnalysis = await analyzeScreenshotForITIssue(message.file.url);
    
    // If screenshot shows an IT issue, create ticket even without text
    if (screenshotAnalysis.isIssue) {
      logger.info('[ticketAi] Screenshot detected as IT issue', { 
        serverId, channelId, messageId, 
        description: screenshotAnalysis.description
      });
    }
  }

  // Use AI to determine if this is a genuine IT support issue (text-based)
  const isTextSupport = messageText ? await isITSupportIssue(messageText) : false;
  
  // Create ticket if either text or screenshot indicates an IT issue
  const isSupport = isTextSupport || (screenshotAnalysis?.isIssue ?? false);
  
  if (!isSupport) {
    logger.info('[ticketAi] AI classified as non-issue, skipping', { 
      serverId, channelId, messageId, 
      messagePreview: messageText.slice(0, 100) 
    });
    return;
  }

  // Use messageId as the issue ID for channel messages
  const issueRef = db.doc(`servers/${serverId}/ticketAiIssues/${messageId}`);
  const issueSnap = await issueRef.get();
  
  // Skip if already exists
  if (issueSnap.exists) return;

  const createdAt = Timestamp.fromDate(msgDate);
  const typeTag = inferTypeTag([messageText]);
  const statusTimeline: IssueTimelineEntry[] = [{ status: 'opened', at: createdAt }];

  // Get author info from message
  const authorId = message.uid ?? message.authorId ?? null;
  const authorName = (message as any).displayName ?? (message as any).authorName ?? (message as any).name ?? null;

  // Build summary: prefer screenshot description, then text
  let summary = messageText.slice(0, 160) || 'Channel message';
  if (screenshotAnalysis?.description) {
    summary = screenshotAnalysis.description.slice(0, 160);
    if (messageText) {
      summary = `${summary} - ${messageText.slice(0, 80)}`;
    }
  }

  const payload: IssueDoc = {
    serverId,
    channelId,
    threadId: null as any, // Channel message, no thread
    parentMessageId: messageId,
    authorId,
    authorName,
    createdAt,
    rootCreatedAt: createdAt,
    status: 'opened',
    statusTimeline,
    summary: summary.slice(0, 160),
    typeTag,
    reopenedAfterClose: false,
    firstStaffResponseAt: null,
    closedAt: null,
    timeToFirstResponseMs: null,
    timeToResolutionMs: null,
    messageCount: 1,
    staffMessageCount: 0,
    clientMessageCount: 1,
    lastMessageAt: createdAt,
    lastMessageText: messageText || null,
    staffDomains: settings.staffDomains,
    staffMemberIds: [], // Empty until a staff member creates a thread (responds)
    retention: settings.retention
  };

  try {
    await issueRef.set({
      ...payload,
      updatedAt: Timestamp.now(),
      lastEmailUsed: email ?? null,
      hasScreenshot: hasImageAttachment || false,
      screenshotUrl: hasImageAttachment ? message.file?.url : null
    });
    logger.info('[ticketAi] created ticket from channel message', { serverId, channelId, messageId, hasScreenshot: hasImageAttachment });
  } catch (err) {
    logger.error('[ticketAi] failed to create issue from channel message', {
      serverId,
      channelId,
      messageId,
      err
    });
  }
}

/**
 * Create a ticket manually from a message.
 * Called by staff members via the UI button.
 */
export async function createManualTicket(data: {
  serverId: string;
  channelId: string;
  messageId: string;
  threadId?: string | null;
  callerUid: string;
}): Promise<{ ok: boolean; ticketId?: string; error?: string }> {
  const { serverId, channelId, messageId, threadId, callerUid } = data;
  
  if (!serverId || !channelId || !messageId || !callerUid) {
    return { ok: false, error: 'Missing required fields' };
  }

  try {
    // Fetch settings to verify caller is staff
    const settings = await fetchSettings(serverId);
    if (!settings) {
      return { ok: false, error: 'Settings not found' };
    }

    // Check if caller is staff
    const callerEmail = await resolveUserEmail(callerUid);
    const isStaff = 
      isStaffMember(callerUid, settings.staffMemberIds) ||
      isStaffEmail(callerEmail, settings.staffDomains);

    if (!isStaff) {
      return { ok: false, error: 'Not authorized - staff only' };
    }

    // Fetch the message
    let messageRef;
    if (threadId) {
      messageRef = db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${messageId}`);
    } else {
      messageRef = db.doc(`servers/${serverId}/channels/${channelId}/messages/${messageId}`);
    }
    
    const messageSnap = await messageRef.get();
    if (!messageSnap.exists) {
      return { ok: false, error: 'Message not found' };
    }

    const message = messageSnap.data() as MessageMeta;
    
    // Check if ticket already exists
    const ticketId = threadId ?? messageId;
    const issueRef = db.doc(`servers/${serverId}/ticketAiIssues/${ticketId}`);
    const issueSnap = await issueRef.get();
    
    if (issueSnap.exists) {
      return { ok: false, error: 'Ticket already exists for this message' };
    }

    const msgDate = toDate(message.createdAt) ?? new Date();
    const createdAt = Timestamp.fromDate(msgDate);
    const messageText = normalizeText(message.text ?? message.content ?? message.plainTextContent ?? '');
    
    // Check for screenshot
    const hasImageAttachment = message.type === 'file' && 
      message.file?.url && 
      (message.file.contentType?.startsWith('image/') || 
       /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(message.file.name ?? ''));
    
    let summary = messageText.slice(0, 160) || 'Manually created ticket';
    
    // Analyze screenshot if present
    if (hasImageAttachment && message.file?.url) {
      const screenshotAnalysis = await analyzeScreenshotForITIssue(message.file.url);
      if (screenshotAnalysis.description) {
        summary = `${screenshotAnalysis.description.slice(0, 100)}${messageText ? ` - ${messageText.slice(0, 50)}` : ''}`;
      }
    }

    const authorId = message.uid ?? message.authorId ?? null;
    const authorName = (message as any).displayName ?? (message as any).authorName ?? (message as any).name ?? null;
    const typeTag = inferTypeTag([messageText]);
    const statusTimeline: IssueTimelineEntry[] = [{ status: 'opened', at: createdAt }];

    const payload: IssueDoc = {
      serverId,
      channelId,
      threadId: threadId ?? (null as any),
      parentMessageId: messageId,
      authorId,
      authorName,
      createdAt,
      rootCreatedAt: createdAt,
      status: 'opened',
      statusTimeline,
      summary: summary.slice(0, 160),
      typeTag,
      reopenedAfterClose: false,
      firstStaffResponseAt: null,
      closedAt: null,
      timeToFirstResponseMs: null,
      timeToResolutionMs: null,
      messageCount: 1,
      staffMessageCount: 0,
      clientMessageCount: 1,
      lastMessageAt: createdAt,
      lastMessageText: messageText || null,
      staffDomains: settings.staffDomains,
      staffMemberIds: [],
      retention: settings.retention
    };

    await issueRef.set({
      ...payload,
      updatedAt: Timestamp.now(),
      manuallyCreated: true,
      createdByUid: callerUid,
      hasScreenshot: hasImageAttachment || false,
      screenshotUrl: hasImageAttachment ? message.file?.url : null
    });

    logger.info('[ticketAi] manually created ticket', { 
      serverId, channelId, messageId, threadId, ticketId, createdBy: callerUid 
    });

    return { ok: true, ticketId };
  } catch (err) {
    logger.error('[ticketAi] failed to create manual ticket', { serverId, channelId, messageId, threadId, err });
    return { ok: false, error: 'Failed to create ticket' };
  }
}