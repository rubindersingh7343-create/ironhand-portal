"use client";

import { useEffect, useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { ScratcherShiftCalculation, ShiftReport, StoredFile } from "@/lib/types";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

type ScratcherCalculationResponse = {
  calculation: ScratcherShiftCalculation | null;
  report: ShiftReport | null;
  scratcherPhotos?: StoredFile[] | null;
  endSnapshotItems?: Array<{ slotId: string; slotNumber: number; ticketValue: string }>;
};

export default function ScratchersInvestigationModal({
  isOpen,
  onClose,
  shiftReportId,
}: {
  isOpen: boolean;
  onClose: () => void;
  shiftReportId: string | null;
}) {
  const [payload, setPayload] = useState<ScratcherCalculationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [disciplineNoticeOpen, setDisciplineNoticeOpen] = useState(false);
  const [disciplineNoticeOption, setDisciplineNoticeOption] =
    useState("Coaching notice");
  const [disciplineNoticeNotes, setDisciplineNoticeNotes] = useState("");
  const [disciplineNoticeSending, setDisciplineNoticeSending] = useState(false);
  const [disciplineNoticeError, setDisciplineNoticeError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen || !shiftReportId) return;
    let active = true;
    setLoading(true);
    fetch(`/api/scratchers/shifts/${shiftReportId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setPayload({
          calculation: data?.calculation ?? null,
          report: data?.report ?? null,
          scratcherPhotos: Array.isArray(data?.scratcherPhotos)
            ? (data.scratcherPhotos as StoredFile[])
            : null,
          endSnapshotItems: Array.isArray(data?.endSnapshotItems)
            ? (data.endSnapshotItems as Array<{
                slotId: string;
                slotNumber: number;
                ticketValue: string;
              }>)
            : [],
        });
      })
      .catch(() => {
        if (!active) return;
        setPayload({
          calculation: null,
          report: null,
          scratcherPhotos: null,
          endSnapshotItems: [],
        });
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, shiftReportId]);

  useEffect(() => {
    if (!isOpen) return;
    setDisciplineNoticeOpen(false);
    setDisciplineNoticeNotes("");
    setDisciplineNoticeError(null);
  }, [isOpen, shiftReportId]);

  const calculation = payload?.calculation ?? null;
  const report = payload?.report ?? null;
  const scratcherPhotos = payload?.scratcherPhotos ?? null;
  const endSnapshotItems = payload?.endSnapshotItems ?? [];
  const flags = calculation?.flags ?? [];
  const missingStart = flags.includes("missing_start_snapshot");
  const missingEnd = flags.includes("missing_end_snapshot");
  const blocked = missingStart || missingEnd;

  const proxyUrlForFile = (file: StoredFile) => {
    const path = file.path ?? file.id;
    return `/api/uploads/proxy?path=${encodeURIComponent(path)}&id=${encodeURIComponent(
      file.id,
    )}&name=${encodeURIComponent(file.originalName ?? file.label ?? "file")}`;
  };

  const breakdown = useMemo(() => {
    if (!calculation?.breakdown?.length) return [];
    return calculation.breakdown.map((row) => ({
      slotNumber: Number(row.slotNumber ?? 0),
      startTicket: String(row.startTicket ?? ""),
      endTicket: String(row.endTicket ?? ""),
      sold: Number(row.sold ?? 0),
      value: Number(row.value ?? 0),
    }));
  }, [calculation?.breakdown]);

  const breakdownFirstHalf = useMemo(
    () => breakdown.filter((row) => row.slotNumber > 0 && row.slotNumber <= 16),
    [breakdown],
  );
  const breakdownSecondHalf = useMemo(
    () => breakdown.filter((row) => row.slotNumber >= 17),
    [breakdown],
  );

  const buildDisciplineNotice = () => {
    const employee = report?.employeeName ?? "Team member";
    const date = report?.date ?? "this shift";
    const storeId = report?.storeId ?? "your store";
    const variance =
      typeof calculation?.varianceValue === "number"
        ? formatMoney(calculation.varianceValue)
        : "—";
    const base = `This is a ${disciplineNoticeOption.toLowerCase()} regarding scratcher counts on ${date} at Store ${storeId}.`;
    const summary = `Scratcher variance: ${variance}.`;
    const flagsLine = flags.length ? `Flags: ${flags.join(", ")}.` : "";
    const closing =
      "Please review your scratcher process and reply in this chat if you have context to share.";
    const note = disciplineNoticeNotes.trim();
    const noteLine = note ? `Owner note: ${note}` : "";
    return [employee + ",", base, summary, flagsLine, closing, noteLine]
      .filter(Boolean)
      .join(" ");
  };

  const handleSendDisciplineNotice = async () => {
    const storeId = report?.storeId;
    if (!storeId) return;
    const messageText = buildDisciplineNotice();
    setDisciplineNoticeSending(true);
    setDisciplineNoticeError(null);
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          type: "owner",
          message: messageText,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to send discipline notice.");
      }
      setDisciplineNoticeOpen(false);
      setDisciplineNoticeNotes("");
    } catch (error) {
      console.error("Failed to send discipline notice", error);
      setDisciplineNoticeError(
        error instanceof Error
          ? error.message
          : "Unable to send discipline notice.",
      );
    } finally {
      setDisciplineNoticeSending(false);
    }
  };

  return (
    <IHModal isOpen={isOpen} onClose={onClose} allowOutsideClose>
      <div className="space-y-4 text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Scratchers investigation
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            {report?.storeId ?? "Shift details"}
          </h3>
          <p className="text-sm text-slate-300">
            {report?.employeeName ?? "Employee"} · {formatDate(report?.date)}
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
            Loading scratcher details…
          </div>
        ) : !calculation ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            No scratcher calculation found for this shift yet.
          </div>
        ) : (
          <>
            {blocked && (
              <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p>Scratcher audit is blocked because snapshots are missing.</p>
                {missingStart && (
                  <p className="mt-1 text-xs text-amber-100">
                    Set a baseline start snapshot to use Scratchers.
                  </p>
                )}
                {missingEnd && (
                  <p className="mt-1 text-xs text-amber-100">
                    Employee must submit the end snapshot for this shift.
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  Expected
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {blocked ? "—" : formatMoney(calculation.expectedTotalValue)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  Reported
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {formatMoney(calculation.reportedScrValue ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  Variance
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {blocked ? "—" : formatMoney(calculation.varianceValue)}
                </p>
              </div>
            </div>

            {flags.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-amber-200">
                Flags: {flags.join(", ")}
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-300">
                Employee End Snapshot
              </p>
              {endSnapshotItems.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  No end snapshot submitted for this shift yet (nothing to show).
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {endSnapshotItems.map((item) => (
                    <div
                      key={`end-snap-${item.slotId}`}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-2"
                    >
                      <span className="text-sm font-semibold text-white">
                        Slot {item.slotNumber || "—"}
                      </span>
                      <span className="font-mono text-sm text-slate-100">
                        {item.ticketValue}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {endSnapshotItems.length > 0 && missingEnd ? (
                <p className="mt-3 text-xs text-amber-200">
                  Note: The calculation is still flagged as missing an end snapshot. Refresh and/or re-open this modal to pull the latest recalculation.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-300">
                Slot breakdown
              </p>
              {breakdown.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  No slot details available yet.
                </p>
              ) : (
                <div className="mt-3 space-y-4 text-sm text-slate-200">
                  {!scratcherPhotos?.length ? (
                    <p className="text-xs text-slate-400">
                      No scratcher photos were uploaded for this shift.
                    </p>
                  ) : null}

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                        Slots 1-16 (rows 1-4)
                      </p>
                      {scratcherPhotos?.[0] ? (
                        <a
                          href={proxyUrlForFile(scratcherPhotos[0])}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-blue-200 hover:underline"
                        >
                          Open photo
                        </a>
                      ) : null}
                    </div>
                    {scratcherPhotos?.[0] ? (
                      <a
                        href={proxyUrlForFile(scratcherPhotos[0])}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block overflow-hidden rounded-xl border border-white/10 bg-black/30"
                      >
                        <img
                          src={proxyUrlForFile(scratcherPhotos[0])}
                          alt="Scratcher rows 1-4"
                          className="max-h-[260px] w-full object-contain"
                        />
                      </a>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      {breakdownFirstHalf.map((row, index) => (
                        <div
                          key={`half-a-${row.slotNumber}-${index}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111b34] px-4 py-2"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">
                              Slot {row.slotNumber || "—"}
                            </p>
                            <p className="text-xs text-slate-400">
                              Start {row.startTicket || "—"} · End {row.endTicket || "—"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Sold</p>
                            <p className="text-sm text-white">{row.sold}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Value</p>
                            <p className="text-sm text-white">{formatMoney(row.value)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                        Slots 17-32 (rows 5-8)
                      </p>
                      {scratcherPhotos?.[1] ? (
                        <a
                          href={proxyUrlForFile(scratcherPhotos[1])}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-blue-200 hover:underline"
                        >
                          Open photo
                        </a>
                      ) : null}
                    </div>
                    {scratcherPhotos?.[1] ? (
                      <a
                        href={proxyUrlForFile(scratcherPhotos[1])}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block overflow-hidden rounded-xl border border-white/10 bg-black/30"
                      >
                        <img
                          src={proxyUrlForFile(scratcherPhotos[1])}
                          alt="Scratcher rows 5-8"
                          className="max-h-[260px] w-full object-contain"
                        />
                      </a>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      {breakdownSecondHalf.map((row, index) => (
                        <div
                          key={`half-b-${row.slotNumber}-${index}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111b34] px-4 py-2"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">
                              Slot {row.slotNumber || "—"}
                            </p>
                            <p className="text-xs text-slate-400">
                              Start {row.startTicket || "—"} · End {row.endTicket || "—"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Sold</p>
                            <p className="text-sm text-white">{row.sold}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Value</p>
                            <p className="text-sm text-white">{formatMoney(row.value)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDisciplineNoticeOpen(true)}
                className="rounded-full border border-blue-400/50 px-4 py-2 text-xs font-semibold text-blue-100 transition hover:border-blue-300"
              >
                Discipline Employee
              </button>
            </div>
          </>
        )}
      </div>

      {disciplineNoticeOpen && (
        <IHModal
          isOpen
          onClose={() => setDisciplineNoticeOpen(false)}
          allowOutsideClose
          backdropClassName="z-[10000]"
          panelClassName="max-w-lg"
        >
          <div className="flex flex-col overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Discipline Notice
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  "Coaching notice",
                  "Written warning",
                  "Final warning",
                  "Suspension review",
                ].map((option) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl border px-3 py-2 text-sm ${
                      disciplineNoticeOption === option
                        ? "border-blue-400/40 bg-blue-500/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span>{option}</span>
                    <input
                      type="radio"
                      name="discipline-notice-scratchers"
                      value={option}
                      checked={disciplineNoticeOption === option}
                      onChange={() => setDisciplineNoticeOption(option)}
                      className="h-3 w-3 accent-blue-500"
                    />
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-300">
                  Owner note (optional)
                </label>
                <textarea
                  value={disciplineNoticeNotes}
                  onChange={(event) => setDisciplineNoticeNotes(event.target.value)}
                  placeholder="Add a short note for the employee..."
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-[#0b152a] px-3 py-2 text-sm text-white placeholder:text-slate-400"
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                  Message Preview
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-white">
                  {buildDisciplineNotice()}
                </p>
              </div>
              {disciplineNoticeError ? (
                <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {disciplineNoticeError}
                </div>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSendDisciplineNotice}
                  disabled={disciplineNoticeSending}
                  className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {disciplineNoticeSending ? "Sending..." : "Send Notice"}
                </button>
              </div>
            </div>
          </div>
        </IHModal>
      )}
    </IHModal>
  );
}
