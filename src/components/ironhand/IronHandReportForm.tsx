"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReportType, SessionUser } from "@/lib/types";
interface ReportStore {
  storeId: string;
  storeName?: string;
  storeAddress?: string;
}

const reportOptions: Array<{
  value: ReportType;
  title: string;
  description: string;
}> = [
  {
    value: "daily",
    title: "Daily Report",
    description: "Text update plus optional photo or video clip.",
  },
  {
    value: "weekly",
    title: "Weekly Orders",
    description: "Upload PDFs/photos or type the order list.",
  },
  {
    value: "monthly",
    title: "Monthly Report",
    description: "Attach signed PDF, DOCX, or export file.",
  },
];

interface IronHandReportFormProps {
  user: SessionUser;
}

export default function IronHandReportForm({ user }: IronHandReportFormProps) {
  const [reportType, setReportType] = useState<ReportType>("daily");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const fallbackStore: ReportStore = useMemo(
    () => ({ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }),
    [user.storeNumber],
  );
  const [stores, setStores] = useState<ReportStore[]>([fallbackStore]);
  const [targetStore, setTargetStore] = useState<string>(fallbackStore.storeId);

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
        const nextStores: StoreSummary[] =
          data.stores?.length ? data.stores : [fallbackStore];
        setStores(nextStores);
        setTargetStore((prev) =>
          nextStores.some((store) => store.storeId === prev)
            ? prev
            : nextStores[0].storeId,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setStores([fallbackStore]);
        setTargetStore(fallbackStore.storeId);
      }
    };
    loadStores();
    return () => controller.abort();
  }, [fallbackStore]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setMessage(null);
    const formElement = event.currentTarget;
    if (!formElement) {
      setStatus("error");
      setMessage("Form reference missing. Please try again.");
      return;
    }
    const formData = new FormData(formElement);
    formData.set("reportType", reportType);
    formData.set("storeNumber", targetStore);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setMessage(error?.error ?? "Unable to save report.");
        setStatus("error");
        return;
      }

      formElement.reset();
      setStatus("success");
      setMessage("Report uploaded successfully.");
    } catch (error) {
      console.error(error);
      setMessage("Connection error. Please try again.");
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 6000);
    }
  };

  return (
    <section className="rounded-[32px] border border-white/10 bg-[rgba(12,20,38,0.85)] p-6 text-white shadow-2xl shadow-slate-950/40 backdrop-blur">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-white uppercase tracking-[0.25em]">
          Client Reports
        </h2>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {reportOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            onClick={() => setReportType(option.value)}
            className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
              reportType === option.value
                ? "border-blue-500 bg-blue-600/10 text-blue-200"
                : "border-white/10 text-slate-200 hover:border-blue-300"
            }`}
          >
            <p className="font-semibold">{option.title}</p>
            <p className="mt-1 text-xs text-slate-400">{option.description}</p>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-200">
            Send this report to
          </label>
          <select
            value={targetStore}
            onChange={(event) => setTargetStore(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
          >
            {stores.map((store) => (
              <option key={store.storeId} value={store.storeId}>
                {store.storeName ?? `Store ${store.storeId}`}
              </option>
            ))}
          </select>
        </div>
        {reportType === "daily" && (
          <>
            <div>
              <label
                htmlFor="dailySummary"
                className="mb-2 block text-sm font-medium text-slate-200"
              >
                Daily summary
              </label>
              <textarea
                id="dailySummary"
                name="dailySummary"
                rows={4}
                required
                placeholder="Key wins, losses, staffing notes, etc."
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Optional photo/video evidence
              </label>
              <input
                type="file"
                name="dailyMedia"
                accept="image/*,video/*"
                className="w-full rounded-2xl border border-dashed border-white/15 bg-[#121f3e] px-4 py-3 text-xs text-slate-200"
              />
            </div>
          </>
        )}

        {reportType === "weekly" && (
          <>
            <div>
              <label
                htmlFor="weeklyList"
                className="mb-2 block text-sm font-medium text-slate-200"
              >
                Weekly order list
              </label>
              <textarea
                id="weeklyList"
                name="weeklyList"
                rows={4}
                placeholder="SKU + quantity per line. Provide at least one attachment or text entry."
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Upload supporting PDF/photo
              </label>
              <input
                type="file"
                name="weeklyFile"
                accept="application/pdf,image/*"
                className="w-full rounded-2xl border border-dashed border-white/15 bg-[#121f3e] px-4 py-3 text-xs text-slate-200"
              />
            </div>
          </>
        )}

        {reportType === "monthly" && (
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">
              Monthly report file (PDF, DOCX, photo)
            </label>
            <input
              type="file"
              name="monthlyFile"
              accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
              required
              className="w-full rounded-2xl border border-dashed border-white/15 bg-[#121f3e] px-4 py-3 text-xs text-slate-200"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="notes"
            className="mb-2 block text-sm font-medium text-slate-200"
          >
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            placeholder="Add approvals, blockers, or store context."
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          />
        </div>

        {message && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm ${
              status === "success"
                ? "bg-emerald-500/10 text-emerald-200"
                : "bg-red-500/10 text-red-200"
            }`}
          >
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" ? "Uploading..." : "Save report"}
        </button>
      </form>
    </section>
  );
}
