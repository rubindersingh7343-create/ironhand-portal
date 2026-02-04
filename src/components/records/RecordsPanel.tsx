"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CombinedRecord, StoredFile, UserRole } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";
import CopyButton from "@/components/ui/CopyButton";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";

const categoryLabels: Record<CombinedRecord["category"], string> = {
  shift: "End of Shift",
  daily: "Daily Report",
  weekly: "Weekly Orders",
  monthly: "Monthly Report",
  surveillance: "Surveillance",
  invoice: "Invoices",
};

const categoryColors: Record<CombinedRecord["category"], string> = {
  shift: "bg-blue-500/15 text-blue-200 border-blue-500/40",
  daily: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
  weekly: "bg-amber-500/15 text-amber-200 border-amber-500/40",
  monthly: "bg-rose-500/15 text-rose-200 border-rose-500/40",
  surveillance: "bg-purple-500/15 text-purple-200 border-purple-500/40",
  invoice: "bg-indigo-500/15 text-indigo-200 border-indigo-500/40",
};

const baseFilterCategories = [
  { value: "all", label: "All categories" },
  { value: "shift", label: "End of Shift" },
  { value: "daily", label: "Daily Reports" },
  { value: "weekly", label: "Weekly Orders" },
  { value: "monthly", label: "Monthly Reports" },
  { value: "invoice", label: "Invoices" },
  { value: "surveillance", label: "Surveillance" },
];

interface RecordsPanelProps {
  role: UserRole;
  storeNumber: string;
  storeIds?: string[];
  variant?: "default" | "split";
}

interface FilterState {
  category: string;
  employee: string;
  startDate: string;
  endDate: string;
  store: string;
}

interface StoreOption {
  id: string;
  label: string;
}

function normalizeStoreOption(entry: any): StoreOption | null {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { id: entry, label: `Store ${entry}` };
  }
  if (typeof entry === "object" && entry.storeId) {
    return {
      id: entry.storeId,
      label: entry.storeName ?? `Store ${entry.storeId}`,
    };
  }
  return null;
}

