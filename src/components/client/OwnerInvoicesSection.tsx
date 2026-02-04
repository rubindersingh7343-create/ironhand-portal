"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FileViewer from "@/components/records/FileViewer";
import type { CombinedRecord, SessionUser, StoredFile } from "@/lib/types";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";

type StoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type InvoiceRecord = CombinedRecord & {
  invoiceNumber?: string;
  invoiceAmountCents?: number;
  invoiceDueDate?: string;
  invoicePaid?: boolean;
  invoicePaymentMethod?: string;
  invoicePaymentDetails?: Record<string, unknown>;
  invoicePaidAmountCents?: number;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatCurrency(cents?: number) {
  if (typeof cents !== "number") return "—";
  return currency.format(cents / 100);
}

function formatMonth(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OwnerInvoicesSection({ user }: { user: SessionUser }) {
  const ownerStore = useOwnerPortalStore();
  const hasSharedStore = Boolean(ownerStore);
  const manualDateRange = ownerStore?.manualDateRange ?? null;
  const setManualDateRange = ownerStore?.setManualDateRange;
  const [stores, setStores] = useState<StoreSummary[]>(
    ownerStore?.stores ?? [],
  );
  const [selectedStore, setSelectedStore] = useState(
    ownerStore?.selectedStoreId ?? "",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [viewerFile, setViewerFile] = useState<StoredFile | null>(null);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});
  const [unseenIds, setUnseenIds] = useState<string[]>([]);
  const selectedStoreMeta = useMemo(
    () => stores.find((store) => store.storeId === selectedStore),
    [stores, selectedStore],
  );
  const showUpgrade =
    Boolean(selectedStoreMeta?.hasSurveillance) &&
    !selectedStoreMeta?.hasManager;

  useEffect(() => {
    if (ownerStore) {
      setStores(ownerStore.stores);
      if (ownerStore.selectedStoreId) {
        setSelectedStore(ownerStore.selectedStoreId);
      }
      return;
    }
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const list: StoreSummary[] = Array.isArray(data.stores)
          ? data.stores
          : [];
        setStores(list);
        setSelectedStore(
          list.find((store) => user.storeIds?.includes(store.storeId))?.storeId ??
            list[0]?.storeId ??
            user.storeNumber ??
            "",
        );
      } catch (error) {
        console.error(error);
      }
    };
    loadStores();
  }, [ownerStore, ownerStore?.stores, ownerStore?.selectedStoreId, user.storeIds, user.storeNumber]);

  useEffect(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(today.toISOString().slice(0, 10));
  }, []);

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

  const loadUnseen = useCallback(
    async (storeOverride?: string) => {
      if (!selectedStore) return;
      try {
        const storeParam = storeOverride ?? selectedStore;
        const response = await fetch(
          `/api/owner/unseen?type=invoice&storeId=${encodeURIComponent(
            storeParam,
          )}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setUnseenCounts(data.counts ?? {});
          setUnseenIds(Array.isArray(data.unseenIds) ? data.unseenIds : []);
        }
      } catch (error) {
        console.error("Failed to load invoice unseen markers", error);
      }
    },
    [selectedStore],
  );

  const loadInvoices = useCallback(
    async (silent = false) => {
      if (!selectedStore) return;
      if (!startDate || !endDate) return;
      if (!silent) {
        setLoading(true);
      }
      setMessage(null);
      try {
        const startIso = new Date(`${startDate}T00:00:00`).toISOString();
        const endIso = new Date(`${endDate}T23:59:59.999`).toISOString();
        const params = new URLSearchParams({
          category: "invoice",
          store: selectedStore,
          startDate: startIso,
          endDate: endIso,
        });
        const response = await fetch(`/api/records?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load invoices.");
        }
        const next = Array.isArray(data.records) ? data.records : [];
        setRecords(next as InvoiceRecord[]);
        loadUnseen(selectedStore);
      } catch (error) {
        console.error(error);
        setRecords([]);
        setMessage(
          error instanceof Error ? error.message : "Unable to load invoices.",
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [selectedStore, startDate, endDate, loadUnseen],
  );

  useEffect(() => {
    loadInvoices(false);
  }, [loadInvoices]);

  useEffect(() => {
    loadUnseen();
  }, [loadUnseen]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadInvoices(true);
      loadUnseen();
    }, 20000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadInvoices(true);
        loadUnseen();
      }
    };
    const handleFocus = () => {
      loadInvoices(true);
      loadUnseen();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadInvoices]);

  const grouped = useMemo(() => {
    const map = new Map<string, InvoiceRecord[]>();
    records.forEach((record) => {
      const label = formatMonth(record.createdAt);
      const list = map.get(label) ?? [];
      list.push(record);
      map.set(label, list);
    });
    return Array.from(map.entries()).map(([label, list]) => ({
      label,
      records: list,
      totalCents: list.reduce(
        (sum, record) => sum + (record.invoiceAmountCents ?? 0),
        0,
      ),
    }));
  }, [records]);

  const totalRange = useMemo(
    () => records.reduce((sum, record) => sum + (record.invoiceAmountCents ?? 0), 0),
    [records],
  );

  const upcomingPayments = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return records
      .filter((record) => !record.invoicePaid && record.invoiceDueDate)
      .filter((record) => (record.invoiceDueDate ?? "") >= today)
      .sort((a, b) => (a.invoiceDueDate ?? "").localeCompare(b.invoiceDueDate ?? ""));
  }, [records]);

  const unseenSet = useMemo(() => new Set(unseenIds), [unseenIds]);

  const handleOpenFile = async (record: InvoiceRecord, file: StoredFile) => {
    setViewerFile(file);
    await fetch("/api/owner/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            storeId: record.storeNumber,
            itemType: "invoice",
            itemId: record.id,
          },
        ],
      }),
    });
    setUnseenIds((prev) => prev.filter((id) => id !== record.id));
    setUnseenCounts((prev) => ({
      ...prev,
      [record.storeNumber]: Math.max(0, (prev[record.storeNumber] ?? 1) - 1),
    }));
  };

  return (
    <section className="ui-card text-white">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
          Invoices
        </p>
      </div>

      <div className="reports-filter-row mb-4 flex flex-wrap gap-2">
        {!hasSharedStore && (
          <div className="relative flex-1 sm:flex-none">
            <select
              className="ui-field--slim min-w-[160px] w-full appearance-none pr-7"
              value={selectedStore}
              onChange={(event) => setSelectedStore(event.target.value)}
            >
              {stores.map((store) => {
                const count = unseenCounts[store.storeId] ?? 0;
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
            {unseenCounts[selectedStore] ? (
              <span className="pointer-events-none absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-400" />
            ) : null}
          </div>
        )}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
          <input
            type="date"
            className="ui-field--slim w-full min-w-0"
            value={startDate}
            onChange={(event) => {
              const next = event.target.value;
              setStartDate(next);
              setManualDateRange?.({ startDate: next, endDate });
            }}
          />
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
            to
          </span>
          <input
            type="date"
            className="ui-field--slim w-full min-w-0"
            value={endDate}
            onChange={(event) => {
              const next = event.target.value;
              setEndDate(next);
              setManualDateRange?.({ startDate, endDate: next });
            }}
          />
        </div>
      </div>

      {showUpgrade ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Upgrade to premium to access this feature.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-200">Upcoming Payments</p>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                {upcomingPayments.length}
              </p>
            </div>
            {upcomingPayments.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                No upcoming payments for this store.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {upcomingPayments.map((record) => (
                  <div
                    key={`upcoming-${record.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1b3a] px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {record.invoiceCompany ?? "Invoice"}{" "}
                        {record.invoiceNumber ? `· ${record.invoiceNumber}` : ""}
                      </p>
                      <p className="text-xs text-slate-400">
                        Due {formatDate(record.invoiceDueDate)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {formatCurrency(record.invoiceAmountCents)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-200">Total</p>
              <p className="text-lg font-semibold text-white">
                {formatCurrency(totalRange)}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setInvoicesOpen((prev) => !prev)}
              className="ui-card-press inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-100"
            >
              {invoicesOpen ? "Hide invoices" : "See invoices"}
            </button>

            {invoicesOpen && (
              <>
                {loading ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
                    Loading invoices…
                  </div>
                ) : message ? (
                  <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                    {message}
                  </div>
                ) : records.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
                    No invoices submitted for this range yet.
                  </div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.label} className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200">
                        <p className="uppercase tracking-[0.3em] text-slate-400">
                          {group.label}
                        </p>
                        <p className="text-sm font-semibold text-slate-100">
                          {formatCurrency(group.totalCents)}
                        </p>
                      </div>
                      {group.records.map((record) => (
                        <div
                          key={record.id}
                          className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold text-slate-100">
                                Invoice {record.invoiceNumber ?? "—"}
                              </p>
                              <p className="text-xs text-slate-400">
                                {new Date(record.createdAt).toLocaleDateString()} ·{" "}
                                {record.employeeName}
                              </p>
                            </div>
                            <p className="text-base font-semibold text-slate-100">
                              {formatCurrency(record.invoiceAmountCents)}
                            </p>
                          </div>
                          {unseenSet.has(record.id) ? (
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                              <span className="h-2 w-2 rounded-full bg-blue-400" />
                              New upload
                            </div>
                          ) : null}
                          {record.invoiceNotes && (
                            <p className="mt-2 text-sm text-slate-300">
                              Notes: {record.invoiceNotes}
                            </p>
                          )}
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {record.attachments.map((file) => (
                              <button
                                key={file.id}
                                type="button"
                                onClick={() => handleOpenFile(record, file)}
                                className="ui-card-press flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1b3a] px-4 py-3 text-left text-sm text-white"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-semibold">
                                    {record.invoiceCompany ||
                                      file.label ||
                                      file.originalName ||
                                      "Invoice file"}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {file.originalName || file.mimeType || "file"}
                                  </p>
                                </div>
                                <span className="text-[11px] uppercase tracking-[0.2em] text-blue-200">
                                  Open
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
        )}

      <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </section>
  );
}
