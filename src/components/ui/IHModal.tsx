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
  const onCloseRef = useRef(onClose);
  const didLockScrollRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setPortalNode(document.body);
  }, []);

  useEffect(() => {
    if (!isOpen || !portalNode) return;
    lastActive.current = document.activeElement as HTMLElement | null;
    const nextCount = Number(document.body.dataset.ihModalCount ?? "0") + 1;
    document.body.dataset.ihModalCount = String(nextCount);
    document.body.classList.add("ui-modal-open");
    document.documentElement.classList.add("ui-modal-open");
    didLockScrollRef.current = true;
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
        onCloseRef.current();
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
      if (didLockScrollRef.current) {
        didLockScrollRef.current = false;
        const current = Math.max(
          0,
          Number(document.body.dataset.ihModalCount ?? "1") - 1,
        );
        if (current === 0) {
          delete document.body.dataset.ihModalCount;
          document.body.classList.remove("ui-modal-open");
          document.documentElement.classList.remove("ui-modal-open");
        } else {
          document.body.dataset.ihModalCount = String(current);
        }
      }
      lastActive.current?.focus?.();
    };
  }, [isOpen, portalNode]);

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
            onTouchEnd={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            aria-label="Close"
            className="ih-modal-close absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:border-white/50"
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
