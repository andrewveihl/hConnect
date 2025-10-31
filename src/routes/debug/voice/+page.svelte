<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ensureFirebaseReady, getDb, waitForAuthInit, startAuthListener } from '$lib/firebase';
  import { user } from '$lib/stores/user';
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
  import type { User } from 'firebase/auth';

  type CallRole = 'offerer' | 'answerer';

  let sessionId = 'debug-room';
  let joining = false;
  let joined = false;
  let callRole: CallRole | null = null;

  let localVideoEl: HTMLVideoElement | null = null;
  let remoteVideoEl: HTMLVideoElement | null = null;

  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;

  let callRef: DocumentReference | null = null;
  let offerCandidatesRef: CollectionReference | null = null;
  let answerCandidatesRef: CollectionReference | null = null;
  let callSnapshotUnsub: Unsubscribe | null = null;
  let offerCandidatesUnsub: Unsubscribe | null = null;
  let answerCandidatesUnsub: Unsubscribe | null = null;

  let callDocData: Record<string, unknown> | null = null;
  let callSnapshotHasData = false;

  let signalingState = 'closed';
  let connectionState = 'new';
  let iceConnectionState = 'new';
  let iceGatheringState = 'new';

  let publishedCandidateCount = 0;
  let appliedCandidateCount = 0;

  let micMuted = false;
  let cameraOff = false;

  const remoteCandidateKeys = new Set<string>();

  let currentUser: User | null = null;
  let authReady = false;

  type LogEntry = { id: string; timestamp: string; message: string; details?: string };
  let logEntries: LogEntry[] = [];
  let logSequence = 0;

  function log(message: string, details?: unknown) {
    const timestamp = new Date().toLocaleTimeString();
    let detailsString: string | undefined;
    if (details !== undefined) {
      try {
        detailsString = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
      } catch {
        detailsString = String(details);
      }
    }
    const id = `${Date.now()}-${logSequence++}`;
    logEntries = [{ id, timestamp, message, details: detailsString }, ...logEntries].slice(0, 250);
    console.debug('[voice-debug]', message, details);
  }

  onMount(() => {
    if (!browser) return;
    let cancelled = false;

    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const appEl = document.getElementById('app');
    htmlEl.classList.add('debug-voice-html');
    bodyEl.classList.add('debug-voice-body');
    appEl?.classList.add('debug-voice-app');

    const unsubscribe = user.subscribe((value) => {
      currentUser = value;
      log('Auth state changed', value ? { uid: value.uid, email: value.email ?? null } : 'null');
    });

    const stopAuth = startAuthListener();

    (async () => {
      try {
        await ensureFirebaseReady();
        await waitForAuthInit();
        if (cancelled) return;
        authReady = true;
        log('Auth initialisation complete', currentUser ? { uid: currentUser.uid } : 'no user detected');
      } catch (err) {
        log(
          'Failed to initialise Firebase auth',
          err instanceof Error ? err.message : String(err ?? 'unknown error')
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      stopAuth?.();
      htmlEl.classList.remove('debug-voice-html');
      bodyEl.classList.remove('debug-voice-body');
      appEl?.classList.remove('debug-voice-app');
    };
  });

  function resetConnectionState() {
    signalingState = 'closed';
    connectionState = 'new';
    iceConnectionState = 'new';
    iceGatheringState = 'new';
  }

  function updatePeerConnectionState() {
    if (!pc) return;
    signalingState = pc.signalingState;
    connectionState = pc.connectionState;
    iceConnectionState = pc.iceConnectionState;
    iceGatheringState = pc.iceGatheringState;
  }

  function ensureRemoteStream() {
    if (!remoteStream) {
      remoteStream = new MediaStream();
    }
    if (remoteVideoEl && remoteStream) {
      remoteVideoEl.srcObject = remoteStream;
      remoteVideoEl.play().catch(() => {});
    }
  }

  function attachPeerConnectionHandlers(currentUid: string) {
    if (!pc) return;

    updatePeerConnectionState();

    pc.addEventListener('signalingstatechange', () => {
      updatePeerConnectionState();
      log('signalingstatechange', { signalingState: pc?.signalingState });
    });

    pc.addEventListener('connectionstatechange', () => {
      updatePeerConnectionState();
      log('connectionstatechange', { connectionState: pc?.connectionState });
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      updatePeerConnectionState();
      log('iceconnectionstatechange', { iceConnectionState: pc?.iceConnectionState });
    });

    pc.addEventListener('icegatheringstatechange', () => {
      updatePeerConnectionState();
      log('icegatheringstatechange', { iceGatheringState: pc?.iceGatheringState });
    });

    pc.addEventListener('negotiationneeded', () => {
      log('negotiationneeded event fired');
    });

    pc.addEventListener('icecandidateerror', (event) => {
      const iceError = event as RTCPeerConnectionIceErrorEvent;
      log('icecandidateerror', {
        errorCode: iceError.errorCode,
        errorText: iceError.errorText,
        hostCandidate: iceError.hostCandidate,
        url: iceError.url
      });
    });

    pc.addEventListener('track', (event) => {
      ensureRemoteStream();
      event.streams.forEach((stream) => {
        stream.getTracks().forEach((track) => {
          if (!remoteStream?.getTracks().some((existing) => existing.id === track.id)) {
            remoteStream?.addTrack(track);
          }
        });
      });
      log('Remote track received', {
        trackIds: event.streams.flatMap((stream) => stream.getTracks().map((track) => track.id))
      });
    });

    pc.addEventListener('icecandidate', async (event) => {
      if (!event.candidate) {
        log('ICE candidate collection completed');
        return;
      }
      const candidateJson = event.candidate.toJSON();
      const candidatePayload = {
        ...candidateJson,
        createdAt: serverTimestamp(),
        owner: currentUid
      };
      const targetRef = callRole === 'offerer' ? offerCandidatesRef : answerCandidatesRef;
      if (!targetRef) {
        log('ICE candidate dropped (missing collection reference)', candidatePayload);
        return;
      }
      try {
        await addDoc(targetRef, candidatePayload);
        publishedCandidateCount += 1;
        log('Published ICE candidate', {
          role: callRole,
          candidate: candidateJson.candidate,
          sdpMid: candidateJson.sdpMid,
          sdpMLineIndex: candidateJson.sdpMLineIndex
        });
      } catch (err) {
        log('Failed to publish ICE candidate', err instanceof Error ? err.message : err);
      }
    });
  }

  async function ensureLocalStream() {
    if (localStream) return;
    if (!browser) throw new Error('Browser-only operation');

    const audioConstraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
    const videoConstraints: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };

    const requestMedia = async (constraints: MediaStreamConstraints, label: string) => {
      log(`Requesting local media (${label})`, constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      log(`Local media granted (${label})`, {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length
      });
      return stream;
    };

    try {
      localStream = await requestMedia({ audio: audioConstraints, video: videoConstraints }, 'audio+video');
    } catch (err) {
      const domErr = err as DOMException;
      const readableError =
        domErr instanceof Error
          ? { name: domErr.name ?? 'Error', message: domErr.message }
          : { name: 'Error', message: String(err ?? 'unknown error') };
      log('Failed to acquire local media', readableError);

      const retryableNames = ['NotFoundError', 'OverconstrainedError', 'NotReadableError', 'DevicesNotFoundError'];
      if (retryableNames.includes(readableError.name)) {
        try {
          localStream = await requestMedia({ audio: audioConstraints, video: false }, 'audio-only fallback');
          log('Continuing with audio-only media (no camera available)');
        } catch (audioErr) {
          const audioReadable =
            audioErr instanceof Error
              ? { name: (audioErr as DOMException).name ?? 'Error', message: audioErr.message }
              : { name: 'Error', message: String(audioErr ?? 'unknown error') };
          log('Audio-only media request failed', audioReadable);
          throw audioErr;
        }
      } else {
        throw err;
      }
    }

    if (!localStream) throw new Error('Unable to acquire local media stream.');

    const hasVideoTracks = localStream.getVideoTracks().length > 0;
    if (localVideoEl) {
      localVideoEl.srcObject = hasVideoTracks ? localStream : null;
      if (hasVideoTracks) {
        localVideoEl.muted = true;
        localVideoEl.play().catch(() => {});
      }
    }

    micMuted = localStream.getAudioTracks().every((track) => !track.enabled);
    cameraOff = hasVideoTracks ? localStream.getVideoTracks().every((track) => !track.enabled) : true;
    if (!hasVideoTracks) {
      log('No local video tracks detected; camera controls will remain disabled', {
        audioTracks: localStream.getAudioTracks().length
      });
    }
  }

  async function setupPeerConnection() {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.close();
      pc = null;
    }
    const config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    pc = new RTCPeerConnection(config);
    remoteCandidateKeys.clear();
    publishedCandidateCount = 0;
    appliedCandidateCount = 0;
    resetConnectionState();
    const currentUid = currentUser?.uid ?? 'unknown';
    attachPeerConnectionHandlers(currentUid);

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc?.addTrack(track, localStream!);
        log('Track added to peer connection', { id: track.id, kind: track.kind });
      });
    }
  }

  async function joinCall() {
    if (!browser) return;
    if (!sessionId.trim()) {
      log('Session ID is required to join a call');
      return;
    }
    if (joining) return;

    joining = true;

    try {
      await ensureFirebaseReady();
      await waitForAuthInit();

      const resolvedUser = currentUser ?? get(user);
      if (!resolvedUser) {
        log('User must be signed in before joining', { authReady, hasUser: false });
        return;
      }
      const activeUser = resolvedUser;

      const db = getDb();
      callRef = doc(db, 'debugCalls', sessionId.trim());
      offerCandidatesRef = collection(callRef, 'offerCandidates');
      answerCandidatesRef = collection(callRef, 'answerCandidates');

      const existing = await getDoc(callRef);

      await ensureLocalStream();
      await setupPeerConnection();

      callSnapshotUnsub?.();
      offerCandidatesUnsub?.();
      answerCandidatesUnsub?.();
      callSnapshotHasData = false;

      callSnapshotUnsub = onSnapshot(callRef, async (snapshot) => {
        const exists = snapshot.exists();
        const data = snapshot.data() ?? null;
        callDocData = data;

        if (exists) {
          if (!callSnapshotHasData) {
            callSnapshotHasData = true;
            log('Call document observed', { hasOffer: !!data?.offer, hasAnswer: !!data?.answer });
          }
        } else {
          if (!callSnapshotHasData) {
            log('Call snapshot empty (waiting for initial create)');
            return;
          }
          log('Call document deleted. Cleaning up.');
          await cleanupCall();
          return;
        }

        if (callRole === 'offerer' && data?.answer && pc && !pc.currentRemoteDescription) {
          log('Applying remote answer', { by: data.answer.createdBy });
          const answer = new RTCSessionDescription({
            type: data.answer.type,
            sdp: data.answer.sdp
          });
          try {
            await pc.setRemoteDescription(answer);
            log('Remote answer applied');
          } catch (err) {
            log('Failed to apply remote answer', err instanceof Error ? err.message : err);
          }
        }
      });

      const existingData = existing.data();
      log('Fetched call snapshot via getDoc', {
        exists: existing.exists(),
        hasOffer: !!existingData?.offer,
        hasAnswer: !!existingData?.answer
      });

      if (!existing.exists() || !existingData?.offer) {
        callRole = 'offerer';
        log('Joining session as offerer');
        const offerDescription = await pc!.createOffer();
        await pc!.setLocalDescription(offerDescription);

        await setDoc(
          callRef,
          {
            createdBy: activeUser.uid,
            createdAt: serverTimestamp(),
            status: 'offer-created',
            lastUpdatedAt: serverTimestamp(),
            offer: {
              type: offerDescription.type,
              sdp: offerDescription.sdp,
              createdBy: activeUser.uid,
              createdAt: serverTimestamp(),
              userAgent: navigator.userAgent
            }
          },
          { merge: true }
        );

        answerCandidatesUnsub = onSnapshot(collection(callRef, 'answerCandidates'), (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const data = change.doc.data() as RTCIceCandidateInit & { candidate: string };
              const key = `${data.sdpMid}|${data.sdpMLineIndex}|${data.candidate}`;
              if (remoteCandidateKeys.has(key)) return;
              remoteCandidateKeys.add(key);
              pc
                ?.addIceCandidate(new RTCIceCandidate(data))
                .then(() => {
                  appliedCandidateCount += 1;
                  log('Applied remote ICE candidate', { from: 'answerer', candidate: data.candidate });
                })
                .catch((err) => {
                  log('Failed to apply remote ICE candidate', err instanceof Error ? err.message : err);
                });
            }
          });
        });
      } else {
        callRole = 'answerer';
        log('Joining session as answerer');
        const offer = existingData?.offer;
        if (!offer?.sdp || !offer?.type) {
          throw new Error('Existing offer is malformed');
        }
        log('Applying remote offer', { by: offer.createdBy });
        await pc!.setRemoteDescription(new RTCSessionDescription(offer));

        const answerDescription = await pc!.createAnswer();
        await pc!.setLocalDescription(answerDescription);

        try {
          await updateDoc(callRef, {
            status: 'answer-created',
            lastUpdatedAt: serverTimestamp(),
            answer: {
              type: answerDescription.type,
              sdp: answerDescription.sdp,
              createdBy: activeUser.uid,
              createdAt: serverTimestamp(),
              userAgent: navigator.userAgent
            }
          });
          log('Published answer description');
        } catch (err) {
          log('Failed to publish answer description', err instanceof Error ? err.message : err);
          throw err;
        }

        offerCandidatesUnsub = onSnapshot(collection(callRef, 'offerCandidates'), (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const data = change.doc.data() as RTCIceCandidateInit & { candidate: string };
              const key = `${data.sdpMid}|${data.sdpMLineIndex}|${data.candidate}`;
              if (remoteCandidateKeys.has(key)) return;
              remoteCandidateKeys.add(key);
              pc
                ?.addIceCandidate(new RTCIceCandidate(data))
                .then(() => {
                  appliedCandidateCount += 1;
                  log('Applied remote ICE candidate', { from: 'offerer', candidate: data.candidate });
                })
                .catch((err) => {
                  log('Failed to apply remote ICE candidate', err instanceof Error ? err.message : err);
                });
            }
          });
        });
        log('Attached offerCandidates listener for answerer');
      }

      joined = true;
      log('Join sequence completed', { callRole });
    } catch (err) {
      log('Failed to join session', err instanceof Error ? err.message : err);
      await cleanupCall();
    } finally {
      joining = false;
    }
  }

  async function leaveCall() {
    log('Leaving session');
    await cleanupCall();
  }

  async function cleanupCall() {
    callSnapshotUnsub?.();
    callSnapshotUnsub = null;
    offerCandidatesUnsub?.();
    offerCandidatesUnsub = null;
    answerCandidatesUnsub?.();
    answerCandidatesUnsub = null;

    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.close();
      pc = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }

    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
      remoteStream = null;
    }

    if (localVideoEl) {
      localVideoEl.srcObject = null;
    }
    if (remoteVideoEl) {
      remoteVideoEl.srcObject = null;
    }

    joined = false;
    callRole = null;
    callRef = null;
    offerCandidatesRef = null;
    answerCandidatesRef = null;
    micMuted = false;
    cameraOff = false;
    callDocData = null;
    callSnapshotHasData = false;
    resetConnectionState();
    remoteCandidateKeys.clear();
    log('Local state cleared');
  }

  async function resetSession() {
    if (!browser) return;
    await ensureFirebaseReady();
    await waitForAuthInit();

    const resolvedUser = currentUser ?? get(user);
    if (!resolvedUser) {
      log('Cannot reset session without being signed in', { authReady, hasUser: false });
      return;
    }
    log('Resetting session request', { sessionId: sessionId.trim(), requestedBy: resolvedUser.uid });
    if (!sessionId.trim()) {
      log('Session ID required to reset');
      return;
    }
    try {
      await ensureFirebaseReady();
      const db = getDb();
      const targetRef = doc(db, 'debugCalls', sessionId.trim());
      const offerColl = collection(targetRef, 'offerCandidates');
      const answerColl = collection(targetRef, 'answerCandidates');
      const [offerDocs, answerDocs] = await Promise.all([getDocs(offerColl), getDocs(answerColl)]);

      await Promise.all([
        ...offerDocs.docs.map((snapshot) => deleteDoc(snapshot.ref)),
        ...answerDocs.docs.map((snapshot) => deleteDoc(snapshot.ref))
      ]);

      await deleteDoc(targetRef);
      log('Session reset and call doc removed');
    } catch (err) {
      log('Failed to reset session', err instanceof Error ? err.message : err);
    }
  }

  function toggleMic() {
    if (!localStream) return;
    const tracks = localStream.getAudioTracks();
    if (!tracks.length) {
      log('No audio tracks found to toggle');
      return;
    }
    const nextState = !tracks[0].enabled;
    tracks.forEach((track) => (track.enabled = nextState));
    micMuted = !nextState;
    log('Mic toggled', { enabled: nextState });
  }

  function toggleCamera() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) {
      log('No video tracks found to toggle');
      return;
    }
    const nextState = !tracks[0].enabled;
    tracks.forEach((track) => (track.enabled = nextState));
    cameraOff = !nextState;
    log('Camera toggled', { enabled: nextState });
  }

  $: if (localVideoEl) {
    if (localStream && hasVideoTracks(localStream)) {
      localVideoEl.srcObject = localStream;
      localVideoEl.muted = true;
      localVideoEl.play().catch(() => {});
    } else {
      localVideoEl.srcObject = null;
    }
  }

  $: if (remoteVideoEl && remoteStream) {
    remoteVideoEl.srcObject = remoteStream;
  }

  const localTrackInfo = () =>
    localStream
      ? localStream.getTracks().map((track) => ({
          id: track.id,
          kind: track.kind,
          enabled: track.enabled,
          muted: (track as MediaStreamTrack & { muted?: boolean }).muted ?? false,
          readyState: track.readyState
      }))
      : [];

  const hasVideoTracks = (stream: MediaStream | null) =>
    !!stream && stream.getVideoTracks().length > 0;

  const remoteTrackInfo = () =>
    remoteStream
      ? remoteStream.getTracks().map((track) => ({
          id: track.id,
          kind: track.kind,
          enabled: track.enabled,
          muted: (track as MediaStreamTrack & { muted?: boolean }).muted ?? false,
          readyState: track.readyState
        }))
      : [];

  onDestroy(() => {
    cleanupCall();
  });
