"use client";

import { useEffect, useMemo, useState } from "react";

export type RealtimeVoiceState = "idle" | "connecting" | "connected" | "error";

export type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error";

export type VoiceUiState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "wake"
  | "error";

export type VoiceMode = "off" | "active" | "wake";

export type VoiceDebugEvent = {
  at: number;
  state: VoiceUiState;
  event: string;
  detail?: string;
};

type VoiceTopic = "sales" | "surveillance" | "other";

type AssistantHistoryMessage = { role: "user" | "assistant"; content: string };

type VoiceSnapshot = {
  state: RealtimeVoiceState;
  voiceState: VoiceState;
  uiState: VoiceUiState;
  mode: VoiceMode;
  error: string | null;
  storeId: string | null;
  voice: string | null;
  primaryLanguage: string | null;
  secondaryLanguage: string | null;
  listening: boolean;
  wakePhraseEnabled: boolean;
  lastTranscript: string | null;
  confirmTranscript: string | null;
  debug: VoiceDebugEvent[];
};

type Subscriber = (snapshot: VoiceSnapshot) => void;

// Used to "unlock" audio playback on iOS Safari (must be triggered by a user gesture).
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

const WAKE_PHRASE = "hey iron hand";

const controller = {
  state: "idle" as RealtimeVoiceState,
  voiceState: "idle" as VoiceState,
  uiState: "idle" as VoiceUiState,
  mode: "off" as VoiceMode,
  error: null as string | null,
  storeId: null as string | null,
  voice: null as string | null,
  primaryLanguage: null as string | null,
  secondaryLanguage: null as string | null,
  storeLabel: null as string | null,
  wakePhraseEnabled: false,
  vadConfig: null as
    | {
        threshold: number;
        prefix_padding_ms: number;
        silence_duration_ms: number;
      }
    | null,

  desiredMicEnabled: false,
  userSpeaking: false,
  responseInFlight: false,
  awaitingTranscript: false,
  listeningStartedAt: 0,
  lastSpeechStoppedAt: 0,
  lastTranscript: null as string | null,
  confirmTranscript: null as string | null,
  confirmItemId: null as string | null,
  pendingTopicTranscript: null as string | null,
  lastResponseCreateAt: 0,

  peer: null as RTCPeerConnection | null,
  dataChannel: null as RTCDataChannel | null,
  audioSender: null as RTCRtpSender | null,
  localStream: null as MediaStream | null,
  localTrack: null as MediaStreamTrack | null,
  remoteStream: null as MediaStream | null,
  audio: null as HTMLAudioElement | null,
  needsPlaybackKick: false,
  audioCtx: null as AudioContext | null,
  transcriptTimer: null as number | null,
  listeningSafetyTimer: null as number | null,
  processingSafetyTimer: null as number | null,
  assistantAbortController: null as AbortController | null,
  assistantRequestSeq: 0,
  activeAssistantRequestSeq: 0,
  assistantHistory: [] as AssistantHistoryMessage[],
  assistantHistoryStoreId: null as string | null,

  debug: [] as VoiceDebugEvent[],
  subscribers: new Set<Subscriber>(),
};

const pushDebug = (event: string, detail?: string) => {
  controller.debug.push({
    at: Date.now(),
    state: controller.uiState,
    event,
    ...(detail ? { detail } : {}),
  });
  if (controller.debug.length > 180) controller.debug.splice(0, controller.debug.length - 180);
};

const notify = () => {
  const snapshot: VoiceSnapshot = {
    state: controller.state,
    voiceState: controller.voiceState,
    uiState: controller.uiState,
    mode: controller.mode,
    error: controller.error,
    storeId: controller.storeId,
    voice: controller.voice,
    primaryLanguage: controller.primaryLanguage,
    secondaryLanguage: controller.secondaryLanguage,
    listening: controller.desiredMicEnabled,
    wakePhraseEnabled: controller.wakePhraseEnabled,
    lastTranscript: controller.lastTranscript,
    confirmTranscript: controller.confirmTranscript,
    debug: controller.debug.slice(),
  };
  controller.subscribers.forEach((cb) => cb(snapshot));
};

const setVoiceState = (next: VoiceState, event: string, detail?: string) => {
  controller.voiceState = next;
  if (next === "idle") {
    controller.uiState = controller.state === "connected" ? "ready" : "idle";
  } else if (next === "listening") {
    controller.uiState = controller.mode === "wake" ? "wake" : "listening";
  } else if (next === "processing") {
    controller.uiState = "thinking";
  } else if (next === "speaking") {
    controller.uiState = "speaking";
  } else {
    controller.uiState = "error";
  }
  pushDebug(event, detail);
  notify();
};

