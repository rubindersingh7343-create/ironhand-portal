"use client";

import { useEffect, useState } from "react";
import type { CombinedRecord } from "@/lib/types";

const reportCategories: Array<CombinedRecord["category"]> = [
  "daily",
  "weekly",
  "monthly",
  "surveillance",
  "invoice",
];

const reportLabels: Record<CombinedRecord["category"], string> = {
  shift: "End of Shift",
  daily: "Daily Report",
  weekly: "Weekly Orders",
  monthly: "Monthly Report",
  surveillance: "Surveillance",
  invoice: "Invoices",
};

interface ArchiveStore {
  storeId: string;
  storeName: string;
  address?: string;
  records: CombinedRecord[];
}

interface ArchiveManager {
  managerId: string;
  managerName: string;
  managerEmail?: string;
  stores: ArchiveStore[];
}

export default function MasterArchivePanel() {
  const [managers, setManagers] = useState<ArchiveManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedManager, setExpandedManager] = useState<string | null>(null);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [expandedManagerReports, setExpandedManagerReports] = useState<
    string | null
  >(null);
  const [openStoreCategory, setOpenStoreCategory] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    const loadArchive = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/master/archive", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Unable to load archive.");
        }
        const data = await response.json();
        setManagers(data.managers ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setError(
            error instanceof Error ? error.message : "Unable to load archive.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    loadArchive();
    return () => controller.abort();
  }, []);

  const totalRecords = managers.reduce((sum, manager) => {
    return (
      sum +
      manager.stores.reduce(
        (storeSum, store) => storeSum + store.records.length,
        0,
      )
    );
  }, 0);

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Master archive
          </p>
          <h2 className="text-2xl font-semibold text-white">
            Files by store manager
          </h2>
          <p className="text-sm text-slate-300">
            Browse every upload (employees, managers, surveillance) grouped by
            the manager responsible for each store.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white">
          {totalRecords} files catalogued
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={`archive-skeleton-${index}`}
              className="rounded-3xl border border-white/10 bg-[#0b152b] px-5 py-4"
            >
              <div className="ui-skeleton h-4 w-36" />
              <div className="mt-3 ui-skeleton h-5 w-56" />
              <div className="mt-2 ui-skeleton h-3 w-40" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {!loading && !error && managers.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-4 text-center text-sm text-slate-300">
          No files have been uploaded yet.
        </p>
      )}

      <div className="space-y-4">
        {managers
          .filter((manager) => manager.managerId !== "unassigned")
          .map((manager) => {
          const storeLabel =
            manager.stores.length === 1
              ? "1 store"
              : `${manager.stores.length} stores`;
          return (
            <article
              key={manager.managerId}
              className="rounded-3xl border border-white/10 bg-[#0b152b] px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1 text-sm text-slate-200 sm:flex-row sm:items-center sm:gap-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Store Manager
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-white">
                    <div className="flex flex-col gap-1 text-sm text-slate-200 sm:flex-row sm:items-center sm:gap-3">
                      <span className="text-base font-semibold">
                        {manager.managerName}
                      </span>
                      {manager.managerEmail && (
                        <span className="text-sm text-slate-300">
                          {manager.managerEmail}
                        </span>
                      )}
                    </div>
                    <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200">
                      {storeLabel}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setExpandedManager((prev) =>
                    prev === manager.managerId ? null : manager.managerId,
                  )
                }
                className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
              >
                {expandedManager === manager.managerId ? "Collapse" : "Expand"}
              </button>
              {expandedManager === manager.managerId && (
                <div className="mt-4 space-y-3">
                  {manager.stores.map((store) => {
                    const storeKey = `${manager.managerId}-${store.storeId}`;
                  const isExpanded = expandedStore === storeKey;
                  return (
                    <div
                      key={store.storeId}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-white">
                            {store.storeName}
                          </p>
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                            {store.storeId}
                          </p>
                          {store.address && (
                            <p className="text-xs text-slate-400">
                              {store.address}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            {store.records.length} record
                            {store.records.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedStore((prev) =>
                              prev === storeKey ? null : storeKey,
                            )
                          }
                          className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
                        >
                          {isExpanded ? "Hide files" : "View files"}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 space-y-3">
                          {store.records.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-center text-xs text-slate-400">
                              No uploads yet.
                            </p>
                          ) : (
                            store.records.map((record) => (
                              <div
                                key={record.id}
                                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs text-slate-200"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-200">
                                    {record.category}
                                  </span>
                                  <p className="text-[11px] text-slate-400">
                                    {new Date(record.createdAt).toLocaleString()}
                                  </p>
                                </div>
                                <p className="mt-1 font-semibold text-white">
                                  {record.employeeName}
                                </p>
                                {record.textContent && (
                                  <p className="mt-1 text-slate-200">
                                    {record.textContent}
                                  </p>
                                )}
                                {record.shiftNotes && (
                                  <p className="mt-1 text-slate-200">
                                    Notes: {record.shiftNotes}
                                  </p>
                                )}
                                {record.notes && (
                                  <p className="mt-1 text-slate-200">
                                    Notes: {record.notes}
                                  </p>
                                )}
                                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                  {record.attachments.map((file) => {
                                    const proxyUrl = `/api/uploads/proxy?path=${encodeURIComponent(
                                      file.path ?? file.id,
                                    )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
                                      file.originalName ?? file.label ?? "file",
                                    )}`;
                                    return (
                                      <a
                                        key={file.id}
                                        href={proxyUrl}
                                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-blue-200 transition hover:border-blue-400 hover:text-blue-100"
                                      >
                                        <p className="font-semibold text-white">
                                          {file.label ?? "Attachment"}
                                        </p>
                                        <p className="truncate text-[10px] text-slate-300">
                                          {file.originalName}
                                        </p>
                                      </a>
                                    );
                                  })}
                                  {record.attachments.length === 0 && (
                                    <p className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-center text-[11px] text-slate-400">
                                      No files attached
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
      </div>

    </section>
  );
}
