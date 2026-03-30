"use client";

import { useEffect } from "react";

export default function BootScreenHider() {
  useEffect(() => {
    const element = document.getElementById("ih-boot");
    if (!element) return;

    element.classList.add("ih-boot-hidden");
    const timeout = window.setTimeout(() => {
      element.remove();
    }, 220);

    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}

