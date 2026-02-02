"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CombinedRecord, SessionUser, StoredFile } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";
import FileViewer from "@/components/records/FileViewer";
import EmployeeChatModal from "@/components/employee/EmployeeChatModal";

const labelStyle = (value?: string) => {
  switch ((value ?? "").toLowerCase()) {
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

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

export default function EmployeeSurveillanceSection({
  user,
}: {
  user: SessionUser;
}) {
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);
  const [explainReport, setExplainReport] = useState<CombinedRecord | null>(null);
  const [explainDraft, setExplainDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [openChat, setOpenChat] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/employee/surveillance?days=7", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load surveillance reports.");
      }
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load surveillance reports.",
      );
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const noReportsCopy = useMemo(
    () => "No surveillance reports shared for you in the last 7 days.",
    [],
  );

  const openExplain = (report: CombinedRecord) => {
    setExplainReport(report);
    const label = report.surveillanceLabel ?? "Surveillance report";
    const created = formatTimestamp(report.createdAt);
    setExplainDraft(`Regarding ${label} from ${created}:`);
  };

  const sendExplanation = async () => {
    if (!explainDraft.trim() || !user.storeNumber) return;
    setSending(true);
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: user.storeNumber,
          type: "surveillance",
          message: explainDraft.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to send explanation.");
      }
      setExplainReport(null);
      setExplainDraft("");
      setOpenChat(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to send explanation.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="ui-card space-y-4 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
          Surveillance day reports
        </p>
        <p className="mt-2 text-sm text-slate-300">
          Reports shared with you by the surveillance team. Use Explain to respond.
        </p>
      </div>

      {message && (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {message}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={`surv-skel-${index}`} className="ui-skeleton h-20" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <p className="text-sm text-slate-400">{noReportsCopy}</p>
      ) : (
        <div className="space-y-3">
          {records.map((report) => {
            const label = report.surveillanceLabel ?? "Routine";
            const summary = report.surveillanceSummary ?? report.notes ?? "";
            const attachments = report.attachments ?? [];
            return (
              <div
                key={report.id}
                className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] ${labelStyle(
                        label,
                      )}`}
                    >
                      {label}
                    </span>
                    <p className="text-sm text-slate-200">
                      {formatTimestamp(report.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openExplain(report)}
                    className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white transition hover:bg-white/20"
                  >
                    Explain
                  </button>
                </div>

                {summary && (
                  <p className="mt-3 text-sm text-slate-200">
                    {summary}
                  </p>
                )}

                {(report.surveillanceGrade || report.surveillanceGradeReason) && (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                    {report.surveillanceGrade && (
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                        Grade: {report.surveillanceGrade}
                      </p>
                    )}
                    {report.surveillanceGradeReason && (
                      <p className="mt-1 text-sm text-slate-200">
                        {report.surveillanceGradeReason}
                      </p>
                    )}
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {attachments.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => setActiveFile(file)}
                        className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-200 hover:bg-white/20"
                      >
                        {file.label || file.originalName || "Attachment"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeFile && (
        <FileViewer file={activeFile} onClose={() => setActiveFile(null)} />
      )}

      <IHModal
        isOpen={Boolean(explainReport)}
        onClose={() => setExplainReport(null)}
        allowOutsideClose
      >
        <div className="w-[min(520px,92vw)] space-y-4">
          <div className="border-b border-white/10 px-6 py-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Explain yourself
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white">
              Message the surveillance team
            </h2>
          </div>
          <div className="space-y-3 px-6">
            <textarea
              value={explainDraft}
              onChange={(event) => setExplainDraft(event.target.value)}
              rows={5}
              className="ui-field min-h-[120px] w-full resize-none"
              placeholder="Share your explanation..."
            />
            <button
              type="button"
              onClick={sendExplanation}
              disabled={sending || !explainDraft.trim()}
              className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {sending ? "Sending..." : "Send explanation"}
            </button>
          </div>
        </div>
      </IHModal>

      {openChat && user.storeNumber && (
        <EmployeeChatModal
          type="surveillance"
          storeId={user.storeNumber}
          storeName={user.storeName ?? `Store ${user.storeNumber}`}
          onClose={() => setOpenChat(false)}
        />
      )}
    </section>
  );
}
