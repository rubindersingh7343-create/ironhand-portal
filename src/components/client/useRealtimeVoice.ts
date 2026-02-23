"use client";

import { useEffect, useMemo, useState } from "react";

export type RealtimeVoiceState = "idle" | "connecting" | "connected" | "error";

type VoiceSnapshot = {
  state: RealtimeVoiceState;
  error: string | null;
  storeId: string | null;
  voice: string | null;
  primaryLanguage: string | null;
  secondaryLanguage: string | null;
  listening: boolean;
};

type Subscriber = (snapshot: VoiceSnapshot) => void;

// Used to "unlock" audio playback on iOS Safari (must be triggered by a user gesture).
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

const controller = {
  state: "idle" as RealtimeVoiceState,
  error: null as string | null,
  storeId: null as string | null,
  voice: null as string | null,
  primaryLanguage: null as string | null,
  secondaryLanguage: null as string | null,
  storeLabel: null as string | null,
  greeted: false,
  continuous: false,
  pendingGreeting: false,
  pendingListenAfterGreet: false,
  desiredMicEnabled: false,
  peer: null as RTCPeerConnection | null,
  dataChannel: null as RTCDataChannel | null,
  audioSender: null as RTCRtpSender | null,
  localStream: null as MediaStream | null,
  localTrack: null as MediaStreamTrack | null,
  remoteStream: null as MediaStream | null,
  audio: null as HTMLAudioElement | null,
  needsPlaybackKick: false,
  audioDoneFallbackTimer: null as number | null,
  subscribers: new Set<Subscriber>(),
};

const notify = () => {
  const snapshot: VoiceSnapshot = {
    state: controller.state,
    error: controller.error,
    storeId: controller.storeId,
    voice: controller.voice,
    primaryLanguage: controller.primaryLanguage,
    secondaryLanguage: controller.secondaryLanguage,
    listening: controller.desiredMicEnabled,
  };
  controller.subscribers.forEach((cb) => cb(snapshot));
};

const ensureAudioElement = () => {
  if (controller.audio) return;
  const audio = document.createElement("audio");
  audio.setAttribute("playsinline", "true");
  audio.autoplay = false;
  audio.muted = false;
  audio.volume = 0.75;
  // iOS Safari can behave badly with display:none media elements.
  // Keep it in the DOM but effectively invisible.
  audio.style.position = "fixed";
  audio.style.left = "-9999px";
  audio.style.top = "0";
  audio.style.width = "1px";
  audio.style.height = "1px";
  audio.style.opacity = "0";
  audio.style.pointerEvents = "none";
  document.body.appendChild(audio);
  controller.audio = audio;
};

const isIOSDevice = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    // iPadOS can report as Mac, but with touch points.
    ((navigator as any).platform === "MacIntel" &&
      typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 1)
  );
};

const prewarmOutput = () => {
  // iOS Safari often blocks/interrupts playback if play() is only called from WebRTC callbacks.
  // This runs from a user gesture (tap) and "unlocks" audio so the greeting doesn't cut out.
  ensureAudioElement();
  if (!controller.audio) return;
  const audio = controller.audio;

  try {
    if (!audio.srcObject) {
      audio.src = SILENT_WAV;
    }
    audio.muted = true;
    const playPromise = audio.play();
    if (playPromise && typeof (playPromise as Promise<void>).then === "function") {
      (playPromise as Promise<void>)
        .then(() => {
          audio.pause();
          audio.muted = false;
          try {
            audio.currentTime = 0;
          } catch {
            // ignore
          }
        })
        .catch(() => {
          // ignore
        });
    }
  } catch {
    // ignore
  }
};

const kickPlayback = () => {
  if (!controller.audio || !controller.remoteStream) return;
  if (controller.audio.srcObject !== controller.remoteStream) {
    controller.audio.srcObject = controller.remoteStream;
  }
  controller.audio.muted = false;
  controller.audio
    .play()
    .then(() => {
      controller.needsPlaybackKick = false;
    })
    .catch(() => {
      controller.needsPlaybackKick = true;
    });
};

