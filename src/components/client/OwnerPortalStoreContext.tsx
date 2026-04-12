"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { SessionUser } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";
import OwnerChatModal from "@/components/client/OwnerChatModal";
import OwnerAssistantModal from "@/components/client/OwnerAssistantModal";
import {
  DEFAULT_ASSISTANT_VOICE,
  type AssistantVoice,
  isAssistantVoice,
} from "@/components/client/assistantVoice";
import {
  DEFAULT_ASSISTANT_LANGUAGE_PRIMARY,
} from "@/components/client/assistantLanguages";

export type OwnerPortalStoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

export type OwnerPortalDateRange = {
  startDate: string;
  endDate: string;
};

type OwnerPortalStoreContextValue = {
  stores: OwnerPortalStoreSummary[];
  selectedStoreId: string;
  setSelectedStoreId: (storeId: string) => void;
  activeStore: OwnerPortalStoreSummary | null;
  ready: boolean;
  refreshStores: () => Promise<void>;
  dateLockRange: OwnerPortalDateRange | null;
  isDateLocked: boolean;
  setDateLockRange: (range: OwnerPortalDateRange) => void;
  clearDateLockRange: () => void;
  getPageDateRange: (pageKey: string, scopeId: string) => OwnerPortalDateRange | null;
  setPageDateRange: (pageKey: string, scopeId: string, range: OwnerPortalDateRange) => void;
  clearPageDateRange: (pageKey: string, scopeId: string) => void;
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
  dateLockRange,
  onSetDateLockRange,
  onClearDateLockRange,
}: {
  stores: OwnerPortalStoreSummary[];
  selectedStoreId: string;
  onChange: (storeId: string) => void;
  ready: boolean;
  dateLockRange: OwnerPortalDateRange | null;
  onSetDateLockRange: (range: OwnerPortalDateRange) => void;
  onClearDateLockRange: () => void;
}) {
  const activeLabel =
    stores.find((store) => store.storeId === selectedStoreId)?.storeName ??
    (selectedStoreId ? `Store ${selectedStoreId}` : "Select a store");
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [surveillanceChatOpen, setSurveillanceChatOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dateLockOpen, setDateLockOpen] = useState(false);
  const [chatBadges, setChatBadges] = useState({ surveillance: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [lockStart, setLockStart] = useState(() => {
    if (typeof window === "undefined") return "";
    return new Date().toISOString().slice(0, 10);
  });
  const [lockEnd, setLockEnd] = useState("");
  const [portalNode, setPortalNode] = useState<Element | null>(null);
  const [assistantVoice, setAssistantVoice] = useState<AssistantVoice>(() => {
    if (typeof window === "undefined") return DEFAULT_ASSISTANT_VOICE;
    const stored = window.localStorage.getItem("ih-assistant-voice");
    return stored && isAssistantVoice(stored) ? stored : DEFAULT_ASSISTANT_VOICE;
  });
  const [assistantPrimaryLanguage, setAssistantPrimaryLanguage] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_ASSISTANT_LANGUAGE_PRIMARY;
    const stored = window.localStorage.getItem("ih-assistant-lang-primary");
    return stored?.trim() || DEFAULT_ASSISTANT_LANGUAGE_PRIMARY;
  });
  const [assistantSecondaryLanguage, setAssistantSecondaryLanguage] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = window.localStorage.getItem("ih-assistant-lang-secondary");
    return stored?.trim() || "";
  });
  const lockToastShownRef = useRef(false);

  const isDateLocked = Boolean(dateLockRange?.startDate);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    if (!isDateLocked) {
      lockToastShownRef.current = false;
      return;
    }
    if (lockToastShownRef.current) return;
    lockToastShownRef.current = true;
    showToast("Date lock active.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDateLocked]);

  const loadBadges = useCallback(async (storeId: string) => {
    if (!storeId) return;
    try {
      const survRes = await fetch(
        `/api/owner/unseen?type=chat-surveillance&storeId=${encodeURIComponent(
          storeId,
        )}`,
        { cache: "no-store" },
      );
      const survData = await survRes.json().catch(() => ({}));
      setChatBadges({
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
    if (typeof window === "undefined") return;
    window.localStorage.setItem("ih-assistant-voice", assistantVoice);
  }, [assistantVoice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("ih-assistant-lang-primary", assistantPrimaryLanguage);
  }, [assistantPrimaryLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("ih-assistant-lang-secondary", assistantSecondaryLanguage);
  }, [assistantSecondaryLanguage]);

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

  const canOpenAssistant = Boolean(selectedStoreId);

  useEffect(() => {
    if (!dateLockOpen) return;
    const nextStart = dateLockRange?.startDate ?? new Date().toISOString().slice(0, 10);
    const nextEnd = dateLockRange?.endDate ?? "";
    setLockStart(nextStart);
    setLockEnd(nextEnd === nextStart ? "" : nextEnd);
  }, [dateLockOpen, dateLockRange?.startDate, dateLockRange?.endDate]);

  return (
    <>
      {portalNode &&
        createPortal(
          <>
            {toast ? (
              <div className="pointer-events-none fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-[60] w-[min(420px,92vw)] -translate-x-1/2 px-4">
                <div className="ui-toast rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-center text-sm text-slate-100 shadow-lg backdrop-blur">
                  {toast}
                </div>
              </div>
            ) : null}
            <div className="owner-bottom-bar">
              <div className="owner-bottom-bar__label owner-bottom-bar__label--ai">
                <div className="owner-bottom-bar__slot">
                  <button
                    type="button"
                    onClick={() => setStorePickerOpen(true)}
                    className="owner-bottom-bar__icon disabled:cursor-not-allowed disabled:opacity-50"
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
                    onClick={() => setDateLockOpen(true)}
                    className="owner-bottom-bar__icon"
                    aria-label="Lock date"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                      <path d="M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-7A1.5 1.5 0 0 1 6.5 11Z" />
                      <path d="M12 15v2" />
                    </svg>
                    {isDateLocked ? (
                      <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-blue-500 ring-2 ring-white/90" />
                    ) : null}
                  </button>
                </div>
                <button
                  type="button"
                  className="owner-bottom-bar__ai"
                  aria-label="Open assistant"
                  disabled={!canOpenAssistant}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setAssistantOpen(true);
                  }}
                  onClick={() => setAssistantOpen(true)}
                >
                  <span className="owner-bottom-bar__ai-core">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Z" />
                      <path d="M19 11a7 7 0 0 1-14 0" />
                      <path d="M12 18v3" />
                    </svg>
                  </span>
                  <span className="owner-bottom-bar__ai-label">
                    Tap for assistant
                  </span>
                </button>
                <div className="owner-bottom-bar__slot owner-bottom-bar__slot--right">
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
                  <button
                    type="button"
                    onClick={() => setAssistantOpen(true)}
                    className="owner-bottom-bar__icon"
                    aria-label="Open assistant"
                    disabled={!canOpenAssistant}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <path d="M12 3l1.6 3.6L17 8.3l-3.4 1.5L12 13.4l-1.6-3.6L7 8.3l3.4-1.7L12 3Z" />
                      <path d="M5 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" />
                      <path d="M18 14l0.8 1.8L21 17l-2.2 1-0.8 1.8-0.8-1.8-2.2-1 2.2-1.2L18 14Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </>,
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

      <IHModal
        isOpen={dateLockOpen}
        onClose={() => setDateLockOpen(false)}
        allowOutsideClose
      >
        <div className="w-[min(420px,92vw)]">
          <div className="border-b border-white/10 px-6 py-4">
            <p className="text-xs uppercase tracking-[0.26em] text-slate-400">
              Date Lock
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white">
              {isDateLocked ? "Date lock active" : "Lock a date"}
            </h2>
          </div>
          <div className="space-y-4 px-6 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="ui-label">Start</label>
                <input
                  type="date"
                  className="ui-field w-full"
                  value={lockStart}
                  onChange={(event) => setLockStart(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="ui-label">End (optional)</label>
                <input
                  type="date"
                  className="ui-field w-full"
                  value={lockEnd}
                  onChange={(event) => setLockEnd(event.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-slate-200/90">
              Locks the selected date or range across all pages and stores until
              you close the app.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {isDateLocked ? (
                <button
                  type="button"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100"
                  onClick={() => {
                    onClearDateLockRange();
                    showToast("Date lock cleared.");
                    setDateLockOpen(false);
                  }}
                >
                  Clear lock
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-900/30"
                disabled={!lockStart}
                onClick={() => {
                  if (!lockStart) return;
                  const normalizedEnd = lockEnd && lockEnd >= lockStart ? lockEnd : "";
                  const effectiveEnd = normalizedEnd || lockStart;
                  onSetDateLockRange({ startDate: lockStart, endDate: effectiveEnd });
                  const label =
                    effectiveEnd === lockStart
                      ? `Date locked: ${lockStart}`
                      : `Range locked: ${lockStart} → ${effectiveEnd}`;
                  showToast(label);
                  setDateLockOpen(false);
                }}
              >
                {isDateLocked ? "Update lock" : "Lock date"}
              </button>
            </div>
          </div>
        </div>
      </IHModal>

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
      {assistantOpen && selectedStoreId && (
        <OwnerAssistantModal
          storeId={selectedStoreId}
          storeName={activeLabel}
          onClose={() => setAssistantOpen(false)}
          voice={assistantVoice}
          onVoiceChange={setAssistantVoice}
          primaryLanguage={assistantPrimaryLanguage}
          secondaryLanguage={assistantSecondaryLanguage}
          onPrimaryLanguageChange={setAssistantPrimaryLanguage}
          onSecondaryLanguageChange={setAssistantSecondaryLanguage}
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
  const [selectedStoreId, setSelectedStoreIdState] = useState(() => {
    if (typeof window === "undefined") return user.storeNumber ?? "";
    const stored = window.localStorage.getItem("ih-owner-store");
    return stored ?? user.storeNumber ?? "";
  });
  const [ready, setReady] = useState(false);
  const [dateLockRange, setDateLockRangeState] =
    useState<OwnerPortalDateRange | null>(null);
  const [pageDateRanges, setPageDateRanges] = useState<
    Record<string, OwnerPortalDateRange>
  >({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem("ih-date-lock-range");
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.startDate !== "string") return;
      if (typeof parsed.endDate !== "string") return;
      if (!parsed.startDate) return;
      setDateLockRangeState({
        startDate: parsed.startDate,
        endDate: parsed.endDate || parsed.startDate,
      });
    } catch {
      // ignore storage parse issues
    }
  }, []);

  const refreshStores = useCallback(async () => {
    const response = await fetch("/api/client/store-list", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load stores");
    const data = await response.json();
    const list: OwnerPortalStoreSummary[] = Array.isArray(data.stores)
      ? data.stores
      : [];
    const fallback = user.storeNumber
      ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
      : [];
    const merged = list.length ? list : fallback;

    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("ih-owner-store")
        : null;
    const storedValid = stored ? merged.some((store) => store.storeId === stored) : false;
    const preferred =
      storedValid
        ? stored!
        : merged.find((store) => user.storeIds?.includes(store.storeId))?.storeId ??
          merged[0]?.storeId ??
          user.storeNumber ??
          "";

    setStores(merged);
    setSelectedStoreIdState((prev) => {
      if (storedValid) return stored!;
      return merged.some((store) => store.storeId === prev) ? prev : preferred;
    });
  }, [user.storeIds, user.storeNumber]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await refreshStores();
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
    })();
    return () => {
      active = false;
    };
  }, [refreshStores, user.storeNumber]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedStoreId) return;
    window.localStorage.setItem("ih-owner-store", selectedStoreId);
  }, [selectedStoreId]);

  const setSelectedStoreId = useCallback((storeId: string) => {
    setSelectedStoreIdState((prev) => {
      if (prev === storeId) return prev;
      return storeId;
    });
  }, []);

  const activeStore = useMemo(
    () => stores.find((store) => store.storeId === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );

  const isDateLocked = Boolean(dateLockRange?.startDate);

  const setDateLockRange = useCallback((range: OwnerPortalDateRange) => {
    if (!range?.startDate) return;
    const normalized: OwnerPortalDateRange = {
      startDate: range.startDate,
      endDate: range.endDate || range.startDate,
    };
    setDateLockRangeState((prev) => {
      if (
        prev &&
        prev.startDate === normalized.startDate &&
        prev.endDate === normalized.endDate
      ) {
        return prev;
      }
      return normalized;
    });
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(
          "ih-date-lock-range",
          JSON.stringify(normalized),
        );
      } catch {
        // ignore storage failures
      }
    }
  }, []);

  const clearDateLockRange = useCallback(() => {
    setDateLockRangeState(null);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem("ih-date-lock-range");
      } catch {
        // ignore storage failures
      }
    }
  }, []);

  const buildPageDateKey = useCallback(
    (pageKey: string, scopeId: string) => `${pageKey}:${scopeId}`,
    [],
  );

  const getPageDateRange = useCallback(
    (pageKey: string, scopeId: string) => {
      const key = buildPageDateKey(pageKey, scopeId);
      return pageDateRanges[key] ?? null;
    },
    [buildPageDateKey, pageDateRanges],
  );

  const setPageDateRange = useCallback(
    (pageKey: string, scopeId: string, range: OwnerPortalDateRange) => {
      if (!pageKey || !scopeId) return;
      if (!range?.startDate || !range?.endDate) return;
      const key = buildPageDateKey(pageKey, scopeId);
      setPageDateRanges((prev) => {
        const existing = prev[key];
        if (
          existing &&
          existing.startDate === range.startDate &&
          existing.endDate === range.endDate
        ) {
          return prev;
        }
        return { ...prev, [key]: { ...range } };
      });
    },
    [buildPageDateKey],
  );

  const clearPageDateRange = useCallback(
    (pageKey: string, scopeId: string) => {
      const key = buildPageDateKey(pageKey, scopeId);
      setPageDateRanges((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [buildPageDateKey],
  );

  const value = useMemo(
    () => ({
      stores,
      selectedStoreId,
      setSelectedStoreId,
      activeStore,
      ready,
      refreshStores,
      dateLockRange,
      isDateLocked,
      setDateLockRange,
      clearDateLockRange,
      getPageDateRange,
      setPageDateRange,
      clearPageDateRange,
    }),
    [
      stores,
      selectedStoreId,
      activeStore,
      ready,
      refreshStores,
      dateLockRange,
      isDateLocked,
      setDateLockRange,
      clearDateLockRange,
      getPageDateRange,
      setPageDateRange,
      clearPageDateRange,
    ],
  );

  return (
    <OwnerPortalStoreContext.Provider value={value}>
      {children}
      <OwnerPortalStoreBar
        stores={stores}
        selectedStoreId={selectedStoreId}
        onChange={setSelectedStoreId}
        ready={ready}
        dateLockRange={dateLockRange}
        onSetDateLockRange={setDateLockRange}
        onClearDateLockRange={clearDateLockRange}
      />
    </OwnerPortalStoreContext.Provider>
  );
}
