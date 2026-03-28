import clsx from "clsx";

export default function UploadProgressBar({
  progress,
  className,
}: {
  progress: number;
  className?: string;
}) {
  const safe = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  return (
    <div className={clsx("h-2 w-full rounded-full bg-white/10", className)}>
      <div
        className="h-2 rounded-full bg-blue-500 transition-[width] duration-150"
        style={{ width: `${safe}%` }}
        aria-label={`Upload progress ${safe}%`}
      />
    </div>
  );
}

