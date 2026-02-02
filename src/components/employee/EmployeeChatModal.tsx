"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { ChatType, StoreChatMessage } from "@/lib/types";

type Props = {
  type: ChatType;
  storeId: string;
  storeName: string;
  onClose: () => void;
};

const typeLabel: Record<ChatType, string> = {
  manager: "Manager",
  surveillance: "Surveillance",
  owner: "Owner",
};

const formatTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function EmployeeChatModal({
  type,
  storeId,
  storeName,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<StoreChatMessage[]>([]);
  const [participantName, setParticipantName] = useState<string>("...");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(
    () => `${typeLabel[type]} Chat`,
    [type],
  );

  const loadMessages = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const params = new URLSearchParams({ storeId, type });
        const response = await fetch(`/api/chat/messages?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load chat.");
        }
        setParticipantName(data.participantName ?? "Assigned User");
        const nextMessages = Array.isArray(data.messages) ? data.messages : [];
        setMessages(nextMessages);
      } catch (err) {
        console.error(err);
        if (!silent) {
          setError(
            err instanceof Error ? err.message : "Unable to load chat.",
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [storeId, type],
  );

  useEffect(() => {
    loadMessages(false);
    const interval = window.setInterval(() => loadMessages(true), 12000);
    const handleFocus = () => loadMessages(true);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const handleSend = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          type,
          message: draft.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to send message.");
      }
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
      setDraft("");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose>
      <div className="flex max-h-[min(560px,80vh)] w-[min(520px,92vw)] flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            {storeName}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {title}
          </h2>
          <p className="text-xs text-slate-400">
            {participantName}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`chat-skel-${index}`} className="ui-skeleton h-10" />
              ))}
            </div>
          )}
          {error && (
            <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </p>
          )}
          {!loading && !error && messages.length === 0 && (
            <p className="rounded-2xl border border-white/10 px-4 py-5 text-sm text-slate-300">
              No messages yet. Start the conversation.
            </p>
          )}
          <div className="space-y-3">
            {messages.map((msg) => {
              const mine = msg.senderRole === "employee";
              return (
                <div
                  key={msg.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                      mine
                        ? "bg-blue-500/20 text-slate-100"
                        : "bg-white/5 text-slate-200"
                    }`}
                  >
                    {!mine && (
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                        {msg.senderName}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap">{msg.message}</p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>
        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type a message..."
              className="ui-field flex-1 bg-white/5 text-sm"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/60 disabled:border-white/10 disabled:text-slate-500"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </IHModal>
  );
}
