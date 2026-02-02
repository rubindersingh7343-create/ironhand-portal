"use client";

import { useEffect, useMemo, useState } from "react";
import CopyButton from "@/components/ui/CopyButton";

type StoreItem = {
  storeId: string;
  storeName?: string;
  address?: string;
};

type OwnerInvite = {
  id: string;
  code: string;
  role: "client";
  storeId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

type SurveillanceInvite = {
  id: string;
  code: string;
  role: "surveillance";
  storeId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

type ManagerInvite = {
  id: string;
  code: string;
  storeId?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export default function StoreCodesPanel() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [ownerInvites, setOwnerInvites] = useState<OwnerInvite[]>([]);
  const [surveillanceInvites, setSurveillanceInvites] = useState<
    SurveillanceInvite[]
  >([]);
  const [managerInvites, setManagerInvites] = useState<ManagerInvite[]>([]);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const loadStores = async () => {
    try {
      const response = await fetch("/api/stores/all", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load stores.");
      const data = await response.json().catch(() => ({}));
      setStores(Array.isArray(data.stores) ? data.stores : []);
    } catch (error) {
      console.error(error);
      setMessage("Unable to load stores.");
    }
  };

  const loadStoreInvites = async () => {
    try {
      const response = await fetch("/api/invites", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load owner invites.");
      const data = await response.json().catch(() => ({}));
      const invites = Array.isArray(data.invites) ? data.invites : [];
      setOwnerInvites(invites.filter((invite: any) => invite.role === "client"));
      setSurveillanceInvites(
        invites.filter((invite: any) => invite.role === "surveillance"),
      );
    } catch (error) {
      console.error(error);
      setMessage("Unable to load owner invites.");
    }
  };

  const loadManagerInvites = async () => {
    try {
      const response = await fetch("/api/manager-invites", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load manager invites.");
      const data = await response.json().catch(() => ({}));
      setManagerInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch (error) {
      console.error(error);
      setMessage("Unable to load manager invites.");
    }
  };

  const loadAll = async () => {
    setStatus("loading");
    setMessage(null);
    await Promise.all([loadStores(), loadStoreInvites(), loadManagerInvites()]);
    setStatus("idle");
  };

  useEffect(() => {
    loadAll();
  }, []);

  const latestOwnerCode = (storeId: string) =>
    ownerInvites
      .filter((invite) => invite.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const latestSurveillanceCode = (storeId: string) =>
    surveillanceInvites
      .filter((invite) => invite.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const latestManagerCode = (storeId: string) =>
    managerInvites
      .filter((invite) => invite.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const createOwnerCode = async (storeId: string) => {
    setMessage(null);
    try {
      const response = await fetch("/api/invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, role: "client" }),
      });
      if (!response.ok) {
        throw new Error("Unable to generate owner code.");
      }
      await loadStoreInvites();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to generate owner code.",
      );
    }
  };

  const createSurveillanceCode = async (storeId: string) => {
    setMessage(null);
    try {
      const response = await fetch("/api/surveillance/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (!response.ok) {
        throw new Error("Unable to generate surveillance code.");
      }
      await loadStoreInvites();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate surveillance code.",
      );
    }
  };

  const createManagerCode = async (storeId: string) => {
    setMessage(null);
    try {
      const response = await fetch("/api/manager-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (!response.ok) {
        throw new Error("Unable to generate manager code.");
      }
      await loadManagerInvites();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate manager code.",
      );
    }
  };

  const rows = useMemo(() => {
    return stores.map((store) => ({
      store,
      ownerCode: latestOwnerCode(store.storeId),
      surveillanceCode: latestSurveillanceCode(store.storeId),
      managerCode: latestManagerCode(store.storeId),
    }));
  }, [stores, ownerInvites, surveillanceInvites, managerInvites]);

  return (
    <section className="ui-card text-white">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
          Store access
        </p>
        <h3 className="text-xl font-semibold text-white">
          Store access codes
        </h3>
        <p className="text-sm text-slate-200">
          Generate owner and manager codes after a store is created.
        </p>
      </div>

      {message && (
        <p className="mb-4 rounded-2xl bg-white/10 px-4 py-2 text-sm text-slate-100">
          {message}
        </p>
      )}

      <div className="space-y-3">
        {status === "loading" && rows.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`store-code-skel-${index}`} className="ui-skeleton h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-400">
            No stores yet. Create one above to generate codes.
          </p>
        ) : (
          rows.map(({ store, ownerCode, surveillanceCode, managerCode }) => (
            <div
              key={store.storeId}
              className="rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-200"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {store.storeName ?? `Store ${store.storeId}`}
                  </p>
                  <p className="text-xs text-slate-400">{store.address ?? "—"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-200">
                    Store ID: {store.storeId}
                  </span>
                  <CopyButton value={store.storeId} label="Copy store ID" />
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#0c1430] px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                      Owner code
                    </p>
                    <button
                      type="button"
                      onClick={() => createOwnerCode(store.storeId)}
                      className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-semibold text-slate-200 transition hover:border-white/60"
                    >
                      {ownerCode ? "Refresh" : "Generate"}
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {ownerCode?.code ?? "—"}
                  </p>
                  {ownerCode?.code && (
                    <CopyButton
                      value={ownerCode.code}
                      label="Copy owner code"
                      className="self-start"
                    />
                  )}
                  {ownerCode?.expiresAt && (
                    <p className="text-slate-500">
                      Expires {new Date(ownerCode.expiresAt).toLocaleString()}
                      {ownerCode.usedAt && " · Recently used"}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0c1430] px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                      Surveillance code
                    </p>
                    <button
                      type="button"
                      onClick={() => createSurveillanceCode(store.storeId)}
                      className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-semibold text-slate-200 transition hover:border-white/60"
                    >
                      {surveillanceCode ? "Refresh" : "Generate"}
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {surveillanceCode?.code ?? "—"}
                  </p>
                  {surveillanceCode?.code && (
                    <CopyButton
                      value={surveillanceCode.code}
                      label="Copy surveillance code"
                      className="self-start"
                    />
                  )}
                  {surveillanceCode?.expiresAt && (
                    <p className="text-slate-500">
                      Expires {new Date(surveillanceCode.expiresAt).toLocaleString()}
                      {surveillanceCode.usedAt && " · Recently used"}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0c1430] px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                      Manager code
                    </p>
                    <button
                      type="button"
                      onClick={() => createManagerCode(store.storeId)}
                      className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-semibold text-slate-200 transition hover:border-white/60"
                    >
                      {managerCode ? "Refresh" : "Generate"}
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {managerCode?.code ?? "—"}
                  </p>
                  {managerCode?.code && (
                    <CopyButton
                      value={managerCode.code}
                      label="Copy manager code"
                      className="self-start"
                    />
                  )}
                  {managerCode?.expiresAt && (
                    <p className="text-slate-500">
                      Expires {new Date(managerCode.expiresAt).toLocaleString()}
                      {managerCode.usedAt && " · Recently used"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
