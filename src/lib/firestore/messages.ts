import { getDb } from '$lib/firebase';
import { addDoc, collection, doc, serverTimestamp, updateDoc, runTransaction, deleteField } from 'firebase/firestore';
import { SPECIAL_MENTION_IDS } from '$lib/data/specialMentions';

type Nullable<T> = T | null | undefined;

export type ReplyReferenceInput = {
  messageId: string;
  authorId?: Nullable<string>;
  authorName?: Nullable<string>;
  preview?: Nullable<string>;
  text?: Nullable<string>;
  type?: Nullable<string>;
  parent?: ReplyReferenceInput | null;
};

export type BaseMessageInput = {
  uid: string;
  displayName?: Nullable<string>;
  photoURL?: Nullable<string>;
  mentions?: MentionInput[];
  replyTo?: ReplyReferenceInput;
};

export type TextMessageInput = BaseMessageInput & {
  type?: 'text';
  text: string;
};

export type GifMessageInput = BaseMessageInput & {
  type: 'gif';
  url: string;
};

export type PollMessageInput = BaseMessageInput & {
  type: 'poll';
  poll: {
    question: string;
    options: string[];
  };
};

export type FormMessageInput = BaseMessageInput & {
  type: 'form';
  form: {
    title: string;
    questions: string[];
  };
};

export type FileMessageInput = BaseMessageInput & {
  type: 'file';
  file: {
    name: string;
    url: string;
    size?: number;
    contentType?: string | null;
    storagePath?: string | null;
  };
};

export type MessageInput =
  | TextMessageInput
  | GifMessageInput
  | PollMessageInput
  | FormMessageInput
  | FileMessageInput;

export type MentionInput = {
  uid: string;
  handle?: Nullable<string>;
  label?: Nullable<string>;
  color?: Nullable<string>;
  kind?: 'member' | 'role' | 'special';
};

function trimString(value: Nullable<string>): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function baseAuthorFields(payload: BaseMessageInput) {
  const displayName = trimString(payload.displayName) ?? null;
  const photoURL = trimString(payload.photoURL) ?? null;
  return {
    uid: payload.uid,
    authorId: payload.uid,
    displayName,
    photoURL,
    author: {
      displayName,
      photoURL
    }
  };
}

function encodeReactionKey(emoji: string) {
  const parts = Array.from(emoji ?? '').map((char) => {
    const code = char.codePointAt(0);
    return code !== undefined ? code.toString(16) : null;
  }).filter((part): part is string => Boolean(part));
  return parts.length ? 'u' + parts.join('_') : 'u';
}

export function reactionKeyFromEmoji(emoji: Nullable<string>) {
  const symbol = trimString(emoji);
  if (!symbol) return 'u';
  return encodeReactionKey(symbol);
}

