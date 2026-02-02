"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { SessionUser } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";
import OwnerChatModal from "@/components/client/OwnerChatModal";

export type OwnerPortalStoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type OwnerPortalStoreContextValue = {
  stores: OwnerPortalStoreSummary[];
  selectedStoreId: string;
  setSelectedStoreId: (storeId: string) => void;
  activeStore: OwnerPortalStoreSummary | null;
  ready: boolean;
};

const OwnerPortalStoreContext =
  createContext<OwnerPortalStoreContextValue | null>(null);

export const useOwnerPortalStore = () => useContext(OwnerPortalStoreContext);

function formatStoreLabel(store: OwnerPortalStoreSummary) {
  return store.storeName ?? `Store ${store.storeId}`;
}

function OwnerPortalStoreBar({
  stores,
  selectedStoreId,
  onChange,
  ready,
}: {
  stores: OwnerPortalStoreSummary[];
  selectedStoreId: string;
  onChange: (storeId: string) => void;
  ready: boolean;
}) {
  const activeLabel =
    stores.find((store) => store.storeId === selectedStoreId)?.storeName ??
    (selectedStoreId ? `Store ${selectedStoreId}` : "Select a store");
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [managerChatOpen, setManagerChatOpen] = useState(false);
  const [surveillanceChatOpen, setSurveillanceChatOpen] = useState(false);
  const [chatBadges, setChatBadges] = useState({ manager: 0, surveillance: 0 });
  const [portalNode, setPortalNode] = useState<Element | null>(null);

  const loadBadges = useCallback(async (storeId: string) => {
    if (!storeId) return;
    try {
      const [managerRes, survRes] = await Promise.all([
        fetch(
          `/api/owner/unseen?type=chat-manager&storeId=${encodeURIComponent(
            storeId,
          )}`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/owner/unseen?type=chat-surveillance&storeId=${encodeURIComponent(
            storeId,
          )}`,
          { cache: "no-store" },
        ),
      ]);
      const managerData = await managerRes.json().catch(() => ({}));
      const survData = await survRes.json().catch(() => ({}));
      setChatBadges({
        manager: managerData.counts?.[storeId] ?? 0,
        surveillance: survData.counts?.[storeId] ?? 0,
      });
    } catch (error) {
      console.error("Failed to load chat badges", error);
    }
  }, []);

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  useEffect(() => {
    if (!selectedStoreId) return;
    loadBadges(selectedStoreId);
    const interval = window.setInterval(() => loadBadges(selectedStoreId), 15000);
    const handleFocus = () => loadBadges(selectedStoreId);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadBadges, selectedStoreId]);

  return (
    <>
      {portalNode &&
        createPortal(
          <div className="owner-bottom-bar">
            <div className="owner-bottom-bar__label">
              <button
                type="button"
                onClick={() => setStorePickerOpen(true)}
                className="owner-bottom-bar__icon"
                aria-label="Select store"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                >
                  <path d="M4 9l2-4h12l2 4" />
                  <path d="M5 9v10h14V9" />
                  <path d="M3 9h18" />
                  <path d="M9 19v-6h6v6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setManagerChatOpen(true)}
                className="owner-bottom-bar__icon"
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
                {chatBadges.manager > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold text-slate-950">
                    {chatBadges.manager}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSurveillanceChatOpen(true)}
                className="owner-bottom-bar__icon"
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
                {chatBadges.surveillance > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold text-slate-950">
                    {chatBadges.surveillance}
                  </span>
                )}
              </button>
            </div>
          </div>,
          portalNode,
        )}

      <IHModal
        isOpen={storePickerOpen}
        onClose={() => setStorePickerOpen(false)}
        allowOutsideClose
      >
        <div className="w-[min(420px,92vw)]">
          <div className="border-b border-white/10 px-6 py-4">
            <p className="text-xs uppercase tracking-[0.26em] text-slate-400">
              Active Store
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white">
              {ready ? activeLabel : "Loading stores..."}
            </h2>
          </div>
          <div className="px-6 py-4">
            {stores.map((store) => {
              const label = formatStoreLabel(store);
              const isActive = store.storeId === selectedStoreId;
              return (
                <button
                  key={store.storeId}
                  type="button"
                  onClick={() => {
                    onChange(store.storeId);
                    setStorePickerOpen(false);
                  }}
                  className={`mb-2 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    isActive
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-slate-200"
                  }`}
                >
                  <span className="font-semibold">{label}</span>
                  {isActive && (
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-300">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </IHModal>

      {managerChatOpen && selectedStoreId && (
        <OwnerChatModal
          type="manager"
          storeId={selectedStoreId}
          storeName={activeLabel}
          onClose={() => {
            setManagerChatOpen(false);
            loadBadges(selectedStoreId);
          }}
        />
      )}
      {surveillanceChatOpen && selectedStoreId && (
        <OwnerChatModal
          type="surveillance"
          storeId={selectedStoreId}
          storeName={activeLabel}
          onClose={() => {
            setSurveillanceChatOpen(false);
            loadBadges(selectedStoreId);
          }}
        />
      )}
    </>
  );
}

export function OwnerPortalStoreProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const [stores, setStores] = useState<OwnerPortalStoreSummary[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => {
    if (typeof window === "undefined") return user.storeNumber ?? "";
    const stored = window.localStorage.getItem("ih-owner-store");
    return stored ?? user.storeNumber ?? "";
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load stores");
        }
        const data = await response.json();
        const list: OwnerPortalStoreSummary[] = Array.isArray(data.stores)
          ? data.stores
          : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        const merged = list.length ? list : fallback;
        if (!active) return;
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem("ih-owner-store")
            : null;
        const storedValid = stored
          ? merged.some((store) => store.storeId === stored)
          : false;
        const preferred =
          storedValid
            ? stored!
            : merged.find((store) => user.storeIds?.includes(store.storeId))
                ?.storeId ??
              merged[0]?.storeId ??
              user.storeNumber ??
              "";
        setStores(merged);
        setSelectedStoreId((prev) => {
          if (storedValid) return stored!;
          return merged.some((store) => store.storeId === prev) ? prev : preferred;
        });
      } catch (error) {
        console.error("Failed to load stores", error);
        if (!active) return;
        setStores(
          user.storeNumber
            ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
            : [],
        );
      } finally {
        if (active) setReady(true);
      }
    };
    loadStores();
    return () => {
      active = false;
    };
  }, [user.storeIds, user.storeNumber]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedStoreId) return;
    window.localStorage.setItem("ih-owner-store", selectedStoreId);
  }, [selectedStoreId]);

  const activeStore = useMemo(
    () => stores.find((store) => store.storeId === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );

  const value = useMemo(
    () => ({
      stores,
      selectedStoreId,
      setSelectedStoreId,
      activeStore,
      ready,
    }),
    [stores, selectedStoreId, activeStore, ready],
  );

  return (
    <OwnerPortalStoreContext.Provider value={value}>
      {children}
      <OwnerPortalStoreBar
        stores={stores}
        selectedStoreId={selectedStoreId}
        onChange={setSelectedStoreId}
        ready={ready}
      />
    </OwnerPortalStoreContext.Provider>
  );
}
