"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export type TopBarSection = {
  id: string;
  label: string;
};

export default function TopBarNav({
  sections,
  sectionSelector = ".portal-section",
}: {
  sections: TopBarSection[];
  sectionSelector?: string;
}) {
  const [navNode, setNavNode] = useState<Element | null>(null);
  const [activeSectionId, setActiveSectionId] = useState(
    sections[0]?.id ?? "",
  );

  const sectionIds = useMemo(
    () => new Set(sections.map((section) => section.id)),
    [sections],
  );

  useEffect(() => {
    setNavNode(document.getElementById("top-bar-nav"));
  }, []);

  useEffect(() => {
    if (!sections.length) return;
    document.body.dataset.topNav = "true";
    return () => {
      delete document.body.dataset.topNav;
    };
  }, [sections.length]);

  useEffect(() => {
    if (!sections.length) return;
    const sectionEls = Array.from(
      document.querySelectorAll<HTMLElement>(sectionSelector),
    ).filter((section) => sectionIds.has(section.id));
    if (!sectionEls.length) return;

    const ratios = new Map<HTMLElement, number>();
    let raf = 0;

    const setActive = () => {
      raf = 0;
      let best: HTMLElement | null = null;
      let bestRatio = 0;
      ratios.forEach((ratio, el) => {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = el;
        }
      });
      sectionEls.forEach((section) => {
        const ratio = ratios.get(section) ?? 0;
        section.style.setProperty("--section-focus", ratio.toFixed(3));
      });
      const bestId = (best as HTMLElement | null)?.id;
      if (bestId) setActiveSectionId(bestId);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          ratios.set(entry.target as HTMLElement, entry.intersectionRatio);
        });
        if (!raf) raf = window.requestAnimationFrame(setActive);
      },
      {
        threshold: Array.from({ length: 11 }, (_, index) => index / 10),
        rootMargin: "-10% 0px -10% 0px",
      },
    );

    sectionEls.forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [sectionIds, sectionSelector, sections.length]);

  if (!navNode || sections.length === 0) return null;

  return createPortal(
    <div className="top-bar-nav__inner">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => {
            const target = document.getElementById(section.id);
            if (target) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
          className={`top-bar-nav__btn${
            activeSectionId === section.id ? " top-bar-nav__btn--active" : ""
          }`}
        >
          {section.label}
        </button>
      ))}
    </div>,
    navNode,
  );
}
