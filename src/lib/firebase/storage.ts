import { ensureFirebaseReady, getStorageInstance } from '$lib/firebase';
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTaskSnapshot
} from 'firebase/storage';

export type UploadedChatFile = {
  url: string;
  storagePath: string;
  name: string;
  size: number;
  contentType: string | null;
};

type BaseParams = {
  file: File;
  uid: string;
};

type UploadCallbacks = {
  onProgress?: (progress: number) => void;
};

type ChannelUploadParams = BaseParams &
  UploadCallbacks & {
    serverId: string;
    channelId: string;
  };

type DMUploadParams = BaseParams &
  UploadCallbacks & {
    threadId: string;
  };

type ProfileUploadParams = BaseParams & UploadCallbacks;

const ROOT = 'chat-uploads';

function safeSegment(value: string, fallback: string) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function cleanFileName(name: string) {
  const fallback = 'file';
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  const lastDot = trimmed.lastIndexOf('.');
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot + 1) : '';
  const safeBase = base
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback;
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '');
  return safeExt ? `${safeBase}.${safeExt.toLowerCase()}` : safeBase;
}

function randomSuffix() {
  try {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      }
      const bytes = new Uint32Array(2);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((n) => n.toString(36).slice(2))
        .join('')
        .slice(0, 12);
    }
  } catch {
    // ignore and fallback below
  }
  return Math.random().toString(36).slice(2, 14);
}

function buildPath(segments: string[], fileName: string) {
  const safeSegments = segments.map((segment, idx) => safeSegment(segment, idx === 0 ? 'root' : 'item'));
  const timestamp = Date.now();
  const suffix = randomSuffix();
  return `${safeSegments.join('/')}/${timestamp}-${suffix}-${cleanFileName(fileName)}`;
}

const UPLOAD_TIMEOUT_MS = 60_000;

async function uploadToPath(
  path: string,
  file: File,
  uid: string,
  callbacks?: UploadCallbacks
): Promise<UploadedChatFile> {
  await ensureFirebaseReady();
  const storage = getStorageInstance();
  const maxAttempts = 2;
  const attemptUpload = () =>
    new Promise<UploadTaskSnapshot>((resolve, reject) => {
      const objectRef = ref(storage, path);
      const task = uploadBytesResumable(objectRef, file, {
        contentType: file.type || undefined,
        customMetadata: {
          uploader: uid,
          originalName: file.name
        }
      });
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        task.cancel();
      }, UPLOAD_TIMEOUT_MS);
      task.on(
        'state_changed',
        (state) => {
          const progress =
            state.totalBytes > 0 ? state.bytesTransferred / state.totalBytes : 0;
          callbacks?.onProgress?.(progress);
        },
        (error) => {
          clearTimeout(timeoutId);
          if (timedOut) {
            const timeoutError = new Error(
              `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`
            );
            (timeoutError as any).code = 'storage/timeout';
            reject(timeoutError);
            return;
          }
          reject(error);
        },
        () => {
          clearTimeout(timeoutId);
          resolve(task.snapshot);
        }
      );
    });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const snapshot = await attemptUpload();
      callbacks?.onProgress?.(1);
      const url = await getDownloadURL(snapshot.ref);
      return {
        url,
        storagePath: snapshot.ref.fullPath,
        name: file.name || snapshot.metadata.name || 'file',
        size: file.size ?? Number(snapshot.metadata.size) ?? 0,
        contentType: file.type || snapshot.metadata.contentType || null
      };
    } catch (error) {
      lastError = error;
      const code = (error as any)?.code ?? '';
      const canRetry = code === 'storage/retry-limit-exceeded' && attempt < maxAttempts - 1;
      if (canRetry) {
        console.warn(
          '[upload] retrying due to storage/retry-limit-exceeded (attempt %d)',
          attempt + 1,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error('Upload failed.');
}

export async function uploadChannelFile(params: ChannelUploadParams): Promise<UploadedChatFile> {
  const path = buildPath(
    [ROOT, 'servers', params.serverId, 'channels', params.channelId, 'attachments'],
    params.file?.name || 'file'
  );
  return uploadToPath(path, params.file, params.uid, params);
}

export async function uploadDMFile(params: DMUploadParams): Promise<UploadedChatFile> {
  const path = buildPath([ROOT, 'dms', params.threadId, 'attachments'], params.file?.name || 'file');
  return uploadToPath(path, params.file, params.uid, params);
}

export async function uploadProfileAvatar(params: ProfileUploadParams): Promise<UploadedChatFile> {
  const path = buildPath(
    ['profile-uploads', params.uid, 'avatars'],
    params.file?.name || 'avatar.png'
  );
  return uploadToPath(path, params.file, params.uid, params);
}
