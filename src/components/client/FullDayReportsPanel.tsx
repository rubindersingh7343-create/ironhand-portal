"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CombinedRecord,
  ReportItemConfig,
  SessionUser,
  ShiftReport,
} from "@/lib/types";
import FullDayInvestigationModal from "@/components/client/FullDayInvestigationModal";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import { getDefaultReportItems, normalizeReportItems } from "@/lib/reportConfig";

interface StoreSummary {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
}

const getLocalDate = () => new Date().toLocaleDateString("en-CA");
const sumShiftReports = (reports: ShiftReport[]) => {
  const customMap = new Map<string, number>();
  const totals = {
    date: reports[0]?.date ?? new Date().toISOString().slice(0, 10),
    scr: 0,
    lotto: 0,
    liquor: 0,
    beer: 0,
    tobacco: 0,
    cigarettes: 0,
    gas: 0,
    gross: 0,
    atm: 0,
    lottoPo: 0,
    deposit: 0,
    customFields: [] as { label: string; amount: number }[],
  };

  reports.forEach((report) => {
    totals.scr += report.scrAmount ?? 0;
    totals.lotto += report.lottoAmount ?? 0;
    totals.liquor += report.liquorAmount ?? 0;
    totals.beer += report.beerAmount ?? 0;
    totals.tobacco += report.tobaccoAmount ?? 0;
    totals.cigarettes += report.cigAmount ?? 0;
    totals.gas += report.gasAmount ?? 0;
    totals.gross += report.grossAmount ?? 0;
    totals.atm += report.atmAmount ?? 0;
    totals.lottoPo += report.lottoPoAmount ?? 0;
    totals.deposit += report.depositAmount ?? 0;
    (report.customFields ?? []).forEach((field) => {
      if (!field.label) return;
      const next = (customMap.get(field.label) ?? 0) + (field.amount ?? 0);
      customMap.set(field.label, next);
    });
  });

  totals.customFields = Array.from(customMap.entries()).map(
    ([label, amount]) => ({ label, amount }),
  );
  return totals;
};

