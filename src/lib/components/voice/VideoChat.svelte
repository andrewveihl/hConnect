<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { get } from 'svelte/store';
  import { getDb } from '$lib/firebase';
  import { user } from '$lib/stores/user';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';
  import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
    type CollectionReference,
    type DocumentReference,
    type Unsubscribe
  } from 'firebase/firestore';

  const CALL_DOC_ID = 'live';
  let serverId: string | null = null;
  let channelId: string | null = null;
  let sessionChannelName = '';
  let sessionServerName = '';
  let sessionVisible = false;

  type ParticipantState = {
    uid: string;
    displayName: string;
    photoURL: string | null;
    hasAudio: boolean;
    hasVideo: boolean;
    screenSharing?: boolean;
    status?: 'active' | 'left' | 'removed';
    joinedAt?: any;
    updatedAt?: any;
    streamId?: string | null;
    kickedBy?: string | null;
    removedAt?: any;
  };

  type ParticipantMedia = {
    uid: string;
    isSelf: boolean;
    streamId: string | null;
    stream: MediaStream | null;
    hasAudio: boolean;
    hasVideo: boolean;
  };

  type ParticipantControls = {
    volume: number;
    muted: boolean;
  };

  type ParticipantTile = ParticipantMedia & {
    displayName: string;
    photoURL: string | null;
    controls: ParticipantControls;
    screenSharing: boolean;
  };

  let localVideoEl: HTMLVideoElement | null = null;
  let localStream: MediaStream | null = null;

  let remoteStreams = new Map<string, MediaStream>();
  let audioRefs = new Map<string, HTMLAudioElement>();
  let videoRefs = new Map<string, HTMLVideoElement>();
  let participantControls = new Map<string, ParticipantControls>();
  let menuOpenFor: string | null = null;
  let longPressTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let isTouchDevice = false;

  let serverMetaUnsub: Unsubscribe | null = null;
  let memberUnsub: Unsubscribe | null = null;
  let serverOwnerId: string | null = null;
  let myPerms: Record<string, any> | null = null;
  let watchedServerId: string | null = null;
  let watchedMemberKey: string | null = null;
  let canKickMembers = false;

  let pc: RTCPeerConnection | null = null;
  let audioSender: RTCRtpSender | null = null;
  let videoSender: RTCRtpSender | null = null;

  let callRef: DocumentReference | null = null;
  let offerCandidatesRef: CollectionReference | null = null;
  let answerCandidatesRef: CollectionReference | null = null;
  let localCandidatesRef: CollectionReference | null = null;
  let participantsCollectionRef: CollectionReference | null = null;

  let callUnsub: Unsubscribe | null = null;
  let offerCandidatesUnsub: Unsubscribe | null = null;
  let answerCandidatesUnsub: Unsubscribe | null = null;
  let participantsUnsub: Unsubscribe | null = null;

  let participantDocRef: DocumentReference | null = null;

  let participants: ParticipantState[] = [];
  let participantMedia: ParticipantMedia[] = [];
  let participantTiles: ParticipantTile[] = [];
  let session: VoiceSession | null = null;
  let activeSessionKey: string | null = null;
  let sessionQueue: Promise<void> = Promise.resolve();
  let voiceUnsubscribe: (() => void) | null = null;
  let isJoined = false;
  let isConnecting = false;
  let isMicMuted = true;
  let isCameraOff = true;
  let remoteConnected = false;
  let isScreenSharing = false;
  let screenStream: MediaStream | null = null;
  let isScreenSharePending = false;
  let shouldRestoreCameraOnShareEnd = false;
  let audioNeedsUnlock = false;

  let statusMessage = '';
  let errorMessage = '';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const RECONNECT_DELAY_MS = 3500;
  let lastPresencePayload: Record<string, unknown> | null = null;
  let presenceDebounce: ReturnType<typeof setTimeout> | null = null;
  let lastParticipantsSnapshot: ParticipantState[] | null = null;

  voiceUnsubscribe = voiceSession.subscribe((next) => {
    sessionQueue = sessionQueue.then(() => handleSessionChange(next));
  });

  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }
    ],
    iceCandidatePoolSize: 10
  };

  $: hasAudioTrack = !!(localStream && localStream.getAudioTracks().length);
  $: hasVideoTrack = !!(localStream && localStream.getVideoTracks().length);
  $: micButtonLabel = hasAudioTrack && !isMicMuted ? 'Mute mic' : 'Enable mic';
  $: cameraButtonLabel = hasVideoTrack && !isCameraOff ? 'Stop video' : 'Start video';
  $: screenShareButtonLabel = isScreenSharing ? 'Stop sharing' : 'Share screen';
  $: participantCount = participants.length;

  const DEFAULT_VOLUME = 0.85;
  const STORAGE_PREFIX = 'hconnect:voice:controls:';

  $: currentUserId = $user?.uid ?? null;
  $: selfParticipant = participants.find((p) => p.uid === currentUserId) ?? null;
  $: localHasAudio = selfParticipant?.hasAudio ?? (hasAudioTrack && !isMicMuted);
  $: localHasVideo = selfParticipant?.hasVideo ?? (hasVideoTrack && !isCameraOff);
  $: participantMedia = (() => {
    const usedStreamIds = new Set<string>();
    const tiles: ParticipantMedia[] = participants.map((p) => {
      const streamId = p.streamId ?? null;
      let stream: MediaStream | null = null;
      if (p.uid === currentUserId) {
        stream = localStream;
      } else if (streamId && remoteStreams.has(streamId)) {
        stream = remoteStreams.get(streamId) ?? null;
      }
      if (stream && streamId) {
        usedStreamIds.add(streamId);
      }
      return {
        uid: p.uid,
        isSelf: p.uid === currentUserId,
        streamId,
        stream,
        hasAudio: p.hasAudio,
        hasVideo: p.hasVideo
      };
    });

    if (tiles.some((tile) => !tile.isSelf && tile.hasVideo && !tile.stream) && remoteStreams.size) {
      const availableStreams = Array.from(remoteStreams.entries()).filter(([_, stream]) =>
        stream.getVideoTracks().some((track) => track.readyState === 'live')
      );
      for (const tile of tiles) {
        if (tile.isSelf || !tile.hasVideo || tile.stream) continue;
      const fallbackEntry = availableStreams.find(([id, stream]) => {
        if (usedStreamIds.has(id)) return false;
        return stream.getVideoTracks().some((track) => track.readyState === 'live');
      });
      if (!fallbackEntry) break;
      const [fallbackId, fallbackStream] = fallbackEntry;
      tile.streamId = tile.streamId ?? fallbackId;
      tile.stream = fallbackStream;
      usedStreamIds.add(fallbackId);
      }
    }

    return tiles;
  })();
  $: participantTiles = participantMedia.map((media) => {
    const base = participants.find((p) => p.uid === media.uid);
    const controls = media.isSelf
      ? { volume: 1, muted: false }
      : participantControls.get(media.uid) ?? { volume: DEFAULT_VOLUME, muted: false };
    return {
      ...media,
      displayName: media.isSelf ? 'You' : base?.displayName ?? 'Member',
      photoURL: base?.photoURL ?? null,
      controls,
      screenSharing: base?.screenSharing ?? false
    };
  });
  $: remoteConnected = participantMedia.some((tile) => !tile.isSelf && !!tile.stream);
  $: localVideoEl && localStream && (localVideoEl.srcObject = localStream);
  $: participantMedia.forEach((tile) => {
    if (!tile.isSelf) {
      ensureParticipantControls(tile.uid);
      applyParticipantControls(tile.uid);
    }
    attachStreamToRefs(tile.uid, tile.stream);
  });
  $: if (serverId && serverId !== watchedServerId) {
    watchedServerId = serverId;
    watchServerMeta(serverId);
  } else if (!serverId && watchedServerId) {
    watchedServerId = null;
    serverOwnerId = null;
    serverMetaUnsub?.();
    serverMetaUnsub = null;
  }
  $: {
    const key = serverId && currentUserId ? `${serverId}:${currentUserId}` : null;
    if (key !== watchedMemberKey) {
      memberUnsub?.();
      watchedMemberKey = key;
      if (serverId && currentUserId) {
        watchMemberDoc(serverId, currentUserId);
      } else {
        myPerms = null;
      }
    }
  }
  $: canKickMembers =
    !!currentUserId &&
    (!!(serverOwnerId && serverOwnerId === currentUserId) ||
      !!myPerms?.manageServer ||
      !!myPerms?.kickMembers);

  let lastPresenceSignature: string | null = null;
  $: if (participantDocRef && isJoined) {
    const signature = `${hasAudioTrack && !isMicMuted}:${hasVideoTrack && !isCameraOff}`;
    if (signature !== lastPresenceSignature) {
      lastPresenceSignature = signature;
      updateParticipantPresence().catch((err) => console.warn('Failed to sync presence', err));
    }
  }

  onMount(() => {
    const onUnload = () => {
      hangUp({ cleanupDoc: false }).catch(() => {});
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        menuOpenFor = null;
        return;
      }
      if (!event.target.closest('[data-voice-menu]')) {
        menuOpenFor = null;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        menuOpenFor = null;
      }
    };

    if (browser && typeof window !== 'undefined') {
      isTouchDevice = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
      window.addEventListener('beforeunload', onUnload);
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('keydown', onKeyDown);
    }
    return () => {
      if (browser && typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', onUnload);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('keydown', onKeyDown);
      }
    };
  });

  onDestroy(() => {
    voiceUnsubscribe?.();
    serverMetaUnsub?.();
    memberUnsub?.();
    hangUp().catch(() => {});
  });

  function avatarInitial(name: string | undefined): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  function storageKeyForControls(uid: string): string {
    const self = currentUserId ?? 'anon';
    return `${STORAGE_PREFIX}${self}:${uid}`;
  }

  function readParticipantControls(uid: string): ParticipantControls {
    if (!browser) return { volume: DEFAULT_VOLUME, muted: false };
    try {
      const raw = localStorage.getItem(storageKeyForControls(uid));
      if (!raw) return { volume: DEFAULT_VOLUME, muted: false };
      const parsed = JSON.parse(raw) as Partial<ParticipantControls>;
      const volume =
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? Math.min(Math.max(parsed.volume, 0), 1)
          : DEFAULT_VOLUME;
      const muted = typeof parsed.muted === 'boolean' ? parsed.muted : false;
      return { volume, muted };
    } catch {
      return { volume: DEFAULT_VOLUME, muted: false };
    }
  }

  function persistParticipantControls(uid: string, controls: ParticipantControls) {
    if (!browser) return;
    try {
      localStorage.setItem(storageKeyForControls(uid), JSON.stringify(controls));
    } catch {
      /* ignore storage failures */
    }
  }

  function ensureParticipantControls(uid: string) {
    if (participantControls.has(uid)) return;
    const controls = readParticipantControls(uid);
    const next = new Map(participantControls);
    next.set(uid, controls);
    participantControls = next;
  }

  function getParticipantControls(uid: string): ParticipantControls {
    ensureParticipantControls(uid);
    return participantControls.get(uid) ?? { volume: DEFAULT_VOLUME, muted: false };
  }

  function applyParticipantControls(uid: string) {
    const controls = participantControls.get(uid);
    if (!controls) return;
    const audio = audioRefs.get(uid);
    if (audio) {
      audio.volume = controls.muted ? 0 : controls.volume;
      audio.muted = controls.muted;
      if (!controls.muted) {
        audio.play?.().catch(() => {});
      }
    }
    if (uid !== currentUserId) {
      const video = videoRefs.get(uid);
      if (video) {
        video.muted = true;
      }
    }
  }

  function setParticipantVolume(uid: string, volume: number) {
    ensureParticipantControls(uid);
    const current = participantControls.get(uid);
    if (!current) return;
    const controls = { ...current, volume };
    participantControls = new Map(participantControls).set(uid, controls);
    persistParticipantControls(uid, controls);
    applyParticipantControls(uid);
  }

  function toggleParticipantMute(uid: string) {
    ensureParticipantControls(uid);
    const current = participantControls.get(uid);
    if (!current) return;
    const controls = { ...current, muted: !current.muted };
    participantControls = new Map(participantControls).set(uid, controls);
    persistParticipantControls(uid, controls);
    applyParticipantControls(uid);
  }

  function attachStreamToRefs(uid: string, stream: MediaStream | null) {
    const audio = audioRefs.get(uid);
    if (audio && audio.srcObject !== stream) {
      audio.srcObject = stream;
      if (stream) {
        try {
          const maybePromise = audio.play?.();
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise
              .then(() => {
                audioNeedsUnlock = false;
              })
              .catch((err: any) => {
                if (err?.name === 'NotAllowedError') {
                  audioNeedsUnlock = true;
                  statusMessage = 'Tap enable audio to hear others.';
                }
              });
          } else {
            audioNeedsUnlock = false;
          }
        } catch (err: any) {
          if (err?.name === 'NotAllowedError') {
            audioNeedsUnlock = true;
            statusMessage = 'Tap enable audio to hear others.';
          }
        }
      } else {
        audio.pause?.();
      }
    }
    let video: HTMLVideoElement | null = null;
    if (uid === currentUserId) {
      video = localVideoEl;
    } else {
      video = videoRefs.get(uid) ?? null;
    }
    if (video && video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) {
        video.play?.().catch(() => {});
      } else {
        video.pause?.();
      }
      if (uid !== currentUserId) {
        video.muted = true;
      }
    }
  }

  function registerAudioRef(uid: string, node: HTMLAudioElement | null) {
    if (node) {
      audioRefs.set(uid, node);
      const target = participantMedia.find((tile) => tile.uid === uid);
      attachStreamToRefs(uid, target?.stream ?? null);
      applyParticipantControls(uid);
    } else {
      const existing = audioRefs.get(uid);
      if (existing) {
        existing.pause?.();
        existing.srcObject = null;
      }
      audioRefs.delete(uid);
    }
  }

  function audioSink(node: HTMLAudioElement, uid: string) {
    registerAudioRef(uid, node);
    return {
      update(nextUid: string) {
        if (nextUid === uid) return;
        registerAudioRef(uid, null);
        uid = nextUid;
        registerAudioRef(uid, node);
      },
      destroy() {
        registerAudioRef(uid, null);
      }
    };
  }

  async function unlockAudioPlayback() {
    if (!audioRefs.size) {
      audioNeedsUnlock = false;
      return;
    }
    const attempts = Array.from(audioRefs.values()).map((node) => {
      try {
        const result = node.play?.();
        if (result && typeof result.then === 'function') {
          return result.catch(() => {});
        }
      } catch (err) {
        // ignore
      }
      return Promise.resolve();
    });
    await Promise.allSettled(attempts);
    const stillBlocked = Array.from(audioRefs.values()).some((node) => node.paused);
    audioNeedsUnlock = stillBlocked;
    if (!stillBlocked && remoteConnected) {
      statusMessage = statusMessage && statusMessage.includes('enable audio') ? 'Connected.' : statusMessage;
    }
  }

  function registerVideoRef(uid: string, node: HTMLVideoElement | null) {
    if (uid === currentUserId) {
      if (localVideoEl && localVideoEl !== node) {
        localVideoEl.pause?.();
        localVideoEl.srcObject = null;
      }
      localVideoEl = node;
    } else if (node) {
      videoRefs.set(uid, node);
    } else {
      const existing = videoRefs.get(uid);
      if (existing) {
        existing.pause?.();
        existing.srcObject = null;
      }
      videoRefs.delete(uid);
    }
    const target = participantMedia.find((tile) => tile.uid === uid);
    attachStreamToRefs(uid, target?.stream ?? null);
  }

  function streamHasLiveVideo(stream: MediaStream | null): boolean {
    return !!(
      stream &&
      stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled)
    );
  }

  function videoSink(node: HTMLVideoElement, uid: string) {
    registerVideoRef(uid, node);
    return {
      update(nextUid: string) {
        if (nextUid === uid) return;
        registerVideoRef(uid, null);
        uid = nextUid;
        registerVideoRef(uid, node);
      },
      destroy() {
        registerVideoRef(uid, null);
      }
    };
  }

  function updateRemoteStreams(mutator: (draft: Map<string, MediaStream>) => void) {
    const draft = new Map(remoteStreams);
    mutator(draft);
    remoteStreams = draft;
  }

  function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }

  function participantsEqual(a: ParticipantState[], b: ParticipantState[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const left = a[i];
      const right = b[i];
      if (
        left.uid !== right.uid ||
        left.displayName !== right.displayName ||
        left.photoURL !== right.photoURL ||
        left.hasAudio !== right.hasAudio ||
        left.hasVideo !== right.hasVideo ||
        left.streamId !== right.streamId ||
        (left.status ?? 'active') !== (right.status ?? 'active')
      ) {
        return false;
      }
    }
    return true;
  }

  function openMenu(uid: string) {
    menuOpenFor = uid;
  }

  function closeMenu() {
    menuOpenFor = null;
  }

  function handleLongPressStart(uid: string) {
    if (!isTouchDevice) return;
    const timer = setTimeout(() => {
      menuOpenFor = uid;
    }, 450);
    longPressTimers.set(uid, timer);
  }

  function handleLongPressEnd(uid: string) {
    const timer = longPressTimers.get(uid);
    if (timer) {
      clearTimeout(timer);
      longPressTimers.delete(uid);
    }
  }

  async function kickParticipant(target: ParticipantState) {
    if (!participantsCollectionRef || !canKickMembers) return;
    if (target.uid === currentUserId) return;
    try {
      const ref = doc(participantsCollectionRef, target.uid);
      await setDoc(
        ref,
        {
          status: 'removed',
          kickedBy: currentUserId ?? null,
          removedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to kick participant', err);
      errorMessage = 'Unable to remove that participant.';
    }
  }

  function watchServerMeta(server: string) {
    serverMetaUnsub?.();
    const db = getDb();
    serverMetaUnsub = onSnapshot(
      doc(db, 'servers', server),
      (snap) => {
        const data = snap.data() as any;
        serverOwnerId = data?.ownerId ?? data?.owner ?? data?.createdBy ?? null;
      },
      () => {
        serverOwnerId = null;
      }
    );
  }

  function watchMemberDoc(server: string, uid: string) {
    memberUnsub?.();
    const db = getDb();
    memberUnsub = onSnapshot(
      doc(db, 'servers', server, 'members', uid),
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : {};
        myPerms = data?.perms ?? null;
      },
      () => {
        myPerms = null;
      }
    );
  }

  async function handleSessionChange(next: VoiceSession | null) {
    if (!next) {
    session = null;
    sessionVisible = false;
    sessionChannelName = '';
    sessionServerName = '';
      const hadSession = activeSessionKey !== null;
      activeSessionKey = null;
      serverId = null;
      channelId = null;
      menuOpenFor = null;
      serverMetaUnsub?.();
      serverMetaUnsub = null;
      memberUnsub?.();
      memberUnsub = null;
      watchedServerId = null;
      watchedMemberKey = null;
      serverOwnerId = null;
      myPerms = null;
      if (hadSession || isJoined || isConnecting) {
        await hangUp();
      }
      return;
    }

    session = next;
    sessionVisible = next.visible;
    sessionChannelName = next.channelName;
    sessionServerName = next.serverName ?? '';

    const nextKey = `${next.serverId}:${next.channelId}`;
    const sameSession = activeSessionKey === nextKey;

    serverId = next.serverId;
    channelId = next.channelId;

    if (sameSession) {
      if (!isJoined && !isConnecting) {
        await joinChannel();
      }
      return;
    }

    if (isJoined || isConnecting) {
      await hangUp();
    }

    activeSessionKey = nextKey;
    await joinChannel();
  }

  function applyTrackStates() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => (track.enabled = !isMicMuted));
    localStream.getVideoTracks().forEach((track) => (track.enabled = !isCameraOff));
  }

  function syncLocalTracksToPeer() {
    if (!pc) return;
    const audioTrack = localStream?.getAudioTracks()[0] ?? null;
    const videoTrack = localStream?.getVideoTracks()[0] ?? null;

    if (audioSender) {
      audioSender.replaceTrack(audioTrack).catch((err) => console.warn('Failed to sync audio track', err));
    } else if (audioTrack) {
      audioSender = pc.addTrack(audioTrack, localStream!);
    }

    if (videoSender) {
      videoSender.replaceTrack(videoTrack).catch((err) => console.warn('Failed to sync video track', err));
    } else if (videoTrack) {
      videoSender = pc.addTrack(videoTrack, localStream!);
    }
  }

  async function acquireTrack(kind: 'audio' | 'video'): Promise<boolean> {
    const constraints: MediaStreamConstraints = {
      audio: kind === 'audio',
      video: kind === 'video'
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!localStream) {
        localStream = new MediaStream();
      }

      const existingTracks =
        kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();

      existingTracks.forEach((track) => {
        track.stop();
        localStream!.removeTrack(track);
      });

      stream.getTracks().forEach((track) => {
        localStream!.addTrack(track);
      });

      if (localVideoEl) {
        localVideoEl.srcObject = localStream;
        localVideoEl.play?.().catch(() => {});
      }

      applyTrackStates();
      syncLocalTracksToPeer();
      errorMessage = '';
      return true;
    } catch (err) {
      console.warn(`Failed to acquire ${kind} track`, err);
      const msg =
        err instanceof Error
          ? err.message
          : `Unable to access ${kind === 'audio' ? 'microphone' : 'camera'}.`;
      errorMessage = msg;
      return false;
    }
  }

  function removeLocalTrack(kind: 'audio' | 'video') {
    if (!localStream) return;
    const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
    tracks.forEach((track) => {
      track.stop();
      localStream!.removeTrack(track);
    });
    if (kind === 'audio' && audioSender) {
      audioSender.replaceTrack(null).catch(() => {});
    }
    if (kind === 'video' && videoSender) {
      videoSender.replaceTrack(null).catch(() => {});
    }
    syncLocalTracksToPeer();
    if (!localStream.getTracks().length) {
      localStream = null;
      if (localVideoEl) localVideoEl.srcObject = null;
    }
  }

  function createPeerConnection() {
    if (pc) return pc;
    pc = new RTCPeerConnection(rtcConfig);

    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    audioSender = audioTransceiver.sender;
    videoSender = videoTransceiver.sender;
    syncLocalTracksToPeer();

    pc.ontrack = (event) => {
      const [stream] = event.streams ?? [];
      const incoming = stream ?? new MediaStream();

      if (!stream) {
        incoming.addTrack(event.track);
      }

      updateRemoteStreams((draft) => {
        const existing = draft.get(incoming.id);
        if (existing && stream) {
          draft.set(incoming.id, stream);
        } else if (existing) {
          existing.addTrack(event.track);
          draft.set(incoming.id, existing);
        } else {
          draft.set(incoming.id, incoming);
        }
      });

      event.track.onended = () => {
        updateRemoteStreams((draft) => {
          const current = draft.get(incoming.id);
          if (!current) return;
          current.removeTrack(event.track);
          if (current.getTracks().length === 0) {
            draft.delete(incoming.id);
          } else {
            draft.set(incoming.id, current);
          }
        });
      };
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      switch (pc.connectionState) {
        case 'connecting':
          statusMessage = 'Connecting...';
          break;
        case 'connected':
          statusMessage = 'Connected.';
          clearReconnectTimer();
          break;
        case 'disconnected':
          statusMessage = 'Connection interrupted. Reconnecting...';
          try {
            pc.restartIce();
          } catch (err) {
            console.warn('ICE restart failed', err);
          }
          scheduleReconnect('Rejoining call...', false);
          break;
        case 'failed':
          statusMessage = 'Connection failed. Rejoining...';
          scheduleReconnect('Rejoining call...', true);
          break;
        case 'closed':
          statusMessage = '';
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (!pc) return;
      if (pc.iceConnectionState === 'connected') {
        clearReconnectTimer();
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        try {
          pc.restartIce();
        } catch (err) {
          console.warn('Failed to restart ICE', err);
        }
      }
    };

    return pc;
  }

  function subscribeParticipants() {
    participantsUnsub?.();
    if (!participantsCollectionRef) {
      participants = [];
      lastParticipantsSnapshot = null;
      return;
    }
    participantsUnsub = onSnapshot(
      participantsCollectionRef,
      (snapshot) => {
        const mapped = snapshot.docs
          .map((d) => {
            const data = d.data() as any;
            const status = (data.status ?? 'active') as 'active' | 'left' | 'removed';
            return {
              uid: data.uid ?? d.id,
              displayName: data.displayName ?? 'Member',
              photoURL: data.photoURL ?? null,
              hasAudio: data.hasAudio ?? false,
              hasVideo: data.hasVideo ?? false,
              screenSharing: data.screenSharing ?? data.isScreenSharing ?? false,
              status,
              joinedAt: data.joinedAt ?? null,
              updatedAt: data.updatedAt ?? null,
              streamId: data.streamId ?? null,
              kickedBy: data.kickedBy ?? null,
              removedAt: data.removedAt ?? data.leftAt ?? null
            } as ParticipantState;
          })
          .sort((a, b) => {
            const aTime = a.joinedAt?.toMillis?.() ?? 0;
            const bTime = b.joinedAt?.toMillis?.() ?? 0;
            return aTime - bTime;
          });

        const current = get(user);
        const currentUid = current?.uid ?? null;
        const selfEntry = currentUid ? mapped.find((p) => p.uid === currentUid) : null;
        if (selfEntry && selfEntry.status && selfEntry.status !== 'active' && isJoined) {
          if (selfEntry.status === 'removed') {
            statusMessage = '';
            errorMessage =
              'You were removed from this voice channel by a moderator.';
          } else if (!errorMessage) {
            statusMessage = 'You have left the call.';
          }
          voiceSession.leave();
        }

        if (lastParticipantsSnapshot && participantsEqual(mapped, lastParticipantsSnapshot)) {
          return;
        }
        lastParticipantsSnapshot = mapped;
        participants = mapped.filter((p) => (p.status ?? 'active') === 'active');
      },
      (err) => {
        console.warn('Failed to subscribe to participants', err);
        participants = [];
        lastParticipantsSnapshot = null;
      }
    );
  }

  async function updateParticipantPresence(extra: Partial<ParticipantState> = {}) {
    if (!participantDocRef) return;
    const current = get(user);
    if (!current?.uid) return;

    const payload = {
      uid: current.uid,
      displayName: current.displayName ?? current.email ?? 'Member',
      photoURL: current.photoURL ?? null,
      hasAudio: hasAudioTrack && !isMicMuted,
      hasVideo: hasVideoTrack && (!isCameraOff || isScreenSharing),
      screenSharing: isScreenSharing,
      streamId: localStream?.id ?? null,
      status: 'active' as const,
      updatedAt: serverTimestamp(),
      ...extra
    };

    const comparable: Record<string, unknown> = { ...payload };
    delete comparable.updatedAt;

    if (!extra.joinedAt) {
      if (lastPresencePayload && shallowEqual(lastPresencePayload, comparable)) {
        return;
      }
      lastPresencePayload = comparable;
    }

    const performWrite = async () => {
      try {
        await setDoc(participantDocRef!, payload, { merge: true });
      } catch (err) {
        console.warn('Failed to update presence', err);
        if (!extra.joinedAt) {
          errorMessage =
            err instanceof Error ? err.message : 'Unable to update your voice status.';
        }
      }
    };

    if (extra.joinedAt) {
      lastPresencePayload = comparable;
      await performWrite();
      return;
    }

    if (presenceDebounce) {
      clearTimeout(presenceDebounce);
    }

    presenceDebounce = setTimeout(() => {
      presenceDebounce = null;
      performWrite().catch((err) => console.warn(err));
    }, 250);
  }

  async function purgeExistingCandidates() {
    if (!callRef) return;
    const offerSnap = await getDocs(collection(callRef, 'offerCandidates'));
    for (const snap of offerSnap.docs) {
      await deleteDoc(snap.ref);
    }
    const answerSnap = await getDocs(collection(callRef, 'answerCandidates'));
    for (const snap of answerSnap.docs) {
      await deleteDoc(snap.ref);
    }
  }

  async function joinChannel() {
    if (!serverId || !channelId) {
      errorMessage = 'Select a voice channel to start a call.';
      return;
    }
    if (isJoined || isConnecting) return;

    const current = get(user);
    if (!current?.uid) {
      errorMessage = 'Sign in to join voice.';
      return;
    }

    isConnecting = true;
    errorMessage = '';
    statusMessage = 'Setting up call...';

    const database = getDb();

    try {
      const connection = createPeerConnection();
      if (!connection) throw new Error('Failed to create peer connection.');

      const docRef = doc(database, 'servers', serverId, 'channels', channelId, 'calls', CALL_DOC_ID);
      callRef = docRef;

      offerCandidatesRef = collection(docRef, 'offerCandidates');
      answerCandidatesRef = collection(docRef, 'answerCandidates');
      localCandidatesRef = null;
      participantsCollectionRef = collection(docRef, 'participants');
      subscribeParticipants();

      participantDocRef = doc(participantsCollectionRef, current.uid);
      lastPresenceSignature = null;

      const existing = await getDoc(docRef);

      if (!existing.exists() || !existing.data()?.offer) {
        await purgeExistingCandidates();
        localCandidatesRef = offerCandidatesRef;
        connection.onicecandidate = (event) => {
          if (event.candidate && localCandidatesRef) {
            addDoc(localCandidatesRef, event.candidate.toJSON()).catch((err) =>
              console.warn('Failed to save ICE candidate', err)
            );
          }
        };

        const offerDescription = await connection.createOffer();
        await connection.setLocalDescription(offerDescription);

        await setDoc(docRef, {
          offer: {
            type: offerDescription.type,
            sdp: offerDescription.sdp
          },
          createdAt: serverTimestamp(),
          createdBy: current.uid
        });

        callUnsub = onSnapshot(docRef, (snapshot) => {
          const data = snapshot.data();
          if (!data) {
            statusMessage = 'Call ended.';
            hangUp({ cleanupDoc: false }).catch(() => {});
            return;
          }
          if (data.answer && connection && !connection.currentRemoteDescription) {
            const answerDescription = new RTCSessionDescription(data.answer);
            connection.setRemoteDescription(answerDescription).catch((err) => {
              console.warn('Failed to set remote description', err);
            });
          }
        });

        answerCandidatesUnsub = onSnapshot(answerCandidatesRef, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const candidate = new RTCIceCandidate(change.doc.data());
              connection.addIceCandidate(candidate).catch((err) => {
                console.warn('Failed to add remote ICE candidate', err);
              });
            }
          });
        });

        statusMessage = 'Waiting for others to join...';
      } else {
        localCandidatesRef = answerCandidatesRef;
        connection.onicecandidate = (event) => {
          if (event.candidate && localCandidatesRef) {
            addDoc(localCandidatesRef, event.candidate.toJSON()).catch((err) =>
              console.warn('Failed to save ICE candidate', err)
            );
          }
        };

        const data = existing.data() as any;
        const offerDescription = data.offer;
        await connection.setRemoteDescription(new RTCSessionDescription(offerDescription));

        const answerDescription = await connection.createAnswer();
        await connection.setLocalDescription(answerDescription);

        await updateDoc(docRef, {
          answer: {
            type: answerDescription.type,
            sdp: answerDescription.sdp
          },
          answeredAt: serverTimestamp(),
          answeredBy: current.uid
        });

        offerCandidatesUnsub = onSnapshot(offerCandidatesRef, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const candidate = new RTCIceCandidate(change.doc.data());
              connection.addIceCandidate(candidate).catch((err) => {
                console.warn('Failed to add remote ICE candidate', err);
              });
            }
          });
        });

        callUnsub = onSnapshot(docRef, (snapshot) => {
          if (!snapshot.exists()) {
            statusMessage = 'Call ended.';
            hangUp({ cleanupDoc: false }).catch(() => {});
          }
        });

        statusMessage = 'Connected.';
      }

      await updateParticipantPresence({
        joinedAt: serverTimestamp()
      });
      participants = [
        ...participants.filter((p) => p.uid !== current.uid),
        {
          uid: current.uid,
          displayName: current.displayName ?? current.email ?? 'Member',
          photoURL: current.photoURL ?? null,
          hasAudio: hasAudioTrack && !isMicMuted,
          hasVideo: hasVideoTrack && (!isCameraOff || isScreenSharing),
          screenSharing: isScreenSharing,
          status: 'active',
          joinedAt: null,
          streamId: localStream?.id ?? null
        }
      ];

      isJoined = true;
      clearReconnectTimer();
      if (!statusMessage || statusMessage.startsWith('Rejoining')) {
        statusMessage = 'Connected.';
      }
      if (!hasAudioTrack && !hasVideoTrack) {
        statusMessage = 'Listening only. Enable mic or camera to share.';
      }
    } catch (err) {
      console.error(err);
      errorMessage =
        err instanceof Error ? err.message : 'Unable to join the call. Please check your devices.';
      await hangUp({ cleanupDoc: false, resetError: false });
    } finally {
      isConnecting = false;
    }
  }

  async function hangUp(options: { cleanupDoc?: boolean; resetError?: boolean } = {}) {
    const { cleanupDoc = true, resetError = true } = options;

    clearReconnectTimer();
    lastPresencePayload = null;
    lastParticipantsSnapshot = null;
    if (presenceDebounce) {
      clearTimeout(presenceDebounce);
      presenceDebounce = null;
    }

    const participantRef = participantDocRef;
    participantDocRef = null;
    lastPresenceSignature = null;

    callUnsub?.();
    offerCandidatesUnsub?.();
    answerCandidatesUnsub?.();
    participantsUnsub?.();

    callUnsub = null;
    offerCandidatesUnsub = null;
    answerCandidatesUnsub = null;
    participantsUnsub = null;

    if (screenStream) {
      screenStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    }
    screenStream = null;
    isScreenSharing = false;
    isScreenSharePending = false;
    shouldRestoreCameraOnShareEnd = false;

    const current = get(user);
    const currentUid = current?.uid ?? null;

    if (participantRef) {
      let removed = false;
      try {
        await deleteDoc(participantRef);
        removed = true;
      } catch (err) {
        if ((err as any)?.code !== 'permission-denied') {
          console.warn('Failed to remove participant entry', err);
        }
      }
      if (!removed) {
        try {
          await setDoc(
            participantRef,
            {
              status: 'left',
              hasAudio: false,
              hasVideo: false,
              leftAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        } catch (err) {
          if ((err as any)?.code !== 'permission-denied') {
            console.warn('Failed to mark participant as left', err);
          }
        }
      }
    }

    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      audioSender?.replaceTrack(null).catch(() => {});
      videoSender?.replaceTrack(null).catch(() => {});
      pc.close();
      pc = null;
    }

    audioSender = null;
    videoSender = null;

    removeLocalTrack('audio');
    removeLocalTrack('video');
    localStream = null;

    updateRemoteStreams((draft) => draft.clear());
    remoteConnected = false;
    audioRefs.forEach((node) => {
      node.pause?.();
      node.srcObject = null;
    });
    videoRefs.forEach((node) => {
      node.pause?.();
      node.srcObject = null;
    });
    audioRefs = new Map();
    videoRefs = new Map();
    if (localVideoEl) {
      localVideoEl.pause?.();
      localVideoEl.srcObject = null;
    }
    audioNeedsUnlock = false;

    const cleanupRef = callRef;
    const participantsRef = participantsCollectionRef;
    callRef = null;
    offerCandidatesRef = null;
    answerCandidatesRef = null;
    localCandidatesRef = null;
    participantsCollectionRef = null;

    if (participantsRef && currentUid) {
      participants = participants.filter((p) => p.uid !== currentUid);
    } else {
      participants = [];
    }

    if (cleanupDoc && cleanupRef) {
      try {
        const remaining = await getDocs(collection(cleanupRef, 'participants'));
        if (remaining.empty) {
          const offers = await getDocs(collection(cleanupRef, 'offerCandidates'));
          for (const snap of offers.docs) {
            await deleteDoc(snap.ref);
          }
          const answers = await getDocs(collection(cleanupRef, 'answerCandidates'));
          for (const snap of answers.docs) {
            await deleteDoc(snap.ref);
          }
          await deleteDoc(cleanupRef);
        }
      } catch (err) {
        if ((err as any)?.code !== 'permission-denied') {
          console.warn('Failed to cleanup call doc', err);
        }
      }
    }

    if (resetError) {
      errorMessage = '';
    }
    statusMessage = '';
    isJoined = false;
    isConnecting = false;
    isMicMuted = true;
    isCameraOff = true;
  }

  async function toggleMic() {
    const enabling = isMicMuted;
    if (enabling) {
      const previous = isMicMuted;
      isMicMuted = false;

      if (!hasAudioTrack) {
        const ok = await acquireTrack('audio');
        if (!ok) {
          isMicMuted = previous;
          return;
        }
      } else {
        localStream?.getAudioTracks().forEach((track) => (track.enabled = true));
        syncLocalTracksToPeer();
      }

      applyTrackStates();
      statusMessage = 'Microphone on.';
    } else {
      removeLocalTrack('audio');
      isMicMuted = true;
      applyTrackStates();
      statusMessage = 'Microphone muted.';
    }
    await updateParticipantPresence();
    const currentUid = $user?.uid ?? null;
    if (currentUid) {
      const nextAudio = hasAudioTrack && !isMicMuted;
      participants = participants.map((p) =>
        p.uid === currentUid ? { ...p, hasAudio: nextAudio, status: 'active' } : p
      );
    }
  }

  async function toggleCamera() {
    if (isScreenSharePending) return;

    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    const enabling = isCameraOff;
    if (enabling) {
      const previous = isCameraOff;
      isCameraOff = false;

      if (!hasVideoTrack) {
        const ok = await acquireTrack('video');
        if (!ok) {
          isCameraOff = previous;
          return;
        }
      } else {
        localStream?.getVideoTracks().forEach((track) => (track.enabled = true));
        syncLocalTracksToPeer();
      }

      applyTrackStates();
      statusMessage = 'Camera on.';
    } else {
      removeLocalTrack('video');
      isCameraOff = true;
      isScreenSharing = false;
      shouldRestoreCameraOnShareEnd = false;
      applyTrackStates();
      statusMessage = 'Camera off.';
    }

    await updateParticipantPresence();
    const currentUid = $user?.uid ?? null;
    if (currentUid) {
      const nextVideo = hasVideoTrack && (!isCameraOff || isScreenSharing);
      participants = participants.map((p) =>
        p.uid === currentUid
          ? { ...p, hasVideo: nextVideo, screenSharing: isScreenSharing, status: 'active' }
          : p
      );
    }
  }

  async function startScreenShare() {
    if (isScreenSharing || isScreenSharePending) return;
    if (!browser || typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      errorMessage = 'Screen sharing is not supported in this browser.';
      return;
    }
    if (!isJoined) {
      errorMessage = 'Join the call before sharing your screen.';
      return;
    }

    isScreenSharePending = true;
    const hadCamera = hasVideoTrack && !isCameraOff && !isScreenSharing;

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      const [track] = displayStream.getVideoTracks();
      if (!track) {
        throw new Error('No screen track returned.');
      }

      shouldRestoreCameraOnShareEnd = hadCamera;

      if (!localStream) {
        localStream = new MediaStream();
      }

      localStream.getVideoTracks().forEach((existing) => {
        existing.stop();
        localStream!.removeTrack(existing);
      });

      localStream.addTrack(track);
      screenStream = displayStream;
      isScreenSharing = true;
      isCameraOff = false;

      track.onended = () => {
        stopScreenShare({ restoreCamera: shouldRestoreCameraOnShareEnd }).catch(() => {});
      };

      applyTrackStates();
      syncLocalTracksToPeer();
      statusMessage = 'Sharing your screen.';
      errorMessage = '';

      const currentUid = $user?.uid ?? null;
      if (currentUid) {
        participants = participants.map((p) =>
          p.uid === currentUid
            ? { ...p, hasVideo: true, screenSharing: true, status: 'active' }
            : p
        );
      }

      await updateParticipantPresence();
    } catch (err) {
      console.warn('Failed to start screen share', err);
      errorMessage =
        err instanceof Error ? err.message : 'Unable to start screen sharing.';
      isScreenSharing = false;
      screenStream = null;
      shouldRestoreCameraOnShareEnd = false;
    } finally {
      isScreenSharePending = false;
    }
  }

  async function stopScreenShare(options: { restoreCamera?: boolean } = {}) {
    const restoreCamera =
      options.restoreCamera ?? shouldRestoreCameraOnShareEnd;

    if (screenStream) {
      screenStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    }

    if (localStream) {
      const screenTracks = localStream.getVideoTracks();
      screenTracks.forEach((track) => {
        localStream!.removeTrack(track);
      });
    }

    screenStream = null;
    isScreenSharing = false;
    shouldRestoreCameraOnShareEnd = false;

    syncLocalTracksToPeer();

    if (restoreCamera) {
      const ok = await acquireTrack('video');
      isCameraOff = !ok;
    } else if (!localStream?.getVideoTracks().length) {
      isCameraOff = true;
    }

    applyTrackStates();

    const currentUid = $user?.uid ?? null;
    if (currentUid) {
      const nextVideo = hasVideoTrack && (!isCameraOff || isScreenSharing);
      participants = participants.map((p) =>
        p.uid === currentUid
          ? { ...p, hasVideo: nextVideo, screenSharing: false, status: 'active' }
          : p
      );
    }

    await updateParticipantPresence();
    statusMessage = restoreCamera ? 'Returned to camera.' : 'Screen share stopped.';
  }

  async function toggleScreenShare() {
    if (isScreenSharing) {
      await stopScreenShare();
    } else {
      await startScreenShare();
    }
  }

  async function refreshDevices() {
    const tasks: Promise<boolean>[] = [];
    if (hasAudioTrack && !isMicMuted) tasks.push(acquireTrack('audio'));
    if (hasVideoTrack && !isCameraOff) tasks.push(acquireTrack('video'));

    if (!tasks.length) {
      statusMessage = 'No devices active to refresh.';
      return;
    }

    const results = await Promise.all(tasks);
    if (results.some((r) => r === false)) {
      statusMessage = 'Some devices could not be refreshed.';
    } else {
      statusMessage = 'Devices refreshed.';
    }
    await updateParticipantPresence();
    const currentUid = $user?.uid ?? null;
    if (currentUid) {
      const nextAudio = hasAudioTrack && !isMicMuted;
      const nextVideo = hasVideoTrack && !isCameraOff;
      participants = participants.map((p) =>
        p.uid === currentUid
          ? { ...p, hasAudio: nextAudio, hasVideo: nextVideo, screenSharing: isScreenSharing, status: 'active' }
          : p
      );
    }
  }
  function handleJoinClick() {
    if (isConnecting || isJoined) return;
    if (!serverId || !channelId) return;
    sessionQueue = sessionQueue.then(() => joinChannel());
  }

  function handleLeave() {
    voiceSession.leave();
  }

  function handleMinimize() {
    voiceSession.setVisible(false);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  async function performFullReconnect() {
    if (isConnecting) return;
    const shouldEnableMic = !isMicMuted;
    const shouldEnableCamera = !isCameraOff && !isScreenSharing;
    const shouldShareScreen = isScreenSharing;

    await hangUp({ cleanupDoc: false, resetError: false });
    statusMessage = 'Rejoining call...';
    await joinChannel();
    if (!isJoined) return;
    clearReconnectTimer();
    statusMessage = 'Connected.';

    if (shouldEnableMic && isMicMuted) {
      await toggleMic();
    }

    if (shouldShareScreen && !isScreenSharing) {
      await toggleScreenShare();
    } else if (shouldEnableCamera && isCameraOff && !isScreenSharing) {
      await toggleCamera();
    }
  }

  function scheduleReconnect(message: string, force = false) {
    statusMessage = message;
    if (reconnectTimer && !force) return;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      sessionQueue = sessionQueue
        .then(() => performFullReconnect())
        .catch((err) => console.warn('Failed to reconnect to voice call', err));
    }, force ? 1500 : RECONNECT_DELAY_MS);
  }

  function controlClasses(options: { active?: boolean; danger?: boolean; disabled?: boolean } = {}) {
    const { active = false, danger = false, disabled = false } = options;
    const classes = ['call-control-button'];
    if (active) classes.push('call-control-button--active');
    if (danger) classes.push('call-control-button--danger');
    if (disabled) classes.push('call-control-button--disabled');
    return classes.join(' ');
  }
