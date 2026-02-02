"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { ScratcherProduct, ScratcherSlot } from "@/lib/types";

interface SlotBundle {
  slots: ScratcherSlot[];
  packs: Array<{ id: string; slotId: string; productId: string; status: string; activationReceiptFileId?: string | null }>;
  products: ScratcherProduct[];
}

type BaselineSnapshot = {
  id: string;
  createdAt: string;
};

export default function ScratchersAdminPanel({
  storeId,
  isOpen,
  onClose,
  onRefresh,
}: {
  storeId: string;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const [bundle, setBundle] = useState<SlotBundle | null>(null);
  const [products, setProducts] = useState<ScratcherProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [slotDrafts, setSlotDrafts] = useState<Record<string, { label: string; isActive: boolean; defaultProductId: string }>>({});
  const [baselineItems, setBaselineItems] = useState<Record<string, string>>({});
  const [baselineOriginal, setBaselineOriginal] = useState<Record<string, string>>({});
  const [baselineSnapshot, setBaselineSnapshot] = useState<BaselineSnapshot | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [baselineDirty, setBaselineDirty] = useState(false);
  const [showInactiveSlots, setShowInactiveSlots] = useState(false);
  const baselineDirtyRef = useRef(false);

  const loadBundle = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [slotsRes, productsRes, baselineRes] = await Promise.all([
        fetch(`/api/scratchers/slots?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
        fetch("/api/scratchers/products", { cache: "no-store" }),
        fetch(`/api/scratchers/snapshots/baseline?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
      ]);
      const slotsData = await slotsRes.json().catch(() => ({}));
      const productsData = await productsRes.json().catch(() => ({}));
      const baselineData = await baselineRes.json().catch(() => ({}));
      setBundle({
        slots: Array.isArray(slotsData.slots) ? slotsData.slots : [],
        packs: Array.isArray(slotsData.packs) ? slotsData.packs : [],
        products: Array.isArray(slotsData.products) ? slotsData.products : [],
      });
      setProducts(
        Array.isArray(productsData.products) ? productsData.products : [],
      );
      if (!baselineDirtyRef.current) {
        const items = Array.isArray(baselineData.items) ? baselineData.items : [];
        const nextItems: Record<string, string> = {};
        items.forEach((item: { slotId?: string; ticketValue?: string }) => {
          if (item?.slotId) {
            nextItems[String(item.slotId)] = String(item.ticketValue ?? "");
          }
        });
        setBaselineItems(nextItems);
        setBaselineOriginal(nextItems);
        setBaselineSnapshot(
          baselineData.snapshot
            ? { id: baselineData.snapshot.id, createdAt: baselineData.snapshot.createdAt }
            : null,
        );
      }
    } catch (error) {
      console.error("Failed to load scratcher admin data", error);
      setNotice("Unable to load scratcher setup data.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (!isOpen) return;
    loadBundle();
  }, [isOpen, loadBundle]);

  useEffect(() => {
    if (!bundle?.slots?.length) return;
    setSlotDrafts((prev) => {
      const next = { ...prev };
      bundle.slots.forEach((slot) => {
        if (!next[slot.id]) {
          next[slot.id] = {
            label: slot.label ?? "",
            isActive: slot.isActive,
            defaultProductId: slot.defaultProductId ?? "",
          };
        }
      });
      return next;
    });
  }, [bundle?.slots]);

  useEffect(() => {
    baselineDirtyRef.current = baselineDirty;
  }, [baselineDirty]);

  useEffect(() => {
    if (isOpen) return;
    setBaselineItems({});
    setBaselineOriginal({});
    setBaselineSnapshot(null);
    setBaselineDirty(false);
    setNotice(null);
    setSlotDrafts({});
  }, [isOpen]);

  const priceOptions = useMemo(() => {
    const byPrice = new Map<number, ScratcherProduct>();
    (products ?? [])
      .filter((product) => product.isActive)
      .forEach((product) => {
        if (!byPrice.has(product.price)) {
          byPrice.set(product.price, product);
        }
      });
    return Array.from(byPrice.values()).sort((a, b) => a.price - b.price);
  }, [products]);

  const handleSlotUpdate = async (
    slotId: string,
    updates: { label?: string; isActive?: boolean; defaultProductId?: string | null },
  ) => {
    const response = await fetch("/api/scratchers/slots/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId, ...updates }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to update slot.");
      return;
    }
    await loadBundle();
    onRefresh?.();
  };

  const handleSlotAdd = async () => {
    const response = await fetch("/api/scratchers/slots/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to add slot.");
      return;
    }
    await loadBundle();
    onRefresh?.();
  };

  const handleSlotSave = async (slotId: string) => {
    const draft = slotDrafts[slotId];
    if (!draft) return;
    await handleSlotUpdate(slotId, {
      label: draft.label.trim(),
      isActive: draft.isActive,
      defaultProductId: draft.defaultProductId || null,
    });
  };

  const handleInitSlots = async () => {
    const response = await fetch("/api/scratchers/slots/init32", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to initialize slots.");
      return;
    }
    await loadBundle();
    onRefresh?.();
  };

  const handleBaselineSave = async () => {
    if (!storeId) return;
    const slots = (bundle?.slots ?? []).filter((slot) =>
      showInactiveSlots ? true : slot.isActive,
    );
    const requiredSlots = (bundle?.slots ?? []).filter((slot) => slot.isActive);
    const missingRequired = requiredSlots.filter(
      (slot) => !baselineItems[slot.id]?.trim(),
    );
    if (missingRequired.length > 0) {
      setNotice("Enter a start ticket for every active slot before saving.");
      return;
    }

    const payloadItems = slots
      .map((slot) => ({
        slotId: slot.id,
        ticketValue: baselineItems[slot.id]?.trim() ?? "",
      }))
      .filter((item) => item.ticketValue.length > 0);

    if (payloadItems.length === 0) {
      setNotice("Provide at least one baseline ticket value.");
      return;
    }

    setBaselineLoading(true);
    setNotice(null);
    const response = await fetch("/api/scratchers/snapshots/baseline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, items: payloadItems }),
    });
    const data = await response.json().catch(() => ({}));
    setBaselineLoading(false);
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to save baseline snapshot.");
      return;
    }
    setBaselineDirty(false);
    await loadBundle();
    onRefresh?.();
  };

  const activeSlots = bundle?.slots ?? [];
  const headerTitle = "Slot Management";

  return (
    <IHModal
      isOpen={isOpen}
      onClose={onClose}
      allowOutsideClose
      panelClassName="max-w-4xl bg-gradient-to-br from-[#101f3f] via-[#0f1a33] to-[#0b1326]"
    >
      <div className="flex max-h-[82vh] flex-col gap-4 rounded-[26px] border border-white/10 bg-[#0f1a33]/80 p-5 shadow-[0_24px_60px_rgba(2,8,24,0.55)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="pr-16">
            <p className="text-[0.65rem] uppercase tracking-[0.4em] text-slate-300">
              Scratchers setup
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              {headerTitle}
            </h3>
            <p className="mt-1 text-xs text-slate-300">
              Maintain catalog, slots, and the baseline start snapshot used to audit shifts.
            </p>
          </div>
          <div className="pr-6 text-xs uppercase tracking-[0.35em] text-slate-400">
            Owner & Manager
          </div>
        </div>

        {notice && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-slate-300">Loading scratcher setup…</div>
        ) : (
          <div className="space-y-3 overflow-y-auto pr-2">
            <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                    Slots overview
                  </p>
                  <p className="mt-2 text-sm text-slate-200">
                    Each slot keeps its label, price, active status, and baseline start ticket.
                  </p>
                  {baselineSnapshot && (
                    <p className="mt-1 text-xs text-slate-400">
                      Baseline last saved {new Date(baselineSnapshot.createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={showInactiveSlots}
                    onChange={(event) => setShowInactiveSlots(event.target.checked)}
                  />
                  Show inactive slots
                </label>
              </div>
            </div>

            {(activeSlots.filter((slot) =>
              showInactiveSlots ? true : slot.isActive,
            )).map((slot) => {
              const draft = slotDrafts[slot.id] ?? {
                label: slot.label ?? "",
                isActive: slot.isActive,
                defaultProductId: slot.defaultProductId ?? "",
              };
              const baselineValue = baselineItems[slot.id] ?? "";
              const baselineChanged =
                baselineValue !== (baselineOriginal[slot.id] ?? "");
              return (
                <div
                  key={slot.id}
                  className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Slot {slot.slotNumber}
                      </p>
                      <p className="text-xs text-slate-300">
                        {draft.isActive ? "Active" : "Inactive"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[0.65rem] uppercase tracking-[0.3em] ${
                        draft.isActive ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-slate-300"
                      }`}
                    >
                      {draft.isActive ? "active" : "inactive"}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[2fr,1fr]">
                    <input
                      value={draft.label}
                      onChange={(event) =>
                        setSlotDrafts((prev) => ({
                          ...prev,
                          [slot.id]: {
                            ...draft,
                            label: event.target.value,
                          },
                        }))
                      }
                      placeholder="Name"
                      className="ui-field"
                    />
                    <select
                      value={draft.defaultProductId}
                      onChange={(event) =>
                        setSlotDrafts((prev) => ({
                          ...prev,
                          [slot.id]: {
                            ...draft,
                            defaultProductId: event.target.value,
                          },
                        }))
                      }
                      className="ui-field"
                    >
                      <option value="">Select price</option>
                      {priceOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          ${option.price}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr,auto]">
                    <input
                      value={baselineValue}
                      onChange={(event) => {
                        setBaselineItems((prev) => ({
                          ...prev,
                          [slot.id]: event.target.value,
                        }));
                        setBaselineDirty(true);
                      }}
                      placeholder="Baseline start ticket"
                      className="ui-field"
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      className={`ui-button ${baselineChanged ? "ui-button-primary" : "ui-button-ghost"}`}
                      onClick={handleBaselineSave}
                      disabled={!baselineChanged || baselineLoading}
                    >
                      {baselineLoading ? "Saving..." : "Confirm"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(event) =>
                          setSlotDrafts((prev) => ({
                            ...prev,
                            [slot.id]: {
                              ...draft,
                              isActive: event.target.checked,
                            },
                          }))
                        }
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      className="ui-button ui-button-ghost"
                      onClick={() => handleSlotSave(slot.id)}
                    >
                      Save slot
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
              <div className="text-xs text-slate-300">
                Add slots as new scratcher columns.
              </div>
              <div className="flex gap-2">
                {!activeSlots.length && (
                  <button type="button" className="ui-button" onClick={handleInitSlots}>
                    Init 32
                  </button>
                )}
                <button type="button" className="ui-button ui-button-primary" onClick={handleSlotAdd}>
                  Add slot
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </IHModal>
  );
}
