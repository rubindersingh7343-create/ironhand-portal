"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type IHModalProps = {
  isOpen: boolean;
  onClose: () => void;
  allowOutsideClose?: boolean;
  labelledBy?: string;
  panelClassName?: string;
  backdropClassName?: string;
  showCloseButton?: boolean;
  children: React.ReactNode;
};

const focusableSelector =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export default function IHModal({
  isOpen,
  onClose,
  allowOutsideClose = false,
  labelledBy,
  panelClassName = "",
  backdropClassName = "",
  showCloseButton = true,
  children,
}: IHModalProps) {
  const [portalNode, setPortalNode] = useState<Element | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastActive = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setPortalNode(document.body);
  }, []);

  useEffect(() => {
    if (!isOpen || !portalNode) return;
    lastActive.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("ui-modal-open");
    document.documentElement.classList.add("ui-modal-open");
    const autoFocusTarget = panelRef.current?.querySelector<HTMLElement>(
      "[data-autofocus='true']",
    );
    if (autoFocusTarget) {
      autoFocusTarget.focus();
    } else {
      panelRef.current?.focus();
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        focusableSelector,
      );
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      document.body.classList.remove("ui-modal-open");
      document.documentElement.classList.remove("ui-modal-open");
      lastActive.current?.focus?.();
    };
  }, [isOpen, onClose, portalNode]);

  if (!isOpen || !portalNode) return null;

  return createPortal(
    <div
      className={`ih-modal-backdrop ${backdropClassName}`}
      data-state="open"
      onMouseDown={(event) => {
        if (!allowOutsideClose) return;
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`ih-modal-panel relative ${panelClassName}`}
        data-state="open"
      >
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:border-white/50"
          >
            ×
          </button>
        )}
        {children}
      </div>
    </div>,
    portalNode,
  );
}