export default function RecordsPanel({
  role,
  storeNumber,
  storeIds,
  variant = "default",
}: RecordsPanelProps) {
  const ownerStore = useOwnerPortalStore();
  const manualDateRange = ownerStore?.manualDateRange ?? null;
  const setManualDateRange = ownerStore?.setManualDateRange;
  const initialFilters = useMemo(
    () => ({
      category: "all",
      employee: "",
      startDate: "",
      endDate: "",
      store:
        role === "client"
          ? (storeIds?.[0] ?? storeNumber)
          : "all",
    }),
    [role, storeIds, storeNumber],
  );

  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const baseClientStores = useMemo(
    () =>
      role === "client"
        ? (storeIds?.length ? storeIds : [storeNumber]).filter(Boolean)
        : [],
    [role, storeIds, storeNumber],
  );
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>(
    role === "client"
      ? baseClientStores.map((id) => ({ id, label: `Store ${id}` }))
      : [],
  );
  useEffect(() => {
    if (role !== "client" || !ownerStore) return;
    const nextOptions = ownerStore.stores.map((store) => ({
      id: store.storeId,
      label: store.storeName ?? `Store ${store.storeId}`,
    }));
    setStoreOptions(nextOptions);
    if (ownerStore.selectedStoreId) {
      setFilters((prev) => ({
        ...prev,
        store: ownerStore.selectedStoreId,
      }));
    }
  }, [ownerStore, ownerStore?.stores, ownerStore?.selectedStoreId, role]);

  useEffect(() => {
    if (!manualDateRange) return;
    setFilters((prev) => {
      if (
        prev.startDate === manualDateRange.startDate &&
        prev.endDate === manualDateRange.endDate
      ) {
        return prev;
      }
      return {
        ...prev,
        startDate: manualDateRange.startDate,
        endDate: manualDateRange.endDate,
      };
    });
  }, [manualDateRange]);
  const [viewerFile, setViewerFile] = useState<StoredFile | null>(null);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [addStoreName, setAddStoreName] = useState("");
  const [addStoreAddress, setAddStoreAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [storeForCode, setStoreForCode] = useState("");
  const [storeInvites, setStoreInvites] = useState<
    Array<{ id: string; code: string; storeId: string; expiresAt?: string; usedAt?: string }>
  >([]);
  const [storeServices, setStoreServices] = useState<
    Record<string, { hasManager: boolean; hasSurveillance: boolean }>
  >({});
  const [inviteStatus, setInviteStatus] = useState<"idle" | "loading">("idle");
  const [employees, setEmployees] = useState<
    Array<{ id: string; name: string; email: string; storeNumber: string }>
  >([]);
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null);
  const [showEmployees, setShowEmployees] = useState(false);
  const filterCategories = useMemo(() => {
    if (role === "client") {
      return baseFilterCategories;
    }
    return baseFilterCategories.filter(
      (category) => category.value !== "surveillance",
    );
  }, [role]);
  const visibleRecords = useMemo(
    () =>
      records.filter((record) =>
        role === "client" ? true : record.category !== "surveillance",
      ),
    [records, role],
  );
  const useSplitLayout = variant === "split" && role === "ironhand";
  const lastDayRecords = useMemo(() => {
    if (!useSplitLayout) {
      return visibleRecords;
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return visibleRecords.filter(
      (record) => new Date(record.createdAt).getTime() >= cutoff,
    );
  }, [useSplitLayout, visibleRecords]);
  const employeeRecords = useMemo(
    () => lastDayRecords.filter((record) => record.category === "shift"),
    [lastDayRecords],
  );
  const managerRecords = useMemo(
    () => lastDayRecords.filter((record) => record.category !== "shift"),
    [lastDayRecords],
  );
  const [showEmployeeSection, setShowEmployeeSection] = useState(true);
  const [showManagerSection, setShowManagerSection] = useState(true);
  const displayRecords = useSplitLayout ? lastDayRecords : visibleRecords;
  const shouldShowRecords =
    role !== "client"
      ? true
      : Boolean(filters.startDate || filters.endDate);
  const visibleDisplayRecords = shouldShowRecords ? displayRecords : [];
  const canDeleteRecords = role === "ironhand" || role === "client";
  const storeLabelFor = useMemo(() => {
    const optionMap = new Map(storeOptions.map((store) => [store.id, store.label]));
    return (storeId: string) =>
      storeNames[storeId] ?? optionMap.get(storeId) ?? `Store ${storeId}`;
  }, [storeNames, storeOptions]);
  const hasManagerAssigned = useMemo(
    () => Object.values(storeServices).some((entry) => entry.hasManager),
    [storeServices],
  );
  const hasSurveillanceAssigned = useMemo(
    () => Object.values(storeServices).some((entry) => entry.hasSurveillance),
    [storeServices],
  );
  const managerOnly = role === "client" && hasManagerAssigned && !hasSurveillanceAssigned;
  const surveillanceOnly =
    role === "client" && hasSurveillanceAssigned && !hasManagerAssigned;

  const recordsList = (
    <>
      {loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`record-skeleton-${index}`} className="ui-skeleton h-40" />
          ))}
        </div>
      )}
      {error && (
        <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      )}
      {!loading &&
        !error &&
        !useSplitLayout &&
        shouldShowRecords &&
        visibleDisplayRecords.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-300">
            No records match your filters yet.
          </p>
        )}
      {!loading && !error && shouldShowRecords && (
        <>
          {useSplitLayout ? (
            <div className="space-y-8">
              <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Employee uploads
                    </p>
                    <h3 className="text-xl font-semibold text-white">
                      {employeeRecords.length} shift packages
                    </h3>
                    <p className="text-xs text-slate-400">
                      Last 24 hours
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEmployeeSection((prev) => !prev)}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
                  >
                    {showEmployeeSection ? "Collapse" : "Expand"}
                  </button>
                </div>
                {!showEmployeeSection ? null : employeeRecords.length === 0 ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-4 text-sm text-slate-300">
                    No employee submissions match your filters.
                  </p>
                ) : (
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    {employeeRecords.map((record) => (
                      <RecordCard
                        key={record.id}
                        record={record}
                        canDeleteRecords={canDeleteRecords}
                        storeNames={storeNames}
                        onDelete={handleDelete}
                        onOpenAttachment={(file) => setViewerFile(file)}
                      />
                    ))}
                  </div>
                )}
              </section>
              <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Store manager reports
                    </p>
                    <h3 className="text-xl font-semibold text-white">
                      {managerRecords.length} reports
                    </h3>
                    <p className="text-xs text-slate-400">
                      Last 24 hours
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowManagerSection((prev) => !prev)}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
                  >
                    {showManagerSection ? "Collapse" : "Expand"}
                  </button>
                </div>
                {!showManagerSection ? null : managerRecords.length === 0 ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-4 text-sm text-slate-300">
                    No manager reports match your filters.
                  </p>
                ) : (
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    {managerRecords.map((record) => (
                      <RecordCard
                        key={record.id}
                        record={record}
                        canDeleteRecords={canDeleteRecords}
                        storeNames={storeNames}
                        onDelete={handleDelete}
                        onOpenAttachment={(file) => setViewerFile(file)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {visibleDisplayRecords.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  canDeleteRecords={canDeleteRecords}
                  storeNames={storeNames}
                  onDelete={handleDelete}
                  onOpenAttachment={(file) => setViewerFile(file)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );

  useEffect(() => {
    if (role !== "client") return;
    setStoreOptions((prev) => {
      const map = new Map(prev.map((opt) => [opt.id, opt.label]));
      baseClientStores.forEach((id) => {
        if (!map.has(id)) {
          map.set(id, `Store ${id}`);
        }
      });
      return Array.from(map, ([id, label]) => ({ id, label }));
    });
  }, [baseClientStores, role]);

  useEffect(() => {
    if (role !== "client") return;
    const controller = new AbortController();
    const loadClientStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load store list");
        }
        const data = await response.json();
        const storesPayload = Array.isArray(data.stores) ? data.stores : [];
        const options: StoreOption[] = storesPayload
          .map((store: any) => normalizeStoreOption(store))
          .filter(
            (option: StoreOption | null | undefined): option is StoreOption =>
              Boolean(option),
          );
        const serviceMap: Record<
          string,
          { hasManager: boolean; hasSurveillance: boolean }
        > = {};
        storesPayload.forEach((store: any) => {
          if (!store?.storeId) return;
          serviceMap[store.storeId] = {
            hasManager: Boolean(store.hasManager),
            hasSurveillance: Boolean(store.hasSurveillance),
          };
        });
        setStoreServices(serviceMap);
        if (options.length) {
          setStoreOptions(options);
          setFilters((prev) => ({
            ...prev,
            store: options.some((opt) => opt.id === prev.store)
              ? prev.store
              : options[0].id,
          }));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Unable to load store names", error);
      }
    };
    loadClientStores();
    return () => controller.abort();
  }, [role]);

  useEffect(() => {
    if (role === "client") return;
    const controller = new AbortController();
    const loadNames = async () => {
      try {
        const response = await fetch("/api/stores/all", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load stores");
        const data = await response.json();
        const map: Record<string, string> = {};
        (data.stores ?? []).forEach((store: { storeId: string; storeName?: string }) => {
          map[store.storeId] = store.storeName ?? `Store ${store.storeId}`;
        });
        setStoreNames(map);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    };
    loadNames();
    return () => controller.abort();
  }, [role]);

  useEffect(() => {
    if (role !== "client") return;
    const controller = new AbortController();
    const loadEmployees = async () => {
      try {
        const response = await fetch("/api/client/employees", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load employees");
        }
        const data = await response.json();
        setEmployees(data.employees ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    };
    loadEmployees();
    return () => controller.abort();
  }, [role, storeOptions]);

  useEffect(() => {
    if (role !== "client") return;
    const loadInvites = async () => {
      try {
        const response = await fetch("/api/client/invites", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load invites");
        }
        const data = await response.json();
        setStoreInvites(data.invites ?? []);
      } catch (error) {
        console.error(error);
      }
    };
    loadInvites();
  }, [role]);

  useEffect(() => {
    const controller = new AbortController();
    const loadRecords = async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
        setActionMessage(null);
      }
      try {
        const params = new URLSearchParams();
        params.set("category", filters.category);
        if (filters.employee) params.set("employee", filters.employee);
        if (filters.startDate) params.set("startDate", filters.startDate);
        if (filters.endDate) params.set("endDate", filters.endDate);

        if (role === "client") {
          params.set("store", filters.store);
        } else if (filters.store && filters.store !== "all") {
          params.set("store", filters.store);
        }

        const response = await fetch(`/api/records?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to load records");
        }

        const data = await response.json();
        setRecords(data.records ?? []);
        const incomingStores: StoreOption[] = (data.stores ?? [])
          .map((entry: any) => normalizeStoreOption(entry))
          .filter(
            (entry: StoreOption | null | undefined): entry is StoreOption =>
              Boolean(entry),
          );
        if (incomingStores.length) {
          if (role === "client") {
            setStoreOptions((prev) => {
              const map = new Map(prev.map((opt) => [opt.id, opt.label]));
              incomingStores.forEach((option) => {
                map.set(option.id, option.label);
              });
              return Array.from(map, ([id, label]) => ({ id, label }));
            });
          } else {
            setStoreOptions(incomingStores);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        if (!silent) {
          setError("Unable to load records at the moment.");
        }
      } finally {
        if (!controller.signal.aborted && !silent) {
          setLoading(false);
        }
      }
    };

    loadRecords(false);
    const interval = window.setInterval(() => loadRecords(true), 25000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadRecords(true);
      }
    };
    const handleFocus = () => {
      loadRecords(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [filters, role, storeNumber, refreshCounter]);

  // background refresh handled in loadRecords effect

  const resetFilters = () => setFilters({ ...initialFilters });

  const handleAddStore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!addStoreName.trim()) return;
    setAdding(true);
    setActionMessage(null);
    try {
      const response = await fetch("/api/client/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeName: addStoreName.trim(),
          storeAddress: addStoreAddress.trim(),
        }),
      });
      const raw = await response.text();
      let result: any = {};
      if (raw) {
        try {
          result = JSON.parse(raw);
        } catch {
          result = { error: raw };
        }
      }
      if (!response.ok) {
        const message =
          typeof result?.error === "string" && result.error.length
            ? result.error
            : `Unable to add store (${response.status})`;
        throw new Error(message);
      }
      const nextStores: string[] = result.stores ?? [];
      const newStoreId = result.storeId as string | undefined;
      const newStoreLabel =
        typeof result.storeName === "string" && result.storeName.length
          ? result.storeName
          : newStoreId
            ? `Store ${newStoreId}`
            : undefined;
      setStoreOptions((prev) => {
        const map = new Map(prev.map((opt) => [opt.id, opt.label]));
        nextStores.forEach((id) => {
          if (!map.has(id)) {
            const label =
              newStoreLabel && newStoreId === id
                ? newStoreLabel
                : `Store ${id}`;
            map.set(id, label);
          }
        });
        return Array.from(map, ([id, label]) => ({ id, label }));
      });
      setFilters((prev) => ({ ...prev, store: result.storeId ?? prev.store }));
      setActionMessage(
        "New store added successfully. Welcome to the Iron Hand network.",
      );
      setAddStoreName("");
      setAddStoreAddress("");
      if (role === "client") {
        try {
          const storeResponse = await fetch("/api/client/store-list", {
            cache: "no-store",
          });
          if (storeResponse.ok) {
            const list = await storeResponse.json();
            const options: StoreOption[] = (list.stores ?? []).map(
              (store: { storeId: string; storeName?: string }) => ({
                id: store.storeId,
                label: store.storeName ?? `Store ${store.storeId}`,
              }),
            );
            if (options.length) {
              setStoreOptions(options);
              setFilters((prev) => ({
                ...prev,
                store: result.storeId ?? prev.store,
              }));
            }
          }
        } catch (error) {
          console.error("Unable to refresh store list", error);
        }
      }
      setInviteStatus("idle");
      setRefreshCounter((prev) => prev + 1);
    } catch (error) {
      console.error(error);
      setActionMessage(
        error instanceof Error ? error.message : "Unable to add store",
      );
    } finally {
      setAdding(false);
    }
  };

  async function handleDelete(recordId: string) {
    if (!canDeleteRecords) return;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm("Delete this record and its files?");
    if (!confirmed) return;

    try {
      const response = await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: recordId }),
      });
      if (!response.ok) {
        throw new Error("Failed to delete");
      }
      setActionMessage("Record deleted.");
      setRefreshCounter((prev) => prev + 1);
    } catch (error) {
      console.error(error);
      setActionMessage("Unable to delete that record right now.");
    }
  }

  return (
    <section className="ui-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            {role === "client"
              ? "Advanced"
              : "Iron Hand Records Archive"}
          </p>
        </div>
        {role !== "client" && (
          <button
            type="button"
            onClick={resetFilters}
            className="ui-button--slim rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-white/60"
          >
            Reset filters
          </button>
        )}
      </div>

      {actionMessage && (
        <p className="mb-4 rounded-2xl border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
          {actionMessage}
        </p>
      )}

      {role !== "client" && recordsList}

      {role === "client" && (
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-[0.2em] text-slate-200">
                Owner Controls
              </div>
              <div className="mt-4 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Manage owner access and filters
                  </p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="ui-button--slim rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-white/60"
                  >
                    Reset filters
                  </button>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <form
                    onSubmit={handleAddStore}
                    className="flex flex-col gap-3 md:flex-row md:items-center"
                  >
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                        Add a new store
                      </label>
                      <input
                        value={addStoreName}
                        onChange={(e) => setAddStoreName(e.target.value)}
                        placeholder="Store name"
                        className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-300"
                        required
                      />
                      <input
                        value={addStoreAddress}
                        onChange={(e) => setAddStoreAddress(e.target.value)}
                        placeholder="Store address (optional)"
                        className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-300"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={adding}
                      className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed"
                    >
                      {adding ? "Adding..." : "Add store"}
                    </button>
                  </form>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Employee access
                      </p>
                      <h3 className="text-lg font-semibold text-white">
                        Generate employee code
                      </h3>
                      <p className="text-sm text-slate-300">
                        Select a store to create a new employee invite code.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <select
                        value={storeForCode}
                        onChange={(event) => setStoreForCode(event.target.value)}
                        className="ui-field"
                      >
                        <option value="">Select store</option>
                        {storeOptions.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!storeForCode || inviteStatus === "loading"}
                        onClick={async () => {
                          if (!storeForCode) return;
                          setInviteStatus("loading");
                          setActionMessage(null);
                          try {
                            const response = await fetch("/api/client/invites", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ storeId: storeForCode }),
                            });
                            if (!response.ok) {
                              const error = await response.json().catch(() => ({}));
                              throw new Error(error?.error ?? "Unable to generate code");
                            }
                            const data = await response.json();
                            setStoreInvites((prev) => [data.invite, ...prev]);
                            setActionMessage("New employee invite code created.");
                          } catch (error) {
                            console.error(error);
                            setActionMessage(
                              error instanceof Error
                                ? error.message
                                : "Unable to create invite code",
                            );
                          } finally {
                            setInviteStatus("idle");
                          }
                        }}
                        className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {inviteStatus === "loading" ? "Creating..." : "Generate code"}
                      </button>
                    </div>
                  </div>
                  {storeInvites.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {storeInvites.map((invite) => {
                        const expiresAt = invite.expiresAt
                          ? new Date(invite.expiresAt).getTime()
                          : 0;
                        const now = Date.now();
                        const isExpired = expiresAt < now;
                        const isUsed = Boolean(invite.usedAt);
                        if (isExpired && !isUsed) return null;
                        const expiresLabel =
                          !invite.expiresAt || isExpired
                            ? "Expired"
                            : `Expires at ${new Date(invite.expiresAt).toLocaleString()}`;

                        return (
                          <div
                            key={invite.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#111a32] px-4 py-2 text-sm text-white"
                          >
                            <div>
                              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                                {`${storeLabelFor(invite.storeId)} (${invite.storeId})`}
                              </p>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold tracking-widest">
                                  {invite.code}
                                </p>
                                <CopyButton
                                  value={invite.code}
                                  label="Copy employee invite code"
                                />
                              </div>
                              <p className="text-[11px] text-slate-300">{expiresLabel}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {isUsed ? (
                                <span className="rounded-full border border-amber-300/60 px-3 py-1 text-[11px] text-amber-100">
                                  Used
                                </span>
                              ) : isExpired ? (
                                <span className="rounded-full border border-red-400/60 px-3 py-1 text-[11px] text-red-200">
                                  Expired
                                </span>
                              ) : null}
                              <span className="text-xs text-slate-300">
                                Share this with the employee to sign up.
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-white/10 pt-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Active employees
                      </p>
                      <h3 className="text-lg font-semibold text-white">
                        Store accounts
                      </h3>
                      <p className="text-sm text-slate-300">
                        Remove an employee to revoke their portal access.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEmployees((prev) => !prev)}
                      className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
                    >
                      {showEmployees ? "Collapse" : "Expand"}
                    </button>
                    {employeeMessage && (
                      <p className="rounded-2xl bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                        {employeeMessage}
                      </p>
                    )}
                  </div>
                  {!showEmployees ? null : employees.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-300">
                      No employees yet for these stores.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {employees.map((employee) => (
                        <div
                          key={employee.id}
                          className="flex flex-wrap items-center justify-between rounded-2xl border border-white/10 bg-[#111a32] px-4 py-2 text-sm text-white"
                        >
                          <div>
                            <p className="font-semibold">{employee.name}</p>
                            <p className="text-xs text-slate-300">{employee.email}</p>
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                              Store {employee.storeNumber}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const confirmed =
                                typeof window === "undefined"
                                  ? true
                                  : window.confirm("Delete this employee account?");
                              if (!confirmed) return;
                              try {
                                const response = await fetch("/api/client/employees", {
                                  method: "DELETE",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ id: employee.id }),
                                });
                                if (!response.ok) {
                                  const error = await response.json().catch(() => ({}));
                                  throw new Error(error?.error ?? "Unable to delete");
                                }
                                setEmployees((prev) =>
                                  prev.filter((entry) => entry.id !== employee.id),
                                );
                                setEmployeeMessage("Employee account removed.");
                              } catch (error) {
                                console.error(error);
                                setEmployeeMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Unable to delete employee.",
                                );
                              }
                            }}
                            className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Filters
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <label className="ui-label">
                    Store #
                  </label>
                  {role === "client" && ownerStore ? (
                    <div className="ui-field w-full text-slate-300">
                      {ownerStore.activeStore?.storeName ??
                        (ownerStore.selectedStoreId
                          ? `Store ${ownerStore.selectedStoreId}`
                          : "Select a store")}
                    </div>
                  ) : (
                    <select
                      value={filters.store}
                      onChange={(event) =>
                        setFilters((prev) => ({ ...prev, store: event.target.value }))
                      }
                      className="ui-field w-full"
                    >
                      {role !== "client" && <option value="all">All stores</option>}
                      {storeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="ui-label">
                    Category
                  </label>
                  <select
                    value={filters.category}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, category: event.target.value }))
                    }
                    className="ui-field w-full"
                  >
                    {filterCategories.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="ui-label">
                    Employee
                  </label>
                  <input
                    type="text"
                    placeholder="Search name"
                    value={filters.employee}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, employee: event.target.value }))
                    }
                    className="ui-field w-full placeholder:text-slate-300"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4">
              <div className="space-y-2">
                <label className="ui-label">
                  Date range
                </label>
                <div className="flex gap-2 flex-row md:flex-col xl:flex-row">
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(event) => {
                      const next = event.target.value;
                      const nextEnd = filters.endDate || next;
                      setFilters((prev) => ({
                        ...prev,
                        startDate: next,
                        endDate: nextEnd,
                      }));
                      setManualDateRange?.({
                        startDate: next,
                        endDate: nextEnd,
                      });
                    }}
                    className="ui-field w-1/2 min-w-0 md:w-full"
                  />
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(event) => {
                      const next = event.target.value;
                      const nextStart = filters.startDate || next;
                      setFilters((prev) => ({
                        ...prev,
                        startDate: nextStart,
                        endDate: next,
                      }));
                      setManualDateRange?.({
                        startDate: nextStart,
                        endDate: next,
                      });
                    }}
                    className="ui-field w-1/2 min-w-0 md:w-full"
                  />
                </div>
              </div>
            </div>

            {!shouldShowRecords && !loading && !error && (
              <p className="rounded-2xl border border-dashed border-white/10 px-4 py-4 text-sm text-slate-300">
                Select a date range to load files.
              </p>
            )}

            <div>
              {recordsList}
            </div>
          </div>
        </div>
      )}
      <FileViewer
        file={viewerFile}
        onClose={() => setViewerFile(null)}
      />
    </section>
  );
}

function RecordCard({
  record,
  canDeleteRecords,
  storeNames,
  onDelete,
  onOpenAttachment,
}: {
  record: CombinedRecord;
  canDeleteRecords: boolean;
  storeNames: Record<string, string>;
  onDelete: (id: string) => Promise<void>;
  onOpenAttachment: (file: StoredFile) => void;
}) {
  const parsedDaily =
    record.category === "daily" && record.textContent
      ? (() => {
          try {
            const data = JSON.parse(record.textContent);
            return typeof data === "object" && data !== null ? data : null;
          } catch {
            return null;
          }
        })()
      : null;
  return (
    <article className="ui-card-press rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${categoryColors[record.category]}`}
        >
          {categoryLabels[record.category]}
        </span>
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-400">
            {new Date(record.createdAt).toLocaleString()}
          </p>
          {canDeleteRecords && (
            <button
              type="button"
              onClick={() => onDelete(record.id)}
              className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-400 transition hover:bg-red-500/10"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1 text-sm text-slate-200">
        <p className="font-semibold text-white">{record.employeeName}</p>
        <p>
          {storeNames[record.storeNumber]
            ? `${storeNames[record.storeNumber]} (${record.storeNumber})`
            : `Store ${record.storeNumber}`}
        </p>
        {parsedDaily ? (
          <div className="mt-3 grid gap-2 text-sm text-slate-100 sm:grid-cols-2">
            {[
              ["Scr", parsedDaily.scr],
              ["Lotto", parsedDaily.lotto],
              ["Store", parsedDaily.store],
              ["Gross", parsedDaily.gross],
              ["ATM", parsedDaily.atm],
              ["Lotto P/O", parsedDaily.lottoPo],
              ["Cash", parsedDaily.cash],
              ["Deposit", parsedDaily.deposit],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">
                  {label}
                </p>
                <p className="ui-tabular text-sm text-white">
                  {typeof value === "number" ? value.toLocaleString() : value}
                </p>
              </div>
            ))}
          </div>
        ) : (
          record.textContent && <p className="text-slate-200">{record.textContent}</p>
        )}
        {record.shiftNotes && (
          <p className="text-slate-200">Notes: {record.shiftNotes}</p>
        )}
        {record.notes && <p>Notes: {record.notes}</p>}
        {record.invoiceNotes && <p>Notes: {record.invoiceNotes}</p>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {record.attachments.map((file) => (
          <AttachmentPreview
            key={file.id}
            file={file}
            onOpen={() => onOpenAttachment(file)}
          />
        ))}
      </div>
      {record.attachments.length === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-3 py-2 text-center text-xs text-slate-400">
          No attachments
        </p>
      )}
    </article>
  );
}

function AttachmentPreview({
  file,
  onOpen,
}: {
  file: StoredFile;
  onOpen: () => void;
}) {
  const src = `/api/uploads/proxy?path=${encodeURIComponent(
    file.path ?? file.id,
  )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
    file.originalName ?? file.label ?? "file",
  )}`;
  const typeLabel =
    file.kind === "video" ? "Video" : file.kind === "image" ? "Photo" : "File";
  const prettySize =
    typeof file.size === "number"
      ? formatBytes(file.size)
      : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="ui-card-press block min-h-[120px] w-full rounded-2xl border border-white/10 bg-gradient-to-r from-[#0f1b3a] to-[#0d1a2f] p-4 text-left text-white shadow-lg transition hover:-translate-y-0.5 hover:border-blue-400/50 hover:shadow-blue-900/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <p className="text-base font-semibold leading-tight">
            {file.label || typeLabel}
          </p>
          <p className="text-xs text-slate-300">
            {file.originalName || "File"}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            <span className="rounded-full border border-white/20 px-2 py-0.5 uppercase tracking-wide">
              {typeLabel}
            </span>
            {prettySize && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-200">
                {prettySize}
              </span>
            )}
          </div>
        </div>
        <span className="text-[11px] text-blue-200">Open</span>
      </div>
    </button>
  );
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function FileViewer({
  file,
  onClose,
  anchorEl,
  anchorTopOverride,
}: {
  file: StoredFile | null;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  anchorTopOverride?: number | null;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val));
  const getDistance = (touches: TouchList | React.TouchList) => {
    const [a, b] = [touches[0] as Touch, touches[1] as Touch];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };
  const showSpinner = file?.kind !== "video";
  const src = `/api/uploads/proxy?path=${encodeURIComponent(
    file?.path ?? file?.id ?? "",
  )}&id=${encodeURIComponent(file?.id ?? "")}&name=${encodeURIComponent(
    file?.originalName ?? file?.label ?? "file",
  )}`;
  const isImage = file?.kind === "image";
  const isVideo = file?.kind === "video";
  const contentStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
    transition: "transform 80ms ease",
  };
  useEffect(() => {
    if (!file) return;
    setLoading(true);
    setFailed(false);
    const timeout = window.setTimeout(() => {
      setFailed(true);
      setLoading(false);
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [file]);

  useEffect(() => {
    if (!file) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [file, anchorEl, anchorTopOverride]);
  const zoomIn = () => setScale((prev) => Math.min(4, parseFloat((prev + 0.25).toFixed(2))));
  const zoomOut = () => setScale((prev) => Math.max(0.5, parseFloat((prev - 0.25).toFixed(2))));

  if (!file) return null;

  return (
    <IHModal
      isOpen={Boolean(file)}
      onClose={onClose}
      allowOutsideClose
      panelClassName="max-w-3xl"
    >
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
        <div
          className="flex-1 overflow-y-auto"
          style={{ touchAction: "pan-y" }}
        >
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
            {failed && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/40 px-4 text-center">
                <p className="text-sm text-slate-200">File is taking too long to load.</p>
              </div>
            )}
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={file.originalName}
                loading="eager"
                onLoad={() => {
                  setLoading(false);
                  setFailed(false);
                }}
                onError={() => {
                  setLoading(false);
                  setFailed(true);
                }}
                className="mx-auto block h-auto max-h-[64vh] w-auto"
                style={contentStyle}
              />
            ) : isVideo ? (
              <video
                controls
                src={src}
                preload="metadata"
                onLoadedData={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setFailed(true);
                }}
                className="mx-auto block h-auto max-h-[64vh] w-auto max-w-none rounded-lg bg-black"
                style={contentStyle}
              />
            ) : (
              <iframe
                src={src}
                title={file.originalName}
                onLoad={() => setLoading(false)}
                className="block h-[60vh] w-auto min-w-[80vw] rounded-lg bg-white"
                style={{ ...contentStyle, height: "60vh" }}
              />
            )}
            {isVideo && (
              <div className="mt-3 text-center text-xs text-slate-300">
                <a
                  href={src}
                  className="text-blue-200 underline underline-offset-4 hover:text-white"
                >
                  Open directly / download
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </IHModal>
  );
}
