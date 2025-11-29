"use client";

import { useEffect, useState } from "react";

interface ManagerRecord {
  id: string;
  name: string;
  email: string;
  employeeCode: string;
  canDelete: boolean;
  portal?: string;
  stores: Array<{
    storeId: string;
    storeName?: string;
    address?: string;
    clients: Array<{ id: string; name: string; email: string }>;
    employees: Array<{ id: string; name: string; email: string }>;
    surveillance: Array<{ id: string; name: string; email: string }>;
  }>;
}

export default function ManagerDirectory() {
  const [managers, setManagers] = useState<ManagerRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [expandedManager, setExpandedManager] = useState<string | null>(null);
  const [generatingSurveillance, setGeneratingSurveillance] =
    useState<string | null>(null);
  const [surveillanceCodes, setSurveillanceCodes] = useState<
    Record<string, { code: string; expiresAt: string }>
  >({});
  const [pending, setPending] = useState(false);

  const deleteStore = async (storeId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this store and all linked accounts?")
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/stores/manager", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to delete store.");
      }
      setMessage("Store removed.");
      await loadManagers();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to delete store.",
      );
    } finally {
      setPending(false);
    }
  };

  const deleteClient = async (clientId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Remove this client account?")
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: clientId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to remove client.");
      }
      setMessage("Client account removed.");
      await loadManagers();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to remove client.",
      );
    } finally {
      setPending(false);
    }
  };

  const deleteEmployee = async (employeeId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Remove this employee account?")
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/employees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: employeeId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to remove employee.");
      }
      setMessage("Employee account removed.");
      await loadManagers();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to remove employee.",
      );
    } finally {
      setPending(false);
    }
  };

  const deleteSurveillance = async (surveillanceId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Remove this surveillance account?")
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/surveillance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: surveillanceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to remove surveillance user.");
      }
      setMessage("Surveillance account removed.");
      await loadManagers();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to remove surveillance user.",
      );
    } finally {
      setPending(false);
    }
  };

  const loadManagers = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/managers", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load managers.");
      }
      const data = await response.json();
      const list: ManagerRecord[] = Array.isArray(data?.managers)
        ? data.managers
        : [];
      const deduped = Array.from(
        new Map(list.map((manager) => [manager.id, manager])).values(),
      );
      setManagers(deduped);
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to load managers.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadManagers();
  }, []);

  const handleDelete = async (managerId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete this manager account and all stores they created?",
      )
    ) {
      return;
    }
    try {
      const response = await fetch("/api/managers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: managerId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to delete manager.");
      }
      setMessage("Manager account deleted.");
      await loadManagers();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to delete manager.",
      );
    }
  };

  const handleGenerateSurveillance = async (storeId: string) => {
    setGeneratingSurveillance(storeId);
    setMessage(null);
    try {
      const response = await fetch("/api/surveillance/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to create surveillance code.");
      }
      setSurveillanceCodes((prev) => ({
        ...prev,
        [storeId]: {
          code: data.invite?.code ?? "",
          expiresAt: data.invite?.expiresAt ?? new Date().toISOString(),
        },
      }));
      setMessage("New surveillance access code ready.");
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create surveillance code.",
      );
    } finally {
      setGeneratingSurveillance(null);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setSurveillanceCodes((prev) => {
        const next: Record<string, { code: string; expiresAt: string }> = {};
        const now = Date.now();
        Object.entries(prev).forEach(([storeId, entry]) => {
          if (new Date(entry.expiresAt).getTime() > now) {
            next[storeId] = entry;
          }
        });
        return next;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="rounded-[32px] border border-white/10 bg-[rgba(12,20,38,0.85)] p-6 shadow-2xl shadow-slate-950/40">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Team roster
          </p>
          <h2 className="text-xl font-semibold text-white">
            Manager directory
          </h2>
          <p className="text-sm text-slate-300">
            Each manager has a unique employee code. Removing a manager deletes
            every store they’ve created.
          </p>
        </div>
      </div>

      {message && (
        <p className="mb-3 rounded-2xl bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
          {message}
        </p>
      )}

      {loading ? (
        <p className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200">
          Loading managers…
        </p>
      ) : managers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-sm text-slate-300">
          No manager accounts yet.
        </p>
      ) : (
        <div className="space-y-3">
          {(showAll ? managers : managers.slice(0, 3)).map((manager) => {
            const hasStores = manager.stores.length > 0;
            const isExpanded = expandedManager === manager.id;
            return (
            <div
              key={manager.id}
              className="rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{manager.name}</p>
                  <p className="text-slate-300">{manager.email}</p>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Employee code {manager.employeeCode}
                  </p>
                </div>
                {manager.portal === "master" ? (
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-wide text-slate-200">
                    Primary
                  </span>
                ) : manager.canDelete ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(manager.id)}
                    className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-300">
                {!hasStores ? (
                  <p>No stores assigned yet.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p>
                        {manager.stores.length} store
                        {manager.stores.length === 1 ? "" : "s"}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedManager((prev) =>
                            prev === manager.id ? null : manager.id,
                          )
                        }
                        className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-white/60"
                      >
                        {isExpanded ? "Hide store details" : "View store details"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 space-y-4 rounded-2xl border border-white/15 bg-[#0d1730] px-3 py-2">
                        {manager.stores.map((store) => (
                          <div key={store.storeId}>
                            <p className="font-semibold text-white">
                              {store.storeName ?? `Store ${store.storeId}`}
                            </p>
                            <p className="text-slate-300 text-xs">
                              {store.storeId}
                            </p>
                            <p className="text-slate-200 text-xs mb-2">
                              {store.address || "Address not provided"}
                            </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => deleteStore(store.storeId)}
                            className="rounded-full border border-red-300 px-3 py-1 text-[10px] font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-60"
                          >
                            Delete store
                          </button>
                          <button
                            type="button"
                            disabled={
                              generatingSurveillance === store.storeId || pending
                            }
                            onClick={() => handleGenerateSurveillance(store.storeId)}
                            className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold text-white transition hover:border-white/60 disabled:opacity-60"
                          >
                            {generatingSurveillance === store.storeId
                              ? "Generating..."
                              : "Surveillance code"}
                          </button>
                        </div>
                        {surveillanceCodes[store.storeId] && (
                          <p className="mt-2 rounded-xl border border-dashed border-white/20 bg-white/5 px-3 py-2 text-[11px] text-slate-200">
                            Share code:{" "}
                            <span className="font-semibold text-white">
                              {surveillanceCodes[store.storeId]?.code}
                            </span>{" "}
                            · expires{" "}
                            {new Date(
                              surveillanceCodes[store.storeId]?.expiresAt ?? "",
                            ).toLocaleString()}
                          </p>
                        )}
                        <div className="space-y-1 text-xs">
                          <p className="text-slate-400 uppercase tracking-[0.3em]">
                            Clients
                          </p>
                          {store.clients.length === 0 ? (
                            <p className="text-slate-500">No clients linked.</p>
                          ) : (
                            store.clients.map((client) => (
                              <div
                                key={client.id}
                                className="flex items-center justify-between gap-2 text-slate-200"
                              >
                                <span>
                                  {client.name} · {client.email}
                                </span>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => deleteClient(client.id)}
                                  className="rounded-full border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="mt-3 space-y-1 text-xs">
                          <p className="text-slate-400 uppercase tracking-[0.3em]">
                            Employees
                          </p>
                          {store.employees.length === 0 ? (
                            <p className="text-slate-500">
                              No employees yet.
                            </p>
                          ) : (
                            store.employees.map((employee) => (
                              <div
                                key={employee.id}
                                className="flex items-center justify-between gap-2 text-slate-200"
                              >
                                <span>
                                  {employee.name} · {employee.email}
                                </span>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => deleteEmployee(employee.id)}
                                  className="rounded-full border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="mt-3 space-y-1 text-xs">
                          <p className="text-slate-400 uppercase tracking-[0.3em]">
                            Surveillance
                          </p>
                          {(store.surveillance?.length ?? 0) === 0 ? (
                            <p className="text-slate-500">
                              No surveillance accounts.
                            </p>
                          ) : (
                            store.surveillance?.map((agent) => (
                              <div
                                key={agent.id}
                                className="flex items-center justify-between gap-2 text-slate-200"
                              >
                                <span>
                                  {agent.name} · {agent.email}
                                </span>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => deleteSurveillance(agent.id)}
                                  className="rounded-full border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );})}
          {managers.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="w-full rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60"
            >
              {showAll ? "Collapse list" : "Show all managers"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
