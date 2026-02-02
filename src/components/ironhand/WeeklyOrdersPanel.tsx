"use client";

import { useEffect, useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type {
  OrderMessage,
  OrderPeriod,
  OrderVendorDirectory,
  OrderVendorItem,
  OrderVendor,
  SessionUser,
  WeeklyOrder,
  WeeklyOrderItem,
} from "@/lib/types";

type StoreSummary = { storeId: string; storeName?: string };

type VendorModalState = {
  vendor: OrderVendor;
};

type OrderModalState = {
  vendor: OrderVendor;
  order: WeeklyOrder | null;
};

type EditableItem = {
  id: string;
  productName: string;
  unitsOnHand: string;
  unitsToOrder: string;
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

function normalizeItems(items: WeeklyOrderItem[]): EditableItem[] {
  return items.map((item) => ({
    id: item.id,
    productName: item.productName,
    unitsOnHand: item.unitsOnHand ? String(item.unitsOnHand) : "",
    unitsToOrder: item.unitsToOrder ? String(item.unitsToOrder) : "",
  }));
}

export default function WeeklyOrdersPanel({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<OrderPeriod>("weekly");
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [selectedStore, setSelectedStore] = useState(user.storeNumber ?? "");
  const [periodStart, setPeriodStart] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [vendors, setVendors] = useState<OrderVendor[]>([]);
  const [vendorDirectory, setVendorDirectory] = useState<OrderVendorDirectory[]>([]);
  const [selectedDirectoryVendor, setSelectedDirectoryVendor] = useState("");
  const [orders, setOrders] = useState<WeeklyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [savingDirectoryVendor, setSavingDirectoryVendor] = useState(false);
  const [vendorModal, setVendorModal] = useState<VendorModalState | null>(null);
  const [orderModal, setOrderModal] = useState<OrderModalState | null>(null);

  const [storeVendorRep, setStoreVendorRep] = useState("");
  const [storeVendorContact, setStoreVendorContact] = useState("");
  const [storeVendorEmail, setStoreVendorEmail] = useState("");

  const storeOptions = useMemo(() => stores, [stores]);
  const ordersByVendor = useMemo(() => {
    const map = new Map<string, WeeklyOrder>();
    orders.forEach((order) => map.set(order.vendorId, order));
    return map;
  }, [orders]);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        const nextStores: StoreSummary[] = Array.isArray(data.stores)
          ? data.stores
          : [];
        setStores(nextStores);
        setSelectedStore((prev) =>
          nextStores.some((store) => store.storeId === prev)
            ? prev
            : nextStores[0]?.storeId ?? prev,
        );
      } catch (error) {
        console.error("Failed to load stores", error);
      }
    };
    loadStores();
  }, []);

  const loadOrders = async () => {
    if (!selectedStore) return;
    setLoading(true);
    setMessage(null);
    try {
      const directoryResponse = await fetch("/api/orders/vendor-directory", {
        cache: "no-store",
      });
      const directoryData = await directoryResponse.json().catch(() => ({}));
      setVendorDirectory(
        Array.isArray(directoryData.vendors) ? directoryData.vendors : [],
      );

      const vendorResponse = await fetch(
        `/api/orders/vendors?storeId=${encodeURIComponent(selectedStore)}`,
        { cache: "no-store" },
      );
      const vendorData = await vendorResponse.json().catch(() => ({}));
      setVendors(Array.isArray(vendorData.vendors) ? vendorData.vendors : []);

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
    } catch (error) {
      console.error("Failed to load orders", error);
      setOrders([]);
      setMessage(error instanceof Error ? error.message : "Unable to load orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [selectedStore, activeTab, periodStart]);

  const handleAddDirectoryVendor = async () => {
    if (!selectedStore) {
      setMessage("Select a store before adding a vendor.");
      return;
    }
    if (!selectedDirectoryVendor) return;
    setSavingDirectoryVendor(true);
    setMessage(null);
    const response = await fetch("/api/orders/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStore,
        directoryVendorId: selectedDirectoryVendor,
        repName: storeVendorRep.trim() || undefined,
        contact: storeVendorContact.trim() || undefined,
        email: storeVendorEmail.trim() || undefined,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data?.error ?? "Unable to add vendor.");
      setSavingDirectoryVendor(false);
      return;
    }
    setSelectedDirectoryVendor("");
    setStoreVendorRep("");
    setStoreVendorContact("");
    setStoreVendorEmail("");
    await loadOrders();
    setSavingDirectoryVendor(false);
  };

  const openOrder = (vendor: OrderVendor) => {
    const order = ordersByVendor.get(vendor.id) ?? null;
    setOrderModal({ vendor, order });
  };

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-slate-300">
          Vendor Orders
        </h2>
        <div className="ui-tabs">
          <button
            type="button"
            onClick={() => setActiveTab("weekly")}
            className={`ui-tab ${activeTab === "weekly" ? "ui-tab--active" : ""}`}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("monthly")}
            className={`ui-tab ${activeTab === "monthly" ? "ui-tab--active" : ""}`}
          >
            Monthly
          </button>
        </div>
      </div>

      <div className="reports-filter-row mb-4">
        <select
          className="ui-field--slim min-w-[160px]"
          value={selectedStore}
          onChange={(event) => setSelectedStore(event.target.value)}
        >
          {storeOptions.map((store) => (
            <option key={store.storeId} value={store.storeId}>
              {formatStoreLabel(store)}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="ui-field--slim"
          value={periodStart}
          onChange={(event) => setPeriodStart(event.target.value)}
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
          Add vendor from directory
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="ui-field--slim min-w-[220px]"
            value={selectedDirectoryVendor}
            onChange={(event) => setSelectedDirectoryVendor(event.target.value)}
          >
            <option value="">Add from directory…</option>
            {vendorDirectory.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ui-button--slim border border-white/20 text-white"
            onClick={handleAddDirectoryVendor}
            disabled={!selectedDirectoryVendor || savingDirectoryVendor}
          >
            {savingDirectoryVendor ? "Adding..." : "Add to store"}
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            className="ui-field"
            placeholder="Rep name (optional)"
            value={storeVendorRep}
            onChange={(event) => setStoreVendorRep(event.target.value)}
          />
          <input
            className="ui-field"
            placeholder="Contact (optional)"
            value={storeVendorContact}
            onChange={(event) => setStoreVendorContact(event.target.value)}
          />
          <input
            className="ui-field"
            placeholder="Email (optional)"
            value={storeVendorEmail}
            onChange={(event) => setStoreVendorEmail(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
            Loading vendors…
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
          vendors.map((vendor) => {
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="ui-button--slim border border-white/20 text-white"
                      onClick={() => setVendorModal({ vendor })}
                      aria-label="Edit vendor"
                    >
                      ⚙
                    </button>
                    <button
                      type="button"
                      className="ui-button--slim border border-white/20 text-white"
                      onClick={() => openOrder(vendor)}
                    >
                      {order ? "Edit Order" : "Create Order"}
                    </button>
                  </div>
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
          })
        )}
      </div>

      {vendorModal ? (
        <VendorEditModal
          vendor={vendorModal.vendor}
          onClose={() => setVendorModal(null)}
          onSaved={loadOrders}
        />
      ) : null}
      {orderModal ? (
        <OrderEditorModal
          state={orderModal}
          onClose={() => setOrderModal(null)}
          onSaved={loadOrders}
          user={user}
          periodStart={periodStart}
          periodType={activeTab}
          storeId={selectedStore}
        />
      ) : null}
    </section>
  );
}

function VendorEditModal({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: OrderVendor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rep, setRep] = useState(vendor.repName ?? "");
  const [contact, setContact] = useState(vendor.contact ?? "");
  const [email, setEmail] = useState(vendor.email ?? "");

  const handleSave = async () => {
    await fetch("/api/orders/vendors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: vendor.id,
        repName: rep,
        contact,
        email,
      }),
    });
    await onSaved();
    onClose();
  };

  const handleDelete = async () => {
    await fetch(`/api/orders/vendors?id=${vendor.id}`, { method: "DELETE" });
    await onSaved();
    onClose();
  };

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose={false}>
      <div className="flex flex-col gap-4 text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Vendor Settings
          </p>
          <h3 className="text-lg font-semibold text-slate-50">{vendor.name}</h3>
        </div>
        <input
          className="ui-field"
          value={rep}
          onChange={(event) => setRep(event.target.value)}
          placeholder="Rep name"
        />
        <input
          className="ui-field"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="Contact"
        />
        <input
          className="ui-field"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100"
            onClick={handleDelete}
          >
            Delete
          </button>
          <button
            type="button"
            className="rounded-full border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </IHModal>
  );
}

