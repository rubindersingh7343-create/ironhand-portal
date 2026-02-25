"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CombinedRecord, StoredFile } from "@/lib/types";
import FileViewer from "@/components/records/FileViewer";

interface StoreInfo {
  storeId: string;
  storeName?: string;
}

interface GroupedRecord {
  storeId: string;
  storeName: string;
  records: CombinedRecord[];
}

export default function DailyFilesPanel() {
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [storeMap, setStoreMap] = useState<Record<string, StoreInfo>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [showAll, setShowAll] = useState(false);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [viewerFile, setViewerFile] = useState<StoredFile | null>(null);

  const groupedRecords = useMemo<GroupedRecord[]>(() => {
    const groups: Record<string, GroupedRecord> = {};
    records.forEach((record) => {
      const storeId = record.storeNumber;
      if (!groups[storeId]) {
        groups[storeId] = {
          storeId,
          storeName:
            storeMap[storeId]?.storeName ?? `Store ${storeId}`,
          records: [],
        };
      }
      groups[storeId].records.push(record);
    });
    return Object.values(groups).sort((a, b) =>
      a.storeName.localeCompare(b.storeName),
    );
  }, [records, storeMap]);

  useEffect(() => {
    const controller = new AbortController();
    const loadData = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const [recordsResponse, storesResponse] = await Promise.all([
          fetch(
            `/api/records?startDate=${selectedDate}&endDate=${selectedDate}`,
            { cache: "no-store", signal: controller.signal },
          ),
          fetch("/api/stores/all", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!recordsResponse.ok) {
          throw new Error("Unable to load daily records.");
        }
        const recordsData = await recordsResponse.json();
        setRecords(recordsData.records ?? []);
        if (storesResponse.ok) {
          const storesData = await storesResponse.json();
          const map: Record<string, StoreInfo> = {};
          (storesData.stores ?? []).forEach((store: StoreInfo) => {
            map[store.storeId] = store;
          });
          setStoreMap(map);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setMessage(
          error instanceof Error ? error.message : "Unable to load files.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    loadData();
    return () => controller.abort();
  }, [selectedDate]);

  const visibleGroups = showAll ? groupedRecords : groupedRecords.slice(0, 3);

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Daily files
          </p>
          <h2 className="text-xl font-semibold text-white">
            {records.length} records
          </h2>
          <p className="text-sm text-slate-300">
            {selectedDate} · All uploaded files grouped by store.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Date
          </label>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded-2xl border border-white/15 bg-[#0d1730] px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
          />
          {groupedRecords.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
            >
              {showAll ? "Collapse list" : "Show all stores"}
            </button>
          )}
        </div>
      </div>

      {message && (
        <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {message}
        </p>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`daily-files-skeleton-${index}`}
              className="rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3"
            >
              <div className="ui-skeleton h-4 w-36" />
              <div className="mt-2 ui-skeleton h-3 w-28" />
              <div className="mt-3 ui-skeleton h-10 w-full" />
            </div>
          ))}
        </div>
      ) : groupedRecords.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-sm text-slate-300">
          No uploads yet today.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((group) => (
            <div
              key={group.storeId}
              className="rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{group.storeName}</p>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    {group.storeId}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200">
                    {group.records.length} uploads
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedStore((prev) =>
                        prev === group.storeId ? null : group.storeId,
                      )
                    }
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-white/60"
                  >
                    {expandedStore === group.storeId ? "Hide uploads" : "View uploads"}
                  </button>
                </div>
              </div>
              {expandedStore === group.storeId && (
                <div className="mt-3 space-y-2 rounded-2xl border border-white/15 bg-[#0d1630] px-4 py-3">
                  {group.records.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-white">
                          {record.employeeName}
                        </p>
                        <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-200">
                          {record.category.toUpperCase()}
                        </span>
                      </div>
                      <p>{new Date(record.createdAt).toLocaleString()}</p>
                      {record.shiftNotes && (
                        <p className="text-slate-200">
                          Notes: {record.shiftNotes}
                        </p>
                      )}
                      {record.textContent && (
                        <p className="text-slate-200">
                          Report: {record.textContent}
                        </p>
                      )}
                      <div className="mt-2 space-y-1">
                        {record.attachments.length === 0 ? (
                          <p className="text-slate-400">No files uploaded.</p>
                        ) : (
                          record.attachments.map((file) => (
                            <button
                              type="button"
                              key={file.id}
                              onClick={() => setViewerFile(file)}
                              className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-[11px] text-white hover:border-white/40"
                            >
                              {file.label ?? file.originalName}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </section>
  );
}

// File viewing is handled by the shared viewer in `@/components/records/FileViewer`.
