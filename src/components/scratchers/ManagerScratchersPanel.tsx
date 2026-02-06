"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ScratcherPackEvent,
  ScratcherShiftCalculation,
  SessionUser,
  StoredFile,
} from "@/lib/types";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import ScratchersAdminPanel from "@/components/scratchers/ScratchersAdminPanel";
import ScratchersInvestigationModal from "@/components/scratchers/ScratchersInvestigationModal";
import ScratchersLogbookModal from "@/components/scratchers/ScratchersLogbookModal";
import FileViewer from "@/components/records/FileViewer";
import type { ShiftReport } from "@/lib/types";

interface StoreSummary {
  storeId: string;
  storeName?: string;
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

export default function ManagerScratchersPanel({ user }: { user: SessionUser }) {
  const ownerStore = useOwnerPortalStore();
  const manualDateRange = ownerStore?.manualDateRange ?? null;
  const setManualDateRange = ownerStore?.setManualDateRange;
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [storeId, setStoreId] = useState(user.storeNumber);
  const [discrepancies, setDiscrepancies] = useState<
    Array<ScratcherShiftCalculation & { report?: ShiftReport | null }>
  >([]);
  const [events, setEvents] = useState<ScratcherPackEvent[]>([]);
  const [calculations, setCalculations] = useState<
    Array<ScratcherShiftCalculation & { report?: ShiftReport | null }>
  >([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventPackId, setEventPackId] = useState<string | null>(null);
  const [eventNote, setEventNote] = useState("");
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [eventType, setEventType] = useState<"note" | "return_receipt">("note");
  const [logbookOpen, setLogbookOpen] = useState(false);
  const [investigateShiftId, setInvestigateShiftId] = useState<string | null>(null);
  const [videoLoadingId, setVideoLoadingId] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dateTouched, setDateTouched] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load stores");
        const data = await response.json().catch(() => ({}));
        const nextStores = Array.isArray(data.stores) ? data.stores : [];
        setStores(nextStores);
        if (
          nextStores.length &&
          !nextStores.some((store: StoreSummary) => store.storeId === storeId)
        ) {
          setStoreId(nextStores[0]?.storeId ?? storeId);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
      }
    };
    loadStores();
    return () => controller.abort();
  }, [storeId]);

  const loadData = useCallback(async () => {
    if (!storeId) return;
    setStatus("loading");
    try {
      const [discrepancyRes, eventRes, calcRes] = await Promise.all([
        fetch(`/api/scratchers/discrepancies?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/scratchers/packs/events?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/scratchers/calculations?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
      ]);
      const discrepancyData = await discrepancyRes.json().catch(() => ({}));
      const eventData = await eventRes.json().catch(() => ({}));
      const calcData = await calcRes.json().catch(() => ({}));
      setDiscrepancies(
        Array.isArray(discrepancyData.discrepancies)
          ? discrepancyData.discrepancies
          : [],
      );
      setEvents(Array.isArray(eventData.events) ? eventData.events : []);
      setCalculations(
        Array.isArray(calcData.calculations) ? calcData.calculations : [],
      );
      setStatus("idle");
    } catch (error) {
      console.error("Failed to load scratcher data", error);
      setStatus("error");
    }
  }, [storeId]);

  const openReceipt = useCallback(async (fileId?: string | null) => {
    if (!fileId) return;
    const response = await fetch(
      `/api/scratchers/files?id=${encodeURIComponent(fileId)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    setActiveFile(data.file ?? null);
  }, []);

  const submitEvent = useCallback(async () => {
    if (!eventPackId) return;
    if (eventType === "return_receipt" && !eventFile) return;
    const formData = new FormData();
    formData.append("packId", eventPackId);
    formData.append("eventType", eventType);
    formData.append("note", eventNote);
    if (eventFile) {
      formData.append("file", eventFile);
    }
    const response = await fetch("/api/scratchers/packs/events", {
      method: "POST",
      body: formData,
    });
    if (response.ok) {
      setEventOpen(false);
      setEventNote("");
      setEventFile(null);
      await loadData();
    }
  }, [eventFile, eventNote, eventPackId, eventType, loadData]);

  const openEventModal = (options: {
    packId: string;
    type: "note" | "return_receipt";
  }) => {
    setEventPackId(options.packId);
    setEventType(options.type);
    setEventNote("");
    setEventFile(null);
    setEventOpen(true);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const normalizeDate = (value?: string | null) => {
    if (!value) return "";
    if (value.includes("T")) {
      return new Date(value).toLocaleDateString("en-CA");
    }
    return value;
  };

  const openScratcherCountMedia = useCallback(
    async (calc: ScratcherShiftCalculation & { report?: ShiftReport | null }) => {
      if (!storeId) return;
      const reportDate = normalizeDate(calc.report?.date);
      if (!reportDate) {
        setVideoErrors((prev) => ({
          ...prev,
          [calc.id]: "Missing shift date for this report.",
        }));
        return;
      }
      setVideoLoadingId(calc.id);
      setVideoErrors((prev) => ({ ...prev, [calc.id]: "" }));
      try {
        const params = new URLSearchParams({
          store_id: storeId,
          date: reportDate,
          employee_name: calc.report?.employeeName ?? "",
        });
        const response = await fetch(`/api/owner/shift-uploads?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const files = Array.isArray(data.files) ? data.files : [];
        const scratcherFiles = files.filter((file: StoredFile) =>
          (file.label ?? "").toLowerCase().includes("scratcher"),
        );
        const getRow = (file: StoredFile) => {
          const match = (file.label ?? "").match(/row\\s*(\\d+)/i);
          if (!match) return Number.POSITIVE_INFINITY;
          const parsed = Number(match[1]);
          return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
        };
        scratcherFiles.sort((a: StoredFile, b: StoredFile) => getRow(a) - getRow(b));
        const media = scratcherFiles[0] ?? files.find((file: StoredFile) => file.kind === "video");
        if (!media) {
          setVideoErrors((prev) => ({
            ...prev,
            [calc.id]: "No scratcher count upload found for this shift.",
          }));
          return;
        }
        setActiveFile(media);
      } catch (error) {
        console.error("Failed to load scratcher count upload", error);
        setVideoErrors((prev) => ({
          ...prev,
          [calc.id]: "Unable to load scratcher count upload.",
        }));
      } finally {
        setVideoLoadingId((prev) => (prev === calc.id ? null : prev));
      }
    },
    [storeId, normalizeDate],
  );

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [events],
  );

  const latestReportDate = useMemo(() => {
    if (!calculations.length) return "";
    let latestValue = "";
    let latestTime = 0;
    calculations.forEach((calc) => {
      const rawDate = calc.report?.date ?? calc.updatedAt ?? calc.createdAt;
      if (!rawDate) return;
      const time = new Date(rawDate).getTime();
      if (!Number.isNaN(time) && time >= latestTime) {
        latestTime = time;
        latestValue = rawDate;
      }
    });
    return normalizeDate(latestValue);
  }, [calculations]);

  useEffect(() => {
    if (!dateTouched && latestReportDate) {
      if (startDate !== latestReportDate) setStartDate(latestReportDate);
      if (endDate !== latestReportDate) setEndDate(latestReportDate);
    }
  }, [dateTouched, latestReportDate, startDate, endDate]);

  useEffect(() => {
    if (!manualDateRange?.startDate) return;
    const nextStart = manualDateRange.startDate;
    const nextEnd = manualDateRange.endDate ?? manualDateRange.startDate;
    if (nextStart !== startDate) setStartDate(nextStart);
    if (nextEnd !== endDate) setEndDate(nextEnd);
    if (!dateTouched) setDateTouched(true);
  }, [manualDateRange, startDate, endDate, dateTouched]);

  const shiftDate = (value: string, delta: number) => {
    if (!value) return value;
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + delta);
    return date.toISOString().slice(0, 10);
  };

  const shiftRange = (delta: number) => {
    if (!startDate) return;
    const nextStart = shiftDate(startDate, delta);
    const nextEnd = shiftDate(endDate || startDate, delta);
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setDateTouched(true);
    setManualDateRange?.({ startDate: nextStart, endDate: nextEnd });
  };

  const inRange = useCallback(
    (value?: string | null) => {
      const date = normalizeDate(value);
      if (!date) return false;
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    },
    [startDate, endDate],
  );

  const filteredDiscrepancies = useMemo(
    () =>
      discrepancies.filter((calc) =>
        inRange(calc.report?.date ?? calc.updatedAt ?? calc.createdAt),
      ),
    [discrepancies, inRange],
  );

  const filteredCalculations = useMemo(
    () =>
      calculations.filter((calc) =>
        inRange(calc.report?.date ?? calc.updatedAt ?? calc.createdAt),
      ),
    [calculations, inRange],
  );

  const sortedCalculations = useMemo(
    () =>
      [...filteredCalculations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [filteredCalculations],
  );

  const recentUploads = useMemo(() => {
    const entries = filteredCalculations
      .map((calc) => {
        const reportDate = normalizeDate(calc.report?.date ?? calc.updatedAt ?? calc.createdAt);
        return {
          calc,
          reportDate,
        };
      })
      .filter((entry) => entry.reportDate);

    entries.sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime(),
    );

    const seen = new Set<string>();
    const rows: Array<{
      key: string;
      employeeName: string;
      reportDate: string;
      expectedValue: number;
    }> = [];
    entries.forEach(({ calc, reportDate }) => {
      const employeeName = calc.report?.employeeName ?? "Employee";
      if (seen.has(employeeName)) return;
      seen.add(employeeName);
      rows.push({
        key: calc.id,
        employeeName,
        reportDate,
        expectedValue: calc.expectedTotalValue,
      });
    });
    return rows;
  }, [filteredCalculations]);

  return (
    <section className="ui-card text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Scratchers Reports
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Discrepancies
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="ui-field appearance-none pr-8"
          >
            {stores.map((store) => (
              <option key={store.storeId} value={store.storeId}>
                {store.storeName ?? `Store ${store.storeId}`}
              </option>
            ))}
          </select>
          <div className="reports-date-range">
            <button
              type="button"
              onClick={() => shiftRange(-1)}
              className="ui-date-step"
              aria-label="Previous day"
            >
              ‹
            </button>
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                const next = event.target.value;
                const nextEnd = endDate && endDate >= next ? endDate : next;
                setStartDate(next);
                setEndDate(nextEnd);
                setDateTouched(true);
                setManualDateRange?.({ startDate: next, endDate: nextEnd });
              }}
              className="ui-field ui-field--slim"
            />
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              To
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                const next = event.target.value;
                const nextStart = startDate && startDate <= next ? startDate : next;
                setEndDate(next);
                setStartDate(nextStart);
                setDateTouched(true);
                setManualDateRange?.({ startDate: nextStart, endDate: next });
              }}
              className="ui-field ui-field--slim"
            />
            <button
              type="button"
              onClick={() => shiftRange(1)}
              className="ui-date-step"
              aria-label="Next day"
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
            onClick={loadData}
            aria-label="Refresh scratcher data"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v6h-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setLogbookOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
            aria-label="Open scratcher logbook"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
            onClick={() => setSetupOpen(true)}
            aria-label="Manage scratchers"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .33 1.7 1.7 0 0 0-.67.87l-.02.06a2 2 0 1 1-3.63 0l-.02-.06a1.7 1.7 0 0 0-.67-.87 1.7 1.7 0 0 0-1-.33 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.33-1 1.7 1.7 0 0 0-.87-.67l-.06-.02a2 2 0 1 1 0-3.63l.06-.02a1.7 1.7 0 0 0 .87-.67 1.7 1.7 0 0 0 .33-1 1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6c.33 0 .66-.11.95-.29a1.7 1.7 0 0 0 .67-.87l.02-.06a2 2 0 1 1 3.63 0l.02.06c.12.35.36.67.67.87.29.18.62.29.95.29a1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05a1.7 1.7 0 0 0-.34 1.87c.18.29.29.62.29.95 0 .33-.11.66-.29.95a1.7 1.7 0 0 0-.34 1.87Z" />
            </svg>
          </button>
        </div>
      </div>

      {status === "error" && (
        <p className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
          Unable to load scratcher data. Try again.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
            Recent uploads
          </p>
          {status === "loading" ? (
            <p className="mt-3 text-sm text-slate-400">Loading uploads…</p>
          ) : recentUploads.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No scratcher uploads found for this date.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentUploads.slice(0, 6).map((upload) => (
                <div
                  key={upload.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      {upload.employeeName}
                    </p>
                    <p className="mt-1 text-sm text-slate-200">
                      Uploaded {upload.reportDate}
                    </p>
                  </div>
                  <p className="ui-tabular text-sm text-white">
                    {formatMoney(upload.expectedValue)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
            Flagged shifts
          </p>
          {status === "loading" ? (
            <p className="mt-3 text-sm text-slate-400">Loading discrepancies…</p>
          ) : filteredDiscrepancies.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No scratcher discrepancies for this store.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {filteredDiscrepancies.map((calc) => {
                const missingStart = calc.flags?.includes("missing_start_snapshot");
                const missingEnd = calc.flags?.includes("missing_end_snapshot");
                const blocked = missingStart || missingEnd;
                return (
                <div
                  key={calc.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      {calc.report?.employeeName ?? "Employee"} ·{" "}
                      {calc.report?.date ?? calc.shiftReportId.slice(0, 8)}
                    </p>
                    {blocked ? (
                      <div className="mt-1 space-y-1 text-sm text-amber-200">
                        <p>Blocked: missing snapshots</p>
                        {missingStart && (
                          <p className="text-xs text-amber-100">
                            Set a baseline start snapshot to use Scratchers.
                          </p>
                        )}
                        {missingEnd && (
                          <p className="text-xs text-amber-100">
                            Employee must submit the end snapshot for this shift.
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 text-sm text-slate-200">
                          Expected {formatMoney(calc.expectedTotalValue)} · Reported{" "}
                          {formatMoney(calc.reportedScrValue ?? 0)}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          Sold tickets: {calc.expectedTotalTickets}
                        </p>
                      </>
                    )}
                    {calc.flags?.length ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Flags: {calc.flags.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Variance
                    </p>
                    <p className="ui-tabular text-sm text-white">
                      {blocked ? "—" : formatMoney(calc.varianceValue)}
                    </p>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => openScratcherCountMedia(calc)}
                      disabled={videoLoadingId === calc.id}
                      aria-label="View scratcher count upload"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M10 8.5 16 12l-6 3.5z" fill="currentColor" />
                        <rect x="4" y="5" width="16" height="14" rx="2" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-white/50"
                      onClick={() => setInvestigateShiftId(calc.shiftReportId)}
                      aria-label="Investigate scratcher shift"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="6" />
                        <path d="m20 20-3.5-3.5" />
                      </svg>
                    </button>
                  </div>
                  {videoErrors[calc.id] ? (
                    <p className="mt-2 text-xs text-amber-200">
                      {videoErrors[calc.id]}
                    </p>
                  ) : null}
                </div>
              )})}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
            Recent calculations
          </p>
          {status === "loading" ? (
            <p className="mt-3 text-sm text-slate-400">Loading calculations…</p>
          ) : sortedCalculations.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No scratcher calculations yet.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {sortedCalculations.slice(0, 6).map((calc) => {
                const missingStart = calc.flags?.includes("missing_start_snapshot");
                const missingEnd = calc.flags?.includes("missing_end_snapshot");
                const blocked = missingStart || missingEnd;
                return (
                <div
                  key={calc.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      {calc.report?.employeeName ?? "Employee"} ·{" "}
                      {calc.report?.date ?? calc.shiftReportId.slice(0, 8)}
                    </p>
                    {blocked ? (
                      <div className="mt-1 space-y-1 text-sm text-amber-200">
                        <p>Blocked: missing snapshots</p>
                        {missingStart && (
                          <p className="text-xs text-amber-100">
                            Set a baseline start snapshot to use Scratchers.
                          </p>
                        )}
                        {missingEnd && (
                          <p className="text-xs text-amber-100">
                            Employee must submit the end snapshot for this shift.
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 text-sm text-slate-200">
                          Expected {formatMoney(calc.expectedTotalValue)} · Reported{" "}
                          {formatMoney(calc.reportedScrValue ?? 0)}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          Sold tickets: {calc.expectedTotalTickets}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Variance
                    </p>
                    <p className="ui-tabular text-sm text-white">
                      {blocked ? "—" : formatMoney(calc.varianceValue)}
                    </p>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-white/50"
                      onClick={() => setInvestigateShiftId(calc.shiftReportId)}
                      aria-label="Investigate scratcher shift"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="6" />
                        <path d="m20 20-3.5-3.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>

      </div>

      <ScratchersAdminPanel
        storeId={storeId}
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onRefresh={loadData}
      />

      <ScratchersInvestigationModal
        isOpen={Boolean(investigateShiftId)}
        shiftReportId={investigateShiftId}
        onClose={() => setInvestigateShiftId(null)}
      />

      <ScratchersLogbookModal
        isOpen={logbookOpen}
        onClose={() => setLogbookOpen(false)}
        events={sortedEvents}
        onViewReceipt={openReceipt}
        onAddNote={(packId) => openEventModal({ packId, type: "note" })}
        onAddPickupReceipt={(packId) =>
          openEventModal({ packId, type: "return_receipt" })
        }
      />

      {eventOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="ui-card w-full max-w-md space-y-4 text-white">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">
              {eventType === "return_receipt" ? "Pickup receipt" : "Pack note"}
            </p>
            <textarea
              value={eventNote}
              onChange={(event) => setEventNote(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
              placeholder="Add context"
            />
            <input
              type="file"
              onChange={(event) => setEventFile(event.target.files?.[0] ?? null)}
              className="text-sm text-slate-200"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="ui-button ui-button-ghost"
                onClick={() => setEventOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="ui-button" onClick={submitEvent}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {activeFile && (
        <FileViewer file={activeFile} onClose={() => setActiveFile(null)} />
      )}
    </section>
  );
}
