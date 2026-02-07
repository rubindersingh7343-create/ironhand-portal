"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatType, SessionUser } from "@/lib/types";
import EmployeeChatModal from "@/components/employee/EmployeeChatModal";

export default function EmployeeBottomBar({ user }: { user: SessionUser }) {
  const [portalNode, setPortalNode] = useState<Element | null>(null);
  const [activeChat, setActiveChat] = useState<ChatType | null>(null);

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  const storeName = user.storeName ?? `Store ${user.storeNumber}`;

  return (
    <>
      {portalNode &&
        createPortal(
          <div className="portal-bottom-bar">
            <div className="portal-bottom-bar__label">
              <button
                type="button"
                onClick={() => setActiveChat("manager")}
                className="portal-bottom-bar__icon"
                aria-label="Manager chat"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M6 7h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setActiveChat("surveillance")}
                className="portal-bottom-bar__icon"
                aria-label="Surveillance chat"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5l-4 3v-3H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
                  <path d="M9.5 11h5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setActiveChat("owner")}
                className="portal-bottom-bar__icon"
                aria-label="Owner chat"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M12 5a5 5 0 1 1-4.2 7.7" />
                  <path d="M5 19a7 7 0 0 1 14 0" />
                </svg>
              </button>
            </div>
          </div>,
          portalNode,
        )}

      {activeChat && (
        <EmployeeChatModal
          type={activeChat}
          storeId={user.storeNumber}
          storeName={storeName}
          onClose={() => setActiveChat(null)}
        />
      )}
    </>
  );
}
