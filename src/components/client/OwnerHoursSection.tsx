"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import type { SessionUser } from "@/lib/types";

type HoursEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  hours: number;
  notes?: string;
};

type HourlyRate = {
  employeeId: string;
  hourlyRate: number;
};

type Payment = {
  employeeId: string;
  month: string;
  totalHours: number;
  hourlyRate: number;
  totalPay: number;
  paidAt?: string;
};

const getLocalDate = () => new Date().toLocaleDateString("en-CA");

const monthKey = (value?: Date) => {
  const now = value ?? new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
};

const shiftMonth = (value: string, delta: number) => {
  const [year, month] = value.split("-").map((part) => Number(part));
  const base = new Date(year, (month || 1) - 1, 1);
  base.setMonth(base.getMonth() + delta);
  return monthKey(base);
};

const monthLabel = (value: string) => {
  const [year, month] = value.split("-").map((part) => Number(part));
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const parseDateOnly = (value: string) => {
  if (!value) return null;
  // Treat YYYY-MM-DD as a local date (JS Date(string) treats it as UTC and can render as the prior day in the US).
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: string) => {
  const parsed = parseDateOnly(value);
  if (!parsed) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const formatTime12 = (value: string) => {
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
  const period = h >= 12 ? "PM" : "AM";
  const hour = ((h % 12) || 12).toString();
  const minute = String(m).padStart(2, "0");
  return `${hour}:${minute} ${period}`;
};

const computeOverlaps = (entries: HoursEntry[]) => {
  const overlaps: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  const byEmployee = new Map<string, HoursEntry[]>();
  entries.forEach((entry) => {
    const key = entry.employeeId || "unknown";
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key)!.push(entry);
  });

  for (const [employeeId, list] of byEmployee.entries()) {
    const byDate = new Map<string, HoursEntry[]>();
    list.forEach((entry) => {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date)!.push(entry);
    });
    const employeeOverlaps: Array<{ date: string; startTime: string; endTime: string }> = [];
    for (const [date, items] of byDate.entries()) {
      const sorted = [...items].sort((a, b) => {
        const aStart = toMinutes(a.startTime) ?? 0;
        const bStart = toMinutes(b.startTime) ?? 0;
        return aStart - bStart;
      });
      let lastEnd = -1;
      for (const item of sorted) {
        const start = toMinutes(item.startTime) ?? 0;
        const end = toMinutes(item.endTime) ?? 0;
        if (lastEnd > -1 && start < lastEnd) {
          employeeOverlaps.push({ date, startTime: item.startTime, endTime: item.endTime });
        }
        lastEnd = Math.max(lastEnd, end);
      }
    }
    if (employeeOverlaps.length > 0) overlaps[employeeId] = employeeOverlaps;
  }

  return overlaps;
};

