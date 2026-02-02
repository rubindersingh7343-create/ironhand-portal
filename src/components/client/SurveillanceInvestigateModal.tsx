"use client";

import { useEffect, useMemo, useState } from "react";
import type { CombinedRecord, InvestigationStatus } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";

type Props = {
  report: CombinedRecord;
  storeName: string;
  onClose: () => void;
  onPreview: () => void;
  hasInvestigationAPI: boolean;
};

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

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const categoryBadgeStyles = {
  routine: "border-emerald-300/40 bg-emerald-500/15 text-emerald-200",
  critical: "border-red-400/40 bg-red-500/15 text-red-200",
  theft: "border-orange-400/40 bg-orange-500/15 text-orange-200",
  incident: "border-blue-400/40 bg-blue-500/15 text-blue-200",
} as const;

const gradePillClass = (grade?: string) => {
  const key = (grade ?? "").toUpperCase();
  if (key.startsWith("A")) {
    return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
  }
  if (key.startsWith("B")) {
    return "border-lime-400/40 bg-lime-500/15 text-lime-200";
  }
  if (key.startsWith("C")) {
    return "border-amber-400/40 bg-amber-500/15 text-amber-200";
  }
  if (key.startsWith("D") || key.startsWith("F")) {
    return "border-red-400/40 bg-red-500/15 text-red-200";
  }
  return "border-white/20 bg-white/5 text-slate-200";
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

export default function SurveillanceInvestigateModal({
  report,
  storeName,
  onClose,
  onPreview,
  hasInvestigationAPI,
}: Props) {
  const [message, setMessage] = useState("");
  const [threadMessages, setThreadMessages] = useState<InvestigationMessage[]>([]);
  const [status, setStatus] = useState<InvestigationStatus>("none");
  const [loading, setLoading] = useState(true);
  const [disciplineOpen, setDisciplineOpen] = useState(false);
  const [disciplineOption, setDisciplineOption] = useState("Verbal warning");
  const [disciplineNotes, setDisciplineNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isRoutine = report.surveillanceLabel?.toLowerCase() === "routine";
  const labelKey = (report.surveillanceLabel ?? "routine").toLowerCase();
  const badgeKey =
    labelKey === "critical" || labelKey === "theft" || labelKey === "incident"
      ? (labelKey as "critical" | "theft" | "incident")
      : "routine";
  const summary = report.surveillanceSummary ?? report.notes ?? "No summary provided.";
  const grade = report.surveillanceGrade;
  const gradeReason = report.surveillanceGradeReason;

  const subtitle = useMemo(() => {
    return `${storeName} · ${formatTimestamp(report.createdAt)}`;
  }, [report.createdAt, storeName]);

  useEffect(() => {
    if (!hasInvestigationAPI) {
      setLoading(false);
      return;
    }
    const loadThread = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/owner/surveillance-investigations?store_id=${encodeURIComponent(
            report.storeNumber,
          )}&report_id=${encodeURIComponent(report.id)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setThreadMessages([]);
          return;
        }
        const investigation = data?.investigation;
        const nextMessages = parseThread(investigation?.notes);
        setThreadMessages(nextMessages);
        if (investigation?.status) {
          setStatus(investigation.status as InvestigationStatus);
        }
      } catch (error) {
        console.error("Failed to load surveillance investigation thread", error);
        setThreadMessages([]);
      } finally {
        setLoading(false);
      }
    };
    loadThread();
  }, [hasInvestigationAPI, report.id, report.storeNumber]);

  useEffect(() => {
    setMessage("");
    setDisciplineOpen(false);
    setDisciplineNotes("");
    setErrorMessage(null);
  }, [report.id]);

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
    const response = await fetch("/api/owner/surveillance-investigations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: report.storeNumber,
        report_id: report.id,
        status: nextStatus,
        notes: notesForReport,
        thread: threadPayload(nextMessages),
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? "Unable to send message.");
    }
  };

  const pushMessage = async (
    nextStatus: InvestigationStatus,
    messageEntry: InvestigationMessage,
    notesForReport?: string,
    systemMessage?: InvestigationMessage,
  ) => {
    const openingMessage: InvestigationMessage | undefined =
      threadMessages.length === 0
        ? {
            id: buildMessageId(),
            role: "system",
            text: "Owner opened investigation.",
            timestamp: new Date().toISOString(),
          }
        : undefined;
    const nextMessages = openingMessage
      ? [openingMessage, ...(systemMessage ? [systemMessage] : []), messageEntry]
      : systemMessage
        ? [...threadMessages, systemMessage, messageEntry]
        : [...threadMessages, messageEntry];
    await persistThread(nextStatus, nextMessages, notesForReport);
    setThreadMessages(nextMessages);
    setStatus(nextStatus);
    setMessage("");
    setDisciplineNotes("");
  };

  const handleSendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const messageEntry: InvestigationMessage = {
      id: buildMessageId(),
      role: "owner",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    const nextStatus = status === "resolved" ? "resolved" : "sent";
    try {
      setErrorMessage(null);
      await pushMessage(nextStatus, messageEntry, trimmed);
    } catch (error) {
      console.error("Failed to send surveillance message", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to send message.",
      );
    }
  };

  const handleConfirmDiscipline = async () => {
    const detail = disciplineNotes.trim();
    const systemText = detail
      ? `Owner requested discipline: ${disciplineOption} — ${detail}`
      : `Owner requested discipline: ${disciplineOption}`;
    const systemMessage: InvestigationMessage = {
      id: buildMessageId(),
      role: "system",
      text: systemText,
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...threadMessages, systemMessage];
    try {
      setErrorMessage(null);
      await persistThread("in_progress", nextMessages, systemText);
      setThreadMessages(nextMessages);
      setStatus("in_progress");
      setDisciplineOpen(false);
      setDisciplineNotes("");
    } catch (error) {
      console.error("Failed to request discipline", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to request discipline.",
      );
    }
  };

  const handleMarkResolved = async () => {
    const systemMessage: InvestigationMessage = {
      id: buildMessageId(),
      role: "system",
      text: "Case marked resolved.",
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...threadMessages, systemMessage];
    try {
      setErrorMessage(null);
      await persistThread("resolved", nextMessages, "Case marked resolved.");
      setThreadMessages(nextMessages);
      setStatus("resolved");
    } catch (error) {
      console.error("Failed to mark surveillance case resolved", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to mark resolved.",
      );
    }
  };

  const messageBubble = (messageEntry: InvestigationMessage) => {
    if (messageEntry.role === "system") {
      return (
        <div key={messageEntry.id} className="text-center text-xs text-slate-400">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            {messageEntry.text}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {formatTimestamp(messageEntry.timestamp)}
          </div>
        </div>
      );
    }
    const isOwner = messageEntry.role === "owner";
    return (
      <div
        key={messageEntry.id}
        className={`flex flex-col gap-1 ${isOwner ? "items-end" : "items-start"}`}
      >
        <div
          className={`max-w-[80%] rounded-2xl border px-3 py-2 text-sm ${
            isOwner
              ? "border-blue-400/40 bg-blue-500/20 text-white"
              : "border-white/10 bg-white/5 text-slate-100"
          }`}
        >
          {messageEntry.text}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
          {isOwner ? "Owner" : "Surveillance"} · {formatTimestamp(messageEntry.timestamp)}
        </div>
      </div>
    );
  };

  return (
    <IHModal isOpen onClose={onClose}>
      <div className="flex max-h-full flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Investigate Surveillance Report
            </p>
            <p className="mt-2 text-sm text-slate-200">{subtitle}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                  categoryBadgeStyles[badgeKey]
                }`}
              >
                {badgeKey === "routine" ? "Routine" : badgeKey}
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusClass(
                  status,
                )}`}
              >
                {statusLabel(status)}
              </span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Summary</p>
            <p className="mt-2 text-sm text-slate-200">{summary}</p>
            {(grade || gradeReason) && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">
                  Behavior Grade
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {grade && (
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                        grade,
                      )}`}
                    >
                      {grade}
                    </span>
                  )}
                  {gradeReason && (
                    <span className="text-xs text-slate-200">{gradeReason}</span>
                  )}
                </div>
              </div>
            )}
            <div className="mt-3">
              <button
                type="button"
                onClick={onPreview}
                className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/40"
              >
                {isRoutine ? "Open report" : "Preview video"}
              </button>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Investigation Thread
            </p>
            <div className="mt-3 max-h-[260px] min-h-[200px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b152a] px-4 py-3">
              {loading ? (
                <div className="space-y-3">
                  <div className="ui-skeleton h-6 w-3/4" />
                  <div className="ui-skeleton h-6 w-2/3" />
                  <div className="ui-skeleton h-6 w-1/2" />
                </div>
              ) : threadMessages.length === 0 ? (
                <div className="text-sm text-slate-400">
                  No messages yet. Start the conversation below.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {threadMessages.map(messageBubble)}
                </div>
              )}
            </div>
            {!hasInvestigationAPI && (
              <p className="mt-3 text-xs text-slate-400">
                Setup required: Surveillance investigations not yet enabled.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <label className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Message
          </label>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={
              hasInvestigationAPI
                ? "Write a message for surveillance..."
                : "Messaging not enabled yet."
            }
            disabled={!hasInvestigationAPI}
            className="mt-2 min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-base text-white placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
          />
          {errorMessage ? (
            <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {errorMessage}
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={!hasInvestigationAPI}
                className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send to Surveillance
              </button>
              <button
                type="button"
                onClick={() => setDisciplineOpen(true)}
                disabled={!hasInvestigationAPI}
                className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Request Discipline
              </button>
              <button
                type="button"
                onClick={handleMarkResolved}
                disabled={!hasInvestigationAPI}
                className="rounded-full border border-emerald-300/60 px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Mark Resolved
              </button>
          </div>
        </div>
      </div>
      {disciplineOpen && (
        <IHModal
          isOpen
          onClose={() => setDisciplineOpen(false)}
          allowOutsideClose
          backdropClassName="z-[10000]"
          panelClassName="max-w-md"
        >
          <div className="flex flex-col overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Request Discipline
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-3">
                {[
                  "Verbal warning",
                  "Written warning",
                  "Suspension review",
                  "Termination review",
                ].map((option) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl border px-3 py-2 text-sm ${
                      disciplineOption === option
                        ? "border-blue-400/40 bg-blue-500/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span>{option}</span>
                    <input
                      type="radio"
                      name="discipline"
                      value={option}
                      checked={disciplineOption === option}
                      onChange={() => setDisciplineOption(option)}
                      className="h-3 w-3 accent-blue-500"
                    />
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-300">
                  Optional notes
                </label>
                <textarea
                  value={disciplineNotes}
                  onChange={(event) => setDisciplineNotes(event.target.value)}
                  placeholder="Add notes for surveillance..."
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-sm text-white placeholder:text-slate-400"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleConfirmDiscipline}
                  className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </IHModal>
      )}
    </IHModal>
  );
}