function compactRecord(record: Record<string, any>) {
  const output: Record<string, any> = {};
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function normalizeMentionList(mentions: MentionInput[] | undefined): Array<{
  uid: string;
  handle: string | null;
  label: string | null;
  color: string | null;
  kind?: 'member' | 'role' | 'special';
}> {
  if (!Array.isArray(mentions)) return [];
  const map = new Map<
    string,
    {
      uid: string;
      handle: string | null;
      label: string | null;
      color: string | null;
      kind?: 'member' | 'role' | 'special';
    }
  >();
  for (const entry of mentions) {
    const uid = trimString(entry?.uid);
    if (!uid) continue;
    const handle = trimString(entry?.handle) ?? null;
    const label = trimString(entry?.label) ?? null;
    const color = trimString(entry?.color) ?? null;
    const kind =
      entry?.kind === 'role'
        ? 'role'
        : entry?.kind === 'member'
          ? 'member'
          : entry?.kind === 'special'
            ? 'special'
            : undefined;
    map.set(uid, { uid, handle, label, color, kind });
  }
  return Array.from(map.values());
}

function normalizeReplyReference(reply: ReplyReferenceInput | undefined): ReplyReferenceInput | undefined {
  if (!reply) return undefined;
  const messageId = trimString(reply.messageId);
  if (!messageId) return undefined;
  const normalizedParent = normalizeReplyReference(reply.parent ?? undefined);
  const result = {
    messageId,
    authorId: trimString(reply.authorId) ?? null,
    authorName: trimString(reply.authorName) ?? null,
    preview: trimString(reply.preview) ?? null,
    text: trimString(reply.text) ?? null,
    type: trimString(reply.type) ?? null
  };
  if (normalizedParent) {
    (result as ReplyReferenceInput).parent = normalizedParent;
  }
  return result;
}

export function buildMessageDocument(payload: MessageInput) {
  if (!payload?.uid) {
    throw new Error('Cannot write message without uid.');
  }

  const type = payload.type ?? 'text';
  const base = baseAuthorFields(payload);
  let extras: Record<string, any> = {};
  const mentions = normalizeMentionList((payload as any)?.mentions);
  const mentionUidSet = new Set(mentions.map((mention) => mention.uid));
  const mentionsEveryone = mentionUidSet.has(SPECIAL_MENTION_IDS.EVERYONE);
  const mentionsHere = mentionUidSet.has(SPECIAL_MENTION_IDS.HERE);
  const replyTo = normalizeReplyReference((payload as BaseMessageInput)?.replyTo);

  switch (type) {
    case 'text': {
      const text = trimString((payload as TextMessageInput).text);
      if (!text) throw new Error('Message text cannot be empty.');
      extras = {
        type: 'text',
        text,
        content: text,
        plainTextContent: text
      };
      break;
    }
    case 'gif': {
      const url = trimString((payload as GifMessageInput).url);
      if (!url) throw new Error('GIF message requires a URL.');
      extras = {
        type: 'gif',
        url,
        plainTextContent: 'Shared a GIF'
      };
      break;
    }
    case 'file': {
      const filePayload = (payload as FileMessageInput).file;
      const url = trimString(filePayload?.url);
      if (!url) throw new Error('File message requires a download URL.');
      const name = trimString(filePayload?.name) ?? 'File';
      const size =
        typeof filePayload?.size === 'number' && Number.isFinite(filePayload.size)
          ? Math.max(0, filePayload.size)
          : undefined;
      const contentType = trimString(filePayload?.contentType) ?? null;
      const storagePath = trimString(filePayload?.storagePath) ?? null;
      extras = {
        type: 'file',
        file: compactRecord({
          name,
          url,
          size,
          contentType,
          storagePath
        }),
        plainTextContent: `Shared ${name}`
      };
      break;
    }
    case 'poll': {
      const pollPayload = (payload as PollMessageInput).poll;
      const question = trimString(pollPayload?.question);
      const options = (pollPayload?.options ?? [])
        .map((opt) => trimString(opt))
        .filter((opt): opt is string => Boolean(opt));
      if (!question || options.length < 2) {
        throw new Error('Poll requires a question and at least two options.');
      }
      extras = {
        type: 'poll',
        poll: {
          question,
          options,
          votesByUser: {}
        },
        plainTextContent: `Poll: ${question}`
      };
      break;
    }
    case 'form': {
      const formPayload = (payload as FormMessageInput).form;
      const title = trimString(formPayload?.title);
      const questions = (formPayload?.questions ?? [])
        .map((q) => trimString(q))
        .filter((q): q is string => Boolean(q));
      if (!title || questions.length === 0) {
        throw new Error('Form requires a title and at least one question.');
      }
      extras = {
        type: 'form',
        form: {
          title,
          questions,
          responses: {}
        },
        plainTextContent: `Form: ${title}`
      };
      break;
    }
    default: {
      throw new Error(`Unsupported message type: ${String(type)}`);
    }
  }

  if (mentions.length) {
    extras = {
      ...extras,
      mentions,
      mentionsMap: mentions.reduce<
        Record<
          string,
          {
            handle: string | null;
            label: string | null;
            color?: string | null;
            kind?: 'member' | 'role' | 'special';
          }
        >
      >(
        (acc, entry) => {
          acc[entry.uid] = {
            handle: entry.handle ?? null,
            label: entry.label ?? null,
            color: entry.color ?? null,
            kind: entry.kind
          };
          return acc;
        },
        {}
      ),
      ...(mentionsEveryone ? { mentionsEveryone: true } : {}),
      ...(mentionsHere ? { mentionsHere: true } : {})
    };
  }

  const plainTextContent =
    typeof extras.plainTextContent === 'string'
      ? extras.plainTextContent
      : typeof extras.text === 'string'
        ? extras.text
        : typeof extras.content === 'string'
          ? extras.content
          : null;

  return {
    ...compactRecord(base),
    ...compactRecord(extras),
    plainTextContent: plainTextContent ?? null,
    ...(replyTo ? { replyTo } : {}),
    createdAt: serverTimestamp()
  } as MessageDocument;
}

export type MessageDocument = Record<string, any>;

export async function sendChannelMessage(
  serverId: string,
  channelId: string,
  payload: MessageInput
) {
  const cleanServer = trimString(serverId);
  const cleanChannel = trimString(channelId);
  if (!cleanServer) throw new Error('Missing server id.');
  if (!cleanChannel) throw new Error('Missing channel id.');

  const db = getDb();
  const baseDoc = buildMessageDocument(payload);
  const docData: MessageDocument & {
    serverId: string;
    channelId: string;
    threadId: string | null;
  } = {
    ...baseDoc,
    serverId: cleanServer,
    channelId: cleanChannel,
    threadId: null
  };

  await addDoc(
    collection(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages'),
    docData
  );
}

export async function toggleChannelReaction(
  serverId: string,
  channelId: string,
  messageId: string,
  uid: string,
  emoji: string
) {
  const cleanServer = trimString(serverId);
  const cleanChannel = trimString(channelId);
  const cleanMessage = trimString(messageId);
  const cleanUid = trimString(uid);
  const symbol = trimString(emoji);
  if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid || !symbol) {
    throw new Error('Missing reaction identifiers.');
  }

  const key = reactionKeyFromEmoji(symbol);
  const db = getDb();
  const messageRef = doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(messageRef);
    if (!snap.exists()) throw new Error('Message not found.');
    const data: any = snap.data() ?? {};
    const reactions: Record<string, any> = data.reactions ?? {};
    const entry = reactions[key] ?? { emoji: symbol, users: {} };
    const users: Record<string, boolean> = { ...(entry.users ?? {}) };
    const has = Boolean(users[cleanUid]);

    if (has) {
      delete users[cleanUid];
      if (Object.keys(users).length === 0) {
        tx.update(messageRef, {
          [`reactions.${key}`]: deleteField()
        });
      } else {
        tx.update(messageRef, {
          [`reactions.${key}.users`]: users
        });
      }
    } else {
      users[cleanUid] = true;
      tx.update(messageRef, {
        [`reactions.${key}.emoji`]: symbol,
        [`reactions.${key}.users`]: users
      });
    }
  });
}

