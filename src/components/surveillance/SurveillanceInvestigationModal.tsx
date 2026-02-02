"use client";

import { useEffect, useState } from "react";
import type { CombinedRecord, InvestigationStatus } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";

type InvestigationMessageRole = "owner" | "surveillance" | "system";

interface InvestigationMessage {
  id: string;
  role: InvestigationMessageRole;
  text: string;
  timestamp: string;
}

interface InvestigationThreadPayload {
  version: 1;
  messages: InvestigationMessage[];
}

type InvestigationCase = {
  id: string;
  storeId: string;
  reportId: string;
  status: InvestigationStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  record?: CombinedRecord | null;
};

type Props = {
  investigation: InvestigationCase;
  storeName: string;
  onClose: () => void;
  onPreviewFile: (file: CombinedRecord["attachments"][number]) => void;
  onUpdated: () => void;
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const statusLabel = (status: InvestigationStatus) => {
  if (status === "resolved") return "RESOLVED";
  if (status === "in_progress") return "IN REVIEW";
  return "OPEN";
};

const statusClass = (status: InvestigationStatus) => {
  if (status === "resolved") {
    return "border-emerald-300/60 text-emerald-200";
  }
  if (status === "in_progress") {
    return "border-amber-300/60 text-amber-200";
  }
  return "border-white/20 text-slate-100";
};

const buildMessageId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const parseThread = (notes?: string | null): InvestigationMessage[] => {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes) as
      | InvestigationThreadPayload
      | InvestigationMessage[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && parsed.version === 1 && Array.isArray(parsed.messages)) {
      return parsed.messages;
    }
  } catch {
    return [
      {
        id: buildMessageId(),
        role: "owner",
        text: notes,
        timestamp: new Date().toISOString(),
      },
    ];
  }
  return [];
};

export default function SurveillanceInvestigationModal({
  investigation,
  storeName,
  onClose,
  onPreviewFile,
  onUpdated,
}: Props) {
  const [threadMessages, setThreadMessages] = useState<InvestigationMessage[]>(() =>
    parseThread(investigation.notes),
  );
  const [messageText, setMessageText] = useState("");
  const [status, setStatus] = useState<InvestigationStatus>(
    investigation.status ?? "none",
  );
  const record = investigation.record ?? null;

  useEffect(() => {
    setMessageText("");
  }, [investigation.id]);

  const threadPayload = (messages: InvestigationMessage[]) =>
    JSON.stringify({
      version: 1,
      messages,
    } satisfies InvestigationThreadPayload);

  const persistThread = async (
    nextStatus: InvestigationStatus,
    nextMessages: InvestigationMessage[],
    notesForReport?: string,
  ) => {
    const response = await fetch("/api/surveillance/investigations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: investigation.storeId,
        report_id: investigation.reportId,
        status: nextStatus,
        notes: notesForReport,
        thread: threadPayload(nextMessages),
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? "Unable to update investigation.");
    }
  };

  const handleSendMessage = async () => {
    const trimmed = messageText.trim();
    if (!trimmed) return;
    const message: InvestigationMessage = {
      id: buildMessageId(),
      role: "surveillance",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    const nextStatus = status === "resolved" ? "resolved" : "in_progress";
    const nextMessages = [...threadMessages, message];
    await persistThread(nextStatus, nextMessages, trimmed);
    setThreadMessages(nextMessages);
    setStatus(nextStatus);
    setMessageText("");
    onUpdated();
  };

  const handleMarkResolved = async () => {
    const systemMessage: InvestigationMessage = {
      id: buildMessageId(),
      role: "system",
      text: "Case marked resolved.",
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...threadMessages, systemMessage];
    await persistThread("resolved", nextMessages, "Case marked resolved.");
    setThreadMessages(nextMessages);
    setStatus("resolved");
    onUpdated();
  };

  const messageBubble = (message: InvestigationMessage) => {
    if (message.role === "system") {
      return (
        <div key={message.id} className="text-center text-xs text-slate-400">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            {message.text}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {formatTimestamp(message.timestamp)}
          </div>
        </div>
      );
    }
    const isOwner = message.role === "owner";
    return (
      <div
        key={message.id}
        className={`flex flex-col gap-1 ${isOwner ? "items-start" : "items-end"}`}
      >
        <div
          className={`max-w-[80%] rounded-2xl border px-3 py-2 text-sm ${
            isOwner
              ? "border-white/10 bg-white/5 text-slate-100"
              : "border-blue-400/40 bg-blue-500/20 text-white"
          }`}
        >
          {message.text}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
          {isOwner ? "Owner" : "Surveillance"} · {formatTimestamp(message.timestamp)}
        </div>
      </div>
    );
  };

  return (
    <IHModal isOpen onClose={onClose}>
      <div className="flex max-h-full flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Surveillance Investigation
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {storeName} · {formatTimestamp(record?.createdAt ?? investigation.createdAt)}
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusClass(
                status,
              )}`}
            >
              {statusLabel(status)}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Summary</p>
            <p className="mt-2 text-sm text-slate-200">
              {record?.surveillanceSummary ?? record?.notes ?? "No summary provided."}
            </p>
            {record?.attachments?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {record.attachments.map((file) => (
                  <button
                    type="button"
                    key={file.id}
                    onClick={() => onPreviewFile(file)}
                    className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/40"
                  >
                    <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                      {(file.label ?? record?.surveillanceLabel ?? "routine").toUpperCase()}
                    </span>
                    <span className="truncate">
                      {file.originalName ?? "View file"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Investigation Thread
            </p>
            <div className="mt-3 max-h-[260px] min-h-[200px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b152a] px-4 py-3">
              {threadMessages.length === 0 ? (
                <div className="text-sm text-slate-400">
                  No messages yet. Start the conversation below.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {threadMessages.map(messageBubble)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <label className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Message
          </label>
          <textarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder="Write a message for the owner..."
            className="mt-2 min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-base text-white placeholder:text-slate-400"
          />
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSendMessage}
                className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
              >
                Send Reply
              </button>
              <button
                type="button"
                onClick={handleMarkResolved}
                className="rounded-full border border-emerald-300/60 px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-200"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        </div>
      </div>
    </IHModal>
  );
}
