"use client";

import { useEffect, useMemo, useState } from "react";
import type { CombinedRecord, StoredFile } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";
import FileViewer from "@/components/records/FileViewer";

type LocalStatus = "default" | "investigating" | "resolved";

type FullDayInvestigationModalProps = {
  report: CombinedRecord;
  storeName: string;
  defaultStatus?: LocalStatus;
  onClose: () => void;
  onStatusChange?: (reportId: string, status: LocalStatus) => void;
  onToast?: (message: string) => void;
};

const formatMoney = (value: unknown) => {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
};

const parseDailyContent = (record: CombinedRecord) => {
  if (!record.textContent) return {};
  try {
    const parsed = JSON.parse(record.textContent);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const buildMessageId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const threadPayload = (messages: Array<{ id: string; role: "owner" | "system"; text: string; timestamp: string }>) =>
  JSON.stringify({ version: 1, messages });

const parseThread = (notes?: string | null) => {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes) as { version?: number; messages?: any } | any[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.messages)) {
      return parsed.messages;
    }
  } catch {
    return [
      {
        id: buildMessageId(),
        role: "owner" as const,
        text: notes,
        timestamp: new Date().toISOString(),
      },
    ];
  }
  return [];
};

export default function FullDayInvestigationModal({
  report,
  storeName,
  defaultStatus = "default",
  onClose,
  onStatusChange,
  onToast,
}: FullDayInvestigationModalProps) {
  const [notes, setNotes] = useState("");
  const [threadMessages, setThreadMessages] = useState<
    Array<{ id: string; role: "owner" | "system"; text: string; timestamp: string }>
  >([]);
  const [status, setStatus] = useState<LocalStatus>(defaultStatus);
  const [threadReportId, setThreadReportId] = useState(report.id);
  const [disciplineOpen, setDisciplineOpen] = useState(false);
  const [disciplineOption, setDisciplineOption] = useState("Verbal warning");
  const [disciplineNotes, setDisciplineNotes] = useState("");
  const [uploads, setUploads] = useState<
    Array<{ employeeName: string; files: StoredFile[] }>
  >([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);

  useEffect(() => {
    setNotes("");
    setDisciplineOpen(false);
    setDisciplineNotes("");
    setActiveFile(null);
    setThreadReportId(report.id);
    setThreadMessages(parseThread(report.notes));
  }, [report.id]);

  useEffect(() => {
    const loadUploads = async () => {
      try {
        setUploadsLoading(true);
        const date = report.createdAt?.slice(0, 10);
        if (!date) {
          setUploads([]);
          return;
        }
        const response = await fetch(
          `/api/owner/shift-uploads?store_id=${encodeURIComponent(
            report.storeNumber,
          )}&date=${encodeURIComponent(date)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setUploads([]);
          return;
        }
        setUploads(Array.isArray(data.uploads) ? data.uploads : []);
      } catch (error) {
        console.error("Failed to load shift uploads", error);
        setUploads([]);
      } finally {
        setUploadsLoading(false);
      }
    };
    loadUploads();
  }, [report.createdAt, report.storeNumber]);

  const statusLabel =
    status === "resolved" ? "RESOLVED" : status === "investigating" ? "IN REVIEW" : "OPEN";
  const statusClass =
    status === "resolved"
      ? "border-emerald-300/60 text-emerald-200"
      : status === "investigating"
        ? "border-amber-300/60 text-amber-200"
        : "border-white/20 text-slate-100";

  const parsed = useMemo(() => parseDailyContent(report), [report]);

  const requestDiscipline = () => {
    const detail = disciplineNotes.trim();
    const message = detail
      ? `Owner requested discipline: ${disciplineOption} — ${detail}`
      : `Owner requested discipline: ${disciplineOption}`;
    const nextMessages = [
      ...threadMessages,
      {
        id: buildMessageId(),
        role: "system" as const,
        text: message,
        timestamp: new Date().toISOString(),
      },
    ];
    setStatus("investigating");
    onStatusChange?.(report.id, "investigating");
    setThreadMessages(nextMessages);
    fetch("/api/reports/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId: threadReportId,
        storeNumber: report.storeNumber,
        storeName,
        textContent: report.textContent ?? "",
        reportDate: report.createdAt?.slice(0, 10),
        thread: threadPayload(nextMessages),
        reason: message,
      }),
    }).catch(() => {});
    onToast?.("Discipline request sent.");
    setDisciplineOpen(false);
    setDisciplineNotes("");
  };

  return (
    <>
      <IHModal isOpen onClose={onClose}>
        <div className="flex max-h-full flex-col overflow-hidden">
          <div className="border-b border-white/10 px-6 py-4">
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                  Full Day Report
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  {storeName}
                </h3>
              </div>
              <div
                className={`w-fit rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusClass}`}
              >
                {statusLabel}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Scr", "scr"],
                ["Lotto", "lotto"],
                ["Store", "store"],
                ["Liquor", "liquor"],
                ["Beer", "beer"],
                ["Tobacco", "tobacco"],
                ["CIG", "cigarettes"],
                ["Gas", "gas"],
                ["Gross", "gross"],
                ["ATM", "atm"],
                ["Lotto P/O", "lottoPo"],
                ["Cash", "cash"],
                ["Deposit", "deposit"],
              ].map(([label, key]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                    {label}
                  </p>
                  <p className="ui-tabular text-sm text-white">
                    {formatMoney((parsed as Record<string, unknown>)[key])}
                  </p>
                </div>
              ))}
              {Array.isArray((parsed as Record<string, unknown>).customFields) &&
                ((parsed as Record<string, unknown>).customFields as Array<{
                  label?: string;
                  amount?: number;
                }>).map((field, index) => (
                  <div
                    key={`custom-${field.label ?? index}`}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                      {field.label ?? "Custom"}
                    </p>
                    <p className="ui-tabular text-sm text-white">
                      {formatMoney(field.amount ?? 0)}
                    </p>
                  </div>
                ))}
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Employee uploads
              </p>
              <div className="mt-3 space-y-4">
                {uploadsLoading ? (
                  <>
                    <div className="ui-skeleton h-16 w-full" />
                    <div className="ui-skeleton h-16 w-full" />
                  </>
                ) : uploads.length ? (
                  uploads.map((entry) => (
                    <div key={entry.employeeName} className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        {entry.employeeName}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {entry.files.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => setActiveFile(file)}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white transition hover:border-white/40"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-semibold">
                                {file.label ?? "Attachment"}
                              </p>
                              <p className="truncate text-xs text-slate-400">
                                {file.originalName}
                              </p>
                            </div>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-300">
                              Open
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">
                    No employee uploads found for this day.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Investigation Thread
              </p>
              <div className="mt-3 max-h-[220px] min-h-[180px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b152a] px-4 py-3">
                {threadMessages.length === 0 ? (
                  <div className="text-sm text-slate-400">
                    No messages yet. Start the conversation below.
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {threadMessages.map((message) => (
                      <div
                        key={message.id}
                        className={
                          message.role === "system"
                            ? "text-center text-xs text-slate-400"
                            : "flex flex-col items-end gap-1"
                        }
                      >
                        {message.role === "system" ? (
                          <>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                              {message.text}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-500">
                              {formatTimestamp(message.timestamp)}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="max-w-[80%] rounded-2xl border border-blue-400/40 bg-blue-500/20 px-3 py-2 text-sm text-white">
                              {message.text}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                              Owner · {formatTimestamp(message.timestamp)}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
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
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add context for the manager..."
              className="mt-2 min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-sm text-white placeholder:text-slate-400"
            />
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const trimmed = notes.trim();
                    if (!trimmed) return;
                    const nextMessage = {
                      id: buildMessageId(),
                      role: "owner" as const,
                      text: trimmed,
                      timestamp: new Date().toISOString(),
                    };
                    const nextMessages = [...threadMessages, nextMessage];
                    const response = await fetch("/api/reports/investigate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        reportId: threadReportId,
                        storeNumber: report.storeNumber,
                        storeName,
                        textContent: report.textContent ?? "",
                        reportDate: report.createdAt?.slice(0, 10),
                        thread: threadPayload(nextMessages),
                        reason: trimmed,
                      }),
                    });
                    if (response.ok) {
                      const data = await response.json().catch(() => ({}));
                      if (data?.reportId) {
                        setThreadReportId(data.reportId);
                      }
                      setStatus("investigating");
                      onStatusChange?.(report.id, "investigating");
                      setThreadMessages(nextMessages);
                      setNotes("");
                      onToast?.("Sent to manager for review.");
                    } else {
                      onToast?.("Unable to send message.");
                    }
                  }}
                  className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  Send to Manager
                </button>
                <button
                  type="button"
                  onClick={() => setDisciplineOpen(true)}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50"
                >
                  Request Discipline
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextMessages = [
                      ...threadMessages,
                      {
                        id: buildMessageId(),
                        role: "system" as const,
                        text: "Case marked resolved.",
                        timestamp: new Date().toISOString(),
                      },
                    ];
                    setStatus("resolved");
                    onStatusChange?.(report.id, "resolved");
                    setThreadMessages(nextMessages);
                    fetch("/api/reports/investigate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        reportId: threadReportId,
                        storeNumber: report.storeNumber,
                        storeName,
                        textContent: report.textContent ?? "",
                        reportDate: report.createdAt?.slice(0, 10),
                        thread: threadPayload(nextMessages),
                        reason: "Case marked resolved.",
                      }),
                    }).catch(() => {});
                    onToast?.("Report marked resolved.");
                    onClose();
                  }}
                  className="rounded-full border border-emerald-300/60 px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-200"
                >
                  Mark Resolved
                </button>
              </div>
            </div>
          </div>
        </div>
      </IHModal>

      {disciplineOpen && (
        <IHModal
          isOpen
          onClose={() => setDisciplineOpen(false)}
          allowOutsideClose
          backdropClassName="z-[10000]"
          panelClassName="max-w-md"
        >
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
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
                  placeholder="Add notes for the manager..."
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-sm text-white placeholder:text-slate-400"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={requestDiscipline}
                  className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </IHModal>
      )}
      {activeFile && (
        <FileViewer file={activeFile} onClose={() => setActiveFile(null)} />
      )}
    </>
  );
}
