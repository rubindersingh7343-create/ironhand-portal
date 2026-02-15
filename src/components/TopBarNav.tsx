"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TopBarSection = {
  id: string;
  label: string;
  badgeCount?: number;
};

export default function TopBarNav({
  sections,
  sectionSelector = ".portal-section",
}: {
  sections: TopBarSection[];
  sectionSelector?: string;
}) {
  const [activeSectionId, setActiveSectionId] = useState(
    sections[0]?.id ?? "",
  );
  const lockRef = useRef<{ id: string; until: number } | null>(null);

  const navNode =
    typeof document === "undefined"
      ? null
      : document.getElementById("top-bar-nav");

  const sectionIds = useMemo(
    () => new Set(sections.map((section) => section.id)),
    [sections],
  );

  const effectiveActiveSectionId = sectionIds.has(activeSectionId)
    ? activeSectionId
    : (sections[0]?.id ?? "");

  useEffect(() => {
    if (!effectiveActiveSectionId) return;
    const nav = document.getElementById("top-bar-nav");
    if (!nav) return;

    const scroller = nav.querySelector<HTMLElement>(".top-bar-nav__inner");
    if (!scroller) return;

    const prefersReducedMotion =
      "matchMedia" in window &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
      const active =
        scroller.querySelector<HTMLElement>(".top-bar-nav__btn--active") ??
        scroller.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!active) return;

      const targetLeft =
        active.offsetLeft + active.offsetWidth / 2 - scroller.clientWidth / 2;
      const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const nextLeft = Math.min(maxLeft, Math.max(0, targetLeft));

      scroller.scrollTo({
        left: nextLeft,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
      });
    });

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [effectiveActiveSectionId, sections.length]);

  useEffect(() => {
    if (!sections.length) return;
    document.body.dataset.topNav = "true";
    return () => {
      delete document.body.dataset.topNav;
    };
  }, [sections.length]);

  useEffect(() => {
    if (!sections.length) return;
    const sectionElsFromIds = sections
      .map((section) => document.getElementById(section.id))
      .filter(Boolean) as HTMLElement[];
    const sectionElsFromSelector = Array.from(
      document.querySelectorAll<HTMLElement>(sectionSelector),
    ).filter((section) => sectionIds.has(section.id));
    const sectionEls = sectionElsFromIds.length
      ? sectionElsFromIds
      : sectionElsFromSelector;
    if (!sectionEls.length) return;

    let raf = 0;

    const commit = (nextId: string) => {
      if (!nextId) return;
      setActiveSectionId((prev) => (prev === nextId ? prev : nextId));
    };

    const setFromScroll = () => {
      raf = 0;
      const lock = lockRef.current;
      if (lock && Date.now() < lock.until) {
        commit(lock.id);
        return;
      }
      if (lock && Date.now() >= lock.until) {
        lockRef.current = null;
      }
      const doc = document.documentElement;
      const maxScroll = Math.max(0, doc.scrollHeight - window.innerHeight);
      const scrollY = window.scrollY;
      if (maxScroll <= 0) return;
      if (scrollY <= 2) {
        const firstId = sectionEls[0]?.id ?? "";
        if (firstId) commit(firstId);
        return;
      }
      if (scrollY >= maxScroll - 4) {
        const lastId = sectionEls[sectionEls.length - 1]?.id ?? "";
        if (lastId) commit(lastId);
        return;
      }
      const focusY = 120;
      let best: HTMLElement | null = null;
      let bestScore = -Infinity;
      sectionEls.forEach((section) => {
        const rect = section.getBoundingClientRect();
        const distance = Math.abs(rect.top - focusY);
        const score = Math.max(0, 1 - distance / 520);
        section.style.setProperty("--section-focus", score.toFixed(3));
        if (score > bestScore) {
          bestScore = score;
          best = section;
        }
      });
      const bestId = (best as HTMLElement | null)?.id ?? "";
      if (bestId) commit(bestId);
    };

    const scheduleScrollCompute = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(setFromScroll);
    };

    window.addEventListener("scroll", scheduleScrollCompute, { passive: true });
    document.addEventListener("scroll", scheduleScrollCompute, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleScrollCompute);
    scheduleScrollCompute();
    return () => {
      window.removeEventListener("scroll", scheduleScrollCompute);
      document.removeEventListener("scroll", scheduleScrollCompute, true);
      window.removeEventListener("resize", scheduleScrollCompute);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [sectionIds, sectionSelector, sections.length]);

  if (!navNode || sections.length === 0) return null;

  return createPortal(
    <div className="top-bar-nav__inner" role="tablist" aria-label="Sections">
      {sections.map((section) => {
        const isActive = effectiveActiveSectionId === section.id;
        const badgeCount = section.badgeCount ?? 0;
        const showBadge = badgeCount > 0;
        const badgeLabel = badgeCount > 9 ? "9+" : String(badgeCount);
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => {
              const target = document.getElementById(section.id);
              const prefersReducedMotion =
                "matchMedia" in window &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              lockRef.current = {
                id: section.id,
                until: Date.now() + (prefersReducedMotion ? 0 : 700),
              };
              if (target) {
                target.scrollIntoView({
                  behavior: prefersReducedMotion ? "auto" : "smooth",
                  block: "start",
                });
              }
              setActiveSectionId(section.id);
            }}
            className={`top-bar-nav__btn${
              isActive ? " top-bar-nav__btn--active" : ""
            }`}
          >
            <span className="top-bar-nav__label">
              {section.label}
              {showBadge && (
                <span className="top-bar-nav__badge" aria-label={`${badgeCount} new`}>
                  {badgeLabel}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>,
    navNode,
  );
}
