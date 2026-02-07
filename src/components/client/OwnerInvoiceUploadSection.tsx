"use client";

import { useMemo } from "react";
import type { SessionUser } from "@/lib/types";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import InvoiceUploadCard from "@/components/invoices/InvoiceUploadCard";

export default function OwnerInvoiceUploadSection({ user }: { user: SessionUser }) {
  const ownerStore = useOwnerPortalStore();
  const selectedStoreId = ownerStore?.selectedStoreId ?? user.storeNumber ?? "";
  const storeLabel = useMemo(() => {
    const active = ownerStore?.activeStore;
    if (active?.storeName) return active.storeName;
    if (selectedStoreId) return `Store ${selectedStoreId}`;
    return "";
  }, [ownerStore?.activeStore, selectedStoreId]);

  return (
    <section className="ui-card space-y-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Upload invoices
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Send invoice files for{" "}
            <span className="font-semibold text-slate-100">
              {storeLabel || "your store"}
            </span>
            .
          </p>
        </div>
      </div>

      {!selectedStoreId ? (
        <p className="text-sm text-amber-200/90">
          Select a store in the bottom bar to enable invoice uploads.
        </p>
      ) : (
        <InvoiceUploadCard storeId={selectedStoreId} storeLabel={storeLabel} />
      )}
    </section>
  );
}

