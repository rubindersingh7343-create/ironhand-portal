"use client";

import { useEffect, useMemo, useState } from "react";
import CopyButton from "@/components/ui/CopyButton";

type InviteRole = "client" | "employee";

interface Invite {
  id: string;
  code: string;
  role: InviteRole;
  storeId: string;
  storeName: string;
  storeAddress: string;
  managerId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

interface StoreGroup {
  storeId: string;
  storeName: string;
  storeAddress: string;
  codes: Invite[];
}

export default function InvitePanel({ isMaster = false }: { isMaster?: boolean }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);

  const groupedInvites = useMemo<StoreGroup[]>(() => {
    const groups: Record<string, StoreGroup> = {};
    invites.forEach((invite) => {
      if (!groups[invite.storeId]) {
        groups[invite.storeId] = {
          storeId: invite.storeId,
          storeName: invite.storeName,
          storeAddress: invite.storeAddress,
          codes: [],
        };
      }
      groups[invite.storeId].codes.push(invite);
    });
    return Object.values(groups);
  }, [invites]);

  const loadInvites = async () => {
    try {
      const response = await fetch("/api/invites", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to load invites");
      }
      const data = await response.json();
      setInvites(data.invites ?? []);
    } catch (error) {
      console.error(error);
      setMessage("Unable to load invites.");
    }
  };

  useEffect(() => {
    loadInvites();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);

    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeName,
          storeAddress,
          createStoreOnly: isMaster,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error ?? "Failed to create invite");
      }
      setStoreName("");
      setStoreAddress("");
      await loadInvites();
      setMessage(isMaster ? "Store created." : "Invite codes generated.");
    } catch (error) {
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Unable to create invite.");
      }
    } finally {
      setStatus("idle");
    }
  };

  const handleRegenerate = async (storeId: string, role: InviteRole) => {
    setMessage(null);
    try {
      const response = await fetch("/api/invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ storeId, role }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error ?? "Failed to refresh code");
      }
      await loadInvites();
      setMessage("New code generated.");
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to refresh code.",
      );
    }
  };

  return (
    <section className="ui-card space-y-4 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">Store invites</p>
        <h3 className="text-xl font-semibold text-white">
          {isMaster ? "Create store" : "Generate access codes"}
        </h3>
        <p className="text-sm text-slate-200">
          {isMaster
            ? "Create a store profile so you can issue owner and manager codes."
            : "Each store gets a client code and an employee code. Both expire after 3 hours."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <input
          placeholder="Store name"
          value={storeName}
          onChange={(event) => setStoreName(event.target.value)}
          required
          className="ui-field"
        />
        <input
          placeholder="Store address"
          value={storeAddress}
          onChange={(event) => setStoreAddress(event.target.value)}
          required
          className="ui-field"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed md:col-span-2"
        >
          {status === "submitting"
            ? "Generating..."
            : isMaster
              ? "Create store"
              : "Create invites"}
        </button>
      </form>

      {message && (
        <p className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-slate-100">
          {message}
        </p>
      )}

      {!isMaster && (
        <div className="space-y-2 text-sm text-slate-300">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Active codes
          </p>
          {groupedInvites.length === 0 && (
            <p className="rounded-2xl border border-white/10 px-4 py-3 text-slate-400">
              No invites yet.
            </p>
          )}

          {groupedInvites.map((group) => {
            const clientCode = group.codes.find((c) => c.role === "client");
            const employeeCode = group.codes.find((c) => c.role === "employee");
            const isOpen = expandedStore === group.storeId;
            return (
              <div
                key={group.storeId}
                className="space-y-2 rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-xs text-slate-200"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedStore((prev) =>
                      prev === group.storeId ? null : group.storeId,
                    )
                  }
                  className="flex w-full flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="font-semibold text-white">{group.storeName}</p>
                    <p className="text-slate-400">{group.storeAddress}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-200">
                      Store ID: {group.storeId}
                    </span>
                    <CopyButton value={group.storeId} label="Copy store ID" />
                    <span className="rounded-full border border-white/30 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-200">
                      {isOpen ? "Hide codes" : "View codes"}
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {clientCode && (
                      <div className="rounded-xl border border-white/10 bg-[#0c1430] px-3 py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                            Owner code
                          </p>
                          <button
                            type="button"
                            onClick={() => handleRegenerate(group.storeId, "client")}
                            className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-semibold text-slate-200 transition hover:border-white/60"
                          >
                            Refresh
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white">
                            {clientCode.code}
                          </p>
                          <CopyButton value={clientCode.code} label="Copy owner code" />
                        </div>
                        <p className="text-slate-500">
                          Expires {new Date(clientCode.expiresAt).toLocaleString()}
                          {clientCode.usedAt && " · Recently used"}
                        </p>
                      </div>
                    )}
                    {employeeCode && (
                      <div className="rounded-xl border border-white/10 bg-[#0c1430] px-3 py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                            Employee code
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              handleRegenerate(group.storeId, "employee")
                            }
                            className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-semibold text-slate-200 transition hover:border-white/60"
                          >
                            Refresh
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white">
                            {employeeCode.code}
                          </p>
                          <CopyButton
                            value={employeeCode.code}
                            label="Copy employee code"
                          />
                        </div>
                        <p className="text-slate-500">
                          Expires {new Date(employeeCode.expiresAt).toLocaleString()}
                          {employeeCode.usedAt && " · Recently used"}
                        </p>
                      </div>
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