export async function voteOnChannelPoll(
  serverId: string,
  channelId: string,
  messageId: string,
  uid: string,
  optionIndex: number
) {
  const cleanServer = trimString(serverId);
  const cleanChannel = trimString(channelId);
  const cleanMessage = trimString(messageId);
  const cleanUid = trimString(uid);
  if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid) {
    throw new Error('Missing poll vote identifiers.');
  }
  const choice = Number(optionIndex);
  if (!Number.isFinite(choice) || choice < 0) {
    throw new Error('Invalid poll option index.');
  }

  const db = getDb();
  await updateDoc(
    doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage),
    {
      [`poll.votesByUser.${cleanUid}`]: Math.floor(choice)
    }
  );
}

export async function submitChannelForm(
  serverId: string,
  channelId: string,
  messageId: string,
  uid: string,
  answers: string[]
) {
  const cleanServer = trimString(serverId);
  const cleanChannel = trimString(channelId);
  const cleanMessage = trimString(messageId);
  const cleanUid = trimString(uid);
  if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid) {
    throw new Error('Missing form submission identifiers.');
  }

  const cleanedAnswers = (answers ?? []).map((answer) => trimString(answer) ?? '');

  const db = getDb();
  await updateDoc(
    doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage),
    {
      [`form.responses.${cleanUid}`]: {
        answers: cleanedAnswers,
        submittedAt: serverTimestamp()
      }
    }
  );
}
