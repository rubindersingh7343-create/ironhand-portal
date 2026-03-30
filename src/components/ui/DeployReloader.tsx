"use client";

import { useEffect } from "react";

const STORAGE_KEY = "ih_deploy_version";
const COOLDOWN_KEY = "ih_deploy_version_reloaded_at";
const COOLDOWN_MS = 60_000;

async function fetchVersion() {
  const response = await fetch("/api/version", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { version?: string };
  return typeof data.version === "string" ? data.version : "";
}

export default function DeployReloader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let inflight = false;

    const maybeReload = async () => {
      if (cancelled || inflight) return;

      const now = Date.now();
      const lastReloadedAtRaw = window.sessionStorage.getItem(COOLDOWN_KEY);
      const lastReloadedAt = lastReloadedAtRaw ? Number(lastReloadedAtRaw) : 0;
      if (lastReloadedAt && now - lastReloadedAt < COOLDOWN_MS) return;

      inflight = true;
      try {
        const next = await fetchVersion();
        if (cancelled || !next) return;
        const prev = window.localStorage.getItem(STORAGE_KEY) ?? "";
        if (!prev) {
          window.localStorage.setItem(STORAGE_KEY, next);
          return;
        }
        if (prev !== next) {
          window.localStorage.setItem(STORAGE_KEY, next);
          window.sessionStorage.setItem(COOLDOWN_KEY, String(now));
          window.location.reload();
        }
      } catch {
        // Never block app usage due to version checks.
      } finally {
        inflight = false;
      }
    };

    // Run once after boot, and again when returning to the app.
    void maybeReload();
    const onFocus = () => void maybeReload();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void maybeReload();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}

