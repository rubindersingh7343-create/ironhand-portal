"use client";

import { useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { CombinedRecord } from "@/lib/types";

type Props = {
  report: CombinedRecord;
  storeName: string;
  mode?: "routine" | "incident";
  onClose: () => void;
  onInvestigate: () => void;
};

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

const formatBytes = (bytes?: number) => {
  if (!bytes || Number.isNaN(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const buildAttachmentSrc = (path?: string) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `/api/uploads/proxy?path=${encodeURIComponent(path)}`;
};

const isPreviewable = (kind?: string) => kind === "image" || kind === "video";

const labelDisplay = (label?: string) => {
  if (!label) return "Routine Surveillance Report";
  const upper = label.toLowerCase();
  if (upper === "routine") return "Routine Surveillance Report";
  return upper.charAt(0).toUpperCase() + upper.slice(1);
};

const labelChipStyle = (label?: string) => {
  switch ((label ?? "").toLowerCase()) {
    case "critical":
      return "border-red-400/40 bg-red-500/15 text-red-200";
    case "theft":
      return "border-orange-400/40 bg-orange-500/15 text-orange-200";
    case "incident":
      return "border-blue-400/40 bg-blue-500/15 text-blue-200";
    default:
      return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  }
};

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
  return "border-white/20 bg-white/5 text-slate-100";
};

export default function SurveillanceSummaryViewer({
  report,
  storeName,
  mode,
  onClose,
  onInvestigate,
}: Props) {
  const attachments = useMemo(
    () => report.attachments ?? [],
    [report.attachments],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullScreenSrc, setFullScreenSrc] = useState<string | null>(null);
  const [fullScreenKind, setFullScreenKind] = useState<
    "image" | "video" | "document" | null
  >(null);
  const activeAttachment = attachments[activeIndex];
  const label = report.surveillanceLabel ?? "Routine";
  const effectiveLabel = mode === "routine" ? "routine" : label;
  const summary =
    report.surveillanceSummary ?? report.notes ?? "No summary provided.";
  const grade = report.surveillanceGrade;
  const gradeReason = report.surveillanceGradeReason;
  const labelKey = (effectiveLabel ?? "").toLowerCase();
  const isIncident = mode === "incident" || ["critical", "theft", "incident"].includes(labelKey);

  const attachmentKind = activeAttachment?.kind ?? "document";
  const isVideo = attachmentKind === "video";
  const isImage = attachmentKind === "image";
  const isRoutine = (effectiveLabel ?? "").toLowerCase() === "routine";
  const openFullScreen = (attachment?: (typeof attachments)[number]) => {
    if (!attachment) return;
    const src = buildAttachmentSrc(attachment.path);
    if (!src) return;
    setFullScreenSrc(src);
    const kind = isPreviewable(attachment.kind) ? attachment.kind : "document";
    setFullScreenKind(kind as "image" | "video" | "document");
  };

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose>
      <div className="flex flex-col overflow-hidden">
        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-300">
                Surveillance Report
              </p>
              <h2 className="mt-2 text-lg font-semibold text-white">
                {labelDisplay(effectiveLabel)}
              </h2>
              <p className="text-sm text-slate-200">
                {storeName} · {report.storeNumber} · {formatTimestamp(report.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${labelChipStyle(
                  effectiveLabel,
                )}`}
              >
                {effectiveLabel.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!isIncident && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                Summary
              </p>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                {summary.split("\n").map((line, index) => (
                  <p key={`${line}-${index}`} className={index ? "mt-2" : ""}>
                    {line || "\u00a0"}
                  </p>
                ))}
              </div>
              {(grade || gradeReason) && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                    Behavior Grade
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {grade && (
                      <span
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                          grade,
                        )}`}
                      >
                        {grade}
                      </span>
                    )}
                    {gradeReason && (
                      <span className="text-sm text-slate-200">
                        {gradeReason}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
              Attachments
            </p>
            {!activeAttachment ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                No attachments uploaded for this report.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  {isVideo && (
                    <button
                      type="button"
                      onClick={() => openFullScreen(activeAttachment)}
                      className="w-full"
                      aria-label="Open video full screen"
                    >
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        className="aspect-video w-full object-contain"
                        src={buildAttachmentSrc(activeAttachment.path)}
                      />
                    </button>
                  )}
                  {isImage && (
                    <button
                      type="button"
                      onClick={() => openFullScreen(activeAttachment)}
                      className="w-full cursor-zoom-in"
                      aria-label="Open image full screen"
                    >
                      <img
                        src={buildAttachmentSrc(activeAttachment.path)}
                        alt={activeAttachment.originalName}
                        className="aspect-video w-full object-contain"
                      />
                    </button>
                    )}
                  {!isVideo && !isImage && (
                    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-sm text-slate-300">
                      <p>{activeAttachment.originalName}</p>
                      <button
                        type="button"
                        onClick={() => openFullScreen(activeAttachment)}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50"
                      >
                        Open document
                      </button>
                    </div>
                  )}
                </div>
                {activeAttachment.summary && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                      File Summary
                    </p>
                    <p className="mt-2">{activeAttachment.summary}</p>
                  </div>
                )}
                {activeAttachment && (
                  <button
                    type="button"
                    onClick={() => openFullScreen(activeAttachment)}
                    className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/50"
                  >
                    Open full screen
                  </button>
                )}

                {attachments.length > 1 && (
                  <div className="space-y-2">
                    {attachments.map((file, index) => (
                      <button
                        type="button"
                        key={file.id}
                        onClick={() => setActiveIndex(index)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                          index === activeIndex
                            ? "border-white/30 bg-white/10 text-white"
                            : "border-white/10 bg-white/5 text-slate-200"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold break-words text-wrap">
                            {file.originalName ?? "Attachment"}
                          </p>
                          {file.summary && (
                            <p className="mt-1 text-xs text-slate-400">
                              {file.summary}
                            </p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>
                              {(file.kind ?? "file").toUpperCase()}{" "}
                              {formatBytes(file.size)}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${labelChipStyle(
                                file.label ?? report.surveillanceLabel,
                              )}`}
                            >
                              {(file.label ?? report.surveillanceLabel ?? "routine").toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          Open
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {fullScreenSrc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4">
            <button
              type="button"
              onClick={() => {
                setFullScreenSrc(null);
                setFullScreenKind(null);
              }}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-sm font-semibold text-slate-200"
            >
              X
            </button>
            {fullScreenKind === "video" ? (
              <video
                controls
                playsInline
                autoPlay
                className="max-h-[90vh] w-full max-w-[1200px] object-contain"
                src={fullScreenSrc}
              />
            ) : fullScreenKind === "image" ? (
              <img
                src={fullScreenSrc}
                alt="Attachment preview"
                className="max-h-[90vh] w-full max-w-[1200px] object-contain"
              />
            ) : (
              <iframe
                src={fullScreenSrc}
                title="Attachment preview"
                className="h-[90vh] w-full max-w-[1200px] rounded-lg bg-white"
              />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={onInvestigate}
            className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/40"
          >
            Investigate
          </button>
        </div>
      </div>
    </IHModal>
  );
}