function parseDailyContent(record: CombinedRecord) {
  if (!record.textContent) return null;
  try {
    const parsed = JSON.parse(record.textContent);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

type FullDayTotals = ReturnType<typeof sumShiftReports>;

const getTotalsItemAmount = (totals: FullDayTotals, item: ReportItemConfig) => {
  switch (item.key) {
    case "gross":
      return totals.gross ?? 0;
    case "scr":
      return totals.scr ?? 0;
    case "lotto":
      return totals.lotto ?? 0;
    case "liquor":
      return totals.liquor ?? 0;
    case "beer":
      return totals.beer ?? 0;
    case "cig":
      return totals.cigarettes ?? 0;
    case "tobacco":
      return totals.tobacco ?? 0;
    case "gas":
      return totals.gas ?? 0;
    case "atm":
      return totals.atm ?? 0;
    case "lottoPo":
      return totals.lottoPo ?? 0;
    case "deposit":
      return totals.deposit ?? 0;
    default:
      if (!item.isCustom) return 0;
      return (totals.customFields ?? [])
        .filter((field) => field.label === item.label)
        .reduce((sum, field) => sum + (field.amount ?? 0), 0);
  }
};

const buildNetSummaryFromTotals = (
  totals: FullDayTotals | null,
  items: ReportItemConfig[],
) => {
  if (!totals) return null;
  const marginItems = items.filter((item) => {
    const margin = Number(item.marginPercent ?? 0);
    return item.enabled && Number.isFinite(margin) && margin > 0;
  });
  if (!marginItems.length) return null;
  const breakdown = marginItems.map((item) => {
    const amount = getTotalsItemAmount(totals, item);
    const margin = Number(item.marginPercent ?? 0);
    const net = (amount * margin) / 100;
    return {
      key: item.key,
      label: item.label,
      margin,
      amount,
      net,
    };
  });
  const netTotal = breakdown.reduce((sum, item) => sum + item.net, 0);
  return { netTotal, breakdown };
};

export default function FullDayReportsPanel({
  user,
  embedded = false,
  reportConfigVersion = 0,
}: {
  user: SessionUser;
  embedded?: boolean;
  reportConfigVersion?: number;
}) {
  const today = useMemo(() => getLocalDate(), []);
  const ownerStore = useOwnerPortalStore();
  const hasSharedStore = Boolean(ownerStore);
  const manualDateRange = ownerStore?.manualDateRange ?? null;
  const setManualDateRange = ownerStore?.setManualDateRange;
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [stores, setStores] = useState<StoreSummary[]>(
    ownerStore?.stores ?? [],
  );
  const [reports, setReports] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState<CombinedRecord | null>(null);
  const [activeStoreName, setActiveStoreName] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<Record<string, "default" | "investigating" | "resolved">>({});
  const activeStoreId = ownerStore?.selectedStoreId ?? user.storeNumber;
  const [reportConfig, setReportConfig] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );

  useEffect(() => {
    if (ownerStore) {
      setStores(ownerStore.stores);
      return;
    }
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const nextStores = Array.isArray(data.stores) ? data.stores : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        const merged = nextStores.length ? nextStores : fallback;
        setStores(merged);
      } catch (error) {
        console.error("Failed to load stores", error);
        setStores([
          { storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` },
        ]);
      }
    };
    loadStores();
  }, [ownerStore, ownerStore?.stores, ownerStore?.selectedStoreId, user.storeNumber]);

  useEffect(() => {
    if (!manualDateRange) return;
    if (
      manualDateRange.startDate !== startDate ||
      manualDateRange.endDate !== endDate
    ) {
      setStartDate(manualDateRange.startDate);
      setEndDate(manualDateRange.endDate);
    }
  }, [manualDateRange, startDate, endDate]);

  useEffect(() => {
    if (!activeStoreId) return;
    const controller = new AbortController();
    const loadConfig = async () => {
      try {
        const response = await fetch(
          `/api/report-config?storeId=${encodeURIComponent(activeStoreId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        setReportConfig(normalizeReportItems(data.items));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load report setup", error);
        }
      }
    };
    loadConfig();
    return () => controller.abort();
  }, [activeStoreId, reportConfigVersion]);

  const loadReports = useCallback(
    async (silent = false, controller?: AbortController) => {
      const activeController = controller ?? new AbortController();
      try {
        if (!silent) setLoading(true);
        const targetStores = stores.length
          ? stores
          : [
              {
                storeId: user.storeNumber,
                storeName: user.storeName ?? `Store ${user.storeNumber}`,
              },
            ];
        const results = await Promise.all(
          targetStores.map(async (store) => {
            const response = await fetch(
              `/api/owner/shift-reports?storeId=${encodeURIComponent(
                store.storeId,
              )}&startDate=${encodeURIComponent(
                startDate,
              )}&endDate=${encodeURIComponent(endDate)}`,
              { cache: "no-store", signal: activeController.signal },
            );
            if (!response.ok) {
              return { store, reports: [] as ShiftReport[] };
            }
            const data = await response.json().catch(() => ({}));
            const nextReports: ShiftReport[] = Array.isArray(data.reports)
              ? data.reports
              : [];
            return { store, reports: nextReports };
          }),
        );

        const aggregates: CombinedRecord[] = [];
        results.forEach(({ store, reports: storeReports }) => {
          if (!storeReports.length) return;
          const totals = sumShiftReports(storeReports);
          aggregates.push({
            id: `full-day-${store.storeId}-${startDate}-${endDate}`,
            employeeName: store.storeName ?? `Store ${store.storeId}`,
            storeNumber: store.storeId,
            category: "daily",
            createdAt: `${endDate}T00:00:00.000Z`,
            textContent: JSON.stringify(totals),
            attachments: [],
          });
        });
        setReports(aggregates);
        setMessage(null);
      } catch (error) {
        if (activeController.signal.aborted) return;
        console.error("Failed to load daily reports", error);
        setMessage("Unable to load daily reports.");
      } finally {
        if (!activeController.signal.aborted && !silent) setLoading(false);
      }
    },
    [startDate, endDate, stores, user.storeName, user.storeNumber],
  );

  const visibleItems = useMemo(
    () => reportConfig.filter((item) => item.enabled),
    [reportConfig],
  );
  const minTableWidth = useMemo(
    () => Math.max(520, 180 + 110 + visibleItems.length * 110 + 80),
    [visibleItems.length],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (startDate && endDate) loadReports(false, controller);
    const interval = window.setInterval(() => loadReports(true), 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadReports(true);
      }
    };
    const handleFocus = () => {
      loadReports(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadReports, startDate, endDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored: Record<string, "default" | "investigating" | "resolved"> = {};
    reports.forEach((report) => {
      const status = window.localStorage.getItem(
        `full-day-status:${report.id}`,
      ) as "default" | "investigating" | "resolved" | null;
      if (status) stored[report.id] = status;
    });
    if (Object.keys(stored).length) {
      setLocalStatus((prev) => ({ ...prev, ...stored }));
    }
  }, [reports]);

  // background refresh handled in loadReports effect

  useEffect(() => {
    const markSeen = async () => {
      if (!reports.length || !startDate || !endDate) return;
      const items = reports
        .map((record) => ({
          record,
          recordDate: recordDateFor(record),
        }))
        .filter((entry) => entry.recordDate)
        .filter(
          (entry) =>
            entry.recordDate >= startDate && entry.recordDate <= endDate,
        )
        .map((entry) => ({
          storeId: entry.record.storeNumber,
          itemType: "full-day",
          itemId: entry.record.id,
        }));
      if (!items.length) return;
      await fetch("/api/owner/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
    };
    markSeen();
  }, [reports, startDate, endDate]);

  const openReport = (report: CombinedRecord, storeName: string) => {
    setActive(report);
    setActiveStoreName(storeName);
  };

  const closeReport = () => {
    setActive(null);
    setActiveStoreName(null);
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

  const recordDateFor = (record: CombinedRecord) => {
    const parsed = parseDailyContent(record);
    return parsed?.date ?? record.createdAt?.slice(0, 10) ?? "";
  };

  const showToast = (value: string) => {
    setToast(value);
    window.setTimeout(() => setToast(null), 2400);
  };

  const setStatus = (reportId: string, status: "default" | "investigating" | "resolved") => {
    setLocalStatus((prev) => ({ ...prev, [reportId]: status }));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`full-day-status:${reportId}`, status);
    }
  };

  const updateStatus = (reportId: string, status: "default" | "investigating" | "resolved") => {
    setStatus(reportId, status);
  };

  const isRange = startDate !== endDate;

  const Container = embedded ? "div" : "section";
  const selectedStoreMeta = useMemo(
    () => stores.find((store) => store.storeId === activeStoreId),
    [stores, activeStoreId],
  );
  const showUpgrade =
    Boolean(selectedStoreMeta?.hasSurveillance) &&
    !selectedStoreMeta?.hasManager;

  const shiftDate = (value: string, delta: number) => {
    if (!value) return value;
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + delta);
    return date.toISOString().slice(0, 10);
  };

  const shiftRange = (delta: number) => {
    const nextStart = shiftDate(startDate, delta);
    const nextEnd = shiftDate(endDate, delta);
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setManualDateRange?.({ startDate: nextStart, endDate: nextEnd });
  };

  return (
    <Container className={embedded ? "text-white" : "ui-card text-white"}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {!embedded && (
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Full Day Reports
            </p>
          </div>
        )}
        <div className="reports-filter-row">
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
              const nextEnd = next > endDate ? next : endDate;
              setStartDate(next);
              if (nextEnd !== endDate) setEndDate(nextEnd);
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
              const nextStart = next < startDate ? next : startDate;
              setEndDate(next);
              if (nextStart !== startDate) setStartDate(nextStart);
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
      </div>

      <div className="mt-6">
        {showUpgrade ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
            Upgrade to premium to access this feature.
          </div>
        ) : (
          <>
            <div className="scroll-clip rounded-2xl border border-white/10 bg-[#0f1a33]">
              <div className="max-h-[360px] overflow-x-auto">
                <table
                  className="w-full table-fixed text-left text-[13px] text-slate-200"
                  style={{ minWidth: `${minTableWidth}px` }}
                >
                  <thead className="sticky top-0 z-10 bg-[#0f1a33] text-[11px] uppercase tracking-[0.24em] text-slate-300">
                    <tr>
                      <th className="w-[180px] px-2 py-3 md:px-4">Store</th>
                      <th className="w-[110px] px-2 py-3 text-right md:px-4">
                        Net
                      </th>
                      {visibleItems.map((item) => (
                        <th
                          key={`${item.key}-${item.label}`}
                          className="w-[110px] px-2 py-3 text-right md:px-4"
                        >
                          {item.label}
                        </th>
                      ))}
                      <th className="sticky right-0 w-[80px] bg-[#0f1a33] px-2 py-3 text-right md:px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <tr key={`daily-skeleton-${index}`} className="border-t border-white/5">
                          <td className="px-3 py-4 md:px-4" colSpan={visibleItems.length + 3}>
                            <div className="ui-skeleton h-6 w-full" />
                          </td>
                        </tr>
                      ))
                    ) : reports.length === 0 && stores.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-slate-400 md:px-4" colSpan={visibleItems.length + 3}>
                            {message ?? "No reports submitted for this date yet."}
                          </td>
                        </tr>
                    ) : (
                      (stores.length ? stores : [
                        {
                          storeId: user.storeNumber,
                          storeName: user.storeName ?? `Store ${user.storeNumber}`,
                        },
                      ]).map((store) => {
                        const activeRecord =
                          reports.find((record) => record.storeNumber === store.storeId) ?? null;
                        const parsed = activeRecord
                          ? parseDailyContent(activeRecord) ?? {}
                          : {};
                        const totals = activeRecord
                          ? ({
                              ...parsed,
                              customFields: Array.isArray(parsed.customFields)
                                ? parsed.customFields
                                : [],
                            } as FullDayTotals)
                          : null;
                        const netSummary = buildNetSummaryFromTotals(
                          totals,
                          reportConfig,
                        );
                    const displayName =
                      store.storeName ?? activeRecord?.employeeName ?? `Store ${store.storeId}`;
                    const missingLabel = isRange
                      ? "No reports in range"
                      : "";
                    const canInvestigate = Boolean(activeRecord && !isRange);
                    const reportId = activeRecord?.id ?? "";
                    return (
                      <tr
                        key={store.storeId}
                        className="border-t border-white/5 transition hover:bg-white/5 active:bg-white/10"
                      >
                        <td className="px-2 py-4 text-white md:px-4 whitespace-normal break-words leading-snug">
                          {displayName}
                          {!activeRecord && missingLabel && (
                            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap">
                              {missingLabel}
                            </div>
                          )}
                        </td>
                        <td className="ui-tabular px-2 py-4 text-right md:px-4 text-emerald-200">
                          {activeRecord && netSummary
                            ? formatMoney(netSummary.netTotal)
                            : "--"}
                        </td>
                        {visibleItems.map((item) => (
                          <td
                            key={`${store.storeId}-${item.key}`}
                            className="ui-tabular px-2 py-4 text-right md:px-4"
                          >
                            {totals
                              ? formatMoney(getTotalsItemAmount(totals, item))
                              : "--"}
                          </td>
                        ))}
                        <td className="sticky right-0 bg-[#0f1a33] px-2 py-4 text-right md:px-4">
                          {canInvestigate ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (activeRecord) openReport(activeRecord, displayName);
                              }}
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold transition ${
                                localStatus[reportId] === "resolved"
                                  ? "border-emerald-300/60 text-emerald-200"
                                  : localStatus[reportId] === "investigating"
                                    ? "border-amber-300/60 text-amber-200"
                                    : "border-white/20 text-white hover:border-white/60"
                              }`}
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
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-[11px] font-semibold text-slate-500/80"
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
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>

      {toast && (
        <div className="ui-toast mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100">
          {toast}
        </div>
      )}

      {active && (
        <FullDayInvestigationModal
          report={active}
          storeName={activeStoreName ?? active.employeeName}
          defaultStatus={localStatus[active.id] ?? "default"}
          onClose={closeReport}
          onStatusChange={updateStatus}
          onToast={showToast}
        />
      )}
    </Container>
  );
}
