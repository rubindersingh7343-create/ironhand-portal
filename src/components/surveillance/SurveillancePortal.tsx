"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import LogoutButton from "@/components/LogoutButton";
import SettingsButton from "@/components/SettingsButton";

const labels = ["critical", "theft", "incident", "routine"];

interface SurveillanceStore {
  storeId: string;
  storeName: string;
  storeAddress?: string;
}

interface RecentReport {
  id: string;
  label: string;
  storeNumber: string;
  storeName: string;
  summary: string;
  notes: string | null;
  createdAt: string;
  attachments: {
    id: string;
    path: string;
    originalName: string;
  }[];
}

export default function SurveillancePortal({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [stores, setStores] = useState<SurveillanceStore[]>([]);
  const [selectedStore, setSelectedStore] = useState(user.storeNumber);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [addCode, setAddCode] = useState("");
  const [addStatus, setAddStatus] = useState<"idle" | "adding">("idle");
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const [recentStatus, setRecentStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [recentMessage, setRecentMessage] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    setStoreNote(null);
    try {
      const response = await fetch("/api/surveillance/stores", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unable to load stores.");
      }
      const data = await response.json();
      const mapped: SurveillanceStore[] = (data.stores ?? []).map(
        (store: SurveillanceStore) => ({
          storeId: store.storeId,
          storeName: store.storeName ?? `Store ${store.storeId}`,
          storeAddress: store.storeAddress ?? "",
        }),
      );
      setStores(mapped);
      if (mapped.length) {
        const exists = mapped.some(
          (store) => store.storeId === selectedStore,
        );
        if (!exists) {
          setSelectedStore(mapped[0].storeId);
        }
      }
    } catch (error) {
      console.error(error);
      setStoreNote(
        error instanceof Error ? error.message : "Unable to load stores.",
      );
    } finally {
      setStoresLoading(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const fetchRecentFromRecords = useCallback(async () => {
    const startDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const params = new URLSearchParams({
      category: "surveillance",
      employee: user.name,
      startDate,
    });
    const response = await fetch(`/api/records?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? "Unable to load submissions.");
    }
    const storeMap = new Map<string, string>(
      Array.isArray(payload?.stores)
        ? payload.stores.map((store: any) => [
            store.storeId ?? store.storeNumber,
            store.storeName ?? store.storeId,
          ])
        : [],
    );
    const records = Array.isArray(payload?.records) ? payload.records : [];
    return records.map((record: any) => ({
      id: record.id,
      label: record.surveillanceLabel ?? "surveillance",
      storeNumber: record.storeNumber,
      storeName:
        storeMap.get(record.storeNumber) ?? `Store ${record.storeNumber}`,
      summary:
        record.surveillanceSummary ??
        record.notes ??
        "Surveillance submission",
      notes: record.notes ?? null,
      createdAt: record.createdAt,
      attachments: Array.isArray(record.attachments)
        ? record.attachments
        : [],
    }));
  }, [user.name]);

  const loadRecentReports = useCallback(async () => {
    setRecentStatus("loading");
    setRecentMessage(null);
    try {
      const fallback = await fetchRecentFromRecords();
      setRecentReports(fallback);
      setRecentStatus("idle");
    } catch (fallbackError) {
      console.error("Unable to load surveillance submissions:", fallbackError);
      setRecentStatus("error");
      setRecentMessage(
        fallbackError instanceof Error
          ? fallbackError.message
          : "Unable to load submissions.",
      );
    }
  }, [fetchRecentFromRecords]);

  useEffect(() => {
    loadRecentReports();
  }, [loadRecentReports]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setMessage(null);
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    formData.set("storeId", selectedStore);

    try {
      const response = await fetch("/api/surveillance", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error ?? "Unable to upload footage.");
      }
      formElement.reset();
      setStatus("success");
      setMessage("Surveillance report sent to client.");
      loadRecentReports();
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to upload footage.",
      );
    } finally {
      setTimeout(() => setStatus("idle"), 5000);
    }
  };

  const handleAddStore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addCode.trim()) return;
    setAddStatus("adding");
    setStoreNote(null);
    try {
      const response = await fetch("/api/surveillance/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: addCode.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to add store.");
      }
      setAddCode("");
      await loadStores();
      setStoreNote("Store added. You can now upload reports for it.");
    } catch (error) {
      console.error(error);
      setStoreNote(
        error instanceof Error ? error.message : "Unable to add store.",
      );
    } finally {
      setAddStatus("idle");
    }
  };

  const formatTimestamp = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#040a20] to-[#010109] px-4 py-10 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-900/40 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Iron Hand · Surveillance
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold text-white">
                Surveillance Desk
              </h1>
              <p className="text-sm text-slate-300">
                Footage and incident summaries route directly to client records.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SettingsButton user={user} />
              <LogoutButton />
            </div>
          </div>
        </header>

        <section className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-900/40 backdrop-blur">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Daily surveillance upload
            </p>
            <h2 className="text-xl font-semibold text-white">
              Log footage + summary
            </h2>
            {storesLoading ? (
              <p className="text-xs text-slate-400">Loading stores…</p>
            ) : (
              <p className="text-xs text-slate-400">
                Reporting for{" "}
                {
                  stores.find((store) => store.storeId === selectedStore)
                    ?.storeName
                }
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Store
              </label>
              <select
                value={selectedStore}
                onChange={(event) => setSelectedStore(event.target.value)}
                className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-3 text-sm text-white focus:border-blue-400 focus:outline-none"
              >
                {stores.map((store) => (
                  <option key={store.storeId} value={store.storeId}>
                    {store.storeName} ({store.storeId})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Footage classification
              </label>
              <select
                name="label"
                required
                className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-3 text-sm text-white focus:border-blue-400 focus:outline-none"
              >
                <option value="">Select label</option>
                {labels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                File upload
              </label>
              <input
                name="footage"
                type="file"
                accept="video/*,image/*"
                required
                className="w-full rounded-2xl border border-dashed border-white/20 bg-[#0e1730] px-4 py-3 text-xs text-slate-300"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Employee action summary
              </label>
              <textarea
                name="summary"
                rows={3}
                required
                placeholder="Summarize observed activity, compliance, or issues."
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Optional notes to client
              </label>
              <textarea
                name="notes"
                rows={3}
                placeholder="Call out critical moments or follow-up requests."
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
              />
            </div>

            {message && (
              <p
                className={`rounded-2xl px-4 py-2 text-sm ${
                  status === "success"
                    ? "bg-emerald-500/10 text-emerald-200"
                    : "bg-red-500/10 text-red-200"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "sending" || stores.length === 0}
              className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "sending" ? "Uploading…" : "Send surveillance report"}
            </button>
          </form>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-900/40 backdrop-blur">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Add stores
            </p>
            <h2 className="text-xl font-semibold text-white">
              Apply surveillance access codes
            </h2>
          </div>

          <form onSubmit={handleAddStore} className="mt-4 flex flex-col gap-3">
            <input
              type="text"
              placeholder="SUR-XXXXXX"
              value={addCode}
              onChange={(event) => setAddCode(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            />
            {storeNote && (
              <p className="text-xs text-slate-200">{storeNote}</p>
            )}
            <button
              type="submit"
              disabled={addStatus === "adding"}
              className="self-start rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60 disabled:opacity-60"
            >
              {addStatus === "adding" ? "Adding…" : "Add store"}
            </button>
          </form>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-900/40 backdrop-blur">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Recent activity
            </p>
            <h2 className="text-xl font-semibold text-white">
              Last 3 days of uploads
            </h2>
            <p className="text-xs text-slate-400">
              Confirm what has been delivered to clients. Section refreshes
              after each send.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {recentStatus === "loading" ? (
              <p className="text-sm text-slate-300">Loading submissions…</p>
            ) : recentStatus === "error" ? (
              <p className="text-sm text-red-300">
                {recentMessage ?? "Unable to load submissions."}
              </p>
            ) : recentReports.length === 0 ? (
              <p className="text-sm text-slate-400">
                No surveillance uploads in the last three days.
              </p>
            ) : (
              recentReports.map((report) => (
                <article
                  key={report.id}
                  className="rounded-2xl border border-white/10 bg-[#0c1329] p-4 text-sm text-slate-200"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-semibold text-white">
                        {report.storeName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {report.storeNumber}
                      </p>
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatTimestamp(report.createdAt)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-blue-200">
                    <span className="rounded-full border border-blue-400/40 px-3 py-1">
                      {report.label}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-200">
                    {report.summary}
                  </p>
                  {report.notes && (
                    <p className="mt-2 text-xs text-slate-400">
                      Client note: {report.notes}
                    </p>
                  )}
                  {Array.isArray(report.attachments) &&
                    report.attachments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {report.attachments.map((file) => (
                          <a
                            key={file.id}
                            href={file.path}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white transition hover:border-white/60"
                          >
                            {file.originalName ?? "View file"}
                          </a>
                        ))}
                      </div>
                    )}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
