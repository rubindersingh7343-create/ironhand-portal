"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReportItemConfig, SessionUser, ShiftReport } from "@/lib/types";
import InvestigationCaseModal from "@/components/client/InvestigationCaseModal";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import { getDefaultReportItems, normalizeReportItems } from "@/lib/reportConfig";

interface StoreSummary {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
}

interface EmployeeSummary {
  id: string;
  name: string;
  storeNumber: string;
}

type InvestigationStatus = "none" | "sent" | "in_progress" | "resolved";

type OwnerShiftReport = ShiftReport & {
  hasDiscrepancy?: boolean;
  investigationStatus?: InvestigationStatus;
  investigationId?: string | null;
  lastUpdated?: string;
};

const POLL_INTERVAL_MS = 10000;
const getLocalDate = () => new Date().toLocaleDateString("en-CA");
const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

const getReportItemAmount = (
  report: ShiftReport,
  item: ReportItemConfig,
) => {
  switch (item.key) {
    case "gross":
      return report.grossAmount ?? 0;
    case "scr":
      return report.scrAmount ?? 0;
    case "lotto":
      return report.lottoAmount ?? 0;
    case "liquor":
      return report.liquorAmount ?? 0;
    case "beer":
      return report.beerAmount ?? 0;
    case "cig":
      return report.cigAmount ?? 0;
    case "tobacco":
      return report.tobaccoAmount ?? 0;
    case "gas":
      return report.gasAmount ?? 0;
    case "atm":
      return report.atmAmount ?? 0;
    case "lottoPo":
      return report.lottoPoAmount ?? 0;
    case "deposit":
      return report.depositAmount ?? 0;
    default:
      if (!item.isCustom) return 0;
      return (report.customFields ?? [])
        .filter((field) => field.label === item.label)
        .reduce((sum, field) => sum + (field.amount ?? 0), 0);
  }
};

