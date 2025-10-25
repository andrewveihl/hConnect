<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
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
    status?: 'active' | 'left';
    joinedAt?: any;
    updatedAt?: any;
  };

  let localVideoEl: HTMLVideoElement | null = null;
  let remoteVideoEl: HTMLVideoElement | null = null;

  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let remoteHasVideo = false;

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

  $: currentUserId = $user?.uid ?? null;
  $: selfParticipant = participants.find((p) => p.uid === currentUserId) ?? null;
  $: remoteParticipants = participants.filter((p) => p.uid !== currentUserId);
  $: localHasAudio = selfParticipant?.hasAudio ?? (hasAudioTrack && !isMicMuted);
  $: localHasVideo = selfParticipant?.hasVideo ?? (hasVideoTrack && !isCameraOff);
  $: remoteHasAudio =
    !!(remoteStream && remoteStream.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled));
  $: remoteHasVideo =
    !!(remoteStream && remoteStream.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled));
  $: fallbackRemote =
    remoteParticipants.length === 0 && (remoteStream || remoteConnected)
      ? {
          uid: '__remote__',
          displayName: 'Participant',
          photoURL: null,
          hasAudio: remoteHasAudio,
          hasVideo: remoteHasVideo,
          status: 'active' as const
        }
      : null;
  $: primaryRemote = remoteParticipants[0] ?? fallbackRemote;
  $: extraRemote = remoteParticipants.slice(1);
  $: primaryRemoteName = primaryRemote?.displayName ?? 'Participant';
  $: primaryRemoteAudio = primaryRemote?.hasAudio ?? remoteHasAudio;
  $: primaryRemoteVideo = primaryRemote?.hasVideo ?? remoteHasVideo;

  $: localVideoEl && localStream && (localVideoEl.srcObject = localStream);
  $: if (remoteVideoEl) {
    const target = remoteStream ?? null;
    if (remoteVideoEl.srcObject !== target) {
      remoteVideoEl.srcObject = target;
      remoteVideoEl.play?.().catch(() => {});
    }
  }

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
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', onUnload);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', onUnload);
      }
    };
  });

  onDestroy(() => {
    voiceUnsubscribe?.();
    hangUp().catch(() => {});
  });

  function avatarInitial(name: string | undefined): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase() || '?';
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
      const incoming = stream ?? remoteStream ?? new MediaStream();

      if (!stream) {
        incoming.addTrack(event.track);
      }

      remoteStream = incoming;
      remoteConnected = true;
      remoteHasVideo =
        remoteStream.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled);
      if (remoteVideoEl) {
        remoteVideoEl.srcObject = remoteStream;
        remoteVideoEl.play?.().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      switch (pc.connectionState) {
        case 'connecting':
          statusMessage = 'Connecting...';
          break;
        case 'connected':
          statusMessage = 'Connected.';
          remoteConnected = true;
          break;
        case 'disconnected':
        case 'failed':
          remoteConnected = false;
          remoteHasVideo = false;
          statusMessage = 'Connection lost.';
          break;
        case 'closed':
          remoteConnected = false;
          remoteHasVideo = false;
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
        participants = snapshot.docs
          .map((d) => {
            const data = d.data() as any;
            const status = (data.status ?? 'active') as 'active' | 'left';
            return {
              uid: data.uid ?? d.id,
              displayName: data.displayName ?? 'Member',
              photoURL: data.photoURL ?? null,
              hasAudio: data.hasAudio ?? false,
              hasVideo: data.hasVideo ?? false,
              status,
              joinedAt: data.joinedAt ?? null,
              updatedAt: data.updatedAt ?? null
            } as ParticipantState;
          })
          .filter((p) => (p.status ?? 'active') !== 'left')
          .sort((a, b) => {
            const aTime = a.joinedAt?.toMillis?.() ?? 0;
            const bTime = b.joinedAt?.toMillis?.() ?? 0;
            return aTime - bTime;
          });
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
          joinedAt: null
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

    remoteStream = null;
    remoteConnected = false;
    if (remoteVideoEl) remoteVideoEl.srcObject = null;
    if (localVideoEl) localVideoEl.srcObject = null;

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

<div class="flex h-full flex-col gap-4 p-4" class:hidden={!session || !sessionVisible} aria-hidden={!session || !sessionVisible}>
  {#if sessionChannelName}
    <div class="text-lg font-semibold text-white/90">{sessionChannelName}</div>
  {/if}

  <div class="flex items-center gap-2 overflow-x-auto rounded-xl border border-white/10 bg-black/30 px-3 py-2">
    {#if participants.length === 0}
      <div class="text-sm text-white/60">No one is in this voice channel yet.</div>
    {:else}
      {#each participants as participant (participant.uid)}
        <div class="flex shrink-0 items-center gap-2 rounded-lg bg-white/5 px-2 py-1">
          {#if participant.photoURL}
            <img
              src={participant.photoURL}
              alt={participant.displayName}
              class="h-7 w-7 rounded-full object-cover"
              loading="lazy"
            />
          {:else}
            <div class="grid h-7 w-7 place-items-center rounded-full bg-[#6c75ff]/40 text-sm font-semibold text-white">
              {avatarInitial(participant.displayName)}
            </div>
          {/if}
          <div class="leading-tight">
            <div class="max-w-[140px] truncate text-sm font-medium">
              {participant.uid === currentUserId ? 'You' : participant.displayName}
            </div>
            <div class="flex items-center gap-1 text-[11px] text-white/50">
              <i
                class={`bx ${participant.hasAudio ? 'bx-microphone' : 'bx-microphone-off'} ${participant.hasAudio ? 'text-white/70' : 'text-red-400'}`}
              ></i>
              <i
                class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off'} ${participant.hasVideo ? 'text-white/70' : 'text-red-400'}`}
              ></i>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="flex-1 overflow-hidden">
    <div
      class="grid h-full content-start gap-4"
      style="grid-template-columns: repeat(auto-fit, minmax(clamp(260px, 28vw, 420px), 1fr));"
    >
      {#if primaryRemote}
        {#key primaryRemote.uid}
          <div class="relative aspect-[5/4] md:aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/70">
            <video
              bind:this={remoteVideoEl}
              autoplay
              playsinline
              class="h-full w-full object-cover"
            ></video>
            {#if !remoteHasVideo}
              <div class="absolute inset-0 grid place-items-center bg-black/70 px-4 text-center text-sm tracking-wide text-white/70">
                <div>
                  <div class="mb-1 text-base font-semibold">{primaryRemoteName}</div>
                  <div>{remoteConnected ? 'Camera disabled' : 'Connecting...'}</div>
                </div>
              </div>
            {/if}
            <div class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-3 py-2 text-sm">
              <span class="font-medium truncate pr-2">{primaryRemoteName}</span>
              <span class="flex items-center gap-2 text-base">
                <i class={`bx ${primaryRemoteAudio ? 'bx-microphone' : 'bx-microphone-off'} ${primaryRemoteAudio ? 'text-white' : 'text-red-400'}`}></i>
                <i class={`bx ${primaryRemoteVideo ? 'bx-video' : 'bx-video-off'} ${primaryRemoteVideo ? 'text-white' : 'text-red-400'}`}></i>
              </span>
            </div>
          </div>
        {/key}
      {/if}

      {#each extraRemote as participant (participant.uid)}
        <div class="relative aspect-[5/4] md:aspect-square overflow-hidden rounded-xl border border-dashed border-white/10 bg-black/60 p-4">
          <div class="flex h-full flex-col items-center justify-center gap-3 text-center text-white/70">
            {#if participant.photoURL}
              <img src={participant.photoURL} alt={participant.displayName} class="h-14 w-14 rounded-full object-cover" loading="lazy" />
            {:else}
              <div class="grid h-14 w-14 place-items-center rounded-full bg-[#6c75ff]/30 text-xl font-semibold text-white">
                {avatarInitial(participant.displayName)}
              </div>
            {/if}
            <div>
              <div class="text-base font-semibold">{participant.displayName}</div>
              <div class="mt-1 text-xs text-white/50">
                {participant.hasVideo ? 'Video enabled' : 'Camera off'}
              </div>
              <div class="mt-1 flex justify-center gap-2 text-base">
                <i class={`bx ${participant.hasAudio ? 'bx-microphone' : 'bx-microphone-off'} ${participant.hasAudio ? 'text-white/80' : 'text-red-400'}`}></i>
                <i class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off'} ${participant.hasVideo ? 'text-white/80' : 'text-red-400'}`}></i>
              </div>
            </div>
          </div>
        </div>
      {/each}

      {#if selfParticipant || isJoined}
        <div class="relative aspect-[5/4] md:aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/60">
          <video
            bind:this={localVideoEl}
            autoplay
            playsinline
            muted
            class="h-full w-full object-cover"
          ></video>
          {#if !localHasVideo}
            <div class="absolute inset-0 grid place-items-center bg-black/70 text-sm tracking-wide text-white/70">
              Camera off
            </div>
          {/if}
          <div class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-3 py-2 text-sm">
            <span class="font-medium">You</span>
            <span class="flex items-center gap-2 text-base">
              <i class={`bx ${localHasAudio ? 'bx-microphone' : 'bx-microphone-off'} ${localHasAudio ? 'text-white' : 'text-red-400'}`}></i>
              <i class={`bx ${localHasVideo ? 'bx-video' : 'bx-video-off'} ${localHasVideo ? 'text-white' : 'text-red-400'}`}></i>
            </span>
          </div>
        </div>
      {/if}

      {#if participants.length === 0}
        <div class="col-span-full grid place-items-center rounded-xl border border-dashed border-white/10 bg-black/50 p-6 text-center text-white/60">
          You're the first one here. Enable your mic or camera to get started.
        </div>
      {/if}
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-3">
    {#if !isJoined}
      <button
        class="btn btn-primary"
        on:click={handleJoinClick}
        disabled={isConnecting || !serverId || !channelId}
      >
        {isConnecting ? 'Joining...' : 'Join voice'}
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
    <div class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {errorMessage}
    </div>
  {/if}
</div>
