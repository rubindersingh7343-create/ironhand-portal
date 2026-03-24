"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CombinedRecord, SessionUser } from "@/lib/types";
import SurveillanceInvestigateModal from "@/components/client/SurveillanceInvestigateModal";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import IHModal from "@/components/ui/IHModal";

type StoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type IncidentCategory = "critical" | "theft" | "incident";

const incidentLabels: IncidentCategory[] = ["critical", "theft", "incident"];

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

type SurveillanceIncident = {
  id: string;
  category: IncidentCategory;
  timestamp: string;
  record: CombinedRecord;
  file: CombinedRecord["attachments"][number];
};

const statusStyles = {
  submitted: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200",
  pending: "border-amber-300/40 bg-amber-400/15 text-amber-100",
} as const;

const categoryStyles: Record<IncidentCategory, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  theft: "border-orange-200 bg-orange-50 text-orange-800",
  incident: "border-blue-200 bg-blue-50 text-blue-800",
};

const gradePillClass = (grade?: string) => {
  const key = (grade ?? "").toUpperCase();
  if (key.startsWith("A")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (key.startsWith("B")) {
    return "border-lime-200 bg-lime-50 text-lime-800";
  }
  if (key.startsWith("C")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (key.startsWith("D") || key.startsWith("F")) {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-slate-200 bg-white text-slate-700";
};

const gradeScale = [
  { grade: "A+", points: 4.3 },
  { grade: "A", points: 4.0 },
  { grade: "A-", points: 3.7 },
  { grade: "B+", points: 3.3 },
  { grade: "B", points: 3.0 },
  { grade: "B-", points: 2.7 },
  { grade: "C+", points: 2.3 },
  { grade: "C", points: 2.0 },
  { grade: "C-", points: 1.7 },
  { grade: "D", points: 1.0 },
  { grade: "F", points: 0.0 },
];

const gradeToPoints = (grade?: string) => {
  if (!grade) return null;
  const match = gradeScale.find(
    (entry) => entry.grade === grade.toUpperCase(),
  );
  return match ? match.points : null;
};

const pointsToGrade = (points: number) => {
  const sorted = [...gradeScale].sort((a, b) => b.points - a.points);
  for (const entry of sorted) {
    if (points >= entry.points) return entry.grade;
  }
  return "F";
};

export default function SurveillanceReportsSection({
  user,
}: {
  user: SessionUser;
}) {
  const ownerStore = useOwnerPortalStore();
  const hasSharedStore = Boolean(ownerStore);
  const manualDateRange = ownerStore?.manualDateRange ?? null;
  const setManualDateRange = ownerStore?.setManualDateRange;
  const [stores, setStores] = useState<StoreSummary[]>(
    ownerStore?.stores ?? [],
  );
  const storeOptions = useMemo(() => stores, [stores]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedStore, setSelectedStore] = useState(
    ownerStore?.selectedStoreId ?? user.storeNumber ?? "",
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeInvestigate, setActiveInvestigate] = useState<CombinedRecord | null>(
    null,
  );
  const hasSurveillanceInvestigationAPI = true;
  const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});
  const [unseenIds, setUnseenIds] = useState<string[]>([]);
  const selectedStoreMeta = useMemo(
    () => stores.find((store) => store.storeId === selectedStore),
    [stores, selectedStore],
  );
  const showUpgrade =
    Boolean(selectedStoreMeta?.hasManager) &&
    !selectedStoreMeta?.hasSurveillance;

  useEffect(() => {
    if (ownerStore) {
      setStores(ownerStore.stores);
      if (ownerStore.selectedStoreId) {
        setSelectedStore(ownerStore.selectedStoreId);
      }
      return;
    }
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const nextStores: StoreSummary[] = Array.isArray(data.stores)
          ? data.stores
          : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        const merged: StoreSummary[] = nextStores.length ? nextStores : fallback;
        setStores(merged);
        setSelectedStore((prev) =>
          merged.some((store: StoreSummary) => store.storeId === prev)
            ? prev
            : merged[0]?.storeId ?? prev,
        );
      } catch (error) {
        console.error("Failed to load stores", error);
        setStores(
          user.storeNumber
            ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
            : [],
        );
      }
    };
    loadStores();
  }, [ownerStore, ownerStore?.stores, ownerStore?.selectedStoreId, user.storeNumber]);

  const loadUnseen = useCallback(
    async (storeOverride?: string) => {
      if (!selectedStore) return;
      try {
        const storeParam = storeOverride ?? selectedStore;
        const response = await fetch(
          `/api/owner/unseen?type=surveillance&storeId=${encodeURIComponent(
            storeParam,
          )}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setUnseenCounts(data.counts ?? {});
          setUnseenIds(Array.isArray(data.unseenIds) ? data.unseenIds : []);
        }
      } catch (error) {
        console.error("Failed to load surveillance unseen markers", error);
      }
    },
    [selectedStore],
  );

  const loadReports = useCallback(
    async (silent = false) => {
      if (!selectedStore) {
        setRecords([]);
        return;
      }
      if (!silent) {
        setLoading(true);
      }
      setMessage(null);
      try {
        const params = new URLSearchParams({
          category: "surveillance",
          store: selectedStore,
        });
        const response = await fetch(`/api/records?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load surveillance reports.");
        }
        const nextRecords = Array.isArray(data.records) ? data.records : [];
        setRecords(nextRecords);
        loadUnseen(selectedStore);
      } catch (error) {
        console.error("Failed to load surveillance reports", error);
        setRecords([]);
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load surveillance reports.",
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [selectedStore, loadUnseen],
  );

  useEffect(() => {
    loadReports(false);
  }, [loadReports]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadReports(true);
      loadUnseen();
    }, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadReports(true);
        loadUnseen();
      }
    };
    const handleFocus = () => {
      loadReports(true);
      loadUnseen();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadReports]);

  useEffect(() => {
    loadUnseen();
  }, [loadUnseen]);

  const markSurveillanceSeen = async (record: CombinedRecord | null) => {
    if (!record) return;
    await fetch("/api/owner/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            storeId: record.storeNumber,
            itemType: "surveillance",
            itemId: record.id,
          },
        ],
      }),
    });
    setUnseenIds((prev) => prev.filter((id) => id !== record.id));
    setUnseenCounts((prev) => ({
      ...prev,
      [record.storeNumber]: Math.max(0, (prev[record.storeNumber] ?? 1) - 1),
    }));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ih-nav-badges-refresh"));
    }
  };

  const shiftDate = (value: string, delta: number) => {
    if (!value) return value;
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + delta);
    return date.toISOString().slice(0, 10);
  };

  const localDateString = (value: string) =>
    new Date(value).toLocaleDateString("en-CA");

  const sortedRecords = useMemo(() => {
    return [...records].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [records]);
  const latestRecordDate =
    sortedRecords[0]?.createdAt ? localDateString(sortedRecords[0].createdAt) : "";
  const recordsForDate = records.filter(
    (record) => localDateString(record.createdAt) === selectedDate,
  );

  const unseenSet = useMemo(() => new Set(unseenIds), [unseenIds]);
  const unseenForSelectedDate = useMemo(
    () => recordsForDate.filter((record) => unseenSet.has(record.id)),
    [recordsForDate, unseenSet],
  );

  useEffect(() => {
    const markVisibleSeen = async () => {
      if (!recordsForDate.length) return;
      const unseenRecords = recordsForDate.filter((record) => unseenSet.has(record.id));
      if (!unseenRecords.length) return;
      await fetch("/api/owner/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: unseenRecords.map((record) => ({
            storeId: record.storeNumber,
            itemType: "surveillance",
            itemId: record.id,
          })),
        }),
      });
      setUnseenIds((prev) =>
        prev.filter((id) => !unseenRecords.some((record) => record.id === id)),
      );
      setUnseenCounts((prev) => {
        const next = { ...prev };
        unseenRecords.forEach((record) => {
          next[record.storeNumber] = Math.max(0, (next[record.storeNumber] ?? 1) - 1);
        });
        return next;
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("ih-nav-badges-refresh"));
      }
    };
    markVisibleSeen();
  }, [recordsForDate, unseenSet]);
  const unseenCountForSelectedDate = unseenForSelectedDate.length;

  useEffect(() => {
    if (!dateTouched && latestRecordDate && latestRecordDate !== selectedDate) {
      setSelectedDate(latestRecordDate);
    }
  }, [dateTouched, latestRecordDate, selectedDate]);

  useEffect(() => {
    if (!manualDateRange?.startDate) return;
    if (manualDateRange.startDate !== selectedDate) {
      setSelectedDate(manualDateRange.startDate);
    }
    if (!dateTouched) setDateTouched(true);
  }, [manualDateRange, selectedDate, dateTouched]);

  const routineRecords = useMemo(() => {
    const labeledRoutine = recordsForDate.filter(
      (record) => record.surveillanceLabel?.toLowerCase() === "routine",
    );
    if (labeledRoutine.length) return labeledRoutine;
    return recordsForDate;
  }, [recordsForDate]);

  const averageGradeByEmployee = useMemo(() => {
    const totals = new Map<string, { sum: number; count: number }>();
    records.forEach((record) => {
      if (!record.employeeName) return;
      const points = gradeToPoints(record.surveillanceGrade);
      if (points === null) return;
      const existing = totals.get(record.employeeName) ?? { sum: 0, count: 0 };
      existing.sum += points;
      existing.count += 1;
      totals.set(record.employeeName, existing);
    });
    const averages = new Map<string, string>();
    totals.forEach((value, key) => {
      if (value.count) {
        averages.set(key, pointsToGrade(value.sum / value.count));
      }
    });
    return averages;
  }, [records]);

  const routineEmployees = useMemo(() => {
    const latestByEmployee = new Map<string, CombinedRecord>();
    [...routineRecords]
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .forEach((record) => {
        if (!record.employeeName) return;
        if (!latestByEmployee.has(record.employeeName)) {
          latestByEmployee.set(record.employeeName, record);
        }
      });
    return Array.from(latestByEmployee.entries()).map(([name, record]) => ({
      name,
      grade: record.surveillanceGrade ?? "",
      avgGrade: (averageGradeByEmployee.get(name) ?? "").replace(/^avg\\s+/i, ""),
      record,
    }));
  }, [routineRecords, averageGradeByEmployee]);

  const incidents = recordsForDate.flatMap((record) => {
    const timestamp = new Date(record.createdAt).toLocaleString();
    return (record.attachments ?? [])
      .map((file) => ({
        id: `${record.id}-${file.id ?? file.path ?? file.originalName ?? "file"}`,
        category: (file.label ?? "").toLowerCase() as IncidentCategory,
        timestamp,
        record,
        file,
      }))
      .filter((entry) => incidentLabels.includes(entry.category));
  });

  const hasReports = recordsForDate.length > 0;
  const activeStoreName =
    storeOptions.find((store) => store.storeId === selectedStore)?.storeName ??
    `Store ${selectedStore}`;

  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [attachmentViewerFile, setAttachmentViewerFile] = useState<
    CombinedRecord["attachments"][number] | null
  >(null);

  const openAttachmentViewer = (
    file?: CombinedRecord["attachments"][number] | null,
  ) => {
    if (!file) return;
    setAttachmentViewerFile(file);
    setAttachmentViewerOpen(true);
  };

  const [selectedRoutineRecordId, setSelectedRoutineRecordId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!routineEmployees.length) {
      setSelectedRoutineRecordId(null);
      return;
    }
    if (
      selectedRoutineRecordId &&
      routineEmployees.some((entry) => entry.record.id === selectedRoutineRecordId)
    ) {
      return;
    }
    setSelectedRoutineRecordId(routineEmployees[0]?.record.id ?? null);
  }, [routineEmployees, selectedRoutineRecordId]);

  const selectedRoutineEntry = useMemo(() => {
    if (!selectedRoutineRecordId) return null;
    return (
      routineEmployees.find((entry) => entry.record.id === selectedRoutineRecordId) ??
      null
    );
  }, [routineEmployees, selectedRoutineRecordId]);

  const routineSummaryLines = useMemo(() => {
    const record = selectedRoutineEntry?.record;
    const summary = record?.surveillanceSummary ?? record?.notes ?? "";
    return summary ? summary.split("\n") : [];
  }, [selectedRoutineEntry]);

  return (
    <section className="ui-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-slate-700">
          Surveillance
        </h2>
      </div>

      <div className="reports-filter-row">
        {!hasSharedStore && (
          <div className="relative">
            <select
              value={selectedStore}
              onChange={(event) => {
                setSelectedStore(event.target.value);
                setDateTouched(false);
              }}
              className="ui-field ui-field--slim appearance-none pr-7"
            >
              {storeOptions.map((store) => {
                const count =
                  store.storeId === selectedStore ? unseenCountForSelectedDate : 0;
                const label = store.storeName ?? `Store ${store.storeId}`;
                return (
                  <option key={store.storeId} value={store.storeId}>
                    {count > 0 ? `${label} • ${count}` : label}
                  </option>
                );
              })}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              ▾
            </span>
            {unseenCountForSelectedDate > 0 ? (
              <span className="pointer-events-none absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-400" />
            ) : null}
          </div>
        )}
        <div className="reports-date-range">
          <button
            type="button"
            onClick={() => {
              const next = shiftDate(selectedDate, -1);
              setDateTouched(true);
              setSelectedDate(next);
              setManualDateRange?.({ startDate: next, endDate: next });
            }}
            className="ui-date-step"
            aria-label="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              const next = event.target.value;
              setDateTouched(true);
              setSelectedDate(next);
              setManualDateRange?.({ startDate: next, endDate: next });
            }}
            className="ui-field ui-field--slim"
          />
          <button
            type="button"
            onClick={() => {
              const next = shiftDate(selectedDate, 1);
              setDateTouched(true);
              setSelectedDate(next);
              setManualDateRange?.({ startDate: next, endDate: next });
            }}
            className="ui-date-step"
            aria-label="Next day"
          >
            ›
          </button>
        </div>
      </div>

      {showUpgrade ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          Upgrade to premium to access this feature.
        </div>
      ) : (
        <div className="mt-6">
          <div className="space-y-4">
              {loading ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                    <div className="ui-skeleton h-4 w-44" />
                    <div className="mt-2 ui-skeleton h-3 w-32" />
                  </div>
                <div className="space-y-2">
                  <div className="ui-skeleton h-3 w-20" />
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-28" />
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-28" />
                  </div>
                </div>
              </div>
            ) : !hasReports ? (
              <p className="text-sm text-slate-600">
                {message ?? "No uploads today."}
              </p>
            ) : (
              <>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                      Summary
                    </p>
                    {selectedRoutineEntry?.record ? (
                      <button
                        type="button"
                        onClick={() => {
                          markSurveillanceSeen(selectedRoutineEntry.record);
                          setActiveInvestigate(selectedRoutineEntry.record);
                        }}
                        className="ui-icon-btn ui-icon-btn--primary"
                        aria-label="Investigate"
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
                    ) : null}
                  </div>

                  {routineEmployees.length ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {routineEmployees.map((entry) => {
                          const isActive = entry.record.id === selectedRoutineRecordId;
                          return (
                            <button
                              key={entry.record.id}
                              type="button"
                              onClick={() => {
                                markSurveillanceSeen(entry.record);
                                setSelectedRoutineRecordId(entry.record.id);
                              }}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-left text-xs font-semibold transition ${
                                isActive
                                  ? "border-blue-200 bg-blue-50 text-blue-900"
                                  : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                              }`}
                            >
                              <span className="max-w-[14ch] truncate">{entry.name}</span>
                              {unseenSet.has(entry.record.id) ? (
                                <span className="h-2 w-2 rounded-full bg-blue-400" />
                              ) : null}
                              {entry.grade ? (
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${gradePillClass(
                                    entry.grade,
                                  )}`}
                                >
                                  {entry.grade}
                                </span>
                              ) : null}
                              {entry.avgGrade ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                                    Avg
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${gradePillClass(
                                      entry.avgGrade,
                                    )}`}
                                  >
                                    {entry.avgGrade}
                                  </span>
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-[rgba(17,24,39,0.02)] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                          Routine Surveillance Report
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {activeStoreName} · {selectedStore} · {formatTimestamp(
                            selectedRoutineEntry?.record?.createdAt ?? selectedDate,
                          )}
                        </p>

                        <div className="mt-3 space-y-2 text-sm text-slate-800">
                          {routineSummaryLines.length ? (
                            routineSummaryLines.map((line, index) => (
                              <p key={`${line}-${index}`} className={index ? "mt-2" : ""}>
                                {line || "\u00a0"}
                              </p>
                            ))
                          ) : (
                            <p className="text-slate-600">No summary provided.</p>
                          )}
                        </div>

                        {(selectedRoutineEntry?.record?.surveillanceGrade ||
                          selectedRoutineEntry?.record?.surveillanceGradeReason) && (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                              Behavior Grade
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {selectedRoutineEntry?.record?.surveillanceGrade ? (
                                <span
                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                                    selectedRoutineEntry.record.surveillanceGrade,
                                  )}`}
                                >
                                  {selectedRoutineEntry.record.surveillanceGrade}
                                </span>
                              ) : null}
                              {selectedRoutineEntry?.record?.surveillanceGradeReason ? (
                                <span className="text-sm text-slate-700">
                                  {selectedRoutineEntry.record.surveillanceGradeReason}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        )}

                        {selectedRoutineEntry?.record?.attachments?.length ? (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                              Attachments
                            </p>
                            <div className="mt-2 space-y-2">
                              {(selectedRoutineEntry.record.attachments ?? []).map((file) => {
                                const src = buildAttachmentSrc(file.path);
                                return (
                                  <div
                                    key={file.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate font-semibold text-slate-900">
                                        {file.originalName ?? "Attachment"}
                                      </p>
                                      <p className="mt-0.5 text-xs text-slate-500">
                                        {(file.kind ?? "file").toUpperCase()}{" "}
                                        {formatBytes(file.size)}
                                      </p>
                                    </div>
                                    {src ? (
                                      <button
                                        type="button"
                                        className="ui-pill-secondary inline-flex items-center justify-center px-3 py-1 text-xs"
                                        onClick={() => openAttachmentViewer(file)}
                                      >
                                        Open
                                      </button>
                                    ) : (
                                      <span className="text-xs text-slate-500">No file</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">
                      No routine reports submitted for this date yet.
                    </p>
                  )}
                </div>

                {incidents.length ? (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                        Incidents
                      </p>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                        {incidents.length}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {incidents.map((incident) => {
                        const src = buildAttachmentSrc(incident.file.path);
                        const headline =
                          incident.file.summary ??
                          incident.record.surveillanceSummary ??
                          incident.record.notes ??
                          "";
                        const detailsLines = headline ? headline.split("\n") : [];
                        return (
                          <div
                            key={incident.id}
                            className="rounded-2xl border border-slate-200 bg-[rgba(17,24,39,0.02)] px-4 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${categoryStyles[incident.category]}`}
                                  >
                                    {incident.category}
                                  </span>
                                  {unseenSet.has(incident.record.id) ? (
                                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                                  ) : null}
                                  <span className="text-xs text-slate-500">
                                    {incident.timestamp}
                                  </span>
                                </div>
                                {incident.record.employeeName ? (
                                  <p className="mt-1 text-sm font-semibold text-slate-900">
                                    {incident.record.employeeName}
                                  </p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  markSurveillanceSeen(incident.record);
                                  setActiveInvestigate({
                                    ...incident.record,
                                    surveillanceLabel: incident.category,
                                    attachments: [incident.file],
                                  });
                                }}
                                className="ui-icon-btn ui-icon-btn--primary"
                                aria-label="Investigate"
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

                            {detailsLines.length ? (
                              <div className="mt-3 space-y-2 text-sm text-slate-800">
                                {detailsLines.map((line, index) => (
                                  <p key={`${incident.id}-line-${index}`}>
                                    {line || "\u00a0"}
                                  </p>
                                ))}
                              </div>
                            ) : null}

                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-slate-900">
                                  {incident.file.originalName ?? "Attachment"}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {(incident.file.kind ?? "file").toUpperCase()}{" "}
                                  {formatBytes(incident.file.size)}
                                </p>
                              </div>
                              {src ? (
                                <button
                                  type="button"
                                  className="ui-pill-secondary inline-flex items-center justify-center px-3 py-1 text-xs"
                                  onClick={() => openAttachmentViewer(incident.file)}
                                >
                                  Open
                                </button>
                              ) : (
                                <span className="text-xs text-slate-500">No file</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                    No incidents reported for this date.
                  </div>
                )}
              </>
              )}
          </div>
        </div>
      )}

      {activeInvestigate && (
        <SurveillanceInvestigateModal
          report={activeInvestigate}
          storeName={activeStoreName}
          hasInvestigationAPI={hasSurveillanceInvestigationAPI}
          onPreview={() => {
            const file = activeInvestigate.attachments?.[0];
            openAttachmentViewer(file);
          }}
          onClose={() => setActiveInvestigate(null)}
        />
      )}

      <IHModal
        isOpen={attachmentViewerOpen}
        onClose={() => setAttachmentViewerOpen(false)}
        allowOutsideClose
        panelClassName="media-modal max-w-6xl"
      >
        <div className="media-shell flex max-h-[82vh] flex-col overflow-hidden">
          <div className="media-header border-b border-white/10 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.26em] text-slate-300">
                  Attachment
                </p>
                <h2 className="mt-2 truncate text-lg font-semibold text-white">
                  {attachmentViewerFile?.originalName ?? "Viewer"}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  {attachmentViewerFile?.kind ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                      {attachmentViewerFile.kind.toUpperCase()}
                    </span>
                  ) : null}
                  {formatBytes(attachmentViewerFile?.size) ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                      {formatBytes(attachmentViewerFile?.size)}
                    </span>
                  ) : null}
                </p>
              </div>

              {attachmentViewerFile?.path ? (
                <a
                  className="media-chip"
                  href={buildAttachmentSrc(attachmentViewerFile.path)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in new tab
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="media-stage flex max-h-[70vh] items-center justify-center p-2">
              {!attachmentViewerFile?.path ? (
                <div className="px-4 py-10 text-sm text-slate-300">
                  No attachment selected.
                </div>
              ) : attachmentViewerFile.kind === "video" ? (
                <video
                  controls
                  playsInline
                  autoPlay
                  className="max-h-[68vh] w-full rounded-xl bg-black object-contain"
                  src={buildAttachmentSrc(attachmentViewerFile.path)}
                />
              ) : attachmentViewerFile.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={buildAttachmentSrc(attachmentViewerFile.path)}
                  alt={attachmentViewerFile.originalName ?? "Attachment preview"}
                  className="max-h-[68vh] w-full rounded-xl object-contain"
                />
              ) : (
                <iframe
                  src={buildAttachmentSrc(attachmentViewerFile.path)}
                  title={attachmentViewerFile.originalName ?? "Attachment preview"}
                  className="h-[68vh] w-full rounded-xl bg-white"
                />
              )}
            </div>
          </div>
        </div>
      </IHModal>
    </section>
  );
}
