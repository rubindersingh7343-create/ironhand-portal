"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import { useRealtimeVoice } from "@/components/client/useRealtimeVoice";
import {
  ASSISTANT_VOICES,
  DEFAULT_ASSISTANT_VOICE,
  type AssistantVoice,
  isAssistantVoice,
} from "@/components/client/assistantVoice";
import {
  ASSISTANT_LANGUAGES,
  DEFAULT_ASSISTANT_LANGUAGE_PRIMARY,
} from "@/components/client/assistantLanguages";

type Props = {
  storeId: string;
  storeName: string;
  onClose: () => void;
  voice: AssistantVoice;
  onVoiceChange: (voice: AssistantVoice) => void;
  primaryLanguage: string;
  secondaryLanguage: string;
  onPrimaryLanguageChange: (language: string) => void;
  onSecondaryLanguageChange: (language: string) => void;
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

export default function OwnerAssistantModal({
  storeId,
  storeName,
  onClose,
  voice,
  onVoiceChange,
  primaryLanguage,
  secondaryLanguage,
  onPrimaryLanguageChange,
  onSecondaryLanguageChange,
}: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([initialMessage]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const {
    supportsRealtime,
    state: realtimeState,
    error: realtimeError,
    listening,
    toggleListening,
    stop: stopVoice,
  } = useRealtimeVoice(storeId, voice, primaryLanguage, secondaryLanguage, storeName);

  const title = useMemo(() => "Store Assistant", []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
          primaryLanguage,
          secondaryLanguage,
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

  const handleVoiceToggle = () => {
    if (!supportsRealtime) return;
    toggleListening();
  };

  const handleVoiceSelect = (value: string) => {
    if (!isAssistantVoice(value)) return;
    onVoiceChange(value);
  };

  const handlePrimaryLanguageChange = (value: string) => {
    onPrimaryLanguageChange(value);
  };

  const handleSecondaryLanguageChange = (value: string) => {
    onSecondaryLanguageChange(value);
  };

  const handleClose = () => {
    stopVoice();
    onClose();
  };

  return (
    <IHModal
      isOpen
      onClose={handleClose}
      allowOutsideClose
      panelClassName="assistant-modal"
    >
      <div className="assistant-shell flex h-[82vh] max-h-[700px] w-[min(720px,92vw)] flex-col overflow-hidden">
        <div className="assistant-header border-b border-black/5 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-600">
            {title}
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{storeName}</h2>
              <p className="text-xs text-slate-600">
                Tap once to start hands-free. Tap again to stop. Or type your question.
              </p>
            </div>
            <div
              className={`assistant-voice-halo ${
                listening ? "listening" : realtimeState
              }`}
              aria-hidden="true"
            >
              <span className="assistant-voice-core" />
              <span className="assistant-voice-ring" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <p className="rounded-2xl border border-red-900/10 bg-red-500/10 px-4 py-3 text-sm text-red-900">
              {error}
            </p>
          )}
          {realtimeError && (
            <p className="mt-3 rounded-2xl border border-amber-900/10 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
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
                        ? "bg-[#223a70] text-white shadow-[0_2px_8px_rgba(15,23,42,0.10)]"
                        : "bg-black/5 text-slate-800"
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

        <div className="assistant-input border-t border-black/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a question..."
              className="ui-field flex-1 bg-white text-sm"
            />
            <button
              type="button"
              onClick={() => void sendMessage(draft.trim())}
              disabled={sending || !draft.trim()}
              className="rounded-full bg-[#223a70] px-4 py-2 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(15,23,42,0.10)] transition hover:bg-[#1a2c56] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
            <button
              type="button"
              disabled={!supportsRealtime}
              aria-label={listening ? "Stop recording" : "Start recording"}
              className={`assistant-voice-icon ${realtimeState} ${
                !supportsRealtime ? "disabled" : ""
              } ${listening ? "listening" : ""}`}
              onClick={handleVoiceToggle}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Z" />
                <path d="M19 11a7 7 0 0 1-14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
            <span>Voice uses realtime AI audio. Microphone access is required.</span>
            <label className="flex items-center gap-2 rounded-full border border-black/5 bg-black/5 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-700">
              Voice
              <select
                value={voice ?? DEFAULT_ASSISTANT_VOICE}
                onChange={(event) => handleVoiceSelect(event.target.value)}
                className="bg-transparent text-slate-900 outline-none"
              >
                {ASSISTANT_VOICES.map((option) => (
                  <option key={option} value={option} className="text-slate-900">
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-600">
                Primary language
              </span>
              <input
                list="assistant-language-list"
                value={primaryLanguage}
                onChange={(event) => handlePrimaryLanguageChange(event.target.value)}
                placeholder={DEFAULT_ASSISTANT_LANGUAGE_PRIMARY}
                className="ui-field bg-white text-xs"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-600">
                Secondary language
              </span>
              <input
                list="assistant-language-list"
                value={secondaryLanguage}
                onChange={(event) => handleSecondaryLanguageChange(event.target.value)}
                placeholder="Optional"
                className="ui-field bg-white text-xs"
              />
            </label>
            <datalist id="assistant-language-list">
              {ASSISTANT_LANGUAGES.map((language) => (
                <option value={language} key={language} />
              ))}
            </datalist>
          </div>
        </div>
      </div>
    </IHModal>
  );
}