function OrderEditorModal({
  state,
  onClose,
  onSaved,
  user,
  periodStart,
  periodType,
  storeId,
}: {
  state: OrderModalState;
  onClose: () => void;
  onSaved: () => void;
  user: SessionUser;
  periodStart: string;
  periodType: OrderPeriod;
  storeId: string;
}) {
  const [items, setItems] = useState<EditableItem[]>(() =>
    state.order ? normalizeItems(state.order.items) : [],
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestionRow, setActiveSuggestionRow] = useState<string | null>(
    null,
  );
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [note, setNote] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const orderId = state.order?.id ?? null;

  useEffect(() => {
    if (!orderId) return;
    let mounted = true;
    const loadMessages = async () => {
      setLoadingMessages(true);
      try {
        const response = await fetch(
          `/api/orders/messages?orderId=${orderId}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (mounted) {
          setMessages(Array.isArray(data.messages) ? data.messages : []);
        }
      } finally {
        if (mounted) setLoadingMessages(false);
      }
    };
    loadMessages();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  useEffect(() => {
    let mounted = true;
    const loadSuggestions = async () => {
      const params = new URLSearchParams();
      if (state.vendor.directoryVendorId) {
        params.set("directoryVendorId", state.vendor.directoryVendorId);
      }
      params.set("vendorId", state.vendor.id);
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
  }, [state.vendor.directoryVendorId]);

  const updateItem = (
    index: number,
    key: keyof EditableItem,
    value: string,
  ) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              [key]: value,
            }
          : item,
      ),
    );
  };

  const selectSuggestion = (rowId: string, value: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === rowId ? { ...item, productName: value } : item,
      ),
    );
    setActiveSuggestionRow(null);
    setSuggestionQuery("");
  };

  const addItem = () => {
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [
      ...prev,
      {
        id: tempId,
        productName: "",
        unitsOnHand: "",
        unitsToOrder: "",
      },
    ]);
  };

  const handleSubmit = async () => {
    const cleanedItems = items
      .map((item) => ({
        productName: item.productName.trim(),
        unitsOnHand: Number(item.unitsOnHand || 0),
        unitsToOrder: Number(item.unitsToOrder || 0),
      }))
      .filter((item) => item.productName);
    await fetch("/api/orders/weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        vendorId: state.vendor.id,
        periodType,
        periodStart,
        items: cleanedItems,
      }),
    });
    await onSaved();
    onClose();
  };

  const handleMessage = async () => {
    if (!note.trim() || !orderId) return;
    const message = note.trim();
    setNote("");
    await fetch("/api/orders/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, message }),
    });
    const response = await fetch(`/api/orders/messages?orderId=${orderId}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    setMessages(Array.isArray(data.messages) ? data.messages : []);
  };

  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose={false}>
      <div className="flex max-h-[82vh] flex-col text-white">
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            {periodLabel[periodType]} Order
          </p>
          <h3 className="text-xl font-semibold text-slate-50">
            {state.vendor.name}
          </h3>
          <p className="text-sm text-slate-400">
            {storeId} · {formatShortDate(periodStart)}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
              <span>Order Items</span>
            </div>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-3 sm:grid-cols-[1.4fr_0.8fr_0.8fr]"
                >
                  <div className="relative">
                    <input
                      className="ui-field"
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
                    className="ui-field"
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
                  />
                  <input
                    className="ui-field"
                    type="text"
                    inputMode="numeric"
                    placeholder="Order qty"
                    value={item.unitsToOrder}
                    onChange={(event) =>
                      updateItem(
                        idx,
                        "unitsToOrder",
                        event.target.value.replace(/[^\d]/g, ""),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="ui-button--slim border border-white/20 text-white"
                onClick={addItem}
              >
                Add item
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Conversation
            </p>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {!orderId ? (
                <p className="text-xs text-slate-400">
                  Submit the order to enable messaging.
                </p>
              ) : loadingMessages ? (
                <p className="text-xs text-slate-400">Loading messages…</p>
              ) : messages.length ? (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-xl border border-white/10 px-3 py-2 text-xs ${
                      msg.senderRole === "manager"
                        ? "bg-blue-500/10 text-blue-100"
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
                placeholder="Add a message for the owner…"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={!orderId}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="ui-button--slim border border-white/20 text-white"
                  onClick={handleMessage}
                  disabled={!orderId}
                >
                  Send Message
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            className="rounded-full border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100"
            onClick={handleSubmit}
          >
            Send to Owner
          </button>
        </div>
      </div>
    </IHModal>
  );
}
