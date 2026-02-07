"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";

type HoursEntry = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  hours: number;
  notes?: string;
};

const monthKey = (value?: Date) => {
  const now = value ?? new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
};

const monthLabel = (value: string) => {
  const [year, month] = value.split("-").map((part) => Number(part));
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const shiftMonth = (value: string, delta: number) => {
  const [year, month] = value.split("-").map((part) => Number(part));
  const base = new Date(year, (month || 1) - 1, 1);
  base.setMonth(base.getMonth() + delta);
  return monthKey(base);
};

const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const computeOverlaps = (entries: HoursEntry[]) => {
  const overlaps: Array<{ date: string; startTime: string; endTime: string }> = [];
  const byDate = new Map<string, HoursEntry[]>();
  entries.forEach((entry) => {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date)!.push(entry);
  });

  for (const [date, list] of byDate.entries()) {
    const sorted = [...list].sort((a, b) => {
      const aStart = toMinutes(a.startTime) ?? 0;
      const bStart = toMinutes(b.startTime) ?? 0;
      return aStart - bStart;
    });
    let lastEnd = -1;
    for (const item of sorted) {
      const start = toMinutes(item.startTime) ?? 0;
      const end = toMinutes(item.endTime) ?? 0;
      if (lastEnd > -1 && start < lastEnd) {
        overlaps.push({ date, startTime: item.startTime, endTime: item.endTime });
      }
      lastEnd = Math.max(lastEnd, end);
    }
  }
  return overlaps;
};

export default function EmployeeHoursSection({ user }: { user: SessionUser }) {
  const [month, setMonth] = useState(() => monthKey());
  const [entries, setEntries] = useState<HoursEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    startTime: "",
    endTime: "",
    breakMinutes: 0,
    notes: "",
  });

  const loadEntries = useCallback(async (targetMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/employee/hours?month=${targetMonth}`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load hours.");
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load hours.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries(month);
  }, [loadEntries, month]);

  const totalHours = useMemo(
    () => entries.reduce((sum, entry) => sum + (Number(entry.hours) || 0), 0),
    [entries],
  );

  const overlaps = useMemo(() => computeOverlaps(entries), [entries]);

  const submitEntry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.date || !form.startTime || !form.endTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/employee/hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          breakMinutes: Number(form.breakMinutes) || 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to save hours.");
      }
      setForm({
        date: form.date,
        startTime: "",
        endTime: "",
        breakMinutes: 0,
        notes: "",
      });
      await loadEntries(month);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save hours.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ui-card space-y-4 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Hours check-in
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Log your shift times. We total monthly hours and flag overlaps.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-300">
          <button
            type="button"
            onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
            className="rounded-full border border-white/10 px-3 py-1 text-[0.65rem] text-slate-200 hover:bg-white/10"
          >
            Prev
          </button>
          <span className="text-xs text-slate-200">{monthLabel(month)}</span>
          <button
            type="button"
            onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
            className="rounded-full border border-white/10 px-3 py-1 text-[0.65rem] text-slate-200 hover:bg-white/10"
          >
            Next
          </button>
        </div>
      </div>

      <form onSubmit={submitEntry} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
          Date
          <input
            type="date"
            className="ui-field mt-2 w-full"
            value={form.date}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, date: event.target.value }))
            }
          />
        </label>
        <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
          Break minutes
          <input
            type="number"
            min={0}
            className="ui-field mt-2 w-full"
            value={form.breakMinutes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                breakMinutes: Number(event.target.value || 0),
              }))
            }
          />
        </label>
        <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
          Start time
          <input
            type="time"
            className="ui-field mt-2 w-full"
            value={form.startTime}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, startTime: event.target.value }))
            }
          />
        </label>
        <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
          End time
          <input
            type="time"
            className="ui-field mt-2 w-full"
            value={form.endTime}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, endTime: event.target.value }))
            }
          />
        </label>
        <label className="sm:col-span-2 text-xs uppercase tracking-[0.2em] text-slate-400">
          Notes (optional)
          <input
            type="text"
            className="ui-field mt-2 w-full"
            value={form.notes}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, notes: event.target.value }))
            }
          />
        </label>
        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-300">
            {user.storeName ? user.storeName : `Store ${user.storeNumber}`}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full border border-white/15 bg-white/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Saving..." : "Save hours"}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Month total
          </span>
          <span className="text-sm font-semibold text-slate-100">
            {totalHours.toFixed(2)} hrs
          </span>
        </div>
        {overlaps.length > 0 && (
          <p className="mt-2 text-xs text-amber-200">
            {overlaps.length} overlap{overlaps.length === 1 ? "" : "s"} detected. Check entries below.
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={`hours-skel-${index}`} className="ui-skeleton h-16" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-400">No hours logged for this month.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-200">
                    {formatDate(entry.date)} · {entry.startTime} - {entry.endTime}
                  </p>
                  {entry.breakMinutes > 0 && (
                    <p className="text-xs text-slate-400">
                      Break: {entry.breakMinutes} min
                    </p>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-100">
                  {Number(entry.hours).toFixed(2)} hrs
                </div>
              </div>
              {entry.notes && (
                <p className="mt-2 text-xs text-slate-300">{entry.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