const cleanup = () => {
  controller.peer?.close();
  controller.peer = null;
  controller.dataChannel?.close();
  controller.dataChannel = null;
  controller.audioSender = null;
  controller.localStream?.getTracks().forEach((track) => track.stop());
  controller.localStream = null;
  controller.localTrack = null;
  if (controller.audioDoneFallbackTimer) {
    window.clearTimeout(controller.audioDoneFallbackTimer);
    controller.audioDoneFallbackTimer = null;
  }
  controller.remoteStream = null;
  if (controller.audio) {
    controller.audio.pause();
    controller.audio.srcObject = null;
    controller.audio.remove();
    controller.audio = null;
  }
};

const stop = () => {
  cleanup();
  controller.state = "idle";
  controller.error = null;
  controller.storeId = null;
  controller.voice = null;
  controller.primaryLanguage = null;
  controller.secondaryLanguage = null;
  controller.storeLabel = null;
  controller.greeted = false;
  controller.continuous = false;
  controller.pendingGreeting = false;
  controller.pendingListenAfterGreet = false;
  controller.desiredMicEnabled = false;
  controller.needsPlaybackKick = false;
  notify();
};

const detachLocalAudio = () => {
  controller.audioSender?.replaceTrack(null).catch(() => {});
  controller.localStream?.getTracks().forEach((track) => track.stop());
  controller.localStream = null;
  controller.localTrack = null;
};

const attachLocalAudio = async () => {
  if (!controller.peer || controller.state !== "connected") return;
  if (!controller.audioSender) return;

  try {
    // Reuse the existing track if we already have one (prevents the audible "mic start/stop" beep).
    if (controller.localTrack && controller.localTrack.readyState !== "ended") {
      controller.localTrack.enabled = true;
      await controller.audioSender.replaceTrack(controller.localTrack);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    controller.localStream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Microphone track missing.");
    track.enabled = true;
    controller.localTrack = track;
    await controller.audioSender.replaceTrack(track);
  } catch (err) {
    controller.error = err instanceof Error ? err.message : "Microphone unavailable.";
    controller.desiredMicEnabled = false;
    notify();
  }
};

const setMicMuted = (muted: boolean) => {
  if (!controller.localTrack) return;
  controller.localTrack.enabled = !muted;
};

const setMicEnabled = (enabled: boolean) => {
  controller.desiredMicEnabled = enabled;
  if (!enabled) detachLocalAudio();
  else void attachLocalAudio();
  notify();
};

const sendRealtimeEvent = (payload: unknown) => {
  if (controller.dataChannel?.readyState !== "open") return false;
  try {
    controller.dataChannel.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn("Failed to send realtime event", error);
    return false;
  }
};

const sendGreeting = () => {
  if (controller.greeted) return;
  const label = controller.storeLabel?.trim() || "your store";
  const ok = sendRealtimeEvent({
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      instructions: `Greet the user with exactly: "Hello, welcome to ${label}." Then stop.`,
    },
  });
  if (!ok) {
    controller.pendingGreeting = true;
    return;
  }
  controller.pendingGreeting = false;
  controller.greeted = true;
  controller.pendingListenAfterGreet = true;
};

const sendVadConfig = () => {
  const isIOS = isIOSDevice();

  // iOS Safari tends to false-trigger VAD on tiny background noise and will then
  // "talk first" and sometimes switch languages due to garbage transcription.
  // We raise the threshold and require a bit more silence on iOS.
  const threshold = isIOS ? 0.55 : 0.45;
  const silence_duration_ms = isIOS ? 400 : 250;

  // Automatic back-and-forth: user talks, pauses, assistant responds.
  sendRealtimeEvent({
    type: "session.update",
    session: {
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold,
            prefix_padding_ms: 300,
            silence_duration_ms,
            create_response: true,
            interrupt_response: true,
          },
        },
      },
    },
  });
};

const clearAudioDoneFallback = () => {
  if (!controller.audioDoneFallbackTimer) return;
  window.clearTimeout(controller.audioDoneFallbackTimer);
  controller.audioDoneFallbackTimer = null;
};