const setUiState = (next: VoiceUiState, event: string, detail?: string) => {
  controller.uiState = next;
  pushDebug(event, detail);
  notify();
};

const ensureAudioElement = () => {
  if (controller.audio) return;
  const audio = document.createElement("audio");
  audio.setAttribute("playsinline", "true");
  audio.autoplay = false;
  audio.muted = false;
  audio.volume = 0.7;
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
  // iOS Safari often blocks playback if play() isn't called from a user gesture.
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

const ensureAudioContext = () => {
  if (controller.audioCtx) return controller.audioCtx;
  try {
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    controller.audioCtx = new Ctor();
    return controller.audioCtx;
  } catch {
    return null;
  }
};

const playEarcon = (variant: "ack" | "wake" | "error" = "ack") => {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // ignore
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const base = variant === "error" ? 220 : variant === "wake" ? 392 : 330;
    osc.frequency.setValueAtTime(base, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    // ignore
  }

  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as any).vibrate(variant === "error" ? 40 : 15);
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

  controller.remoteStream = null;
  if (controller.audio) {
    controller.audio.pause();
    controller.audio.srcObject = null;
    controller.audio.remove();
    controller.audio = null;
  }
  if (controller.audioCtx) {
    try {
      controller.audioCtx.close();
    } catch {
      // ignore
    }
    controller.audioCtx = null;
  }
  if (controller.transcriptTimer) {
    window.clearTimeout(controller.transcriptTimer);
    controller.transcriptTimer = null;
  }
  if (controller.listeningSafetyTimer) {
    window.clearTimeout(controller.listeningSafetyTimer);
    controller.listeningSafetyTimer = null;
  }
  if (controller.processingSafetyTimer) {
    window.clearTimeout(controller.processingSafetyTimer);
    controller.processingSafetyTimer = null;
  }
  if (controller.assistantAbortController) {
    controller.assistantAbortController.abort();
    controller.assistantAbortController = null;
  }
};

const stop = () => {
  cleanup();
  controller.state = "idle";
  controller.voiceState = "idle";
  controller.uiState = "idle";
  controller.mode = "off";
  controller.error = null;
  controller.storeId = null;
  controller.voice = null;
  controller.primaryLanguage = null;
  controller.secondaryLanguage = null;
  controller.storeLabel = null;
  controller.desiredMicEnabled = false;
  controller.userSpeaking = false;
  controller.responseInFlight = false;
  controller.awaitingTranscript = false;
  controller.listeningStartedAt = 0;
  controller.lastSpeechStoppedAt = 0;
  controller.lastResponseCreateAt = 0;
  controller.needsPlaybackKick = false;
  controller.lastTranscript = null;
  controller.confirmTranscript = null;
  controller.confirmItemId = null;
  controller.pendingTopicTranscript = null;
  controller.transcriptTimer = null;
  controller.activeAssistantRequestSeq = 0;
  controller.assistantHistory = [];
  controller.assistantHistoryStoreId = null;
  pushDebug("stop", "all");
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

const detachLocalAudio = () => {
  controller.audioSender?.replaceTrack(null).catch(() => {});
  if (controller.localTrack) controller.localTrack.enabled = false;
};

const attachLocalAudio = async () => {
  if (!controller.peer || controller.state !== "connected") return;
  if (!controller.audioSender) return;

  try {
    // Reuse existing track to avoid the audible "mic start/stop" beep.
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
    controller.mode = "off";
    controller.state = "error";
    setUiState("error", "mic.error", controller.error ?? undefined);
  }
};

const setMicEnabled = (enabled: boolean) => {
  controller.desiredMicEnabled = enabled;
  if (!enabled) detachLocalAudio();
  else void attachLocalAudio();
  notify();
};

const normalizeTranscript = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const looksLikeFiller = (text: string) => {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return true;
  if (normalized.length < 3) return true;
  if (/^(um+|uh+|erm+|hmm+|mm+|ah+|eh+)$/.test(normalized)) return true;
  return false;
};

const detectVoiceTopic = (text: string): { topic: VoiceTopic; explicit: boolean } => {
  const normalized = text.toLowerCase();
  const hasSales =
    /\b(sales|gross|net|profit|margin|pos|transaction|transactions|report|reports|shift|totals?)\b/.test(
      normalized,
    ) ||
    /\b(lotto|lottery|scratchers?|scr|p\/o|payout|atm|cash|deposit)\b/.test(normalized) ||
    /\b(liquor|beer|wine|cig|cigs|cigarettes|tobacco|gas|grocery)\b/.test(normalized);
  const hasSurveillance =
    /\b(surveillance|camera|incident|theft|stolen|robbery|fight|police|footage|investigation|case|cases)\b/.test(
      normalized,
    );

  if (hasSurveillance) return { topic: "surveillance", explicit: true };
  if (hasSales) {
    const explicit =
      /\b(sales|gross|net|profit|margin|pos)\b/.test(normalized) ||
      /\b(surveillance|camera|footage)\b/.test(normalized);
    return { topic: "sales", explicit };
  }
  return { topic: "other", explicit: false };
};

const parseTopicSelection = (text: string): VoiceTopic | null => {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (/^(sales|sale)$/.test(normalized)) return "sales";
  if (/^(surveillance|camera|cameras|footage)$/.test(normalized)) return "surveillance";
  if (/^(other|something else|else)$/.test(normalized)) return "other";
  return null;
};

const looksLikeClearUserIntent = (text: string) => {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length < 5) return false;
  if (
    /\b(what|why|how|when|where|who|show|tell|give|pull|check|find|explain|summarize|compare|open|latest|today|yesterday)\b/i.test(
      normalized,
    )
  )
    return true;
  const topic = detectVoiceTopic(normalized);
  return topic.topic !== "other";
};

