"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { CombinedRecord, StoredFile, UserRole } from "@/lib/types";

const categoryLabels: Record<CombinedRecord["category"], string> = {
  shift: "End of Shift",
  daily: "Daily Report",
  weekly: "Weekly Orders",
  monthly: "Monthly Report",
  surveillance: "Surveillance",
};

const categoryColors: Record<CombinedRecord["category"], string> = {
  shift: "bg-blue-500/15 text-blue-200 border-blue-500/40",
  daily: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
  weekly: "bg-amber-500/15 text-amber-200 border-amber-500/40",
  monthly: "bg-rose-500/15 text-rose-200 border-rose-500/40",
  surveillance: "bg-purple-500/15 text-purple-200 border-purple-500/40",
};

const baseFilterCategories = [
  { value: "all", label: "All categories" },
  { value: "shift", label: "End of Shift" },
  { value: "daily", label: "Daily Reports" },
  { value: "weekly", label: "Weekly Orders" },
  { value: "monthly", label: "Monthly Reports" },
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
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [addCode, setAddCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [storeForCode, setStoreForCode] = useState("");
  const [storeInvites, setStoreInvites] = useState<
    Array<{ id: string; code: string; storeId: string }>
  >([]);
  const [inviteStatus, setInviteStatus] = useState<"idle" | "loading">("idle");
  const [employees, setEmployees] = useState<
    Array<{ id: string; name: string; email: string; storeNumber: string }>
  >([]);
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null);
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
        const options: StoreOption[] = (data.stores ?? [])
          .map((store: any) => normalizeStoreOption(store))
          .filter((option): option is StoreOption => Boolean(option));
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
    const loadRecords = async () => {
      setLoading(true);
      setError(null);
      setActionMessage(null);
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
          .filter((entry): entry is StoreOption => Boolean(entry));
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
        setError("Unable to load records at the moment.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadRecords();
    return () => controller.abort();
  }, [filters, role, storeNumber, refreshCounter]);

  const resetFilters = () => setFilters({ ...initialFilters });
  const canDeleteRecords = role === "ironhand" || role === "client";

  const handleAddStore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!addCode.trim()) return;
    setAdding(true);
    setActionMessage(null);
    try {
      const response = await fetch("/api/client/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: addCode.trim() }),
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
      setStoreOptions((prev) => {
        const map = new Map(prev.map((opt) => [opt.id, opt.label]));
        nextStores.forEach((id) => {
          if (!map.has(id)) {
            map.set(id, `Store ${id}`);
          }
        });
        return Array.from(map, ([id, label]) => ({ id, label }));
      });
      setFilters((prev) => ({ ...prev, store: result.storeId ?? prev.store }));
      setActionMessage(
        "New store added successfully. Welcome to the Iron Hand network.",
      );
      setAddCode("");
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

  const handleDelete = async (recordId: string) => {
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
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-900/50">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            {role === "client"
              ? "Client Viewing Portal"
              : "Iron Hand Records Archive"}
          </p>
          <h2 className="text-2xl font-semibold text-white">
            {displayRecords.length} records
          </h2>
          <p className="text-sm text-slate-300">
            Filter by employee, date range, category, and download the original
            files.
          </p>
        </div>
        <button
          type="button"
          onClick={resetFilters}
          className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/60"
        >
          Reset filters
        </button>
      </div>

      {actionMessage && (
        <p className="mb-4 rounded-2xl bg-blue-50 px-4 py-2 text-sm text-blue-700">
          {actionMessage}
        </p>
      )}

      {role === "client" && (
        <form
          onSubmit={handleAddStore}
          className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:flex-row md:items-center"
        >
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
              Add a store with client code
            </label>
            <input
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder="Enter client invite code"
              className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400"
              required
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
      )}

      {role === "client" && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
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
                className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
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
              {storeInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between rounded-2xl border border-white/10 bg-[#111a32] px-4 py-2 text-sm text-white"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Store {invite.storeId}
                    </p>
                    <p className="font-semibold tracking-widest">{invite.code}</p>
                  </div>
                  <span className="text-xs text-slate-300">
                    Share this with the employee to sign up.
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {role === "client" && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
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
            {employeeMessage && (
              <p className="rounded-2xl bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                {employeeMessage}
              </p>
            )}
          </div>
          {employees.length === 0 ? (
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
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">
            Store #
          </label>
          <select
            value={filters.store}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, store: event.target.value }))
            }
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
          >
            {role !== "client" && <option value="all">All stores</option>}
            {storeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">
            Category
          </label>
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, category: event.target.value }))
            }
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
          >
            {filterCategories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">
            Employee
          </label>
          <input
            type="text"
            placeholder="Search name"
            value={filters.employee}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, employee: event.target.value }))
            }
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">
            Date range
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, startDate: event.target.value }))
              }
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
            />
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, endDate: event.target.value }))
              }
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </div>

      {loading && (
        <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
          Loading records…
        </p>
      )}
      {error && (
        <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      )}

      {!loading && !error && !useSplitLayout && displayRecords.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-300">
          No records match your filters yet.
        </p>
      )}

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
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {displayRecords.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              canDeleteRecords={canDeleteRecords}
              storeNames={storeNames}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordCard({
  record,
  canDeleteRecords,
  storeNames,
  onDelete,
}: {
  record: CombinedRecord;
  canDeleteRecords: boolean;
  storeNames: Record<string, string>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-lg">
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
      <div className="mt-3 space-y-1 text-sm text-slate-300">
        <p className="font-semibold text-white">{record.employeeName}</p>
        <p>
          {storeNames[record.storeNumber]
            ? `${storeNames[record.storeNumber]} (${record.storeNumber})`
            : `Store ${record.storeNumber}`}
        </p>
        {record.textContent && (
          <p className="text-slate-200">{record.textContent}</p>
        )}
        {record.shiftNotes && (
          <p className="text-slate-200">Notes: {record.shiftNotes}</p>
        )}
        {record.notes && <p>Notes: {record.notes}</p>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {record.attachments.map((file) => (
          <AttachmentPreview key={file.id} file={file} />
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

function AttachmentPreview({ file }: { file: StoredFile }) {
  if (file.kind === "image") {
    return (
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <Image
          src={file.path}
          alt={file.originalName}
          width={320}
          height={200}
          className="h-32 w-full object-cover"
        />
        <a
          href={file.path}
          download
          target="_blank"
          rel="noreferrer"
          className="block bg-black/40 px-3 py-2 text-xs text-center text-white"
        >
          {file.label ?? "Photo"}
        </a>
      </div>
    );
  }

  if (file.kind === "video") {
    return (
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <video
          controls
          src={file.path}
          className="h-32 w-full object-cover"
          preload="metadata"
        />
        <a
          href={file.path}
          target="_blank"
          rel="noreferrer"
          className="block bg-black/40 px-3 py-2 text-xs text-center text-white"
        >
          {file.label ?? "Video Evidence"}
        </a>
      </div>
    );
  }

  return (
    <a
      href={file.path}
      target="_blank"
      rel="noreferrer"
      className="flex h-24 flex-col justify-center rounded-2xl border border-white/15 bg-white/10 px-3 text-center text-xs text-white transition hover:border-white/40"
    >
      <span className="font-semibold">
        {file.label ?? "Download file"}
      </span>
      <span className="text-[11px] text-slate-300">{file.originalName}</span>
    </a>
  );
}
