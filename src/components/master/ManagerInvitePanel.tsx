"use client";

import { useEffect, useState } from "react";
import CopyButton from "@/components/ui/CopyButton";

interface ManagerInvite {
  id: string;
  code: string;
  storeId?: string;
  storeName?: string;
  storeAddress?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

interface StoreOption {
  id: string;
  name: string;
  address?: string;
}

export default function ManagerInvitePanel() {
  const [invites, setInvites] = useState<ManagerInvite[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const loadInvites = async () => {
    try {
      const response = await fetch("/api/manager-invites", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load manager invites.");
      }
      const data = await response.json();
      setInvites(data.invites ?? []);
    } catch (error) {
      console.error(error);
      setMessage("Unable to load manager invites.");
    }
  };

  useEffect(() => {
    loadInvites();
  }, []);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores/all", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load stores.");
        }
        const data = await response.json();
        const options: StoreOption[] = (data.stores ?? []).map((store: any) => ({
          id: store.storeId,
          name: store.storeName ?? `Store ${store.storeId}`,
          address: store.address ?? "",
        }));
        setStores(options);
        if (!storeId && options.length) {
          setStoreId(options[0].id);
        }
      } catch (error) {
        console.error(error);
        setMessage("Unable to load stores.");
      }
    };
    loadStores();
  }, [storeId]);

  const generateInvite = async () => {
    setStatus("loading");
    setMessage(null);
    try {
      if (!storeId) {
        setMessage("Select a store to generate a manager code.");
        setStatus("idle");
        return;
      }
      const response = await fetch("/api/manager-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (!response.ok) {
        throw new Error("Unable to create invite.");
      }
      await loadInvites();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to create invite.",
      );
    } finally {
      setStatus("idle");
    }
  };

  const deleteInvite = async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this invite code?")
    ) {
      return;
    }
    try {
      const response = await fetch("/api/manager-invites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        throw new Error("Unable to delete invite.");
      }
      await loadInvites();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to delete invite.",
      );
    }
  };

  const regenerateInvite = async (id: string) => {
    try {
      const response = await fetch("/api/manager-invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        throw new Error("Unable to refresh invite.");
      }
      await loadInvites();
      setMessage("New manager code generated.");
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to refresh invite.",
      );
    }
  };

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Master access
          </p>
          <h2 className="text-xl font-semibold text-white">
            Manager portal invites
          </h2>
          <p className="text-sm text-slate-300">
            Generate store-bound codes to add a manager to a specific store.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="ui-field"
          >
            {stores.length === 0 && (
              <option value="">No stores found</option>
            )}
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={status === "loading"}
            onClick={generateInvite}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {status === "loading" ? "Generating..." : "New manager code"}
          </button>
        </div>
      </div>

      {message && (
        <p className="mb-3 rounded-2xl bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
          {message}
        </p>
      )}

      <div className="space-y-3">
        {invites.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-sm text-slate-300">
            No manager codes yet. Generate one above when needed.
          </p>
        )}
        {invites.map((invite) => {
          const expired = new Date(invite.expiresAt).getTime() < Date.now();
          return (
            <div
              key={invite.id}
              className="rounded-2xl border border-white/10 bg-[#101b36] px-4 py-3 text-sm text-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Code
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-semibold tracking-widest">
                      {invite.code}
                    </p>
                    <CopyButton value={invite.code} label="Copy manager code" />
                  </div>
                  {invite.storeName && (
                    <p className="text-xs text-slate-300">
                      {invite.storeName}
                      {invite.storeId ? ` · ${invite.storeId}` : ""}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">
                    Created {new Date(invite.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs ${
                      expired
                        ? "border-amber-300/60 text-amber-200"
                        : invite.usedAt
                          ? "border-emerald-400/60 text-emerald-200"
                          : "border-white/30 text-slate-200"
                    }`}
                  >
                    {invite.usedAt
                      ? "Used"
                      : expired
                        ? "Expired"
                        : "Active"}
                  </span>
                  {!invite.usedAt && (
                    <button
                      type="button"
                      onClick={() => regenerateInvite(invite.id)}
                      className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white/90 transition hover:border-white/70"
                    >
                      Refresh
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteInvite(invite.id)}
                    className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Expires at {new Date(invite.expiresAt).toLocaleString()}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
