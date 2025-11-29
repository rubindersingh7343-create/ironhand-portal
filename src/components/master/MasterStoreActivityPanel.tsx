"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CombinedRecord } from "@/lib/types";

type CategoryKey = "shift" | "daily" | "weekly" | "monthly" | "surveillance";

interface StoreOption {
  id: string;
  name: string;
  address?: string;
  manager?: string;
}

const CATEGORY_SECTIONS: Array<{
  key: CategoryKey;
  label: string;
  description: string;
}> = [
  { key: "shift", label: "End of shift evidence", description: "Employee uploads" },
  { key: "daily", label: "Daily reports", description: "Store manager summaries" },
  { key: "weekly", label: "Weekly orders", description: "Restock + supply lists" },
  { key: "monthly", label: "Monthly reports", description: "Documents & audits" },
  { key: "surveillance", label: "Surveillance", description: "Remote footage + notes" },
];

export default function MasterStoreActivityPanel() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState<Record<CategoryKey, boolean>>({
    shift: true,
    daily: true,
    weekly: false,
    monthly: false,
    surveillance: false,
  });

  const mergeStores = useCallback(
    (incoming: StoreOption[]) => {
      if (!incoming.length) return;
      setStoreOptions((prev) => {
        const map = new Map(prev.map((entry) => [entry.id, entry]));
        incoming.forEach((store) => {
          const existing = map.get(store.id) ?? {};
          map.set(store.id, {
            id: store.id,
            name: store.name ?? existing.name ?? `Store ${store.id}`,
            address: store.address ?? existing.address,
            manager: store.manager ?? existing.manager,
          });
        });
        const sorted = Array.from(map.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        if (!selectedStore && sorted.length) {
          setSelectedStore(sorted[0].id);
        }
        return sorted;
      });
    },
    [selectedStore],
  );

  useEffect(() => {
    const controller = new AbortController();
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores/all", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Unable to load stores.");
        }
        const data = await response.json();
        const options: StoreOption[] = (data.stores ?? []).map((store: any) => ({
          id: store.storeId,
          name:
            store.storeName ??
            store.store_name ??
            store.name ??
            `Store ${store.storeId}`,
          address: store.address,
          manager: store.managerName ?? "—",
        }));
        if (options.length) {
          mergeStores(options);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setError("Unable to load stores.");
        }
      }
    };
    loadStores();
    return () => controller.abort();
  }, [mergeStores]);

  useEffect(() => {
    const controller = new AbortController();
    const loadArchiveStores = async () => {
      try {
        const response = await fetch("/api/master/archive", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Unable to load archive stores.");
        }
        const data = await response.json();
        const fromArchive: StoreOption[] = (data.managers ?? []).flatMap(
          (manager: any) =>
            (manager.stores ?? []).map((store: any) => ({
              id: store.storeId,
              name: store.storeName ?? `Store ${store.storeId}`,
              address: store.address,
              manager: manager.managerName ?? "—",
            })),
        );
        mergeStores(fromArchive);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    };
    loadArchiveStores();
    return () => controller.abort();
  }, [mergeStores]);

  const loadRecords = useCallback(
    async (storeId: string, day: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("store", storeId);
        const startISO = new Date(`${day}T00:00:00.000Z`).toISOString();
        const endISO = new Date(`${day}T23:59:59.999Z`).toISOString();
        params.set("startDate", startISO);
        params.set("endDate", endISO);
        params.set("category", "all");
        const response = await fetch(`/api/records?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Unable to load records.");
        }
        const data = await response.json();
        const additionalStores: StoreOption[] = Array.isArray(data.stores)
          ? (data.stores as any[]).map((store) => ({
              id: store.storeId ?? store,
              name:
                typeof store === "object" &&
                (store.storeName || store.store_name || store.name)
                  ? store.storeName ?? store.store_name ?? store.name
                  : `Store ${store.storeId ?? store}`,
              address: store.address,
              manager: store.managerName,
            }))
          : [];
        if (additionalStores.length) {
          mergeStores(additionalStores);
        }
        setRecords(Array.isArray(data.records) ? data.records : []);
      } catch (error) {
        console.error(error);
        setError(error instanceof Error ? error.message : "Unable to load files.");
        setRecords([]);
      } finally {
        setLoading(false);
      }
    },
    [mergeStores],
  );

  useEffect(() => {
    if (!selectedStore || !selectedDate) return;
    loadRecords(selectedStore, selectedDate);
  }, [selectedStore, selectedDate, loadRecords]);

  const selectedStoreMeta = storeOptions.find(
    (option) => option.id === selectedStore,
  );

  const recordsByCategory = useMemo(() => {
    const grouped: Record<CategoryKey, CombinedRecord[]> = {
      shift: [],
      daily: [],
      weekly: [],
      monthly: [],
      surveillance: [],
    };
    records.forEach((record) => {
      if ((grouped as any)[record.category]) {
        grouped[record.category as CategoryKey].push(record);
      }
    });
    return grouped;
  }, [records]);

  const changeDay = (direction: "prev" | "next") => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + (direction === "prev" ? -1 : 1));
    const formatted = current.toISOString().slice(0, 10);
    if (direction === "next" && formatted > today) return;
    setSelectedDate(formatted);
  };

  const toggleCategory = (key: CategoryKey) => {
    setCategoryOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section className="rounded-[32px] border border-white/10 bg-[rgba(9,16,30,0.95)] p-6 shadow-2xl shadow-slate-950/40">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Store activity
          </p>
          <h2 className="text-2xl font-semibold text-white">
            Daily submissions by store
          </h2>
          <p className="text-sm text-slate-300">
            Check every file uploaded for the selected store and date.
          </p>
        </div>
        <div className="space-y-2 text-sm text-slate-200">
          <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Store
          </label>
          <select
            value={selectedStore}
            onChange={(event) => setSelectedStore(event.target.value)}
            className="w-72 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
          >
            {storeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Selected store
          </p>
          <p className="text-lg font-semibold text-white">
            {selectedStoreMeta?.name ?? "Select a store"}
          </p>
          <p className="text-xs text-slate-400">
            ID {selectedStore} • Manager {selectedStoreMeta?.manager ?? "—"}
          </p>
          {selectedStoreMeta?.address && (
            <p className="text-xs text-slate-400">{selectedStoreMeta.address}</p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => changeDay("prev")}
            className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white hover:border-white/40"
          >
            Previous day
          </button>
          <input
            type="date"
            max={today}
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => changeDay("next")}
            className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white hover:border-white/40"
          >
            Next day
          </button>
        </div>
      </div>

      {loading && (
        <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
          Loading files…
        </p>
      )}
      {error && (
        <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {CATEGORY_SECTIONS.map((section) => {
            const items = recordsByCategory[section.key];
            const isOpen = categoryOpen[section.key];
            return (
              <div
                key={section.key}
                className="rounded-3xl border border-white/10 bg-[#0d1730] px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(section.key)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      {section.label}
                    </p>
                    <p className="text-sm text-slate-300">{section.description}</p>
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white">
                    {isOpen
                      ? `Hide (${items.length})`
                      : `View (${items.length})`}
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-3">
                    {items.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-white/10 px-3 py-2 text-center text-sm text-slate-400">
                        No {section.label.toLowerCase()} submissions on this date.
                      </p>
                    ) : (
                      items.map((record) => (
                        <div
                          key={record.id}
                          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.3em] text-slate-400">
                            <span>Submitted by {record.employeeName}</span>
                            <span>
                              {new Date(record.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {record.shiftNotes && (
                            <p className="mt-2 text-sm text-slate-200">
                              Notes: {record.shiftNotes}
                            </p>
                          )}
                          {record.textContent && (
                            <p className="mt-2 text-sm text-slate-200">
                              {record.textContent}
                            </p>
                          )}
                          {record.notes && (
                            <p className="mt-2 text-sm text-slate-200">
                              {record.notes}
                            </p>
                          )}
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {record.attachments?.length === 0 ? (
                              <p className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-center text-xs text-slate-400">
                                No files attached.
                              </p>
                            ) : (
                              record.attachments.map((file) => (
                                <a
                                  key={file.id}
                                  href={file.path}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-blue-200 transition hover:border-blue-400 hover:text-blue-100"
                                >
                                  <p className="font-semibold text-white">
                                    {file.label ?? "Attachment"}
                                  </p>
                                  <p className="truncate text-[11px] text-slate-300">
                                    {file.originalName}
                                  </p>
                                </a>
                              ))
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
    </section>
  );
}
