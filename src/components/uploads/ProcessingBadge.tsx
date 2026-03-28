import clsx from "clsx";
import type { UploadStatus } from "@/lib/uploads/types";

const labelFor = (status: UploadStatus) => {
  switch (status) {
    case "idle":
      return "Idle";
    case "preparing":
      return "Preparing";
    case "uploading":
      return "Uploading";
    case "uploaded":
      return "Upload complete";
    case "processing":
      return "Processing";
    case "needs_review":
      return "Needs review";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
  }
};

const classFor = (status: UploadStatus) => {
  if (status === "complete") return "border-emerald-300/40 bg-emerald-500/15 text-emerald-200";
  if (status === "needs_review") return "border-amber-300/40 bg-amber-500/15 text-amber-200";
  if (status === "error") return "border-rose-300/40 bg-rose-500/15 text-rose-200";
  if (status === "uploaded") return "border-sky-300/40 bg-sky-500/15 text-sky-200";
  if (status === "processing") return "border-purple-300/40 bg-purple-500/15 text-purple-200";
  if (status === "uploading" || status === "preparing")
    return "border-white/20 bg-white/5 text-slate-200";
  return "border-white/20 bg-white/5 text-slate-200";
};

export default function ProcessingBadge({
  status,
  className,
}: {
  status: UploadStatus;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
        classFor(status),
        className,
      )}
    >
      {labelFor(status)}
    </span>
  );
}