export default function OwnerHoursSection({ user }: { user: SessionUser }) {
  const ownerStore = useOwnerPortalStore();
  const storeId = ownerStore?.selectedStoreId ?? user.storeNumber;
  const storeName = ownerStore?.activeStore?.storeName ?? user.storeName;
  const [month, setMonth] = useState(() => monthKey());
  const [day, setDay] = useState<string>("");
  const [entries, setEntries] = useState<HoursEntry[]>([]);
  const [rates, setRates] = useState<HourlyRate[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRate, setSavingRate] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const fetchMonthData = useCallback(
    async (targetMonth: string) => {
      if (!storeId) {
        return { entries: [], rates: [], payments: [] } as {
          entries: HoursEntry[];
          rates: HourlyRate[];
          payments: Payment[];
        };
      }
      const response = await fetch(
        `/api/owner/hours?storeId=${encodeURIComponent(storeId)}&month=${encodeURIComponent(targetMonth)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load hours.");
      }
      return {
        entries: Array.isArray(data.entries) ? data.entries : [],
        rates: Array.isArray(data.rates) ? data.rates : [],
        payments: Array.isArray(data.payments) ? data.payments : [],
      } as {
        entries: HoursEntry[];
        rates: HourlyRate[];
        payments: Payment[];
      };
    },
    [storeId],
  );

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchMonthData(month)
      .then((current) => {
        if (!active) return;
        setEntries(current.entries);
        setRates(current.rates);
        setPayments(current.payments);
        // Default to the most recent day with hours in this month.
        const latestDay = current.entries.reduce<string>((latest, entry) => {
          if (!entry?.date) return latest;
          if (!latest || entry.date > latest) return entry.date;
          return latest;
        }, "");
        setDay(latestDay || getLocalDate());
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load hours.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchMonthData, month, storeId]);

  const visibleEntries = useMemo(() => {
    if (!day) return entries;
    return entries.filter((entry) => entry.date === day);
  }, [day, entries]);

  const entriesByEmployee = useMemo(() => {
    const map = new Map<string, HoursEntry[]>();
    visibleEntries.forEach((entry) => {
      const key = entry.employeeId || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    });
    return map;
  }, [visibleEntries]);

  const monthEntriesByEmployee = useMemo(() => {
    const map = new Map<string, HoursEntry[]>();
    entries.forEach((entry) => {
      const key = entry.employeeId || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    });
    return map;
  }, [entries]);

  const rateMap = useMemo(() => {
    const map = new Map<string, number>();
    rates.forEach((rate) => {
      if (rate.employeeId) map.set(rate.employeeId, rate.hourlyRate);
    });
    return map;
  }, [rates]);

  const paymentMap = useMemo(() => {
    const map = new Map<string, Payment>();
    payments.forEach((payment) => {
      if (payment.employeeId) map.set(payment.employeeId, payment);
    });
    return map;
  }, [payments]);

  const overlaps = useMemo(() => computeOverlaps(visibleEntries), [visibleEntries]);

  const overlapEntryIds = useMemo(() => {
    const ids = new Set<string>();
    const byEmployee = new Map<string, HoursEntry[]>();
    visibleEntries.forEach((entry) => {
      const key = entry.employeeId || "unknown";
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key)!.push(entry);
    });

    for (const list of byEmployee.values()) {
      const byDate = new Map<string, HoursEntry[]>();
      list.forEach((entry) => {
        if (!byDate.has(entry.date)) byDate.set(entry.date, []);
        byDate.get(entry.date)!.push(entry);
      });

      for (const items of byDate.values()) {
        const sorted = [...items].sort((a, b) => {
          const aStart = toMinutes(a.startTime) ?? 0;
          const bStart = toMinutes(b.startTime) ?? 0;
          return aStart - bStart;
        });

        let lastEnd = -1;
        let lastEntryId: string | null = null;
        for (const item of sorted) {
          const start = toMinutes(item.startTime) ?? 0;
          const end = toMinutes(item.endTime) ?? 0;
          if (lastEnd > -1 && start < lastEnd) {
            ids.add(item.id);
            if (lastEntryId) ids.add(lastEntryId);
          }
          if (end >= lastEnd) {
            lastEnd = end;
            lastEntryId = item.id;
          }
        }
      }
    }

    return ids;
  }, [visibleEntries]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry) => {
      const key = entry.employeeId || "unknown";
      map.set(key, (map.get(key) ?? 0) + (Number(entry.hours) || 0));
    });
    return map;
  }, [entries]);

  const visibleTotals = useMemo(() => {
    const map = new Map<string, number>();
    visibleEntries.forEach((entry) => {
      const key = entry.employeeId || "unknown";
      map.set(key, (map.get(key) ?? 0) + (Number(entry.hours) || 0));
    });
    return map;
  }, [visibleEntries]);

  const currentMonth = useMemo(() => monthKey(), []);
  const isCurrentMonth = month === currentMonth;

  const monthlySummary = useMemo(() => {
    const monthOverlaps = computeOverlaps(entries);
    const rows: Array<{
      employeeId: string;
      employeeName: string;
      totalHours: number;
      totalPay: number;
      overlapCount: number;
      paidAt?: string;
    }> = [];

    monthEntriesByEmployee.forEach((list, employeeId) => {
      const employeeName = list[0]?.employeeName ?? "Employee";
      const totalHours = Number(
        list.reduce((sum, entry) => sum + (Number(entry.hours) || 0), 0).toFixed(2),
      );
      const hourlyRate = Number(rateMap.get(employeeId) ?? 0);
      const totalPay = Number((totalHours * hourlyRate).toFixed(2));
      const overlapCount = monthOverlaps[employeeId]?.length ?? 0;
      const payment = paymentMap.get(employeeId);
      rows.push({
        employeeId,
        employeeName,
        totalHours,
        totalPay,
        overlapCount,
        paidAt: payment?.paidAt,
      });
    });

    rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    const totalMonthlyPay = Number(
      rows.reduce((sum, row) => sum + (Number(row.totalPay) || 0), 0).toFixed(2),
    );
    const totalMonthlyHours = Number(
      rows.reduce((sum, row) => sum + (Number(row.totalHours) || 0), 0).toFixed(2),
    );
    return { rows, totalMonthlyPay, totalMonthlyHours };
  }, [entries, monthEntriesByEmployee, paymentMap, rateMap]);

  const shiftDay = (delta: number) => {
    if (!day) return;
    const base = parseDateOnly(day);
    if (!base) return;
    base.setDate(base.getDate() + delta);
    setDay(base.toISOString().slice(0, 10));
  };

  const updateRate = async (employeeId: string, hourlyRate: number) => {
    if (!storeId || !employeeId || !Number.isFinite(hourlyRate)) return;
    setSavingRate(employeeId);
    try {
      const response = await fetch("/api/owner/hours/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, employeeId, hourlyRate }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to save rate.");
      }
      const current = await fetchMonthData(month);
      setEntries(current.entries);
      setRates(current.rates);
      setPayments(current.payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save rate.");
    } finally {
      setSavingRate(null);
    }
  };

  const markPaid = async (employeeId: string) => {
    if (!storeId || !employeeId) return;
    const totalHours = Number(totals.get(employeeId) ?? 0);
    const hourlyRate = Number(rateMap.get(employeeId) ?? 0);
    const totalPay = Number((totalHours * hourlyRate).toFixed(2));
    setMarkingPaid(employeeId);
    try {
      const response = await fetch("/api/owner/hours/paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          employeeId,
          month,
          totalHours,
          hourlyRate,
          totalPay,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to mark paid.");
      }
      const current = await fetchMonthData(month);
      setEntries(current.entries);
      setRates(current.rates);
      setPayments(current.payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to mark paid.");
    } finally {
      setMarkingPaid(null);
    }
  };

  return (
    <section className="ui-card space-y-4 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Hours & payroll
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Track employee hours, overlaps, and monthly payroll for {storeName ?? `Store ${storeId}`}.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs uppercase tracking-[0.2em] text-slate-300">
          <div className="flex flex-nowrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
              className="ui-date-step"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="text-xs text-slate-200 whitespace-nowrap">
              {monthLabel(month)}
            </span>
            <button
              type="button"
              onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
              className="ui-date-step"
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="flex flex-nowrap items-center gap-2">
            <button
              type="button"
              onClick={() => shiftDay(-1)}
              className="ui-date-step"
              aria-label="Previous day"
              disabled={!day}
            >
              ‹
            </button>
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="ui-field ui-field--slim"
              aria-label="Hours date"
            />
            <button
              type="button"
              onClick={() => shiftDay(1)}
              className="ui-date-step"
              aria-label="Next day"
              disabled={!day}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {!storeId && (
        <p className="text-sm text-amber-200/90">
          Select a store in the bottom bar to see hours.
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={`hours-skel-${index}`} className="ui-skeleton h-20" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-400">No hours logged for this month.</p>
      ) : day && visibleEntries.length === 0 ? (
        <p className="text-sm text-slate-400">
          No hours logged for {formatDate(day)}.
        </p>
      ) : (
        <div className="space-y-4">
          {[...entriesByEmployee.entries()].map(([employeeId, list]) => {
            const name = list[0]?.employeeName ?? "Employee";
            const totalHours = Number((totals.get(employeeId) ?? 0).toFixed(2));
            const dayHours = Number((visibleTotals.get(employeeId) ?? 0).toFixed(2));
            const hourlyRate = Number(rateMap.get(employeeId) ?? 0);
            const totalPay = Number((totalHours * hourlyRate).toFixed(2));
            const payment = paymentMap.get(employeeId);
            const overlapList = overlaps[employeeId] ?? [];
            return (
              <div
                key={employeeId}
                className="ui-ink-inverse rounded-2xl border border-white/10 bg-[#0f1a33] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{name}</p>
                    <p className="text-xs text-slate-400">
                      {day
                        ? `${dayHours.toFixed(2)} hrs on ${formatDate(day)}`
                        : `${totalHours.toFixed(2)} hrs logged`}
                    </p>
                    {day ? (
                      <p className="text-[11px] text-slate-500">
                        {totalHours.toFixed(2)} hrs month-to-date
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-400">
                      Hourly rate
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="ui-field ui-field--slim mt-2 w-24"
                        defaultValue={hourlyRate || ""}
                        onBlur={(event) =>
                          updateRate(employeeId, Number(event.target.value))
                        }
                        disabled={savingRate === employeeId}
                      />
                    </label>
                    <div className="text-right">
                      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-400">
                        Monthly pay
                      </p>
                      <p className="text-sm font-semibold text-slate-100">
                        ${totalPay.toFixed(2)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => markPaid(employeeId)}
                      disabled={markingPaid === employeeId || totalHours === 0}
                      className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {payment?.paidAt ? "Paid" : "Mark paid"}
                    </button>
                  </div>
                </div>

                {payment?.paidAt && (
                  <p className="mt-2 text-xs text-emerald-200">
                    Paid on {new Date(payment.paidAt).toLocaleDateString()}.
                  </p>
                )}

                {overlapList.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    {overlapList.length} overlap{overlapList.length === 1 ? "" : "s"} detected for this employee.
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  {list.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs ${
                        overlapEntryIds.has(entry.id)
                          ? "border-amber-300/45 bg-amber-500/10 text-amber-50"
                          : "border-white/10 bg-[#0b1429] text-slate-300"
                      }`}
                    >
                      <span>
                        {formatDate(entry.date)} · {formatTime12(entry.startTime)} -{" "}
                        {formatTime12(entry.endTime)}
                      </span>
                      <span className="text-slate-100">{Number(entry.hours).toFixed(2)} hrs</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Monthly report
          </span>
          <span className="text-xs text-slate-300">
            {monthLabel(month)}
          </span>
        </div>

        {monthlySummary.rows.length > 0 ? (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>{monthlySummary.totalMonthlyHours.toFixed(2)} hrs</span>
              <span className="text-slate-100">
                Total monthly pay ${monthlySummary.totalMonthlyPay.toFixed(2)}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {monthlySummary.rows.map((row) => (
                <div
                  key={`month-${row.employeeId}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs ${
                    row.overlapCount > 0
                      ? "border-amber-300/30 bg-amber-500/10 text-amber-50"
                      : "border-white/10 bg-[#0b1429] text-slate-200"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {row.employeeName}
                    {row.overlapCount > 0
                      ? ` · ${row.overlapCount} overlap${row.overlapCount === 1 ? "" : "s"}`
                      : ""}
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-right">
                    <span className="text-slate-100">{row.totalHours.toFixed(2)} hrs</span>
                    <span className="text-slate-100">${row.totalPay.toFixed(2)}</span>
                    {row.paidAt ? (
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-100">
                        Paid
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
            {!isCurrentMonth ? (
              <p className="mt-2 text-[11px] text-slate-400">
                You are viewing a past month.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs text-slate-300">
            No hours logged for this month yet.
          </p>
        )}
      </div>
    </section>
  );
}
