"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { firstLastFromName } from "@/lib/userDisplayName";

export default function AppLoadingScreen({
  name,
  label = "Loading…",
  className,
}: {
  name?: string | null;
  label?: string;
  className?: string;
}) {
  const displayName = useMemo(() => {
    if (typeof name === "string" && name.trim().length) {
      return firstLastFromName(name);
    }
    return "";
  }, [name]);

  return (
    <div
      className={clsx(
        "relative min-h-screen bg-[#071327] text-white",
        className,
      )}
      style={{ ["--ih-logo-h" as any]: "min(34vh, 300px)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logowriting2.png"
        alt="Iron Hand"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain"
        style={{
          height: "var(--ih-logo-h)",
          width: "auto",
          maxWidth: "min(86vw, 420px)",
        }}
      />

      <div
        className="absolute left-1/2 w-full max-w-[420px] -translate-x-1/2 px-6 text-center"
        style={{
          top: "calc(50% + (var(--ih-logo-h) / 2) + 28px)",
        }}
      >
        <p className="text-3xl font-semibold tracking-tight">
          {displayName || " "}
        </p>

        <div className="mt-3 flex items-center justify-center gap-3 text-lg text-white/80">
          <span>{label}</span>
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white/80"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
