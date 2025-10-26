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
  let sessionVisible = false;

  type ParticipantState = {
    uid: string;
    displayName: string;
    photoURL: string | null;
    hasAudio: boolean;
    hasVideo: boolean;
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

  let statusMessage = '';
  let errorMessage = '';

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
      controls
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
        audio.play?.().catch(() => {});
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
          break;
        case 'disconnected':
        case 'failed':
          statusMessage = 'Connection lost.';
          break;
        case 'closed':
          statusMessage = '';
          break;
      }
    };

    return pc;
  }

  function subscribeParticipants() {
    participantsUnsub?.();
    if (!participantsCollectionRef) {
      participants = [];
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

        participants = mapped.filter((p) => (p.status ?? 'active') === 'active');
      },
      (err) => {
        console.warn('Failed to subscribe to participants', err);
        participants = [];
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
      hasVideo: hasVideoTrack && !isCameraOff,
      streamId: localStream?.id ?? null,
      status: 'active' as const,
      updatedAt: serverTimestamp(),
      ...extra
    };

    try {
      await setDoc(participantDocRef, payload, { merge: true });
    } catch (err) {
      console.warn('Failed to update presence', err);
      if (!extra.joinedAt) {
        errorMessage =
          err instanceof Error ? err.message : 'Unable to update your voice status.';
      }
    }
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
          hasVideo: hasVideoTrack && !isCameraOff,
          status: 'active',
          joinedAt: null,
          streamId: localStream?.id ?? null
        }
      ];

      isJoined = true;
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
      applyTrackStates();
      statusMessage = 'Camera off.';
    }
    await updateParticipantPresence();
    const currentUid = $user?.uid ?? null;
    if (currentUid) {
      const nextVideo = hasVideoTrack && !isCameraOff;
      participants = participants.map((p) =>
        p.uid === currentUid ? { ...p, hasVideo: nextVideo, status: 'active' } : p
      );
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
        p.uid === currentUid ? { ...p, hasAudio: nextAudio, hasVideo: nextVideo, status: 'active' } : p
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
</script>

<div
  class="flex h-full flex-col gap-4 p-4 md:p-6"
  class:hidden={!session || !sessionVisible}
  aria-hidden={!session || !sessionVisible}
>
  {#if sessionChannelName}
    <header class="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 md:px-4">
      <div class="flex items-center gap-2 text-white">
        <i class="bx bx-headphone text-lg text-white/70" aria-hidden="true"></i>
        <span class="text-base font-semibold md:text-lg">{sessionChannelName}</span>
      </div>
      <div class="ml-auto flex items-center gap-3 text-xs text-white/60 md:text-sm">
        <span class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 font-medium text-white/70">
          <i class="bx bx-user-voice text-base"></i>
          {participantCount}
        </span>
        {#if remoteConnected}
          <span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">
            <i class="bx bx-check-shield text-base"></i>
            Live
          </span>
        {/if}
      </div>
    </header>
  {/if}

  <div class="flex items-center gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 md:px-4">
    {#if participantTiles.length === 0}
      <div class="text-sm text-white/60">No one is in this voice channel yet.</div>
    {:else}
      {#each participantTiles as tile (tile.uid)}
        <div class="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/80 md:text-sm">
          <div class="relative h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/10">
            {#if tile.photoURL}
              <img src={tile.photoURL} alt={tile.displayName} class="h-full w-full object-cover" loading="lazy" />
            {:else}
              <div class="grid h-full w-full place-items-center text-sm font-semibold">
                {avatarInitial(tile.displayName)}
              </div>
            {/if}
            {#if !tile.hasAudio && !tile.isSelf}
              <i class="bx bx-microphone-off absolute -bottom-1 -right-1 text-xs text-red-400"></i>
            {/if}
          </div>
          <span class="max-w-[140px] truncate">{tile.displayName}</span>
        </div>
      {/each}
    {/if}
  </div>

  <div class="flex-1 overflow-hidden">
    <div
      class="grid h-full content-start gap-3 sm:gap-4"
      style="grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));"
    >
      {#if participantTiles.length === 0}
        <div class="col-span-full grid place-items-center rounded-2xl border border-dashed border-white/15 bg-black/40 px-6 py-8 text-center text-sm text-white/60">
          You're the first one here. Enable your mic or camera to get started.
        </div>
      {:else}
        {#each participantTiles as tile (tile.uid)}
          <div
            class={`relative group rounded-2xl border border-white/10 bg-black/50 p-3 sm:p-4 transition ${tile.isSelf ? 'ring-1 ring-white/20' : ''}`}
            data-voice-menu
            on:touchstart={() => handleLongPressStart(tile.uid)}
            on:touchend={() => handleLongPressEnd(tile.uid)}
            on:touchcancel={() => handleLongPressEnd(tile.uid)}
          >
            <div class="relative aspect-video w-full overflow-hidden rounded-xl bg-black/70">
              <video
                use:videoSink={tile.uid}
                autoplay
                playsinline
                muted={tile.isSelf}
                class={`h-full w-full object-cover `}
              ></video>
              {#if !streamHasLiveVideo(tile.stream)}
                <div class="flex h-full flex-col items-center justify-center gap-3 text-white/70">
                  <div class="h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-[#5865f2]/30">
                    {#if tile.photoURL}
                      <img src={tile.photoURL} alt={tile.displayName} class="h-full w-full object-cover" loading="lazy" />
                    {:else}
                      <div class="grid h-full w-full place-items-center text-xl font-semibold">
                        {avatarInitial(tile.displayName)}
                      </div>
                    {/if}
                  </div>
                  <span class="text-xs uppercase tracking-wide text-white/50">
                    {tile.hasVideo ? 'Video loading�' : 'Camera disabled'}
                  </span>
                </div>
              {/if}
              {#if !tile.isSelf}
                <audio
                  use:audioSink={tile.uid}
                  autoplay
                  playsinline
                  class="hidden"
                ></audio>
              {/if}
              <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 via-black/10 to-transparent px-3 py-2 text-xs text-white">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-semibold">{tile.displayName}</span>
                  {#if tile.isSelf}
                    <span class="rounded bg-white/20 px-2 text-[10px] uppercase tracking-wide">You</span>
                  {/if}
                  {#if !tile.isSelf && tile.controls.muted}
                    <span class="rounded bg-white/20 px-2 text-[10px] uppercase tracking-wide text-white/80">Muted</span>
                  {/if}
                </div>
                <div class="flex items-center gap-2 text-base">
                  <i class={`bx ${tile.hasAudio ? 'bx-microphone' : 'bx-microphone-off'} ${tile.hasAudio ? 'text-white' : 'text-red-400'}`}></i>
                  <i class={`bx ${tile.hasVideo ? 'bx-video' : 'bx-video-off'} ${tile.hasVideo ? 'text-white' : 'text-red-400'}`}></i>
                </div>
              </div>
              {#if !tile.isSelf}
                <button
                  type="button"
                  class="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/80 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                  on:click|stopPropagation={() => openMenu(tile.uid)}
                  data-voice-menu
                  aria-label={`Voice options for ${tile.displayName}`}
                >
                  <i class="bx bx-dots-vertical-rounded text-lg"></i>
                </button>
              {/if}
            </div>

            {#if menuOpenFor === tile.uid && !tile.isSelf}
              <div
                class="absolute inset-x-0 top-full z-20 mt-2 w-full min-w-[220px] rounded-xl border border-white/10 bg-[#14141a] p-3 text-sm text-white shadow-xl"
                data-voice-menu
              >
                <div class="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                  <span class="font-semibold normal-case text-white">{tile.displayName}</span>
                  <button class="text-white/60 hover:text-white" on:click={closeMenu} type="button">
                    <i class="bx bx-x text-lg"></i>
                  </button>
                </div>
                <div class="mt-3 space-y-3">
                  <div>
                    <div class="flex items-center justify-between text-xs uppercase tracking-wide text-white/40">
                      <span>Volume</span>
                      <span>{Math.round(tile.controls.volume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(tile.controls.volume * 100)}
                      class="mt-2 w-full accent-[#5865f2]"
                      on:input={(event) => {
                        const target = event.currentTarget as HTMLInputElement;
                        setParticipantVolume(tile.uid, Number(target.value) / 100);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between rounded-lg bg-white/[0.06] px-3 py-2 text-left hover:bg-white/[0.12]"
                    on:click={() => toggleParticipantMute(tile.uid)}
                  >
                    <span>{tile.controls.muted ? 'Unmute for me' : 'Mute for me'}</span>
                    <i class={`bx ${tile.controls.muted ? 'bx-volume-full' : 'bx-volume-mute'} text-lg`}></i>
                  </button>
                  {#if canKickMembers}
                    <button
                      type="button"
                      class="flex w-full items-center justify-between rounded-lg bg-red-500/10 px-3 py-2 text-left text-red-200 hover:bg-red-500/20"
                      on:click={() => {
                        const target = participants.find((p) => p.uid === tile.uid);
                        if (target) kickParticipant(target);
                        closeMenu();
                      }}
                    >
                      <span>Remove from channel</span>
                      <i class="bx bx-user-x text-lg"></i>
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/40 p-3 md:p-4">
    {#if !isJoined}
      <button
        class="btn btn-primary"
        on:click={handleJoinClick}
        disabled={isConnecting || !serverId || !channelId}
      >
        {isConnecting ? 'Joining…' : 'Join Voice'}
      </button>
    {:else}
      <button class="btn btn-secondary" on:click={toggleMic}>
        {micButtonLabel}
      </button>
      <button class="btn btn-secondary" on:click={toggleCamera}>
        {cameraButtonLabel}
      </button>
      <button
        class="btn btn-ghost"
        on:click={refreshDevices}
        disabled={!hasAudioTrack && !hasVideoTrack}
      >
        Refresh devices
      </button>
      <span class="ml-auto hidden text-sm text-white/60 md:inline">
        {participantCount} {participantCount === 1 ? 'person' : 'people'} connected
      </span>
      <button class="btn btn-danger md:ml-2" on:click={handleLeave}>
        Leave
      </button>
    {/if}
    {#if statusMessage}
      <div class="text-sm text-white/60 md:ml-3">{statusMessage}</div>
    {/if}
  </div>

  {#if errorMessage}
    <div class="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {errorMessage}
    </div>
  {/if}
</div>

