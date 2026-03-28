"use client";

import UploadCard from "@/components/uploads/UploadCard";
import type { UploadItem } from "@/lib/uploads/types";

export default function UploadQueue({
  items,
  onRetry,
  onRemove,
}: {
  items: UploadItem[];
  onRetry?: (localId: string) => void;
  onRemove?: (localId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
          Upload queue
        </p>
        <p className="text-[11px] text-slate-400">
          {items.length} item{items.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <UploadCard
            key={item.localId}
            item={item}
            onRetry={onRetry}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}