const classifyIntent = (text: string): "store_related" | "off_topic" => {
  const normalized = text.toLowerCase();
  if (
    /\b(sales|gross|net|profit|margin|pos|transactions?|items?|inventory|invoice|orders?|hours?|shift|report|reports|staff|staffing|payroll|customers?)\b/.test(
      normalized,
    )
  )
    return "store_related";
  if (
    /\b(surveillance|camera|incident|theft|stolen|robbery|fight|police|footage|notes?)\b/.test(
      normalized,
    )
  )
    return "store_related";
  if (/\b(lotto|lottery|scratchers?|scr|p\/o|payout|atm|cash|deposit)\b/.test(normalized))
    return "store_related";
  if (/\b(liquor|beer|cig|cigs|cigarettes|tobacco|gas)\b/.test(normalized))
    return "store_related";
  return "off_topic";
};

const pickLanguage = (text: string) => {
  // We only route between Primary + Secondary; everything else defaults to Primary.
  const primary = controller.primaryLanguage ?? "English";
  const secondary = controller.secondaryLanguage ?? "";
  const hasSecondary = Boolean(secondary.trim());
  const normalized = text.trim();
  if (!hasSecondary) return primary;
  // Punjabi (Gurmukhi) unicode range.
  if (/[\u0A00-\u0A7F]/.test(normalized)) return secondary;
  // Heuristic for romanized Punjabi.
  if (/\b(haan|nahin|nahi|ki|kida|kidda|kiven|tusi|thoda|bahut)\b/i.test(normalized))
    return secondary;
  return primary;
};

const extractInputTranscript = (payload: any): string => {
  // Common Realtime shapes:
  // - { type: "conversation.item.input_audio_transcription.completed", transcript: "..." }
  // - { type: "...", transcription: { text: "..." } }
  // - { type: "...", item: { content: [{ transcript: "..." }] } }
  return normalizeTranscript(
    payload?.transcript ??
      payload?.text ??
      payload?.transcription?.text ??
      payload?.item?.content?.[0]?.transcript ??
      payload?.item?.content?.[0]?.text ??
      "",
  );
};

const normalizeWakePhrase = (text: string) =>
  text
    .toLowerCase()
    // Wake phrase matching is English-only; keep this ASCII-safe for Safari.
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripWakePhrase = (text: string) => {
  const normalized = normalizeWakePhrase(text);
  const idx = normalized.indexOf(WAKE_PHRASE);
  if (idx === -1) return { hit: false, remainder: text.trim() };
  const remainder = normalized.slice(idx + WAKE_PHRASE.length).trim();
  return { hit: true, remainder };
};

const shouldConfirmTranscript = (text: string) => {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length < 4) return false;
  if (normalized.length < 12 && classifyIntent(normalized) === "off_topic") return true;
  return false;
};

