"use client";

import clsx from "clsx";

export default function ReceiptRectOverlay({
  enabled,
  tone,
}: {
  enabled: boolean;
  tone: "gray" | "yellow" | "green";
}) {
  if (!enabled) return null;

  const frameCls =
    tone === "green"
      ? "border-emerald-300/75 shadow-[0_0_0_1px_rgba(52,211,153,0.18),0_0_26px_rgba(52,211,153,0.18)]"
      : tone === "yellow"
        ? "border-amber-300/70 shadow-[0_0_0_1px_rgba(251,191,36,0.12),0_0_22px_rgba(251,191,36,0.16)]"
        : "border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]";

  // width = screenWidth * 0.62, height = width * 2.1 => aspect 10/21.
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/35" />
      <div
        className={clsx(
          "absolute left-1/2 top-1/2 w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2",
          "aspect-[10/21]",
          frameCls,
        )}
      >
        {/* Corner brackets (receipt-only). */}
        {[
          "left-[-2px] top-[-2px] rounded-tl-2xl border-l-2 border-t-2",
          "right-[-2px] top-[-2px] rounded-tr-2xl border-r-2 border-t-2",
          "left-[-2px] bottom-[-2px] rounded-bl-2xl border-b-2 border-l-2",
          "right-[-2px] bottom-[-2px] rounded-br-2xl border-b-2 border-r-2",
        ].map((pos) => (
          <span
            key={pos}
            className={clsx(
              "absolute h-6 w-6",
              tone === "green"
                ? "border-emerald-200/50"
                : tone === "yellow"
                  ? "border-amber-200/50"
                  : "border-white/35",
              pos,
            )}
          />
        ))}
      </div>
    </div>
  );
}

