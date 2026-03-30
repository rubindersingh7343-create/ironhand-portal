"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { firstLastFromName } from "@/lib/userDisplayName";

export default function AppLoadingScreen({
  name,
  label = "Logging you in…",
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
        "safe-area-top flex min-h-screen items-center justify-center bg-gradient-to-b from-[#071327] to-[#02060f] px-6 py-12 text-white",
        className,
      )}
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logowriting2.png"
          alt="Iron Hand"
          className="h-32 w-auto object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
        />

        <p className="mt-6 text-3xl font-semibold tracking-tight">
          {displayName || " "}
        </p>

        <div className="mt-3 flex items-center gap-3 text-lg text-white/80">
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
