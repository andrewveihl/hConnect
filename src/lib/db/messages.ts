import { getDb } from '$lib/firebase';
import { addDoc, collection, doc, serverTimestamp, updateDoc, runTransaction, deleteField } from 'firebase/firestore';

type Nullable<T> = T | null | undefined;

export type BaseMessageInput = {
  uid: string;
  displayName?: Nullable<string>;
  photoURL?: Nullable<string>;
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

export type MessageInput =
  | TextMessageInput
  | GifMessageInput
  | PollMessageInput
  | FormMessageInput;

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

export function buildMessageDocument(payload: MessageInput) {
  if (!payload?.uid) {
    throw new Error('Cannot write message without uid.');
  }

  const type = payload.type ?? 'text';
  const base = baseAuthorFields(payload);
  let extras: Record<string, any> = {};

  switch (type) {
    case 'text': {
      const text = trimString((payload as TextMessageInput).text);
      if (!text) throw new Error('Message text cannot be empty.');
      extras = {
        type: 'text',
        text,
        content: text
      };
      break;
    }
    case 'gif': {
      const url = trimString((payload as GifMessageInput).url);
      if (!url) throw new Error('GIF message requires a URL.');
      extras = {
        type: 'gif',
        url
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
        }
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
        }
      };
      break;
    }
    default: {
      throw new Error(`Unsupported message type: ${String(type)}`);
    }
  }

  return {
    ...compactRecord(base),
    ...compactRecord(extras),
    createdAt: serverTimestamp()
  };
}

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
  const docData = buildMessageDocument(payload);

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
