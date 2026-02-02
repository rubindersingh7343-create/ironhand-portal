"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CombinedRecord, StoredFile } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";

type CategoryKey =
  | "shift"
  | "daily"
  | "weekly"
  | "monthly"
  | "surveillance"
  | "invoice";

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
  { key: "invoice", label: "Invoices", description: "Invoices sent by employees" },
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
    invoice: false,
  });

  const mergeStores = useCallback(
    (incoming: StoreOption[]) => {
      if (!incoming.length) return;
      setStoreOptions((prev) => {
        const map = new Map(prev.map((entry) => [entry.id, entry]));
        incoming.forEach((store) => {
          const existing = map.get(store.id);
          map.set(store.id, {
            id: store.id,
            name: store.name ?? existing?.name ?? `Store ${store.id}`,
            address: store.address ?? existing?.address,
            manager: store.manager ?? existing?.manager,
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
      invoice: [],
    };
    records.forEach((record) => {
      if ((grouped as any)[record.category]) {
        grouped[record.category as CategoryKey].push(record);
      }
    });
    return grouped;
  }, [records]);
  const [viewerFile, setViewerFile] = useState<StoredFile | null>(null);

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
    <section className="ui-card text-white">
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
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`store-activity-skeleton-${index}`}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="ui-skeleton h-4 w-40" />
              <div className="mt-2 ui-skeleton h-3 w-32" />
              <div className="mt-3 ui-skeleton h-10 w-full" />
            </div>
          ))}
        </div>
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
                              record.attachments.map((file) => {
                                const src = `/api/uploads/proxy?path=${encodeURIComponent(
                                  file.path ?? file.id,
                                )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
                                  file.originalName ?? file.label ?? "file",
                                )}`;
                                return (
                                  <button
                                    type="button"
                                    key={file.id}
                                    onClick={() => setViewerFile(file)}
                                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-blue-200 transition hover:border-blue-400 hover:text-blue-100"
                                  >
                                    <p className="font-semibold text-white">
                                      {file.label ?? "Attachment"}
                                    </p>
                                    <p className="truncate text-[11px] text-slate-300">
                                      {file.originalName}
                                    </p>
                                  </button>
                                );
                              })
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
      <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </section>
  );
}

function FileViewer({
  file,
  onClose,
}: {
  file: StoredFile | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  if (!file) return null;
  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val));
  const getDistance = (touches: TouchList | React.TouchList) => {
    const [a, b] = [touches[0] as Touch, touches[1] as Touch];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };
  const showSpinner = file.kind !== "video";
  useEffect(() => {
    if (!showSpinner) {
      setLoading(false);
      setLoadError(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const timer = setTimeout(() => {
      setLoading(false);
      setLoadError(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, [file?.id, showSpinner]);
  const src = `/api/uploads/proxy?path=${encodeURIComponent(
    file.path ?? file.id,
  )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
    file.originalName ?? file.label ?? "file",
  )}`;
  const isImage = file.kind === "image";
  const isVideo = file.kind === "video";
  const contentStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
    transition: "transform 80ms ease",
  };
  const zoomIn = () => setScale((prev) => Math.min(4, parseFloat((prev + 0.25).toFixed(2))));
  const zoomOut = () => setScale((prev) => Math.max(0.5, parseFloat((prev - 0.25).toFixed(2))));

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose panelClassName="max-w-4xl">
      <div className="relative flex max-h-[82vh] flex-col gap-3">
        <div className="absolute right-2 top-10 flex gap-2">
          <button
            type="button"
            onClick={zoomOut}
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white hover:bg-white/10"
          >
            -
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white hover:bg-white/10"
          >
            +
          </button>
        </div>
        <div className="space-y-1 pr-12">
          <p className="text-lg font-semibold text-white">
            {file.label || file.originalName || "File"}
          </p>
          <p className="text-xs text-slate-300">{file.originalName}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div
            className="relative max-h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2"
            onTouchStart={(event) => {
              if (event.touches.length === 2) {
                pinchStartDist.current = getDistance(event.touches);
                pinchStartScale.current = scale;
              } else if (event.touches.length === 1) {
                lastTouch.current = {
                  x: event.touches[0].clientX,
                  y: event.touches[0].clientY,
                };
              }
            }}
            onTouchMove={(event) => {
              if (event.touches.length === 2 && pinchStartDist.current) {
                const dist = getDistance(event.touches);
                const nextScale = clamp(
                  pinchStartScale.current * (dist / pinchStartDist.current),
                  1,
                  4,
                );
                setScale(nextScale);
              } else if (
                event.touches.length === 1 &&
                lastTouch.current &&
                scale > 1
              ) {
                const { clientX, clientY } = event.touches[0];
                const deltaX = clientX - lastTouch.current.x;
                const deltaY = clientY - lastTouch.current.y;
                setOffset((prev) => ({
                  x: prev.x + deltaX,
                  y: prev.y + deltaY,
                }));
                lastTouch.current = { x: clientX, y: clientY };
              }
            }}
            onTouchEnd={() => {
              pinchStartDist.current = null;
              lastTouch.current = null;
            }}
            style={{ touchAction: "none" }}
          >
            {showSpinner && loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            )}
            {showSpinner && loadError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/40 text-sm text-red-200">
                <p>Unable to load this file.</p>
                <a
                  href={src}
                  className="rounded-md bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                >
                  Download / open directly
                </a>
              </div>
            )}
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={file.originalName}
                loading="lazy"
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setLoadError(true);
                }}
                className="mx-auto block h-auto max-h-[64vh] w-auto"
                style={contentStyle}
              />
            ) : isVideo ? (
              <>
                <video
                  controls
                  src={src}
                  playsInline
                  preload="metadata"
                  onLoadedData={() => setLoading(false)}
                  className="mx-auto block h-auto max-h-[64vh] w-auto max-w-none rounded-lg bg-black"
                  style={contentStyle}
                />
                <div className="mt-3 text-center text-xs text-slate-300">
                  <a
                    href={src}
                    className="text-blue-200 underline underline-offset-4 hover:text-white"
                  >
                    Open directly / download
                  </a>
                </div>
              </>
            ) : (
              <iframe
                src={src}
                title={file.originalName}
                onLoad={() => setLoading(false)}
                className="h-[60vh] w-full rounded-lg bg-white"
                style={{ ...contentStyle, height: "60vh" }}
              />
            )}
          </div>
        </div>
      </div>
    </IHModal>
  );
}