const cancelAssistantSpeech = () => {
  // Best-effort: cancel server response + clear output buffer, and locally cut audio.
  sendRealtimeEvent({ type: "response.cancel" });
  sendRealtimeEvent({ type: "output_audio_buffer.clear" });
  controller.activeAssistantRequestSeq = 0;
  if (controller.assistantAbortController) {
    controller.assistantAbortController.abort();
    controller.assistantAbortController = null;
  }
  if (controller.audio) {
    try {
      controller.audio.pause();
    } catch {
      // ignore
    }
    controller.audio.muted = true;
    window.setTimeout(() => {
      if (!controller.audio) return;
      controller.audio.muted = false;
      kickPlayback();
    }, 90);
  }
};

const stopListening = (event: string, detail?: string) => {
  if (controller.listeningSafetyTimer) {
    window.clearTimeout(controller.listeningSafetyTimer);
    controller.listeningSafetyTimer = null;
  }
  if (controller.transcriptTimer) {
    window.clearTimeout(controller.transcriptTimer);
    controller.transcriptTimer = null;
  }
  controller.awaitingTranscript = false;
  controller.userSpeaking = false;
  controller.listeningStartedAt = 0;
  controller.lastSpeechStoppedAt = 0;
  setMicEnabled(false);
  setVoiceState("idle", event, detail);
};

const commitListening = (event: string, detail?: string) => {
  if (controller.listeningSafetyTimer) {
    window.clearTimeout(controller.listeningSafetyTimer);
    controller.listeningSafetyTimer = null;
  }
  if (controller.transcriptTimer) {
    window.clearTimeout(controller.transcriptTimer);
    controller.transcriptTimer = null;
  }

  controller.awaitingTranscript = true;
  controller.userSpeaking = false;
  controller.listeningStartedAt = 0;
  controller.lastSpeechStoppedAt = Date.now();

  // Freeze mic while we wait for the final transcript.
  setMicEnabled(false);
  // Best-effort: force an endpoint if the server supports manual commit.
  sendRealtimeEvent({ type: "input_audio_buffer.commit" });

  setVoiceState("processing", event, detail);
  startProcessingTimeout();

  controller.transcriptTimer = window.setTimeout(() => {
    controller.transcriptTimer = null;
    if (!controller.awaitingTranscript) return;
    controller.awaitingTranscript = false;
    controller.error = "Didn't catch that.";
    stopListening("transcript.timeout.manual");
  }, 3500);
};

const startProcessingTimeout = () => {
  if (controller.processingSafetyTimer) window.clearTimeout(controller.processingSafetyTimer);
  controller.processingSafetyTimer = window.setTimeout(() => {
    controller.processingSafetyTimer = null;
    if (controller.voiceState !== "processing") return;
    if (controller.assistantAbortController) controller.assistantAbortController.abort();
    controller.assistantAbortController = null;
    controller.error = "Assistant timed out.";
    setVoiceState("error", "processing.timeout");
    window.setTimeout(() => {
      if (controller.voiceState === "error") setVoiceState("idle", "processing.reset");
    }, 450);
  }, 25000);
};

const startListening = async () => {
  if (controller.voiceState !== "idle") {
    pushDebug("listening.skip", `state=${controller.voiceState}`);
    return;
  }

  controller.error = null;
  notify();

  prewarmOutput();
  kickPlayback();

  if (controller.state !== "connected") {
    setUiState("connecting", "listening.connect");
    await connect(
      controller.storeId ?? "",
      controller.voice ?? undefined,
      controller.primaryLanguage ?? undefined,
      controller.secondaryLanguage ?? undefined,
    );
  }

  if (controller.state !== "connected") {
    controller.error = controller.error ?? "Voice unavailable.";
    setVoiceState("error", "listening.connect_failed");
    window.setTimeout(() => {
      if (controller.voiceState === "error") setVoiceState("idle", "listening.reset");
    }, 450);
    return;
  }

  controller.awaitingTranscript = false;
  controller.confirmTranscript = null;
  controller.confirmItemId = null;
  controller.pendingTopicTranscript = null;

  setMicEnabled(true);
  playEarcon("ack");
  controller.listeningStartedAt = Date.now();
  setVoiceState("listening", "listening.start");

  if (controller.listeningSafetyTimer) window.clearTimeout(controller.listeningSafetyTimer);
  controller.listeningSafetyTimer = window.setTimeout(() => {
    controller.listeningSafetyTimer = null;
    if (controller.voiceState !== "listening") return;
    controller.error = "Didn't catch that.";
    stopListening("listening.timeout");
  }, 10000);
};

const speakText = (text: string) => {
  const trimmed = normalizeTranscript(text);
  if (!trimmed) return false;
  const ok = sendRealtimeEvent({
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      instructions:
        "You are a voice assistant. Speak the following message naturally. " +
        "Do not add new facts. Do not change languages. Keep it concise.\n\n" +
        trimmed,
    },
  });
  if (!ok) return false;
  controller.responseInFlight = true;
  controller.lastResponseCreateAt = Date.now();
  return true;
};