const scheduleAudioDoneFallback = () => {
  // Some clients don't always emit response.audio.done reliably; response.done can arrive first.
  // We use a delayed fallback so iOS doesn't cut the greeting, but we still resume listening.
  clearAudioDoneFallback();
  // The greeting is short but on iOS we must not grab the mic while the greeting audio is still
  // coming out of the speaker. Use a longer delay for the greeting only.
  const delayMs = controller.pendingListenAfterGreet ? 2600 : 1200;
  controller.audioDoneFallbackTimer = window.setTimeout(() => {
    controller.audioDoneFallbackTimer = null;
    if (controller.pendingListenAfterGreet) {
      controller.pendingListenAfterGreet = false;
      controller.continuous = true;
      setMicEnabled(true);
      setMicMuted(false);
      return;
    }
    if (controller.continuous) {
      setMicMuted(false);
      return;
    }
    setMicEnabled(false);
  }, delayMs);
};

const start = async (
  storeId: string,
  voice?: string,
  primaryLanguage?: string,
  secondaryLanguage?: string,
) => {
  if (!storeId) return;
  if (controller.state === "connecting") return;

  const requestedVoice = voice?.trim() ? voice.trim() : null;
  const requestedPrimary = primaryLanguage?.trim() ? primaryLanguage.trim() : null;
  const requestedSecondary = secondaryLanguage?.trim()
    ? secondaryLanguage.trim()
    : null;

  if (
    controller.state === "connected" &&
    controller.storeId === storeId &&
    controller.voice === requestedVoice &&
    controller.primaryLanguage === requestedPrimary &&
    controller.secondaryLanguage === requestedSecondary
  )
    return;

  if (controller.state === "connected") {
    stop();
  }

  controller.state = "connecting";
  controller.error = null;
  controller.storeId = storeId;
  controller.voice = requestedVoice;
  controller.primaryLanguage = requestedPrimary;
  controller.secondaryLanguage = requestedSecondary;
  notify();

  try {
    const tokenResponse = await fetch("/api/realtime-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        voice: requestedVoice,
        primaryLanguage: requestedPrimary,
        secondaryLanguage: requestedSecondary,
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      const detail = tokenData?.details ? ` ${tokenData.details}` : "";
      throw new Error((tokenData?.error ?? "Unable to start voice.") + detail);
    }
    const token = tokenData?.value;
    if (!token) {
      throw new Error("Realtime token missing.");
    }
    const prompt = tokenData?.prompt ?? null;

    const pc = new RTCPeerConnection();
    controller.peer = pc;

    // Create an audio m-line up front without grabbing the mic yet.
    // We'll call getUserMedia only when the user taps the mic. This fixes "mic stuck on"
    // in Safari where track.enabled=false still shows the mic indicator.
    const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    controller.audioSender = transceiver.sender;

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      controller.remoteStream = stream;
      ensureAudioElement();
      kickPlayback();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        stop();
      }
    };

    controller.dataChannel = pc.createDataChannel("oai-events");
    controller.dataChannel.onopen = () => {
      sendVadConfig();
      if (prompt) {
        sendRealtimeEvent({
          type: "session.update",
          session: { prompt },
        });
      }
      if (controller.pendingGreeting) {
        sendGreeting();
      }
    };

    controller.dataChannel.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        const type = payload?.type;
        // While the assistant is speaking, keep the mic muted to avoid feedback loops.
        // Do not stop/recreate the mic stream each turn (that causes the distracting beep).
        if (type === "response.created" || type === "response.audio.start") {
          if (controller.desiredMicEnabled) setMicMuted(true);
        }

        // When a response finishes, continue listening automatically if voice mode is "on".
        // IMPORTANT (iPhone fix): prefer audio.done for mic state transitions.
        if (type === "response.done") {
          scheduleAudioDoneFallback();
        }

        if (type === "response.audio.done") {
          clearAudioDoneFallback();
          if (controller.pendingListenAfterGreet) {
            controller.pendingListenAfterGreet = false;
            controller.continuous = true;
            // Delay helps iOS settle the audio route before we grab the mic.
            const delayMs = isIOSDevice() ? 450 : 150;
            window.setTimeout(() => {
              setMicEnabled(true);
              setMicMuted(false);
            }, delayMs);
            return;
          }

          if (controller.continuous) {
            setMicMuted(false);
          } else {
            setMicEnabled(false);
          }
        }
      } catch (error) {
        console.warn("Realtime message parse failed", error);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp ?? "",
    });
    if (!sdpResponse.ok) {
      const text = await sdpResponse.text();
      throw new Error(text || "Realtime connection failed.");
    }
    const answer = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    controller.state = "connected";
    controller.error = null;
    if (controller.desiredMicEnabled) {
      void attachLocalAudio();
    }
    notify();
  } catch (err) {
    controller.error = err instanceof Error ? err.message : "Voice unavailable.";
    controller.state = "error";
    notify();
    cleanup();
  }
};