export default function ShiftReportsPanel({
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
  const [storeId, setStoreId] = useState(
    ownerStore?.selectedStoreId ?? user.storeNumber,
  );
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [reports, setReports] = useState<OwnerShiftReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<OwnerShiftReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reportBadgeCounts, setReportBadgeCounts] = useState<Record<string, number>>({});
  const [reportConfig, setReportConfig] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );

  useEffect(() => {
    if (ownerStore) {
      setStores(ownerStore.stores);
      if (ownerStore.selectedStoreId) {
        setStoreId(ownerStore.selectedStoreId);
      }
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
        setStoreId((prev) =>
          merged.some((store: StoreSummary) => store.storeId === prev)
            ? prev
            : merged[0]?.storeId ?? prev,
        );
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
    if (!storeId) return;
    const controller = new AbortController();
    const loadConfig = async () => {
      try {
        const response = await fetch(
          `/api/report-config?storeId=${encodeURIComponent(storeId)}`,
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
  }, [storeId, reportConfigVersion]);

  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const response = await fetch("/api/client/employees", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const nextEmployees = Array.isArray(data.employees) ? data.employees : [];
        setEmployees(nextEmployees);
      } catch (error) {
        console.error("Failed to load employees", error);
        setEmployees([]);
      }
    };
    loadEmployees();
  }, []);

  const loadReports = async (silent = false) => {
    if (!storeId || !startDate || !endDate) return;
    try {
      if (!silent) {
        setLoading(true);
      }
      const isRange = startDate !== endDate;
      const response = await fetch(
        `/api/owner/shift-reports?store_id=${encodeURIComponent(
          storeId,
        )}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(
          endDate,
        )}${!isRange ? `&date=${encodeURIComponent(startDate)}&fallback=1` : ""}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data?.error ?? "Unable to load shift reports.");
        setReports([]);
        return;
      }
      if (
        !manualDateRange &&
        !isRange &&
        data?.effectiveDate &&
        data.effectiveDate !== startDate
      ) {
        setStartDate(data.effectiveDate);
        setEndDate(data.effectiveDate);
      }
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setMessage(null);
    } catch (error) {
      console.error("Failed to load shift reports", error);
      setMessage("Unable to load shift reports.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadReports(false);
    const interval = setInterval(() => {
      loadReports(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, startDate, endDate]);

  const loadBadges = async () => {
    try {
      const response = await fetch("/api/owner/unseen?type=reports", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setReportBadgeCounts(data.counts ?? {});
      }
    } catch (error) {
      console.error("Failed to load report badges", error);
    }
  };

  useEffect(() => {
    loadBadges();
    const interval = setInterval(() => {
      loadBadges();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
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
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const markSeen = async () => {
      if (!reports.length || !storeId) return;
      const items = reports.map((report) => ({
        storeId: report.storeId,
        itemType: "shift",
        itemId: report.id,
      }));
      await fetch("/api/owner/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      loadBadges();
    };
    markSeen();
  }, [reports, storeId]);

  const handleInvestigate = async (
    report: OwnerShiftReport,
    status: InvestigationStatus,
    reason?: string,
    threadPayload?: string,
  ) => {
    try {
      const response = await fetch("/api/owner/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: report.storeId,
          date: report.date,
          shift_report_id: report.id,
          status,
          notes: reason,
          thread: threadPayload,
        }),
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json().catch(() => ({}));
      const updated = data?.investigation;
      if (updated?.shiftReportId) {
        setReports((prev) =>
          prev.map((entry) =>
            entry.id === updated.shiftReportId
              ? {
                  ...entry,
                  investigationStatus: updated.status as InvestigationStatus,
                  investigationId: updated.id,
                }
              : entry,
          ),
        );
      }
      await loadReports(true);
    } catch (error) {
      console.error("Failed to flag shift report", error);
    }
  };

  const getStatus = (report: OwnerShiftReport): InvestigationStatus => {
    if (report.investigationStatus) return report.investigationStatus;
    if (report.investigationFlag) return "sent";
    return "none";
  };

  const isRange = startDate !== endDate;
  const missingLabel = isRange ? "No reports in range" : "";
  const formatShortName = (name?: string) => {
    if (!name) return "";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0];
    return lastInitial ? `${first} ${lastInitial}` : first;
  };

  const visibleItems = useMemo(
    () => reportConfig.filter((item) => item.enabled),
    [reportConfig],
  );
  const netItems = useMemo(
    () =>
      reportConfig.filter((item) => {
        const margin = Number(item.marginPercent ?? 0);
        return item.enabled && Number.isFinite(margin) && margin > 0;
      }),
    [reportConfig],
  );
  const minTableWidth = useMemo(
    () => Math.max(520, 180 + visibleItems.length * 130 + 80),
    [visibleItems.length],
  );
  const netTableMinWidth = useMemo(
    () => Math.max(520, 180 + netItems.length * 130 + 110),
    [netItems.length],
  );

  const displayRows = useMemo(() => {
    const aggregated = new Map<
      string,
      {
        key: string;
        employeeId?: string;
        employeeName: string;
        totals: Record<string, number>;
        primaryReport?: OwnerShiftReport;
      }
    >();

    reports.forEach((report) => {
      const key = report.employeeId ?? report.managerId ?? report.id;
      const existing = aggregated.get(key);
      const totals = existing?.totals ?? {};
      visibleItems.forEach((item) => {
        totals[item.key] =
          (totals[item.key] ?? 0) + getReportItemAmount(report, item);
      });
      if (existing) {
        existing.totals = totals;
        if (!existing.primaryReport) existing.primaryReport = report;
      } else {
        aggregated.set(key, {
          key,
          employeeId: report.employeeId,
          employeeName: report.employeeName ?? report.managerName ?? "Unknown",
          totals,
          primaryReport: report,
        });
      }
    });

    const storeEmployees = employees.filter(
      (entry) => entry.storeNumber === storeId,
    );
    const rows: Array<{
      key: string;
      employeeName: string;
      totals: Record<string, number>;
      primaryReport?: OwnerShiftReport;
    }> = [];

    if (storeEmployees.length) {
      const seen = new Set<string>();
      storeEmployees.forEach((employee) => {
        const row = aggregated.get(employee.id);
        if (row) {
          rows.push({
            key: employee.id,
            employeeName: employee.name,
            totals: row.totals,
            primaryReport: row.primaryReport,
          });
          seen.add(employee.id);
        } else {
          rows.push({
            key: employee.id,
            employeeName: employee.name,
            totals: {},
          });
        }
      });
      aggregated.forEach((row) => {
        if (row.employeeId && seen.has(row.employeeId)) return;
        rows.push({
          key: row.key,
          employeeName: row.employeeName,
          totals: row.totals,
          primaryReport: row.primaryReport,
        });
      });
      return rows;
    }

    aggregated.forEach((row) => {
      rows.push({
        key: row.key,
        employeeName: row.employeeName,
        totals: row.totals,
        primaryReport: row.primaryReport,
      });
    });
    return rows;
  }, [employees, reports, storeId, visibleItems]);

  const openInvestigate = (report: OwnerShiftReport) => {
    setActiveReport(report);
  };

  const closeInvestigate = () => {
    setActiveReport(null);
  };

  const showToast = (value: string) => {
    setToast(value);
    window.setTimeout(() => setToast(null), 2400);
  };

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

  const Container = embedded ? "div" : "section";
  const selectedStoreMeta = useMemo(
    () => stores.find((store) => store.storeId === storeId),
    [stores, storeId],
  );
  const showUpgrade =
    Boolean(selectedStoreMeta?.hasSurveillance) &&
    !selectedStoreMeta?.hasManager;

  return (
    <Container className={embedded ? "text-white" : "ui-card text-white"}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {!embedded && (
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
              Shift Reports
            </p>
          </div>
        )}
        <div className="reports-filter-row">
          {!hasSharedStore && (
            <div className="relative">
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className="ui-field ui-field--slim appearance-none pr-7"
              >
                {stores.map((store) => {
                  const count = reportBadgeCounts[store.storeId] ?? 0;
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
              {reportBadgeCounts[storeId] ? (
                <span className="pointer-events-none absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-400" />
              ) : null}
            </div>
          )}
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
      </div>

      <div className="mt-6">
        {showUpgrade ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
            Upgrade to premium to access this feature.
          </div>
        ) : (
          <>
            <div className="scroll-clip rounded-2xl border border-white/10 bg-[#0f1a33]">
              <div className="max-h-[360px] overflow-auto">
                <table
                  className="w-full table-fixed text-left text-[13px] text-slate-200"
                  style={{ minWidth: `${minTableWidth}px` }}
                >
                  <thead className="sticky top-0 z-10 bg-[#0f1a33] text-[11px] uppercase tracking-[0.24em] text-slate-300">
                    <tr>
                      <th className="w-[180px] px-2 py-3 md:px-3 whitespace-nowrap">Name</th>
                      {visibleItems.map((item) => (
                        <th
                          key={`${item.key}-${item.label}`}
                          className="w-[130px] px-2 py-3 text-right md:px-3 whitespace-nowrap"
                        >
                          {item.label}
                        </th>
                      ))}
                      <th className="sticky right-0 w-[80px] bg-[#0f1a33] px-2 py-3 text-right md:px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 4 }).map((_, index) => (
                        <tr key={`skeleton-${index}`} className="border-t border-white/5">
                          <td
                            className="px-3 py-4 md:px-4"
                            colSpan={visibleItems.length + 2}
                          >
                            <div className="ui-skeleton h-6 w-full" />
                          </td>
                        </tr>
                      ))
                    ) : reports.length === 0 ? (
                      <tr>
                        <td
                          className="px-3 py-6 text-slate-400 md:px-4"
                          colSpan={visibleItems.length + 2}
                        >
                          {message ?? "No reports submitted for this date yet."}
                        </td>
                      </tr>
                    ) : (
                      displayRows.map((row) => {
                        const report = row.primaryReport;
                        const hasDiscrepancy = Boolean(report?.hasDiscrepancy);
                        const canInvestigate = Boolean(report);
                        return (
                          <tr
                            key={row.key}
                            className="border-t border-white/5 transition hover:bg-white/5 active:bg-white/10"
                          >
                            <td className="px-2 py-4 text-white md:px-3">
                              {formatShortName(row.employeeName)}
                              {!report && missingLabel && (
                                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap">
                                  {missingLabel}
                                </div>
                              )}
                            </td>
                            {visibleItems.map((item) => {
                              const amount = row.totals[item.key] ?? 0;
                              return (
                                <td
                                  key={`${row.key}-${item.key}`}
                                  className="ui-tabular px-2 py-4 text-right md:px-3 text-slate-100"
                                >
                                  {report ? formatMoney(amount) : "--"}
                                </td>
                              );
                            })}
                            <td className="sticky right-0 bg-[#0f1a33] px-2 py-4 text-right md:px-3">
                              {canInvestigate ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (report) openInvestigate(report);
                                  }}
                                  disabled={!report}
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold transition ${
                                    report && getStatus(report) === "resolved"
                                      ? "border-emerald-300/60 text-emerald-200"
                                      : report &&
                                          (getStatus(report) === "sent" ||
                                            getStatus(report) === "in_progress")
                                        ? "border-amber-300/60 text-amber-200"
                                        : hasDiscrepancy
                                          ? "border-white/20 text-white hover:border-white/60"
                                          : "border-white/10 text-slate-300 hover:border-white/40"
                                  } ${report ? "" : "opacity-50 cursor-not-allowed"}`}
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
            {netItems.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-4 text-sm text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.26em] text-slate-300">
                    Net sales
                  </p>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table
                    className="w-full table-fixed text-left text-[13px] text-slate-200"
                    style={{ minWidth: `${netTableMinWidth}px` }}
                  >
                    <thead className="text-[11px] uppercase tracking-[0.24em] text-slate-300">
                      <tr>
                        <th className="w-[180px] px-2 py-3 md:px-3 whitespace-nowrap">Name</th>
                        <th className="w-[110px] px-2 py-3 text-right md:px-3 whitespace-nowrap">
                          Net
                        </th>
                        {netItems.map((item) => (
                          <th
                            key={`net-head-${item.key}`}
                            className="w-[130px] px-2 py-3 text-right md:px-3 whitespace-nowrap"
                          >
                            {item.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row) => {
                        const report = row.primaryReport;
                        const netTotal = netItems.reduce((sum, item) => {
                          const amount = row.totals[item.key] ?? 0;
                          const margin = Number(item.marginPercent ?? 0);
                          return sum + (amount * margin) / 100;
                        }, 0);
                        return (
                          <tr
                            key={`net-${row.key}`}
                            className="border-t border-white/5 transition hover:bg-white/5 active:bg-white/10"
                          >
                            <td className="px-2 py-4 text-white md:px-3">
                              {formatShortName(row.employeeName)}
                            </td>
                            <td className="ui-tabular px-2 py-4 text-right md:px-3 text-emerald-200">
                              {report ? formatMoney(netTotal) : "--"}
                            </td>
                            {netItems.map((item) => {
                              const amount = row.totals[item.key] ?? 0;
                              const margin = Number(item.marginPercent ?? 0);
                              const netValue = (amount * margin) / 100;
                              return (
                                <td
                                  key={`net-${row.key}-${item.key}`}
                                  className="ui-tabular px-2 py-4 text-right md:px-3 text-slate-100"
                                >
                                  {report ? formatMoney(netValue) : "--"}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="ui-toast mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100">
          {toast}
        </div>
      )}

      {activeReport && (
        <InvestigationCaseModal
          report={activeReport}
          onClose={closeInvestigate}
          onToast={showToast}
          onSubmit={handleInvestigate}
        />
      )}
    </Container>
  );
}
