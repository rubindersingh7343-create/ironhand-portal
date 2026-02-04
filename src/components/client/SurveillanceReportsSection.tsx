"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CombinedRecord, SessionUser } from "@/lib/types";
import SurveillanceSummaryViewer from "@/components/client/SurveillanceSummaryViewer";
import SurveillanceInvestigateModal from "@/components/client/SurveillanceInvestigateModal";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";

type StoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type IncidentCategory = "critical" | "theft" | "incident";

const incidentLabels: IncidentCategory[] = ["critical", "theft", "incident"];

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
  critical: "border-red-400/40 bg-red-500/15 text-red-200",
  theft: "border-orange-400/40 bg-orange-500/15 text-orange-200",
  incident: "border-blue-400/40 bg-blue-500/15 text-blue-200",
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
  return "border-white/20 bg-white/5 text-slate-200";
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
  const [activeRecord, setActiveRecord] = useState<CombinedRecord | null>(null);
  const [activeRecordMode, setActiveRecordMode] = useState<"routine" | "incident">(
    "routine",
  );
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
      avgGrade: averageGradeByEmployee.get(name),
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

  const recordForIncident = (
    incident: (typeof incidents)[number],
    mode: "review" | "investigate",
  ) => {
    const base = {
      ...incident.record,
      surveillanceLabel: incident.category,
      attachments: [incident.file],
    };
    if (mode === "review") {
      setActiveRecordMode("incident");
      setActiveRecord(base);
    } else {
      setActiveInvestigate(base);
    }
  };

  const hasReports = recordsForDate.length > 0;
  const activeStoreName =
    storeOptions.find((store) => store.storeId === selectedStore)?.storeName ??
    `Store ${selectedStore}`;

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-slate-300">
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
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-300">
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
        <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
          Upgrade to premium to access this feature.
        </div>
      ) : (
        <div className="mt-6">
          <div className="scroll-clip rounded-2xl border border-white/10 bg-[#0f1a33]">
            <div className="space-y-3 px-4 py-3 md:px-5">
              {loading ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="ui-skeleton h-4 w-44" />
                    <div className="mt-2 ui-skeleton h-3 w-32" />
                  </div>
                <div className="space-y-2">
                  <div className="ui-skeleton h-3 w-20" />
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-28" />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-28" />
                  </div>
                </div>
              </div>
            ) : !hasReports ? (
              <p className="text-sm text-slate-400">
                {message ?? "No reports submitted for this date yet."}
              </p>
            ) : (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 md:px-4 md:py-3">
                  <div className="mb-2">
                    <p className="text-sm font-semibold leading-snug text-white">
                      Routine Surveillance Report
                    </p>
                  </div>
                  {routineEmployees.length ? (
                    <div className="space-y-2">
                      {routineEmployees.map((entry) => (
                        <div
                          key={entry.name}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-slate-100">
                            <span className="truncate font-medium">{entry.name}</span>
                            {unseenSet.has(entry.record.id) ? (
                              <span className="h-2 w-2 rounded-full bg-blue-400" />
                            ) : null}
                            {entry.grade && (
                              <span
                                className={`surv-chip rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                                  entry.grade,
                                )}`}
                              >
                                {entry.grade}
                              </span>
                            )}
                            {entry.avgGrade && (
                              <span
                                className={`surv-chip rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                                  entry.avgGrade,
                                )}`}
                              >
                                Avg {entry.avgGrade}
                              </span>
                            )}
                          </div>
                          <div className="surv-actions-buttons">
                            <button
                              type="button"
                              onClick={() => {
                                markSurveillanceSeen(entry.record);
                                setActiveRecordMode("routine");
                                setActiveRecord(entry.record);
                              }}
                              className="surv-btn rounded-full border border-white/20 text-slate-200 transition hover:border-white/40"
                            >
                              View summary
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                markSurveillanceSeen(entry.record);
                                setActiveInvestigate(entry.record);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-slate-200 transition hover:border-white/40"
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
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      No routine reports submitted for this date yet.
                    </p>
                  )}
                </div>

                {incidents.length ? (
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
                      Incidents
                    </p>
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                      {incidents.map((incident, index) => (
                        <div
                          key={incident.id}
                          className={`flex items-center justify-between gap-3 px-3 py-2 md:px-4 ${
                            index === 0 ? "" : "border-t border-white/10"
                          }`}
                        >
                          <div className="surv-incident-left flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-200">
                            <span
                              className={`surv-chip rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${categoryStyles[incident.category]}`}
                            >
                              {incident.category}
                            </span>
                            {unseenSet.has(incident.record.id) ? (
                              <span className="h-2 w-2 rounded-full bg-blue-400" />
                            ) : null}
                          </div>
                          <div className="surv-actions-buttons">
                            <button
                              type="button"
                              onClick={() => {
                                markSurveillanceSeen(incident.record);
                                recordForIncident(incident, "review");
                              }}
                              className="surv-btn rounded-full border border-white/20 text-slate-200 transition hover:border-white/40"
                            >
                              Review
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                markSurveillanceSeen(incident.record);
                                recordForIncident(incident, "investigate");
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-slate-200 transition hover:border-white/40"
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
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    No incidents reported for this date.
                  </p>
                )}
              </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeRecord && (
        <SurveillanceSummaryViewer
          report={activeRecord}
          storeName={activeStoreName}
          mode={activeRecordMode}
          onClose={() => setActiveRecord(null)}
          onInvestigate={() => {
            setActiveRecord(null);
            setActiveInvestigate(activeRecord);
          }}
        />
      )}
      {activeInvestigate && (
        <SurveillanceInvestigateModal
          report={activeInvestigate}
          storeName={activeStoreName}
          hasInvestigationAPI={hasSurveillanceInvestigationAPI}
          onPreview={() => {
            setActiveInvestigate(null);
            setActiveRecord(activeInvestigate);
          }}
          onClose={() => setActiveInvestigate(null)}
        />
      )}
    </section>
  );
}
