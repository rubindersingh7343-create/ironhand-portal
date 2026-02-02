"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const PULL_THRESHOLD = 70;
const MAX_PULL = 140;
const HOLD_OFFSET = 36;

export default function ScrollTopBar() {
  const pathname = usePathname();
  const [pullProgress, setPullProgress] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullRef = useRef({
    active: false,
    startY: 0,
    startX: 0,
    startScrollY: 0,
    startedAtTop: false,
    ignore: false,
  });

  useEffect(() => {
    if (typeof window === "undefined" || navigator.maxTouchPoints === 0) return;

    const isInteractiveTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest("input, textarea, select, [contenteditable='true']"),
      );
    };

    const onTouchStart = (event: TouchEvent) => {
      if (isRefreshing) return;
      if (document.body.classList.contains("ui-modal-open")) return;
      if (isInteractiveTarget(event.target)) return;
      const touch = event.touches[0];
      if (!touch) return;
      pullRef.current.active = true;
      pullRef.current.startY = touch.clientY;
      pullRef.current.startX = touch.clientX;
      pullRef.current.startScrollY = window.scrollY;
      pullRef.current.startedAtTop = window.scrollY <= 2;
      pullRef.current.ignore = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pullRef.current.active || isRefreshing) return;
      if (pullRef.current.ignore) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (!pullRef.current.startedAtTop && window.scrollY <= 2) {
        pullRef.current.startedAtTop = true;
      }
      const deltaX = touch.clientX - pullRef.current.startX;
      const delta = touch.clientY - pullRef.current.startY;
      if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(delta) * 1.1) {
        pullRef.current.ignore = true;
        setPullProgress(0);
        setPullDistance(0);
        return;
      }
      if (delta <= 0) {
        setPullProgress(0);
        setPullDistance(0);
        return;
      }
      if (!pullRef.current.startedAtTop) {
        setPullProgress(0);
        setPullDistance(0);
        return;
      }
      const consumedScroll = Math.max(
        0,
        pullRef.current.startScrollY - window.scrollY,
      );
      const pull = Math.max(0, delta - consumedScroll);
      if (pull === 0) {
        setPullProgress(0);
        setPullDistance(0);
        return;
      }
      const clamped = Math.min(pull, MAX_PULL);
      setPullProgress(Math.min(clamped / PULL_THRESHOLD, 1));
      setPullDistance(clamped);
      if (event.cancelable) event.preventDefault();
    };

    const finishPull = () => {
      if (!pullRef.current.active) return;
      pullRef.current.active = false;
      pullRef.current.ignore = false;
      if (pullProgress >= 1 && !isRefreshing) {
        setIsRefreshing(true);
        setPullDistance(HOLD_OFFSET);
        window.setTimeout(() => {
          window.location.reload();
        }, 200);
        return;
      }
      setPullProgress(0);
      setPullDistance(0);
    };

    const onTouchEnd = () => finishPull();
    const onTouchCancel = () => finishPull();

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [isRefreshing, pullProgress]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const next = `${Math.round(pullDistance)}px`;
    document.documentElement.style.setProperty("--pull-offset", next);
    if (pullDistance > 0) {
      document.body.dataset.pullActive = "true";
    } else {
      delete document.body.dataset.pullActive;
    }
    if (isRefreshing) {
      document.body.dataset.pullRefreshing = "true";
    } else {
      delete document.body.dataset.pullRefreshing;
    }
  }, [pullDistance, isRefreshing]);

  if (pathname === "/auth/login") {
    return null;
  }

  return (
    <div
      className="scroll-top-bar scroll-top-bar--solid scroll-top-bar--visible"
      aria-label="Top bar"
      data-pulling={pullProgress > 0}
      data-refreshing={isRefreshing}
      style={{ ["--scroll-progress" as string]: pullProgress }}
    >
      <div className="scroll-top-bar__label">
        <span>Iron Hand</span>
        <span className="scroll-top-bar__spinner" />
      </div>
      <div id="top-bar-nav" className="scroll-top-bar__nav" />
    </div>
  );
}
