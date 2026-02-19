"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import IHModal from "@/components/ui/IHModal";

type Props = {
  storeId: string;
  storeName: string;
  onClose: () => void;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const initialMessage: AssistantMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "Ask me about sales, reports, staffing, or recent activity.",
};

export default function OwnerAssistantModal({ storeId, storeName, onClose }: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([initialMessage]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const title = useMemo(() => "Store Assistant", []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    return () => {
      peerRef.current?.close();
      peerRef.current = null;
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }
    };
  }, []);

  const sendMessage = async (content: string) => {
    if (!content.trim() || sending) return;
    setError(null);
    setSending(true);
    const timestamp = Date.now();
    const pendingId = `assistant-pending-${timestamp}`;
    const userMessage: AssistantMessage = {
      id: `user-${timestamp}`,
      role: "user",
      content,
    };
    const pendingMessage: AssistantMessage = {
      id: pendingId,
      role: "assistant",
      content: "Thinking…",
    };
    setMessages((prev) => [...prev, userMessage, pendingMessage]);
    setDraft("");

    try {
      const history = messages
        .filter((msg) => msg.id !== initialMessage.id)
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          message: content,
          history: history.slice(-8),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to reach the assistant.");
      }
      const reply = data?.reply ?? "I couldn't find that information yet.";
      setMessages((prev) =>
        prev.map((msg) => (msg.id === pendingId ? { ...msg, content: reply } : msg)),
      );
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg.id !== pendingId));
      setError(err instanceof Error ? err.message : "Assistant unavailable.");
    } finally {
      setSending(false);
    }
  };

  const supportsRealtime =
    typeof window !== "undefined" &&
    typeof RTCPeerConnection !== "undefined" &&
    navigator.mediaDevices?.getUserMedia;

  const stopRealtime = () => {
    peerRef.current?.close();
    peerRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    setRealtimeState("idle");
  };

  const startRealtime = async () => {
    if (!supportsRealtime || realtimeState === "connecting" || realtimeState === "connected") {
      return;
    }
    setRealtimeError(null);
    setRealtimeState("connecting");

    try {
      const tokenResponse = await fetch("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok) {
        throw new Error(tokenData?.error ?? "Unable to start voice.");
      }
      const token = tokenData?.value;
      if (!token) {
        throw new Error("Realtime token missing.");
      }

      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      pc.ontrack = (event) => {
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.autoplay = true;
        }
        audioRef.current.srcObject = event.streams[0];
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          stopRealtime();
        }
      };

      const dataChannel = pc.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

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
      setRealtimeState("connected");
    } catch (err) {
      setRealtimeError(err instanceof Error ? err.message : "Voice unavailable.");
      stopRealtime();
      setRealtimeState("error");
    }
  };

  const handleVoiceToggle = () => {
    if (!supportsRealtime) return;
    if (realtimeState === "connected" || realtimeState === "connecting") {
      stopRealtime();
      return;
    }
    void startRealtime();
  };

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose>
      <div className="flex h-[82vh] max-h-[680px] w-[min(640px,92vw)] flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-4">
          <p className="text-xs uppercase tracking-[0.26em] text-slate-400">
            {title}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">{storeName}</h2>
          <p className="text-xs text-slate-400">
            Use voice or text to ask about this store.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </p>
          )}
          {realtimeError && (
            <p className="mt-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Voice: {realtimeError}
            </p>
          )}
          <div className="space-y-3">
            {messages.map((msg) => {
              const mine = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm ${
                      mine
                        ? "bg-blue-500/20 text-slate-100"
                        : "bg-white/5 text-slate-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a question..."
              className="ui-field flex-1 bg-white/5 text-sm"
            />
            <button
              type="button"
              onClick={() => void sendMessage(draft.trim())}
              disabled={sending || !draft.trim()}
              className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/60 disabled:border-white/10 disabled:text-slate-500"
            >
              Send
            </button>
            <button
              type="button"
              onClick={handleVoiceToggle}
              disabled={!supportsRealtime}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                realtimeState === "connected"
                  ? "border-emerald-400/60 text-emerald-100"
                  : realtimeState === "connecting"
                    ? "border-amber-300/60 text-amber-100"
                    : "border-white/20 text-slate-200"
              } ${!supportsRealtime ? "opacity-50" : ""}`}
            >
              {!supportsRealtime
                ? "Voice Unavailable"
                : realtimeState === "connecting"
                  ? "Connecting…"
                  : realtimeState === "connected"
                    ? "Voice On"
                    : "Voice Off"}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Voice uses realtime AI audio. Microphone access is required.
          </p>
        </div>
      </div>
    </IHModal>
  );
}
