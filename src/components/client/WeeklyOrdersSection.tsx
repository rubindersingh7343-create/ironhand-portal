"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type {
  OrderMessage,
  OrderPeriod,
  OrderStatus,
  OrderVendor,
  OrderVendorItem,
  SessionUser,
  WeeklyOrder,
  WeeklyOrderItem,
} from "@/lib/types";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";

type StoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type OrderModalState = {
  order: WeeklyOrder;
  vendor: OrderVendor | null;
};

type EditableOrderItem = {
  id: string;
  productName: string;
  unitsOnHand: string;
  unitsToOrder: string;
  isNew: boolean;
};

const periodLabel: Record<OrderPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
};

function formatStoreLabel(store: StoreSummary) {
  return store.storeName ?? `Store ${store.storeId}`;
}

function formatShortDate(value: string) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function normalizeItems(items: WeeklyOrderItem[]) {
  return items.map((item) => ({
    id: item.id,
    productName: item.productName,
    unitsOnHand: String(item.unitsOnHand ?? ""),
    unitsToOrder: String(item.unitsToOrder ?? ""),
    isNew: false,
  }));
}

export default function WeeklyOrdersSection({ user }: { user: SessionUser }) {
  const activeTab: OrderPeriod = "weekly";
  const ownerStore = useOwnerPortalStore();
  const hasSharedStore = Boolean(ownerStore);
  const [stores, setStores] = useState<StoreSummary[]>(
    ownerStore?.stores ?? [],
  );
  const [selectedStore, setSelectedStore] = useState(
    ownerStore?.selectedStoreId ?? user.storeNumber ?? "",
  );
  const [periodStart, setPeriodStart] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [vendors, setVendors] = useState<OrderVendor[]>([]);
  const [orders, setOrders] = useState<WeeklyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<OrderModalState | null>(null);
  const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});
  const [unseenIds, setUnseenIds] = useState<string[]>([]);

  const storeOptions = useMemo(() => stores, [stores]);
  const selectedStoreMeta = useMemo(
    () => stores.find((store) => store.storeId === selectedStore),
    [stores, selectedStore],
  );
  const showUpgrade =
    Boolean(selectedStoreMeta?.hasSurveillance) &&
    !selectedStoreMeta?.hasManager;
  const ordersByVendor = useMemo(() => {
    const map = new Map<string, WeeklyOrder>();
    orders.forEach((order) => map.set(order.vendorId, order));
    return map;
  }, [orders]);
  const unseenSet = useMemo(() => new Set(unseenIds), [unseenIds]);

  useEffect(() => {
    if (ownerStore) {
      setStores(ownerStore.stores);
      if (ownerStore.selectedStoreId) {
        setSelectedStore(ownerStore.selectedStoreId);
      }
      return;
    }
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const nextStores: StoreSummary[] = Array.isArray(data.stores)
          ? data.stores
          : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        const merged: StoreSummary[] = nextStores.length ? nextStores : fallback;
        setStores(merged);
        setSelectedStore((prev) =>
          merged.some((store) => store.storeId === prev)
            ? prev
            : merged[0]?.storeId ?? prev,
        );
      } catch (error) {
        console.error("Failed to load stores", error);
      }
    };
    loadStores();
  }, [ownerStore, ownerStore?.stores, ownerStore?.selectedStoreId, user.storeNumber]);

  const loadUnseen = useCallback(
    async (storeOverride?: string) => {
      if (!selectedStore) return;
      try {
        const storeParam = storeOverride ?? selectedStore;
        const response = await fetch(
          `/api/owner/unseen?type=order&storeId=${encodeURIComponent(storeParam)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setUnseenCounts(data.counts ?? {});
          setUnseenIds(Array.isArray(data.unseenIds) ? data.unseenIds : []);
        }
      } catch (error) {
        console.error("Failed to load order unseen markers", error);
      }
    },
    [selectedStore],
  );

  const loadData = useCallback(
    async (silent = false) => {
      if (!selectedStore) return;
      if (!silent) {
        setLoading(true);
      }
      setMessage(null);
      try {
        const vendorResponse = await fetch(
          `/api/orders/vendors?storeId=${encodeURIComponent(selectedStore)}`,
          { cache: "no-store" },
        );
        const vendorData = await vendorResponse.json().catch(() => ({}));
        const vendorList: OrderVendor[] = Array.isArray(vendorData.vendors)
          ? vendorData.vendors
          : [];
        setVendors(vendorList);

        const orderParams = new URLSearchParams({
          storeId: selectedStore,
          periodType: activeTab,
          periodStart,
        });
        const orderResponse = await fetch(
          `/api/orders/weekly?${orderParams.toString()}`,
          { cache: "no-store" },
        );
        const orderData = await orderResponse.json().catch(() => ({}));
        if (!orderResponse.ok) {
          throw new Error(orderData?.error ?? "Unable to load orders.");
        }
        setOrders(Array.isArray(orderData.orders) ? orderData.orders : []);
        loadUnseen(selectedStore);
      } catch (error) {
        console.error("Failed to load orders", error);
        setOrders([]);
        setMessage(
          error instanceof Error ? error.message : "Unable to load orders.",
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [selectedStore, activeTab, periodStart, loadUnseen],
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  useEffect(() => {
    loadUnseen();
  }, [loadUnseen]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadData(true);
      loadUnseen();
    }, 20000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadData(true);
        loadUnseen();
      }
    };
    const handleFocus = () => {
      loadData(true);
      loadUnseen();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadData, loadUnseen]);

  const openOrder = async (order: WeeklyOrder, vendor: OrderVendor | null) => {
    await fetch("/api/owner/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            storeId: order.storeId,
            itemType: "order",
            itemId: order.id,
          },
        ],
      }),
    });
    setUnseenIds((prev) => prev.filter((id) => id !== order.id));
    setUnseenCounts((prev) => ({
      ...prev,
      [order.storeId]: Math.max(0, (prev[order.storeId] ?? 1) - 1),
    }));
    setActiveModal({ order, vendor });
  };

  const closeOrder = () => {
    setActiveModal(null);
  };

  const refreshOrders = async () => {
    if (!selectedStore) return;
    const params = new URLSearchParams({
      storeId: selectedStore,
      periodType: activeTab,
      periodStart,
    });
    const response = await fetch(`/api/orders/weekly?${params.toString()}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    setOrders(Array.isArray(data.orders) ? data.orders : []);
  };

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-slate-300">
          Orders
        </h2>
        <span className="text-xs uppercase tracking-[0.24em] text-slate-400">
          Weekly
        </span>
      </div>

      <div className="reports-filter-row mb-4">
        {!hasSharedStore && (
          <div className="relative">
            <select
              className="ui-field--slim min-w-[160px] appearance-none pr-7"
              value={selectedStore}
              onChange={(event) => setSelectedStore(event.target.value)}
            >
              {storeOptions.map((store) => {
                const count = unseenCounts[store.storeId] ?? 0;
                const label = formatStoreLabel(store);
                return (
                  <option key={store.storeId} value={store.storeId}>
                    {count > 0 ? `${label} • ${count}` : label}
                  </option>
                );
              })}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-300">
              ▾
            </span>
            {unseenCounts[selectedStore] ? (
              <span className="pointer-events-none absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-400" />
            ) : null}
          </div>
        )}
        <input
          type="date"
          className="ui-field--slim"
          value={periodStart}
          onChange={(event) => setPeriodStart(event.target.value)}
        />
      </div>

      {showUpgrade ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Upgrade to premium to access this feature.
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
          Loading {periodLabel[activeTab].toLowerCase()} orders…
        </div>
      ) : message ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {message}
        </div>
      ) : vendors.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
          No vendors yet for this store.
        </div>
      ) : (
        <div className="space-y-3">
          {vendors.map((vendor) => {
            const order = ordersByVendor.get(vendor.id);
            return (
              <div
                key={vendor.id}
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-100">
                      {vendor.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {vendor.repName ? `Rep: ${vendor.repName}` : "Rep: —"}
                    </p>
                  </div>
                  {order ? (
                    <div className="flex items-center gap-2">
                      {unseenSet.has(order.id) ? (
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                      ) : null}
                      <button
                        type="button"
                        className="ui-button--slim border border-white/20 text-white"
                        onClick={() => openOrder(order, vendor)}
                      >
                        Open
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">
                      No {periodLabel[activeTab].toLowerCase()} order yet.
                    </span>
                  )}
                </div>
                {order ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>
                      {periodLabel[activeTab]} order · {formatShortDate(order.periodStart)}
                    </span>
                    <span className="uppercase tracking-[0.2em] text-slate-400">
                      {order.status}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {activeModal ? (
        <OrderReviewModal
          state={activeModal}
          onClose={closeOrder}
          onUpdated={refreshOrders}
          user={user}
        />
      ) : null}
    </section>
  );
}

function OrderReviewModal({
  state,
  onClose,
  onUpdated,
  user,
}: {
  state: OrderModalState;
  onClose: () => void;
  onUpdated: () => void;
  user: SessionUser;
}) {
  const { order, vendor } = state;
  const [draftItems, setDraftItems] = useState<EditableOrderItem[]>(() =>
    normalizeItems(order.items),
  );
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestionRow, setActiveSuggestionRow] = useState<string | null>(
    null,
  );
  const [suggestionQuery, setSuggestionQuery] = useState("");

  useEffect(() => {
    setDraftItems(normalizeItems(order.items));
    setStatus(order.status);
  }, [order.items, order.status]);

  useEffect(() => {
    let mounted = true;
    const loadSuggestions = async () => {
      const params = new URLSearchParams();
      if (vendor?.directoryVendorId) {
        params.set("directoryVendorId", vendor.directoryVendorId);
      }
      if (vendor?.id) {
        params.set("vendorId", vendor.id);
      }
      try {
        const response = await fetch(
          `/api/orders/vendor-items?${params.toString()}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        const items = Array.isArray(data.items) ? data.items : [];
        if (mounted) {
          setSuggestions(items.map((item: OrderVendorItem | string) =>
            typeof item === "string" ? item : item.productName,
          ));
        }
      } catch (error) {
        console.error("Failed to load vendor items", error);
        if (mounted) setSuggestions([]);
      }
    };
    loadSuggestions();
    return () => {
      mounted = false;
    };
  }, [vendor?.directoryVendorId]);

  useEffect(() => {
    let mounted = true;
    const loadMessages = async () => {
      setLoadingMessages(true);
      try {
        const response = await fetch(
          `/api/orders/messages?orderId=${order.id}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!mounted) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch (error) {
        console.error("Failed to load messages", error);
      } finally {
        if (mounted) setLoadingMessages(false);
      }
    };
    loadMessages();
    return () => {
      mounted = false;
    };
  }, [order.id]);

  const updateItem = (
    index: number,
    key: keyof EditableOrderItem,
    value: string,
  ) => {
    setDraftItems((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, [key]: value } : item,
      ),
    );
  };

  const addItem = () => {
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraftItems((prev) => [
      ...prev,
      {
        id: tempId,
        productName: "",
        unitsOnHand: "",
        unitsToOrder: "",
        isNew: true,
      },
    ]);
  };

  const selectSuggestion = (rowId: string, value: string) => {
    setDraftItems((prev) =>
      prev.map((item) =>
        item.id === rowId ? { ...item, productName: value } : item,
      ),
    );
    setActiveSuggestionRow(null);
    setSuggestionQuery("");
  };

  const handleSave = async (status?: OrderStatus) => {
    setSaving(true);
    try {
      await fetch("/api/orders/weekly", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.id,
          status,
          items: draftItems.map((item) => ({
            productName: item.productName,
            unitsOnHand: Number(item.unitsOnHand || 0),
            unitsToOrder: Number(item.unitsToOrder || 0),
          })),
        }),
      });
      await onUpdated();
      if (status) {
        setStatus(status);
      }
      if (status === "approved") {
        onClose();
      }
    } catch (error) {
      console.error("Order update failed", error);
    } finally {
      setSaving(false);
    }
  };

  const handleMessage = async () => {
    if (!note.trim()) return;
    const message = note.trim();
    setNote("");
    await fetch("/api/orders/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, message }),
    });
    const response = await fetch(`/api/orders/messages?orderId=${order.id}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    setMessages(Array.isArray(data.messages) ? data.messages : []);
  };

  const isApproved = status === "approved";

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose={false}>
      <div className="flex flex-col gap-5 text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            {periodLabel[order.periodType]} Order
          </p>
          <h3 className="text-xl font-semibold text-slate-50">
            {vendor?.name ?? "Vendor"}
          </h3>
          <p className="text-sm text-slate-400">
            {order.storeId} · {formatShortDate(order.periodStart)}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
            <span>Order Items</span>
            <span className="text-slate-500">{order.status}</span>
          </div>
          <div className="space-y-3">
            {draftItems.map((item, idx) => (
              <div
                key={item.id ?? `${item.productName}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2"
              >
                {item.isNew ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <div className="relative min-w-[180px] flex-1">
                      <input
                        className="ui-field w-full"
                        placeholder="Product name"
                        value={item.productName}
                        onChange={(event) => {
                          const value = event.target.value;
                          updateItem(idx, "productName", value);
                          setActiveSuggestionRow(item.id);
                          setSuggestionQuery(value);
                        }}
                        onFocus={() => {
                          setActiveSuggestionRow(item.id);
                          setSuggestionQuery(item.productName);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            setActiveSuggestionRow((current) =>
                              current === item.id ? null : current,
                            );
                          }, 120);
                        }}
                        disabled={isApproved}
                      />
                      {activeSuggestionRow === item.id && suggestions.length ? (
                        (() => {
                          const filtered = suggestions.filter((name) =>
                            name.toLowerCase().includes(suggestionQuery.toLowerCase()),
                          );
                          if (!filtered.length) return null;
                          return (
                            <div className="absolute z-20 mt-2 max-h-40 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-950/95 p-2 text-sm text-slate-200 shadow-lg">
                              {filtered.slice(0, 8).map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    selectSuggestion(item.id, name);
                                  }}
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
                          );
                        })()
                      ) : null}
                    </div>
                    <input
                      className="ui-field h-8 w-24 text-center"
                      type="text"
                      inputMode="numeric"
                      placeholder="On hand"
                      value={item.unitsOnHand}
                      onChange={(event) =>
                        updateItem(
                          idx,
                          "unitsOnHand",
                          event.target.value.replace(/[^\d]/g, ""),
                        )
                      }
                      disabled={isApproved}
                    />
                    <input
                      className="ui-field h-8 w-24 text-center"
                      type="text"
                      inputMode="numeric"
                      placeholder="Order"
                      value={item.unitsToOrder}
                      onChange={(event) =>
                        updateItem(
                          idx,
                          "unitsToOrder",
                          event.target.value.replace(/[^\d]/g, ""),
                        )
                      }
                      disabled={isApproved}
                    />
                  </div>
                ) : (
                  <>
                    <div className="min-w-[160px]">
                      <p className="text-sm font-semibold text-slate-100">
                        {item.productName}
                      </p>
                      <p className="text-xs text-slate-400">
                        On hand: {item.unitsOnHand}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Order</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="ui-field h-8 w-20 text-center"
                        value={item.unitsToOrder}
                        onChange={(event) =>
                          updateItem(
                            idx,
                            "unitsToOrder",
                            event.target.value.replace(/[^\d]/g, ""),
                          )
                        }
                        disabled={isApproved}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {!isApproved ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="ui-button--slim border border-white/20 text-white"
                onClick={addItem}
              >
                Add item
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Conversation
          </p>
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {loadingMessages ? (
              <p className="text-xs text-slate-400">Loading messages…</p>
            ) : messages.length ? (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-xl border border-white/10 px-3 py-2 text-xs ${
                    msg.senderRole === "owner"
                      ? "bg-emerald-500/10 text-emerald-100"
                      : "bg-slate-900/60 text-slate-200"
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    {msg.senderRole}
                  </p>
                  <p>{msg.message}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400">
                No messages yet. Start the conversation below.
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-white"
              rows={3}
              placeholder="Add a message for the manager…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="ui-button--slim border border-white/20 text-white"
                onClick={handleMessage}
              >
                Send Message
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isApproved ? (
            <>
              <button
                type="button"
                className="ui-button--slim border border-white/20 text-white"
                onClick={() => handleSave()}
                disabled={saving}
              >
                Save changes
              </button>
              <button
                type="button"
                className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100"
                onClick={() => handleSave("approved")}
                disabled={saving}
              >
                Approve
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100"
              onClick={() => handleSave("submitted")}
              disabled={saving}
            >
              Unapprove
            </button>
          )}
        </div>
      </div>
    </IHModal>
  );
}
