"use client";

import { useMemo, useState } from "react";
import type { CombinedRecord } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";

type Props = {
  report: CombinedRecord;
  storeName: string;
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

const buildAttachmentSrc = (path?: string) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `/api/uploads/proxy?path=${encodeURIComponent(path)}`;
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

export default function SurveillanceReportModal({
  report,
  storeName,
  onClose,
  onInvestigate,
}: Props) {
  const attachments = useMemo(
    () => report.attachments ?? [],
    [report.attachments],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAttachment = attachments[activeIndex];
  const isRoutine = report.surveillanceLabel?.toLowerCase() === "routine";
  const category = report.surveillanceLabel ?? "Routine";
  const grade = report.surveillanceGrade;
  const gradeReason = report.surveillanceGradeReason;
  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose panelClassName="max-w-[860px]">
      <div className="flex max-h-full flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-300">
              Surveillance Report
            </p>
            <p className="mt-1 text-sm text-slate-200">
              {storeName} · {formatTimestamp(report.createdAt)} ·{" "}
              {category.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!isRoutine && attachments.length > 0 && activeAttachment && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                  Video Preview
                </p>
                {attachments.length > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveIndex((prev) =>
                          prev === 0 ? attachments.length - 1 : prev - 1,
                        )
                      }
                      className="ui-date-step"
                      aria-label="Previous clip"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveIndex((prev) =>
                          prev === attachments.length - 1 ? 0 : prev + 1,
                        )
                      }
                      className="ui-date-step"
                      aria-label="Next clip"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <video
                  controls
                  playsInline
                  className="aspect-video w-full"
                  src={buildAttachmentSrc(activeAttachment.path)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
              Summary
            </p>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              {report.surveillanceSummary ?? report.notes ?? "No summary provided."}
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

          {!isRoutine && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                Incident Metadata
              </p>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                Category: {category}
                <br />
                Reported by: {report.employeeName}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {!isRoutine && (
              <button
                type="button"
                className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
              >
                Mark as Reviewed
              </button>
            )}
            <button
              type="button"
              onClick={onInvestigate}
              className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/40"
            >
              Investigate
            </button>
          </div>
        </div>
      </div>
    </IHModal>
  );
}
