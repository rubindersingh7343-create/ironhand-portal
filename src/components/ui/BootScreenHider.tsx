"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __IH_BOOT_START?: number;
  }
}

export default function BootScreenHider() {
  useEffect(() => {
    const element = document.getElementById("ih-boot");
    if (!element) return;

    const minVisibleMs = 900;
    const bootStart =
      typeof window.__IH_BOOT_START === "number" ? window.__IH_BOOT_START : 0;
    const elapsed = bootStart ? Date.now() - bootStart : minVisibleMs;
    const wait = Math.max(0, minVisibleMs - elapsed);

    const hide = () => {
      element.classList.add("ih-boot-hidden");
      const removeTimeout = window.setTimeout(() => {
        element.remove();
      }, 220);
      return () => window.clearTimeout(removeTimeout);
    };

    const timeout = window.setTimeout(() => {
      hide();
    }, wait);

    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