export function useRealtimeVoice(
  storeId: string,
  voice?: string,
  primaryLanguage?: string,
  secondaryLanguage?: string,
  storeLabel?: string,
) {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({
    state: controller.state,
    error: controller.error,
    storeId: controller.storeId,
    voice: controller.voice,
    primaryLanguage: controller.primaryLanguage,
    secondaryLanguage: controller.secondaryLanguage,
    listening: controller.desiredMicEnabled,
  });

  useEffect(() => {
    const handle: Subscriber = (next) => setSnapshot(next);
    controller.subscribers.add(handle);
    return () => {
      controller.subscribers.delete(handle);
    };
  }, []);

  const supportsRealtime =
    typeof window !== "undefined" &&
    typeof RTCPeerConnection !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const actions = useMemo(
    () => ({
      start: () => {
        controller.storeLabel = storeLabel?.trim() ? storeLabel.trim() : null;
        start(storeId, voice, primaryLanguage, secondaryLanguage);
      },
      stop: () => stop(),
      toggleListening: () => {
        controller.storeLabel = storeLabel?.trim() ? storeLabel.trim() : null;
        prewarmOutput();
        kickPlayback();

        if (controller.state === "connecting") {
          stop();
          return;
        }

        if (controller.state !== "connected") {
          // First tap: greet, then start an automatic back-and-forth conversation.
          controller.continuous = true;
          controller.pendingGreeting = !controller.greeted;
          controller.pendingListenAfterGreet = !controller.greeted;
          setMicEnabled(controller.greeted);
          start(storeId, voice, primaryLanguage, secondaryLanguage);
          return;
        }

        if (!controller.greeted) {
          controller.continuous = true;
          setMicEnabled(false);
          controller.pendingGreeting = true;
          controller.pendingListenAfterGreet = true;
          sendGreeting();
          return;
        }

        // Connected + greeted:
        // - tap once to start voice mode (auto back-and-forth)
        // - tap again to turn it off (end the session)
        if (!controller.continuous) {
          controller.continuous = true;
          setMicEnabled(true);
          return;
        }

        stop();
      },
      resumeOutput: () => {
        prewarmOutput();
        kickPlayback();
      },
      mute: () => setMicEnabled(false),
      unmute: () => setMicEnabled(true),
    }),
    [storeId, voice, primaryLanguage, secondaryLanguage, storeLabel],
  );

  useEffect(() => {
    if (
      snapshot.state !== "connected" ||
      (!storeId && !voice && !primaryLanguage && !secondaryLanguage)
    )
      return;
    if (
      snapshot.voice !== (voice?.trim() || null) ||
      snapshot.primaryLanguage !== (primaryLanguage?.trim() || null) ||
      snapshot.secondaryLanguage !== (secondaryLanguage?.trim() || null)
    ) {
      start(storeId, voice, primaryLanguage, secondaryLanguage);
    }
  }, [
    storeId,
    voice,
    primaryLanguage,
    secondaryLanguage,
    snapshot.state,
    snapshot.voice,
    snapshot.primaryLanguage,
    snapshot.secondaryLanguage,
  ]);

  return {
    supportsRealtime,
    state: snapshot.state,
    error: snapshot.error,
    voice: snapshot.voice,
    primaryLanguage: snapshot.primaryLanguage,
    secondaryLanguage: snapshot.secondaryLanguage,
    listening: snapshot.listening,
    ...actions,
  };
}