</script>

<svelte:head>
  <title>Voice / Video Debug</title>
</svelte:head>

<div class="debug-scroll">
  <main class="debug-root">
    <h1>Voice &amp; Video Debugger</h1>

    <section class="controls">
      <div class="field">
        <label for="session">Session ID</label>
        <input
          id="session"
          type="text"
        bind:value={sessionId}
        placeholder="debug-room"
        spellcheck="false"
      />
    </div>

    <div class="buttons">
      <button class="primary" on:click|preventDefault={joinCall} disabled={joining || joined}>
        {joining ? 'Joining…' : joined ? 'Connected' : 'Join Session'}
      </button>
      <button on:click|preventDefault={leaveCall} disabled={!joined}>
        Leave Session
      </button>
      <button class="danger" on:click|preventDefault={resetSession}>
        Reset Session
      </button>
    </div>

    <div class="quick-stats">
      <div>
        <span class="label">Auth</span>
        <span class="value">
          {#if authReady}
            {#if currentUser}
              Signed in ({currentUser.uid})
            {:else}
              No user
            {/if}
          {:else}
            Initialising…
          {/if}
        </span>
      </div>
      <div>
        <span class="label">Role</span>
        <span class="value">{callRole ?? 'Not joined'}</span>
      </div>
      <div>
        <span class="label">Signaling</span>
        <span class="value">{signalingState}</span>
      </div>
      <div>
        <span class="label">Connection</span>
        <span class="value">{connectionState}</span>
      </div>
      <div>
        <span class="label">ICE</span>
        <span class="value">{iceConnectionState} / {iceGatheringState}</span>
      </div>
      <div>
        <span class="label">Local ICE sent</span>
        <span class="value">{publishedCandidateCount}</span>
      </div>
      <div>
        <span class="label">Remote ICE applied</span>
        <span class="value">{appliedCandidateCount}</span>
      </div>
    </div>

    <div class="media-controls">
      <button on:click|preventDefault={toggleMic} disabled={!localStream}>
        {micMuted ? 'Unmute Mic' : 'Mute Mic'}
      </button>
      <button
        on:click|preventDefault={toggleCamera}
        disabled={!localStream || !hasVideoTracks(localStream)}
      >
        {cameraOff ? 'Enable Camera' : 'Disable Camera'}
      </button>
    </div>
  </section>

  <section class="videos">
    <div class="video-panel">
      <h2>Local Preview</h2>
      <video playsinline autoplay muted bind:this={localVideoEl}></video>
      {#if localStream && !hasVideoTracks(localStream)}
        <p class="video-info">No camera detected for this device. Connected with audio only.</p>
      {/if}
      <pre>{JSON.stringify(localTrackInfo(), null, 2)}</pre>
    </div>
    <div class="video-panel">
      <h2>Remote Preview</h2>
      <video playsinline autoplay aria-hidden="true" tabindex="-1" bind:this={remoteVideoEl}></video>
      <pre>{JSON.stringify(remoteTrackInfo(), null, 2)}</pre>
    </div>
  </section>

  <section class="call-doc">
    <h2>Firestore Document Snapshot</h2>
    <pre>{callDocData ? JSON.stringify(callDocData, null, 2) : 'No data'}</pre>
  </section>

  <section class="logs">
    <h2>Event Log</h2>
    {#if logEntries.length}
      <ul>
        {#each logEntries as entry (entry.id)}
          <li>
            <span class="time">{entry.timestamp}</span>
            <span class="msg">{entry.message}</span>
            {#if entry.details}
              <pre>{entry.details}</pre>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p>No logs yet.</p>
    {/if}
  </section>
  </main>
</div>

<style>
  .debug-scroll {
    min-height: 100dvh;
    overflow-y: auto;
    width: 100%;
  }

  .debug-root {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 1000px;
    margin: 0 auto;
  }

  h1 {
    font-size: 1.8rem;
    font-weight: 600;
  }

  section {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(6px);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  label {
    font-size: 0.9rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.75);
  }

  input {
    padding: 0.55rem 0.8rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.45);
    color: rgba(255, 255, 255, 0.95);
    font-size: 0.95rem;
  }

  input:focus {
    outline: 2px solid rgba(255, 255, 255, 0.25);
    outline-offset: 2px;
  }

  .buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    padding: 0.55rem 1.25rem;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
    cursor: pointer;
    transition: transform 120ms ease, background 150ms ease;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
  }

  .primary {
    background: rgba(125, 189, 255, 0.18);
    border-color: rgba(125, 189, 255, 0.25);
  }

  .primary:not(:disabled):hover {
    background: rgba(125, 189, 255, 0.25);
  }

  .danger {
    background: rgba(246, 112, 112, 0.12);
    border-color: rgba(246, 112, 112, 0.25);
  }

  .danger:not(:disabled):hover {
    background: rgba(246, 112, 112, 0.2);
  }

  .quick-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    font-size: 0.9rem;
  }

  .quick-stats .label {
    display: block;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.6);
  }

  .quick-stats .value {
    font-family: 'Fira Code', monospace;
    word-break: break-word;
  }

  .media-controls {
    display: flex;
    gap: 0.75rem;
  }

  .videos {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .video-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .video-panel video {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 12px;
    object-fit: cover;
  }

  .video-panel pre {
    font-size: 0.75rem;
    max-height: 140px;
    overflow: auto;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 8px;
  }

  .video-info {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.08);
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
  }

  .call-doc pre {
    max-height: 220px;
    overflow: auto;
    background: rgba(0, 0, 0, 0.45);
    padding: 0.75rem;
    border-radius: 8px;
    font-size: 0.8rem;
  }

  .logs ul {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-height: 320px;
    overflow: auto;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .logs li {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    padding: 0.75rem;
  }

  .logs .time {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  .logs .msg {
    font-weight: 600;
  }

  .logs pre {
    margin: 0;
    font-size: 0.75rem;
    background: rgba(0, 0, 0, 0.35);
    padding: 0.6rem;
    border-radius: 6px;
    overflow: auto;
  }

  @media (max-width: 640px) {
    .debug-root {
      padding: 1rem;
    }
  }

  :global(html.debug-voice-html),
  :global(body.debug-voice-body),
  :global(#app.debug-voice-app) {
    overflow-y: auto !important;
  }
</style>