</script>

<div class="voice-root">
  <div class="call-shell">
    <header class="call-header">
      <div class="call-header__info">
        <div class="call-header__icon">
          <i class="bx bx-hash"></i>
        </div>
        <div>
          <div class="call-header__title">#{sessionChannelName || 'Voice channel'}</div>
          {#if sessionServerName}
            <div class="call-header__subtitle">{sessionServerName}</div>
          {/if}
        </div>
      </div>
      <div class="call-header__actions">
        <div class="call-header__count">
          <i class="bx bx-user-voice"></i>
          <span>{participantCount}</span>
        </div>
        <div class="call-status">
          <span class={`call-status__dot ${remoteConnected ? 'call-status__dot--online' : ''}`}>
            {#if remoteConnected}
              <span class="call-status__pulse"></span>
            {/if}
          </span>
          <span class="call-status__label">{remoteConnected ? 'Voice connected' : 'Connecting'}</span>
        </div>
        <button
          type="button"
          class="call-header__minimize"
          on:click={handleMinimize}
          aria-label="Hide call"
        >
          <i class="bx bx-minus"></i>
          <span class="call-header__minimize-label">Hide</span>
        </button>
      </div>
    </header>

    <section class="call-stage">
      {#if isJoined && participantTiles.length}
        <div class="call-grid">
          {#each participantTiles as tile (tile.uid)}
            <article
              class={`call-tile ${tile.isSelf ? 'call-tile--self' : ''} ${tile.screenSharing ? 'call-tile--sharing' : ''}`}
              data-voice-menu
              on:touchstart={() => handleLongPressStart(tile.uid)}
              on:touchend={() => handleLongPressEnd(tile.uid)}
              on:touchcancel={() => handleLongPressEnd(tile.uid)}
            >
              <div class="call-tile__media">
                <video
                  use:videoSink={tile.uid}
                  autoplay
                  playsinline
                  muted={tile.isSelf}
                  class:call-tile__video-visible={streamHasLiveVideo(tile.stream)}
                ></video>
                {#if !streamHasLiveVideo(tile.stream)}
                  <div class="call-avatar">
                    <div class="call-avatar__image">
                      {#if tile.photoURL}
                        <img src={tile.photoURL} alt={tile.displayName} loading="lazy" />
                      {:else}
                        <span>{avatarInitial(tile.displayName)}</span>
                      {/if}
                    </div>
                    <span class="call-avatar__hint">
                      {tile.hasVideo ? 'Video starting...' : 'Camera disabled'}
                    </span>
                  </div>
                {/if}
                {#if !tile.isSelf}
                  <audio use:audioSink={tile.uid} autoplay playsinline class="hidden"></audio>
                {/if}
                <div class="call-tile__overlay">
                  <div class="call-tile__details">
                    <span class="call-tile__name">{tile.displayName}</span>
                    {#if tile.isSelf}
                      <span class="call-pill">You</span>
                    {/if}
                    {#if !tile.isSelf && tile.controls.muted}
                      <span class="call-pill call-pill--muted">Muted</span>
                    {/if}
                    {#if tile.screenSharing}
                      <span class="call-pill call-pill--share">
                        <i class="bx bx-desktop"></i>
                        Sharing
                      </span>
                    {/if}
                  </div>
                  <div class="call-tile__icons">
                    <i class={`bx ${tile.hasAudio ? 'bx-microphone' : 'bx-microphone-off'} ${tile.hasAudio ? '' : 'is-off'}`}></i>
                    <i class={`bx ${tile.hasVideo ? 'bx-video' : 'bx-video-off'} ${tile.hasVideo ? '' : 'is-off'}`}></i>
                  </div>
                </div>
                {#if !tile.isSelf}
                  <button
                    type="button"
                    class="call-tile__menu-button"
                    on:click|stopPropagation={() => openMenu(tile.uid)}
                    data-voice-menu
                    aria-label={`Voice options for ${tile.displayName}`}
                  >
                    <i class="bx bx-dots-vertical-rounded"></i>
                  </button>
                {/if}
              </div>

              {#if menuOpenFor === tile.uid && !tile.isSelf}
                <div class="call-tile__menu-panel" data-voice-menu>
                  <div class="call-menu__header">
                    <span>{tile.displayName}</span>
                    <button type="button" on:click={closeMenu} aria-label="Close participant menu">
                      <i class="bx bx-x"></i>
                    </button>
                  </div>
                  <div class="call-menu__section">
                    <div class="call-menu__label">
                      <span>Volume</span>
                      <span>{Math.round(tile.controls.volume * 100)}%</span>
                    </div>
                    <input
                      class="call-menu__slider"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(tile.controls.volume * 100)}
                      on:input={(event) => {
                        const target = event.currentTarget as HTMLInputElement;
                        setParticipantVolume(tile.uid, Number(target.value) / 100);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    class="call-menu__action"
                    on:click={() => toggleParticipantMute(tile.uid)}
                  >
                    <span>{tile.controls.muted ? 'Unmute for me' : 'Mute for me'}</span>
                    <i class={`bx ${tile.controls.muted ? 'bx-volume-full' : 'bx-volume-mute'}`}></i>
                  </button>
                  {#if canKickMembers}
                    <button
                      type="button"
                      class="call-menu__action call-menu__action--danger"
                      on:click={() => {
                        const target = participants.find((p) => p.uid === tile.uid);
                        if (target) kickParticipant(target);
                        closeMenu();
                      }}
                    >
                      <span>Remove from channel</span>
                      <i class="bx bx-user-x"></i>
                    </button>
                  {/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {:else if isJoined}
        <div class="call-empty">
          <div class="call-empty__card">
            <div class="call-empty__icon">
              <i class="bx bx-group"></i>
            </div>
            <h3>Waiting for others</h3>
            <p>Share this channel so teammates can hop in.</p>
          </div>
        </div>
      {:else}
        <div class="call-empty">
          <div class="call-empty__card">
            <div class="call-empty__icon">
              <i class="bx bx-video"></i>
            </div>
            <h3>Join the conversation</h3>
            <p>Connect your mic or camera to get started.</p>
          </div>
        </div>
      {/if}
    </section>

    <footer class="call-controls" style:padding-bottom="calc(env(safe-area-inset-bottom, 0px) + 1rem)">
      {#if !isJoined}
        <div class="call-controls__row call-controls__row--join">
          <button
            class="call-button call-button--primary"
            on:click={handleJoinClick}
            disabled={isConnecting || !serverId || !channelId}
          >
            <i class="bx bx-phone"></i>
            {isConnecting ? 'Connecting...' : 'Join Voice'}
          </button>
          {#if statusMessage}
            <span class="call-status-message">{statusMessage}</span>
          {/if}
        </div>
      {:else}
        <div class="call-controls__row call-controls__row--connected">
          <div class="call-controls__status">
            {#if audioNeedsUnlock}
              <div class="call-audio-unlock">
                <button class="call-button call-button--primary" type="button" on:click={unlockAudioPlayback}>
                  <i class="bx bx-volume-full"></i>
                  Enable audio
                </button>
                <span class="call-status-message">Your browser blocked auto-play.</span>
              </div>
            {:else if statusMessage}
              <span class="call-status-message">{statusMessage}</span>
            {:else if !remoteConnected}
              <span class="call-status-message">Reconnecting...</span>
            {/if}
          </div>
          <div class="call-controls__group call-controls__group--main">
            <div class="call-controls__item">
              <button class={controlClasses({ active: !isMicMuted })} on:click={toggleMic} aria-label={micButtonLabel}>
                <i class={`bx ${isMicMuted ? 'bx-microphone-off' : 'bx-microphone'}`}></i>
              </button>
              <span>{isMicMuted ? 'Muted' : 'Mute'}</span>
            </div>
            <div class="call-controls__item">
              <button
                class={controlClasses({ active: !isCameraOff && !isScreenSharing })}
                on:click={toggleCamera}
                aria-label={cameraButtonLabel}
              >
                <i class={`bx ${isCameraOff || isScreenSharing ? 'bx-video-off' : 'bx-video'}`}></i>
              </button>
              <span>{isCameraOff || isScreenSharing ? 'Camera off' : 'Camera'}</span>
            </div>
            <div class="call-controls__item">
              <button
                class={controlClasses({ active: isScreenSharing, disabled: isScreenSharePending })}
                on:click={toggleScreenShare}
                aria-label={screenShareButtonLabel}
                disabled={isScreenSharePending}
              >
                <i class="bx bx-desktop"></i>
              </button>
              <span>{isScreenSharing ? 'Stop share' : 'Share'}</span>
            </div>
            <div class="call-controls__item">
              <button
                class={controlClasses({ disabled: !hasAudioTrack && !hasVideoTrack })}
                on:click={refreshDevices}
                aria-label="Refresh devices"
                disabled={!hasAudioTrack && !hasVideoTrack}
              >
                <i class="bx bx-sync"></i>
              </button>
              <span>Refresh</span>
            </div>
          </div>
          <div class="call-controls__group call-controls__group--exit">
            <button class="call-button" type="button" on:click={handleMinimize} aria-label="Minimize call">
              <i class="bx bx-window-alt"></i>
              <span>Collapse</span>
            </button>
            <div class="call-controls__item call-controls__item--leave">
              <button class={controlClasses({ danger: true })} on:click={handleLeave} aria-label="Leave call">
                <i class="bx bx-phone-off"></i>
              </button>
              <span>Leave</span>
            </div>
          </div>
        </div>
      {/if}
    </footer>
  </div>

  {#if errorMessage}
    <div class="call-error">
      {errorMessage}
    </div>
  {/if}
</div>

<style>
  .voice-root {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-height: 100%;
    padding: clamp(0.75rem, 2vw, 1.5rem);
    color: var(--text-100);
  }

  .call-shell {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 1.25rem;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-panel-muted) 90%, transparent);
    border: 1px solid var(--color-border-subtle);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    padding: clamp(1rem, 2.5vw, 1.75rem);
  }

  .call-header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: space-between;
    align-items: center;
  }

  .call-header__info {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    min-width: 0;
  }

  .call-header__icon {
    width: 3rem;
    height: 3rem;
    border-radius: 0.9rem;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-panel) 65%, transparent);
    color: var(--text-80);
    font-size: 1.25rem;
  }

  @media (max-width: 640px) {
    .call-header__icon {
      width: 2.5rem;
      height: 2.5rem;
      font-size: 1.1rem;
    }
  }

  .call-header__title {
    font-size: clamp(1rem, 2vw, 1.25rem);
    font-weight: 600;
    color: var(--text-100);
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .call-header__subtitle {
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-55);
  }

  .call-header__actions {
    display: inline-flex;
    align-items: center;
    gap: 0.85rem;
  }

  .call-header__count {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    color: var(--text-80);
    font-size: 0.85rem;
  }

  .call-status {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-55);
  }

  .call-status__dot {
    position: relative;
    display: inline-flex;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 999px;
    background: var(--text-30);
  }

  .call-status__dot--online {
    background: color-mix(in srgb, var(--color-accent) 85%, transparent);
  }

  .call-status__pulse {
    position: absolute;
    inset: -0.3rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 35%, transparent);
    animation: pulse 1.6s infinite;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.6);
      opacity: 0.6;
    }
    100% {
      transform: scale(1.4);
      opacity: 0;
    }
  }

  .call-header__minimize {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 0.85rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 40%, transparent);
    color: var(--text-60);
    font-size: 0.8rem;
    transition: background 150ms ease, color 150ms ease;
  }

  .call-header__minimize i {
    font-size: 1rem;
  }

  .call-header__minimize:hover {
    background: color-mix(in srgb, var(--color-panel) 60%, transparent);
    color: var(--text-80);
  }

  .call-header__minimize:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .call-header__minimize-label {
    display: none;
  }

  @media (min-width: 640px) {
    .call-header__minimize-label {
      display: inline;
    }
  }

  .call-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    background: linear-gradient(
      155deg,
      color-mix(in srgb, var(--color-panel) 65%, transparent),
      color-mix(in srgb, var(--color-panel-muted) 55%, transparent)
    );
    border-radius: var(--radius-lg);
    border: 1px solid rgba(255, 255, 255, 0.04);
    padding: clamp(0.75rem, 2vw, 1.25rem);
  }

  .call-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: clamp(0.75rem, 2vw, 1.25rem);
    width: 100%;
    align-content: start;
  }

  @media (min-width: 1200px) {
    .call-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
  }

  .call-tile {
    position: relative;
    border-radius: 1.25rem;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
    min-height: 220px;
    display: flex;
  }

  .call-tile--self {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .call-tile--sharing {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-strong) 55%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  }

  .call-tile__media {
    position: relative;
    flex: 1;
    display: flex;
    align-items: stretch;
    justify-content: center;
    background: rgba(0, 0, 0, 0.64);
  }

  .call-tile__media video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: none;
  }

  .call-tile__media video.call-tile__video-visible {
    display: block;
  }

  .call-avatar {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-70);
  }

  .call-avatar__image {
    width: 4.5rem;
    height: 4.5rem;
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.12);
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--text-80);
  }

  .call-avatar__image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .call-avatar__hint {
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    color: var(--text-50);
  }

  .call-tile__overlay {
    pointer-events: none;
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1.1rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.68), transparent 85%);
    font-size: 0.85rem;
    color: var(--text-100);
  }

  .call-tile__details {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .call-tile__name {
    font-weight: 600;
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-pill {
    pointer-events: auto;
    background: rgba(255, 255, 255, 0.16);
    border-radius: var(--radius-pill);
    padding: 0.15rem 0.55rem;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-80);
  }

  .call-pill--muted {
    background: color-mix(in srgb, var(--color-danger) 25%, transparent);
    color: color-mix(in srgb, var(--color-danger) 85%, white);
  }

  .call-pill--share {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: color-mix(in srgb, var(--color-accent) 85%, white);
  }

  .call-tile__icons {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 1.05rem;
  }

  .call-tile__icons .is-off {
    color: color-mix(in srgb, var(--color-danger) 65%, white);
  }

  .call-tile__menu-button {
    position: absolute;
    top: 0.8rem;
    right: 0.9rem;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.6);
    color: rgba(255, 255, 255, 0.9);
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .call-tile:hover .call-tile__menu-button,
  .call-tile__menu-button:focus-visible {
    opacity: 1;
  }

  .call-tile__menu-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .call-tile__menu-panel {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(240px, 90%);
    border-radius: 1rem;
    padding: 1rem;
    background: color-mix(in srgb, var(--color-panel) 80%, transparent);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: var(--shadow-elevated);
    z-index: 30;
    color: var(--text-90);
  }

  .call-menu__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-transform: none;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-100);
  }

  .call-menu__header button {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-70);
  }

  .call-menu__header button:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-90);
  }

  .call-menu__section {
    margin-top: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .call-menu__label {
    display: flex;
    justify-content: space-between;
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-50);
  }

  .call-menu__slider {
    width: 100%;
    accent-color: color-mix(in srgb, var(--color-accent) 85%, white);
  }

  .call-menu__action {
    margin-top: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    border-radius: 0.9rem;
    padding: 0.65rem 0.85rem;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-80);
    font-size: 0.85rem;
    transition: background 150ms ease, color 150ms ease;
  }

  .call-menu__action i {
    font-size: 1rem;
  }

  .call-menu__action:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-100);
  }

  .call-menu__action--danger {
    background: color-mix(in srgb, var(--color-danger) 20%, transparent);
    color: color-mix(in srgb, var(--color-danger) 90%, white);
  }

  .call-menu__action--danger:hover {
    background: color-mix(in srgb, var(--color-danger) 32%, transparent);
  }

  .call-empty {
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    text-align: center;
  }

  .call-empty__card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
    max-width: 320px;
    color: var(--text-70);
  }

  .call-empty__icon {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 1rem;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    color: var(--text-80);
    font-size: 1.5rem;
  }

  .call-empty__card h3 {
    color: var(--text-90);
    font-size: 1rem;
    font-weight: 600;
  }

  .call-empty__card p {
    font-size: 0.9rem;
    color: var(--text-60);
    line-height: 1.4;
  }

  .call-controls {
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 70%, transparent);
    padding: clamp(0.9rem, 2vw, 1.25rem);
  }

  .call-controls__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .call-controls__row--join {
    justify-content: center;
    text-align: center;
  }

  .call-button {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.65rem 1.1rem;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-90);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .call-button--primary {
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    border-color: color-mix(in srgb, var(--button-primary-bg) 80%, transparent);
  }

  .call-button--primary:hover {
    background: var(--button-primary-hover);
  }

  .call-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .call-status-message {
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .call-controls__status {
    min-width: 0;
  }

  .call-audio-unlock {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .call-controls__group {
    display: inline-flex;
    align-items: center;
    gap: 1.1rem;
    flex-wrap: wrap;
  }

  .call-controls__group--main {
    flex: 1 1 auto;
    justify-content: center;
  }

  .call-controls__group--exit {
    gap: 0.75rem;
  }

  .call-controls__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-55);
  }

  .call-controls__item span {
    max-width: 6rem;
    text-align: center;
  }

  .call-controls__item--leave span {
    color: color-mix(in srgb, var(--color-danger) 85%, white);
  }

  .call-control-button {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 1.2rem;
    transition: transform 120ms ease, background 150ms ease, color 150ms ease;
  }

  .call-control-button:hover {
    background: rgba(255, 255, 255, 0.16);
    color: var(--text-100);
  }

  .call-control-button--active {
    background: color-mix(in srgb, var(--color-accent) 35%, transparent);
    color: color-mix(in srgb, var(--color-accent) 85%, white);
    border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
  }

  .call-control-button--danger {
    background: color-mix(in srgb, var(--color-danger) 25%, transparent);
    color: color-mix(in srgb, var(--color-danger) 85%, white);
    border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
  }

  .call-control-button--danger:hover {
    background: color-mix(in srgb, var(--color-danger) 35%, transparent);
  }

  .call-control-button--disabled,
  .call-control-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-40);
  }

  .call-error {
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
    background: color-mix(in srgb, var(--color-danger) 20%, transparent);
    padding: 0.9rem 1.1rem;
    color: color-mix(in srgb, var(--color-danger) 85%, white);
    font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .voice-root {
      padding: 0.75rem;
    }

    .call-shell {
      padding: 1rem;
    }

    .call-stage {
      padding: 0.75rem;
    }

    .call-controls__group--main {
      justify-content: center;
    }

    .call-controls__row--connected {
      flex-direction: column;
      align-items: stretch;
    }

    .call-controls__group--main {
      order: 2;
    }

    .call-controls__status {
      order: 1;
      text-align: center;
    }

    .call-controls__group--exit {
      order: 3;
      justify-content: center;
    }
  }

  @media (max-width: 480px) {
    .call-grid {
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    .call-controls__group--main {
      gap: 0.85rem;
    }

    .call-controls__item span {
      font-size: 0.7rem;
    }
  }
</style>