const requestStoreAssistantResponse = async (transcript: string) => {
  const text = normalizeTranscript(transcript);
  if (!text) return false;
  if (controller.responseInFlight) {
    // Legit in-flight while we're fetching the assistant response.
    const fetchInFlight = Boolean(controller.assistantAbortController);
    if (fetchInFlight) {
      pushDebug("response.skip", "in_flight");
      return false;
    }

    // If we're speaking and the user produced a transcript, barge-in and proceed.
    if (controller.voiceState === "speaking") {
      cancelAssistantSpeech();
      controller.responseInFlight = false;
      pushDebug("response.barge_in", "cancel_speech");
    } else {
      // Stale lock (shouldn't happen, but prevents "works once then stuck").
      controller.responseInFlight = false;
      pushDebug("response.fixup", `stale_in_flight state=${controller.voiceState}`);
    }
  }
  if (Date.now() - controller.lastResponseCreateAt < 650) {
    pushDebug("response.skip", "debounce");
    if (controller.voiceState === "processing") setVoiceState("idle", "assistant.debounce");
    return false;
  }

  const storeId = controller.storeId ?? "";
  if (!storeId) {
    if (controller.voiceState === "processing") setVoiceState("idle", "assistant.no_store");
    return false;
  }

  // Reset voice session history when store changes (prevents cross-store confusion).
  if (controller.assistantHistoryStoreId !== storeId) {
    controller.assistantHistory = [];
    controller.assistantHistoryStoreId = storeId;
  }

  controller.responseInFlight = true;
  const seq = (controller.assistantRequestSeq += 1);
  controller.activeAssistantRequestSeq = seq;
  pushDebug("assistant.fetch.start", text.slice(0, 80));

  try {
    if (controller.assistantAbortController) controller.assistantAbortController.abort();
    controller.assistantAbortController = new AbortController();
    startProcessingTimeout();
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({
        storeId,
        message: text,
        mode: "voice",
        history: controller.assistantHistory.slice(-8),
        primaryLanguage: controller.primaryLanguage ?? undefined,
        secondaryLanguage: controller.secondaryLanguage ?? undefined,
      }),
      signal: controller.assistantAbortController.signal,
    });
    const raw = await res.text().catch(() => "");
    const data = (() => {
      if (!raw) return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    })();
    if (!res.ok) {
      const msg =
        (data as any)?.error ??
        (raw && raw.trim() ? raw.trim().slice(0, 180) : null) ??
        `Assistant unavailable (HTTP ${res.status}).`;
      pushDebug("assistant.fetch.error", `http=${res.status} ${String(msg).slice(0, 120)}`);
      controller.responseInFlight = false;
      controller.error = String(msg);
      setVoiceState("error", "assistant.fetch.error");
      window.setTimeout(() => {
        if (controller.voiceState === "error") setVoiceState("idle", "assistant.fetch.reset");
      }, 450);
      playEarcon("error");
      return false;
    }

    if (controller.activeAssistantRequestSeq !== seq) {
      controller.responseInFlight = false;
      pushDebug("assistant.fetch.stale", "ignored");
      return false;
    }

    const answer = normalizeTranscript((data as any)?.reply ?? "");
    if (!answer) {
      controller.responseInFlight = false;
      setVoiceState("idle", "assistant.empty");
      return false;
    }

    controller.assistantHistory.push({ role: "user", content: text });
    controller.assistantHistory.push({ role: "assistant", content: answer });
    if (controller.assistantHistory.length > 16) {
      controller.assistantHistory.splice(0, controller.assistantHistory.length - 16);
    }

    pushDebug("assistant.fetch.ok", answer.slice(0, 80));
    controller.responseInFlight = false;
    if (controller.processingSafetyTimer) {
      window.clearTimeout(controller.processingSafetyTimer);
      controller.processingSafetyTimer = null;
    }
    // Transition: PROCESSING -> SPEAKING
    setVoiceState("speaking", "assistant.speak");
    const spoke = speakText(answer);
    if (!spoke) {
      controller.error = "Voice output failed.";
      setVoiceState("error", "tts.create_failed");
      window.setTimeout(() => {
        if (controller.voiceState === "error") setVoiceState("idle", "tts.reset");
      }, 450);
    }
    return spoke;
  } catch (err) {
    controller.responseInFlight = false;
    pushDebug("assistant.fetch.exception", err instanceof Error ? err.message : "error");
    controller.error = err instanceof Error ? err.message : "Assistant unavailable.";
    setVoiceState("error", "assistant.fetch.exception");
    window.setTimeout(() => {
      if (controller.voiceState === "error") setVoiceState("idle", "assistant.fetch.reset");
    }, 450);
    playEarcon("error");
    return false;
  } finally {
    if (controller.assistantAbortController) {
      controller.assistantAbortController = null;
    }
  }
};

