"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionUser, ShiftReport } from "@/lib/types";

interface StoreSummary {
  storeId: string;
  storeName?: string;
}

interface EmployeeSummary {
  id: string;
  name: string;
  storeNumber: string;
}

interface ShiftReportFormProps {
  user: SessionUser;
}

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

export default function ShiftReportForm({ user }: ShiftReportFormProps) {
  const today = useMemo(() => getLocalDate(), []);
  const [date, setDate] = useState(today);
  const [scrAmount, setScrAmount] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [netAmount, setNetAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [currentReport, setCurrentReport] = useState<ShiftReport | null>(null);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [storeId, setStoreId] = useState(user.storeNumber);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [employeeId, setEmployeeId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load stores");
        }
        const data = await response.json();
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
        if (controller.signal.aborted) return;
        console.error(error);
        setStores([
          { storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` },
        ]);
      }
    };
    loadStores();
    return () => controller.abort();
  }, [user.storeNumber]);

  const loadReport = async () => {
    try {
      const response = await fetch(
        `/api/shift-reports?storeId=${encodeURIComponent(
          storeId,
        )}&date=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = await response.json();
      const report = (data.reports?.[0] ?? null) as ShiftReport | null;
      setCurrentReport(report);
      if (report && !employeeId) {
        setEmployeeId(report.employeeId ?? "");
      }
    } catch (error) {
      console.error("Failed to load shift report", error);
    }
  };

  useEffect(() => {
    loadReport();
    const interval = setInterval(loadReport, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, storeId]);

  useEffect(() => {
    const controller = new AbortController();
    const loadEmployees = async () => {
      try {
        const response = await fetch(
          `/api/manager/employees?storeId=${encodeURIComponent(storeId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        const nextEmployees = Array.isArray(data.employees) ? data.employees : [];
        setEmployees(nextEmployees);
        setEmployeeId((prev) =>
          nextEmployees.some((entry: EmployeeSummary) => entry.id === prev)
            ? prev
            : nextEmployees[0]?.id ?? "",
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Failed to load employees", error);
        setEmployees([]);
        setEmployeeId("");
      }
    };
    loadEmployees();
    return () => controller.abort();
  }, [storeId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch("/api/shift-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          storeId,
          employeeId,
          scrAmount: Number(scrAmount),
          cashAmount: Number(cashAmount),
          netAmount: Number(netAmount),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error");
        setMessage(payload?.error ?? "Unable to save shift report.");
        return;
      }
      setStatus("saved");
      setMessage("Shift report saved.");
      setCurrentReport(payload.report ?? null);
      setScrAmount("");
      setCashAmount("");
      setNetAmount("");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("Unable to save shift report.");
    } finally {
      setTimeout(() => setStatus("idle"), 4000);
    }
  };

  return (
    <section className="ui-card text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Shift Report
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">Shift Report</h2>
        </div>
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="ui-field"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <div className="relative">
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
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-300">
            ▾
          </span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-2 text-sm text-slate-200 md:col-span-3">
          <span className="ui-label">Employee</span>
          <select
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            className="ui-field"
          >
            {employees.length === 0 ? (
              <option value="">No employees for this store</option>
            ) : (
              employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-slate-200">
          <span className="ui-label">Scr</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              $
            </span>
            <input
              type="number"
              step="0.01"
              value={scrAmount}
              onChange={(event) => setScrAmount(event.target.value)}
              className="ui-field w-full pl-8"
            />
          </div>
        </label>
        <label className="flex flex-col gap-2 text-sm text-slate-200">
          <span className="ui-label">Cash</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              $
            </span>
            <input
              type="number"
              step="0.01"
              value={cashAmount}
              onChange={(event) => setCashAmount(event.target.value)}
              className="ui-field w-full pl-8"
            />
          </div>
        </label>
        <label className="flex flex-col gap-2 text-sm text-slate-200">
          <span className="ui-label">Net</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              $
            </span>
            <input
              type="number"
              step="0.01"
              value={netAmount}
              onChange={(event) => setNetAmount(event.target.value)}
              className="ui-field w-full pl-8"
            />
          </div>
        </label>
        <div className="md:col-span-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={status === "saving" || !employeeId}
            className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "saving" ? "Saving..." : "Save shift report"}
          </button>
          {message && (
            <span
              className={`text-xs ${
                status === "error" ? "text-red-200" : "text-emerald-200"
              }`}
            >
              {message}
            </span>
          )}
        </div>
      </form>
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
          Saved Report
          </h3>
          {currentReport?.investigationFlag && (
            <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
              Investigation Requested
            </span>
          )}
        </div>
        {currentReport ? (
          <>
            <div className="mt-3 grid gap-3 text-sm text-slate-200 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Name</p>
              <p className="text-white">
                {currentReport.employeeName ?? currentReport.managerName}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scr</p>
              <p className="text-white">{formatMoney(currentReport.scrAmount)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Cash</p>
              <p className="text-white">{formatMoney(currentReport.cashAmount)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Net</p>
              <p className="text-white">{formatMoney(currentReport.netAmount)}</p>
            </div>
            <div className="sm:col-span-4 text-xs text-slate-400">
              Updated {new Date(currentReport.updatedAt).toLocaleString()}
            </div>
            </div>
            {currentReport.investigationFlag && (
              <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                The owner flagged this shift report. Please review the numbers and update Scr, Cash, or Net if needed.
              </div>
            )}
            {currentReport.investigationFlag && currentReport.investigationReason && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    Investigation Request.txt
                  </span>
                </div>
                <p className="mt-2 text-sm text-white">
                  {currentReport.investigationReason}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No saved report yet.</p>
        )}
      </section>
    </section>
  );
}
