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
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const title = useMemo(() => "Store Assistant", []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const Speech =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech) {
      setSpeechSupported(false);
      return;
    }
    setSpeechSupported(true);
    const recognition = new Speech();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      setListening(false);
      if (transcript.trim()) {
        void sendMessage(transcript.trim());
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    return () => {
      recognition.stop();
    };
  }, []);

  const speak = (text: string) => {
    if (!voiceMode || typeof window === "undefined") return;
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  };

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
      speak(reply);
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg.id !== pendingId));
      setError(err instanceof Error ? err.message : "Assistant unavailable.");
    } finally {
      setSending(false);
    }
  };

  const handleVoiceToggle = () => {
    if (!speechSupported || !recognitionRef.current) return;
    if (!voiceMode) {
      setVoiceMode(true);
    }
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    setListening(true);
    recognitionRef.current.start();
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
              disabled={!speechSupported}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                voiceMode
                  ? "border-emerald-400/60 text-emerald-100"
                  : "border-white/20 text-slate-200"
              } ${!speechSupported ? "opacity-50" : ""}`}
            >
              {speechSupported
                ? listening
                  ? "Listening…"
                  : voiceMode
                    ? "Voice On"
                    : "Voice Off"
                : "Voice Unavailable"}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Voice replies are AI-generated and use device speech services.
          </p>
        </div>
      </div>
    </IHModal>
  );
}
