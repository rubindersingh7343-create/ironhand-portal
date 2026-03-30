"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __IH_BOOT_START?: number;
  }
}

export default function BootScreenHider() {
  useEffect(() => {
    try {
      const element = document.getElementById("ih-boot");
      if (!element) return;

      const minVisibleMs = 900;
      const bootStart =
        typeof window.__IH_BOOT_START === "number" ? window.__IH_BOOT_START : 0;
      const elapsed = bootStart ? Date.now() - bootStart : minVisibleMs;
      const wait = Math.max(0, minVisibleMs - elapsed);

      const timeout = window.setTimeout(() => {
        element.classList.add("ih-boot-hidden");
        window.setTimeout(() => {
          // Don't remove the node (React rendered it); just hide it permanently.
          element.classList.add("ih-boot-gone");
        }, 220);
      }, wait);

      return () => window.clearTimeout(timeout);
    } catch {
      // Never block app boot on the splash hider.
      return;
    }
  }, []);

  return null;
}
