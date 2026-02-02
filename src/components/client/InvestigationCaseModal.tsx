"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  InvestigationStatus,
  ScratcherShiftCalculation,
  ShiftReport,
  StoredFile,
} from "@/lib/types";
import IHModal from "@/components/ui/IHModal";
import FileViewer from "@/components/records/FileViewer";

type InvestigationMessageRole = "owner" | "manager" | "system";

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

interface InvestigationCaseModalProps {
  report: ShiftReport & {
    investigationStatus?: InvestigationStatus;
  };
  onClose: () => void;
  onSubmit: (
    report: InvestigationCaseModalProps["report"],
    status: InvestigationStatus,
    notes: string | undefined,
    threadPayload?: string,
  ) => Promise<void>;
  onToast?: (message: string) => void;
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

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

const parseThread = (notes?: string | null): InvestigationMessage[] => {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes) as InvestigationThreadPayload | InvestigationMessage[];
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

export default function InvestigationCaseModal({
  report,
  onClose,
  onSubmit,
  onToast,
}: InvestigationCaseModalProps) {
  const [threadMessages, setThreadMessages] = useState<InvestigationMessage[]>([]);
  const [status, setStatus] = useState<InvestigationStatus>(
    report.investigationStatus ?? "none",
  );
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(true);
  const [attachments, setAttachments] = useState<StoredFile[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);
  const [scratcherCalc, setScratcherCalc] =
    useState<ScratcherShiftCalculation | null>(null);
  const [scratcherLoading, setScratcherLoading] = useState(false);
  const [disciplineOpen, setDisciplineOpen] = useState(false);
  const [disciplineOption, setDisciplineOption] = useState("Verbal warning");
  const [disciplineNotes, setDisciplineNotes] = useState("");

  useEffect(() => {
    const loadThread = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/owner/investigations?store_id=${encodeURIComponent(
            report.storeId,
          )}&date=${encodeURIComponent(report.date)}&shift_report_id=${encodeURIComponent(
            report.id,
          )}`,
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
        console.error("Failed to load investigation thread", error);
        setThreadMessages([]);
      } finally {
        setLoading(false);
      }
    };
    loadThread();
  }, [report.date, report.id, report.storeId]);

  useEffect(() => {
    const loadAttachments = async () => {
      if (!report.employeeName) {
        setAttachments([]);
        return;
      }
      try {
        setAttachmentsLoading(true);
        const response = await fetch(
          `/api/owner/shift-uploads?store_id=${encodeURIComponent(
            report.storeId,
          )}&date=${encodeURIComponent(report.date)}&employee_name=${encodeURIComponent(
            report.employeeName,
          )}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setAttachments([]);
          return;
        }
        setAttachments(Array.isArray(data.files) ? data.files : []);
      } catch (error) {
        console.error("Failed to load shift uploads", error);
        setAttachments([]);
      } finally {
        setAttachmentsLoading(false);
      }
    };
    loadAttachments();
  }, [report.date, report.employeeName, report.storeId]);

  useEffect(() => {
    if (!report.id) return;
    let active = true;
    setScratcherLoading(true);
    fetch(`/api/scratchers/shifts/${report.id}`, { cache: "no-store" })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(response),
      )
      .then((data) => {
        if (!active) return;
        setScratcherCalc(data?.calculation ?? null);
      })
      .catch(() => {
        if (active) setScratcherCalc(null);
      })
      .finally(() => {
        if (active) setScratcherLoading(false);
      });
    return () => {
      active = false;
    };
  }, [report.id]);

  useEffect(() => {
    setMessageText("");
    setDisciplineOpen(false);
    setDisciplineNotes("");
    setActiveFile(null);
  }, [report.id]);

  const summaryName = report.employeeName ?? report.managerName ?? "—";
  const detailFields = [
    { label: "Gross", value: report.grossAmount },
    { label: "Lotto", value: report.lottoAmount },
    { label: "Scr", value: report.scrAmount },
    { label: "Cash", value: report.cashAmount },
    { label: "Store", value: report.storeAmount ?? report.netAmount },
    { label: "Liquor", value: report.liquorAmount },
    { label: "Beer", value: report.beerAmount },
    { label: "Cig", value: report.cigAmount },
    { label: "Tobacco", value: report.tobaccoAmount },
    { label: "Gas", value: report.gasAmount },
    { label: "ATM", value: report.atmAmount },
    { label: "Lotto P/O", value: report.lottoPoAmount },
    { label: "Deposit", value: report.depositAmount },
  ];

  const scratcherBreakdown = useMemo(() => {
    if (!scratcherCalc?.breakdown) return [] as Array<{
      slotNumber: string;
      sold: number;
      value: number;
    }>;
    return scratcherCalc.breakdown
      .map((entry) => {
        const slotNumber =
          typeof entry.slotNumber === "number" || typeof entry.slotNumber === "string"
            ? String(entry.slotNumber)
            : "—";
        return {
          slotNumber,
          sold: Number(entry.sold ?? 0),
          value: Number(entry.value ?? 0),
        };
      })
      .sort((a, b) => Number(a.slotNumber) - Number(b.slotNumber));
  }, [scratcherCalc?.breakdown]);

  const scratcherFlags = useMemo(
    () => scratcherCalc?.flags ?? [],
    [scratcherCalc?.flags],
  );

  const threadPayload = (messages: InvestigationMessage[]) =>
    JSON.stringify({
      version: 1,
      messages,
    } satisfies InvestigationThreadPayload);

  const pushMessage = async (
    nextStatus: InvestigationStatus,
    message: InvestigationMessage,
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
      ? [openingMessage, ...(systemMessage ? [systemMessage] : []), message]
      : systemMessage
        ? [...threadMessages, systemMessage, message]
        : [...threadMessages, message];
    await onSubmit(report, nextStatus, notesForReport, threadPayload(nextMessages));
    setThreadMessages(nextMessages);
    setStatus(nextStatus);
    setMessageText("");
    setDisciplineNotes("");
    onToast?.("Message sent to manager.");
  };

  const handleSendMessage = async () => {
    const trimmed = messageText.trim();
    if (!trimmed) return;
    const message: InvestigationMessage = {
      id: buildMessageId(),
      role: "owner",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    const nextStatus = status === "resolved" ? "resolved" : "sent";
    await pushMessage(nextStatus, message, trimmed);
  };

  const handleMarkResolved = async () => {
    const systemMessage: InvestigationMessage = {
      id: buildMessageId(),
      role: "system",
      text: "Case marked resolved.",
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...threadMessages, systemMessage];
    await onSubmit(report, "resolved", "Case marked resolved.", threadPayload(nextMessages));
    setThreadMessages(nextMessages);
    setStatus("resolved");
    onToast?.("Report marked resolved.");
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
    await onSubmit(report, "in_progress", systemText, threadPayload(nextMessages));
    setThreadMessages(nextMessages);
    setStatus("in_progress");
    setDisciplineOpen(false);
    setDisciplineNotes("");
    onToast?.("Discipline request sent.");
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
        className={`flex flex-col gap-1 ${isOwner ? "items-end" : "items-start"}`}
      >
        <div
          className={`max-w-[80%] rounded-2xl border px-3 py-2 text-sm ${
            isOwner
              ? "border-blue-400/40 bg-blue-500/20 text-white"
              : "border-white/10 bg-white/5 text-slate-100"
          }`}
        >
          {message.text}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
          {isOwner ? "Owner" : "Manager"} · {formatTimestamp(message.timestamp)}
        </div>
      </div>
    );
  };

  const modalBody = (
    <IHModal isOpen onClose={onClose}>
      <div className="flex max-h-full flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Investigate Report
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {summaryName}
              </h3>
              <p className="text-sm text-slate-200">
                Store {report.storeId} · {report.date} · Shift Report
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                Scr
              </p>
              <p className="ui-tabular text-sm text-white">
                {formatMoney(report.scrAmount)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                Cash
              </p>
              <p className="ui-tabular text-sm text-white">
                {formatMoney(report.cashAmount)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                Net
              </p>
              <p className="ui-tabular text-sm text-white">
                {formatMoney(report.netAmount)}
              </p>
            </div>
            <div
              className={`ml-auto flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusClass(
                status,
              )}`}
            >
              {statusLabel(status)}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Shift report details
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {detailFields.map((field) => (
                <div
                  key={field.label}
                  className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    {field.label}
                  </p>
                  <p className="ui-tabular mt-2 text-sm text-white">
                    {formatMoney(Number(field.value ?? 0))}
                  </p>
                </div>
              ))}
              {(report.customFields ?? []).map((field) => (
                <div
                  key={`custom-${field.label}`}
                  className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    {field.label}
                  </p>
                  <p className="ui-tabular mt-2 text-sm text-white">
                    {formatMoney(Number(field.amount ?? 0))}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Scratchers (Anti-Theft)
            </p>
            {scratcherLoading ? (
              <div className="mt-3 text-sm text-slate-400">
                Loading scratcher calculations…
              </div>
            ) : scratcherCalc ? (
              <div className="mt-3 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Expected
                    </p>
                    <p className="ui-tabular mt-2 text-sm text-white">
                      {formatMoney(scratcherCalc.expectedTotalValue)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Reported
                    </p>
                    <p className="ui-tabular mt-2 text-sm text-white">
                      {formatMoney(scratcherCalc.reportedScrValue ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Variance
                    </p>
                    <p className="ui-tabular mt-2 text-sm text-white">
                      {formatMoney(scratcherCalc.varianceValue)}
                    </p>
                  </div>
                </div>
                {scratcherFlags.length > 0 && (
                  <div className="rounded-2xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Flags: {scratcherFlags.join(", ")}
                  </div>
                )}
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <div className="grid grid-cols-[1fr,1fr,1fr] gap-2 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    <span>Slot</span>
                    <span className="text-right">Sold</span>
                    <span className="text-right">Value</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {scratcherBreakdown.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-400">
                        No scratcher slots recorded for this shift.
                      </div>
                    ) : (
                      scratcherBreakdown.map((row, index) => (
                        <div
                          key={`scratcher-${index}`}
                          className="grid grid-cols-[1fr,1fr,1fr] gap-2 border-t border-white/5 px-4 py-2 text-sm text-slate-200"
                        >
                          <span>Slot {row.slotNumber}</span>
                          <span className="ui-tabular text-right">
                            {row.sold}
                          </span>
                          <span className="ui-tabular text-right">
                            {formatMoney(row.value)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-400">
                No scratcher calculation found for this shift yet.
              </div>
            )}
          </div>

          <div className="mb-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Employee uploads
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {attachmentsLoading ? (
                <>
                  <div className="ui-skeleton h-16 w-full" />
                  <div className="ui-skeleton h-16 w-full" />
                  <div className="ui-skeleton h-16 w-full" />
                </>
              ) : attachments.length ? (
                attachments.map((file) => (
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
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No uploads found for this shift.
                </p>
              )}
            </div>
          </div>

          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Investigation Thread
          </p>
          <div className="mt-3 h-[300px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b152a] px-4 py-3">
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
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <label className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Message
          </label>
          <textarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder="Write a message for the manager..."
            className="mt-2 min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-sm text-white placeholder:text-slate-400"
          />
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSendMessage}
                className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
              >
                Send Message
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
                onClick={handleMarkResolved}
                className="rounded-full border border-emerald-300/60 px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-200"
              >
                Mark Resolved
              </button>
            </div>
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
      {activeFile && (
        <FileViewer file={activeFile} onClose={() => setActiveFile(null)} />
      )}
    </IHModal>
  );

  return modalBody;
}