const sendVadConfig = () => {
  const isIOS = isIOSDevice();
  const base = controller.vadConfig ?? {
    threshold: 0.62,
    prefix_padding_ms: 300,
    silence_duration_ms: 1100,
  };

  // More conservative endpointing to avoid early replies / random replies on small noises.
  const threshold = Math.min(0.9, Math.max(0.1, base.threshold + (isIOS ? 0.04 : 0)));
  const silence_duration_ms = Math.min(3000, Math.max(400, base.silence_duration_ms + (isIOS ? 150 : 0)));
  const prefix_padding_ms = Math.min(1200, Math.max(0, base.prefix_padding_ms));

  sendRealtimeEvent({
    type: "session.update",
    session: {
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold,
            prefix_padding_ms,
            silence_duration_ms,
            create_response: false,
            interrupt_response: true,
          },
        },
      },
    },
  });
};

const connect = async (
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

  if (controller.state === "connected") stop();

  controller.state = "connecting";
  controller.error = null;
  controller.storeId = storeId;
  controller.voice = requestedVoice;
  controller.primaryLanguage = requestedPrimary;
  controller.secondaryLanguage = requestedSecondary;
  controller.assistantHistory = [];
  controller.assistantHistoryStoreId = storeId;
  setUiState("connecting", "connect.start");

  try {
    const tokenResponse = await fetch("/api/realtime-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({
        storeId,
        voice: requestedVoice,
        primaryLanguage: requestedPrimary,
        secondaryLanguage: requestedSecondary,
      }),
    });
    const raw = await tokenResponse.text().catch(() => "");
    const tokenData = (() => {
      if (!raw) return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    })();
    if (!tokenResponse.ok) {
      const detail =
        (tokenData as any)?.details
          ? ` ${(tokenData as any).details}`
          : raw && raw.trim()
            ? ` ${raw.trim().slice(0, 180)}`
            : "";
      throw new Error(((tokenData as any)?.error ?? "Unable to start voice.") + detail);
    }
    const token = (tokenData as any)?.value;
    if (!token) throw new Error("Realtime token missing.");
    const prompt = (tokenData as any)?.prompt ?? null;
    const vad = (tokenData as any)?.vad ?? null;
    if (
      vad &&
      typeof vad.threshold === "number" &&
      typeof vad.prefix_padding_ms === "number" &&
      typeof vad.silence_duration_ms === "number"
    ) {
      controller.vadConfig = {
        threshold: vad.threshold,
        prefix_padding_ms: vad.prefix_padding_ms,
        silence_duration_ms: vad.silence_duration_ms,
      };
    } else {
      controller.vadConfig = null;
    }

    const pc = new RTCPeerConnection();
    controller.peer = pc;

    // Create audio m-line up front without grabbing mic yet.
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
        controller.error = "Voice disconnected.";
        controller.state = "error";
        setUiState("error", "pc.disconnected");
        cleanup();
      }
    };

    controller.dataChannel = pc.createDataChannel("oai-events");
    controller.dataChannel.onopen = () => {
      sendVadConfig();
      if (prompt) sendRealtimeEvent({ type: "session.update", session: { prompt } });
      setUiState("ready", "connect.channel.open");
    };

    controller.dataChannel.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        const type = payload?.type;

        if (type === "input_audio_buffer.speech_started") {
          controller.userSpeaking = true;
          controller.awaitingTranscript = true;
          controller.confirmTranscript = null;
          controller.confirmItemId = null;
          if (controller.listeningSafetyTimer) {
            window.clearTimeout(controller.listeningSafetyTimer);
            controller.listeningSafetyTimer = null;
          }
          if (controller.transcriptTimer) {
            window.clearTimeout(controller.transcriptTimer);
            controller.transcriptTimer = null;
          }

          if (controller.voiceState === "speaking") {
            // Optional barge-in (only if mic is active): cancel output and keep listening.
            cancelAssistantSpeech();
            controller.responseInFlight = false;
            setVoiceState("listening", "barge_in.speech_started");
          } else if (controller.mode === "wake") {
            setUiState("wake", "wake.speech_started");
          } else {
            setVoiceState("listening", "vad.speech_started");
          }
        }

        if (type === "input_audio_buffer.speech_stopped") {
          controller.userSpeaking = false;
          controller.lastSpeechStoppedAt = Date.now();
          if (controller.transcriptTimer) window.clearTimeout(controller.transcriptTimer);
          controller.transcriptTimer = window.setTimeout(() => {
            controller.transcriptTimer = null;
            if (!controller.awaitingTranscript) return;
            controller.awaitingTranscript = false;
            controller.error = "Didn't catch that.";
            stopListening("transcript.timeout");
          }, 3500);
          if (controller.mode === "wake") setUiState("wake", "wake.speech_stopped");
          else {
            // Transition: LISTENING -> PROCESSING (freeze mic before we call AI).
            setMicEnabled(false);
            setVoiceState("processing", "vad.speech_stopped");
            startProcessingTimeout();
          }
        }

        if (
          typeof type === "string" &&
          type.includes("input_audio_transcription") &&
          type.endsWith("completed")
        ) {
          const transcript = extractInputTranscript(payload);
          const itemId =
            String(payload?.item_id ?? payload?.item?.id ?? payload?.conversation_item_id ?? "") ||
            null;
          controller.lastTranscript = transcript || null;
          notify();

          if (!controller.awaitingTranscript) {
            pushDebug("transcript.ignored", "not awaiting");
            return;
          }
          controller.awaitingTranscript = false;
          if (controller.transcriptTimer) {
            window.clearTimeout(controller.transcriptTimer);
            controller.transcriptTimer = null;
          }

          // Guard: only respond when we have a clear endpoint (speech_stopped) recently.
          if (!controller.lastSpeechStoppedAt || Date.now() - controller.lastSpeechStoppedAt > 5000) {
            controller.error = "Didn't catch that.";
            stopListening("transcript.no_endpoint");
            return;
          }

          if (looksLikeFiller(transcript)) {
            controller.error = "Didn't catch that.";
            stopListening("transcript.filler");
            return;
          }

	          if (controller.mode === "wake") {
	            const { hit, remainder } = stripWakePhrase(transcript);
	            if (!hit) {
	              setUiState("wake", "wake.miss", transcript.slice(0, 80));
              return;
            }
            playEarcon("wake");
            controller.mode = "active";
	            if (!remainder) {
	              setVoiceState("listening", "wake.hit");
	              return;
	            }
	            setVoiceState("processing", "wake.hit.respond");
	            void requestStoreAssistantResponse(remainder);
	            return;
	          }

          if (shouldConfirmTranscript(transcript)) {
            controller.confirmTranscript = transcript;
            controller.confirmItemId = itemId;
            setVoiceState("idle", "transcript.confirm", transcript);
            return;
          }

          setVoiceState("processing", "transcript.commit");
          void requestStoreAssistantResponse(transcript);
	        }

        if (type === "response.audio.start") {
          controller.responseInFlight = true;
          setVoiceState("speaking", "response.audio.start");
        }

        if (type === "response.audio.done" || type === "response.done") {
          controller.responseInFlight = false;
          // Transition: SPEAKING -> IDLE (tap-to-talk never auto-restarts listening).
          setMicEnabled(false);
          if (controller.processingSafetyTimer) {
            window.clearTimeout(controller.processingSafetyTimer);
            controller.processingSafetyTimer = null;
          }
          if (controller.mode === "wake") {
            controller.voiceState = "listening";
            setUiState("wake", "response.done.wake");
          } else {
            setVoiceState("idle", "response.done");
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
    if (controller.desiredMicEnabled) void attachLocalAudio();
    setUiState("ready", "connect.done");
  } catch (err) {
    controller.error = err instanceof Error ? err.message : "Voice unavailable.";
    controller.state = "error";
    setUiState("error", "connect.error", controller.error ?? undefined);
    cleanup();
  } finally {
    notify();
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
    voiceState: controller.voiceState,
    uiState: controller.uiState,
    mode: controller.mode,
    error: controller.error,
    storeId: controller.storeId,
    voice: controller.voice,
    primaryLanguage: controller.primaryLanguage,
    secondaryLanguage: controller.secondaryLanguage,
    listening: controller.desiredMicEnabled,
    wakePhraseEnabled: controller.wakePhraseEnabled,
    lastTranscript: controller.lastTranscript,
    confirmTranscript: controller.confirmTranscript,
    debug: controller.debug.slice(),
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
        void connect(storeId, voice, primaryLanguage, secondaryLanguage);
      },
      prewarm: () => {
        controller.storeLabel = storeLabel?.trim() ? storeLabel.trim() : null;
        prewarmOutput();
        ensureAudioContext();
        kickPlayback();
        if (controller.state === "connected" || controller.state === "connecting") return;
        void connect(storeId, voice, primaryLanguage, secondaryLanguage);
      },
      stop: () => stop(),
      toggleListening: () => {
        controller.storeLabel = storeLabel?.trim() ? storeLabel.trim() : null;
        prewarmOutput();
        ensureAudioContext();
        kickPlayback();

        if (controller.state === "connecting") {
          stop();
          return;
        }

        // Tap-to-talk: toggle only idle <-> listening.
        // If speaking, tap cancels TTS and immediately starts listening.
        if (controller.voiceState === "speaking") {
          cancelAssistantSpeech();
          controller.responseInFlight = false;
          controller.mode = "off";
          // Ensure the controller knows the requested store params before we start.
          controller.storeId = storeId;
          controller.voice = voice?.trim() ? voice.trim() : null;
          controller.primaryLanguage = primaryLanguage?.trim() ? primaryLanguage.trim() : null;
          controller.secondaryLanguage = secondaryLanguage?.trim() ? secondaryLanguage.trim() : null;
          void startListening();
          return;
        }

        // If processing, tap cancels and returns to idle.
        if (controller.voiceState === "processing") {
          if (controller.assistantAbortController) controller.assistantAbortController.abort();
          controller.assistantAbortController = null;
          controller.responseInFlight = false;
          controller.error = null;
          stopListening("processing.cancel");
          return;
        }

        if (controller.voiceState === "listening") {
          const longEnoughToCommit =
            controller.listeningStartedAt > 0 &&
            Date.now() - controller.listeningStartedAt > 750;
          const shouldCommit = controller.userSpeaking || controller.awaitingTranscript || longEnoughToCommit;
          if (shouldCommit) commitListening("mic.toggle.commit");
          else stopListening("mic.toggle.off");
          return;
        }

        controller.mode = "off";
        controller.storeId = storeId;
        controller.voice = voice?.trim() ? voice.trim() : null;
        controller.primaryLanguage = primaryLanguage?.trim() ? primaryLanguage.trim() : null;
        controller.secondaryLanguage = secondaryLanguage?.trim() ? secondaryLanguage.trim() : null;
        void startListening();
      },
      armWakePhrase: () => {
        controller.storeLabel = storeLabel?.trim() ? storeLabel.trim() : null;
        prewarmOutput();
        ensureAudioContext();
        kickPlayback();
        if (controller.mode !== "off") return;
        controller.mode = "wake";
        setUiState("connecting", "wake.arm");
        void connect(storeId, voice, primaryLanguage, secondaryLanguage).then(() => {
          setMicEnabled(true);
          playEarcon("ack");
          controller.voiceState = "listening";
          setUiState("wake", "wake.armed");
        });
      },
      resumeOutput: () => {
        prewarmOutput();
        kickPlayback();
      },
      mute: () => setMicEnabled(false),
      unmute: () => setMicEnabled(true),
      setWakePhraseEnabled: (enabled: boolean) => {
        controller.wakePhraseEnabled = enabled;
        pushDebug("wake.toggle", enabled ? "on" : "off");
        notify();
      },
      confirmHeard: () => {
        if (!controller.confirmTranscript) return;
        const transcript = controller.confirmTranscript;
        controller.confirmTranscript = null;
        controller.confirmItemId = null;
        setVoiceState("processing", "confirm.ok", transcript);
        void requestStoreAssistantResponse(transcript);
      },
      retryHeard: () => {
        if (controller.confirmItemId) {
          sendRealtimeEvent({ type: "conversation.item.delete", item_id: controller.confirmItemId });
        }
        controller.confirmTranscript = null;
        controller.confirmItemId = null;
        controller.mode = "off";
        void startListening();
      },
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
      void connect(storeId, voice, primaryLanguage, secondaryLanguage);
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
    uiState: snapshot.uiState,
    mode: snapshot.mode,
    error: snapshot.error,
    voice: snapshot.voice,
    primaryLanguage: snapshot.primaryLanguage,
    secondaryLanguage: snapshot.secondaryLanguage,
    listening: snapshot.listening,
    wakePhraseEnabled: snapshot.wakePhraseEnabled,
    lastTranscript: snapshot.lastTranscript,
    confirmTranscript: snapshot.confirmTranscript,
    debug: snapshot.debug,
    ...actions,
  };
}
