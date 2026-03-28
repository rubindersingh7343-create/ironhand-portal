"use client";

import clsx from "clsx";
import UploadProgressBar from "@/components/uploads/UploadProgressBar";
import ProcessingBadge from "@/components/uploads/ProcessingBadge";
import type { UploadItem } from "@/lib/uploads/types";

const formatBytes = (value?: number | null) => {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[index]}`;
};

export default function UploadCard({
  item,
  onRetry,
  onRemove,
  className,
}: {
  item: UploadItem;
  onRetry?: (localId: string) => void;
  onRemove?: (localId: string) => void;
  className?: string;
}) {
  const showProgress = item.status === "preparing" || item.status === "uploading";
  const canRetry = item.status === "error";
  const canRemove = item.status !== "uploading";
  const meta = [formatBytes(item.totalBytes), item.mimeType].filter(Boolean).join(" · ");

  return (
    <article
      className={clsx(
        "rounded-2xl border border-white/10 bg-[#0c1329] p-4 text-sm text-slate-200",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="h-12 w-12 flex-none overflow-hidden rounded-xl border border-white/10 bg-white/5">
            {item.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.previewUrl}
                alt={item.filename}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                FILE
              </div>
            )}
          </div>

          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{item.filename}</p>
            {meta ? <p className="mt-0.5 text-xs text-slate-400">{meta}</p> : null}
            {item.errorMessage ? (
              <p className="mt-1 text-xs text-rose-200">{item.errorMessage}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-none flex-col items-end gap-2">
          <ProcessingBadge status={item.status} />
          <div className="flex items-center gap-2">
            {canRetry && onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(item.localId)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
              >
                Retry
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                disabled={!canRemove}
                onClick={() => onRemove(item.localId)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3">
        {showProgress ? (
          <div className="space-y-2">
            <UploadProgressBar progress={item.progress} />
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{item.status === "preparing" ? "Signing upload…" : "Uploading…"}</span>
              <span>{item.progress}%</span>
            </div>
          </div>
        ) : item.status === "uploaded" ? (
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Upload complete</span>
            <span>100%</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

