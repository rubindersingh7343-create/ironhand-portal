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
  const [priceConfirmations, setPriceConfirmations] = useState<Record<string, boolean>>({});
  const [baselineItems, setBaselineItems] = useState<Record<string, string>>({});
  const [baselineOriginal, setBaselineOriginal] = useState<Record<string, string>>({});
  const [baselineSnapshot, setBaselineSnapshot] = useState<BaselineSnapshot | null>(null);
  const [addingPrice, setAddingPrice] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", price: "" });
  const [savingAllSlots, setSavingAllSlots] = useState(false);
  const baselineDirtyRef = useRef(false);

  const isSlotBlank = useCallback(
    (draft: { label: string; defaultProductId: string }, baselineValue: string) =>
      !draft.label.trim() &&
      !(draft.defaultProductId || "").trim() &&
      !baselineValue.trim(),
    [],
  );

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
    setPriceConfirmations((prev) => {
      const next = { ...prev };
      bundle.slots.forEach((slot) => {
        if (!(slot.id in next)) {
          next[slot.id] = true;
        }
      });
      return next;
    });
  }, [bundle?.slots]);

  useEffect(() => {
    if (isOpen) return;
    setBaselineItems({});
    setBaselineOriginal({});
    setBaselineSnapshot(null);
    baselineDirtyRef.current = false;
    setNotice(null);
    setSlotDrafts({});
    setPriceConfirmations({});
    setAddingPrice(false);
    setNewProduct({ name: "", price: "" });
  }, [isOpen]);

  const priceOptions = useMemo(() => {
    const byPrice = new Map<number, ScratcherProduct>();
    (products ?? [])
      .filter((product) => product.isActive && product.price > 0)
      .forEach((product) => {
        if (!byPrice.has(product.price)) {
          byPrice.set(product.price, product);
        }
      });
    return Array.from(byPrice.values()).sort((a, b) => a.price - b.price);
  }, [products]);

  const updateSlot = async (
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
      return false;
    }
    return true;
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

  const dirtySlots = useMemo(() => {
    if (!bundle?.slots?.length) return [];
    return bundle.slots.filter((slot) => {
      const draft = slotDrafts[slot.id];
      if (!draft) return false;
      const label = draft.label.trim();
      const defaultProductId = draft.defaultProductId || "";
      const slotLabel = slot.label ?? "";
      const slotProductId = slot.defaultProductId ?? "";
      return (
        label !== slotLabel ||
        draft.isActive !== slot.isActive ||
        defaultProductId !== slotProductId
      );
    });
  }, [bundle?.slots, slotDrafts]);

  const baselineDirty = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(baselineItems),
      ...Object.keys(baselineOriginal),
    ]);
    for (const key of allKeys) {
      if ((baselineItems[key] ?? "") !== (baselineOriginal[key] ?? "")) {
        return true;
      }
    }
    return false;
  }, [baselineItems, baselineOriginal]);

  const handleSaveAllSlots = async () => {
    if (!dirtySlots.length && !baselineDirty) return;
    setSavingAllSlots(true);
    setNotice(null);
    const unconfirmed = dirtySlots.filter((slot) => {
      const originalProductId = slot.defaultProductId ?? "";
      const draft = slotDrafts[slot.id];
      if (!draft) return false;
      const draftProductId = draft.defaultProductId || "";
      if (draftProductId === originalProductId) return false;
      return priceConfirmations[slot.id] === false;
    });
    if (unconfirmed.length > 0) {
      setSavingAllSlots(false);
      setNotice("Confirm price changes before saving.");
      return;
    }
    if (baselineDirty) {
      const requiredSlots = (bundle?.slots ?? []).filter((slot) => slot.isActive);
      const missingRequired = requiredSlots.filter(
        (slot) => !baselineItems[slot.id]?.trim(),
      );
      if (missingRequired.length > 0) {
        setSavingAllSlots(false);
        setNotice("Enter a baseline start ticket for every active slot.");
        return;
      }
    }

    const results = await Promise.all(
      dirtySlots.map((slot) => {
        const draft = slotDrafts[slot.id];
        if (!draft) return Promise.resolve(true);
        return updateSlot(slot.id, {
          label: draft.label.trim(),
          isActive: draft.isActive,
          defaultProductId: draft.defaultProductId || null,
        });
      }),
    );
    if (baselineDirty) {
      const slots = bundle?.slots ?? [];
      const payloadItems = slots
        .map((slot) => ({
          slotId: slot.id,
          ticketValue: baselineItems[slot.id]?.trim() ?? "",
        }))
        .filter((item) => item.ticketValue.length > 0);
      const baselineResponse = await fetch("/api/scratchers/snapshots/baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, items: payloadItems }),
      });
      const baselineData = await baselineResponse.json().catch(() => ({}));
      if (!baselineResponse.ok) {
        setSavingAllSlots(false);
        setNotice(baselineData?.error ?? "Unable to save baseline snapshot.");
        return;
      }
      baselineDirtyRef.current = false;
    }
    setSavingAllSlots(false);
    if (results.some((ok) => !ok)) {
      setNotice("Some slots did not save. Please try again.");
      return;
    }
    await loadBundle();
    onRefresh?.();
  };

  const handleAddPrice = async () => {
    const priceValue = Number(newProduct.price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      setNotice("Enter a valid price greater than 0.");
      return;
    }
    const response = await fetch("/api/scratchers/products/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newProduct.name.trim() || null,
        price: priceValue,
        isActive: true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to add price.");
      return;
    }
    setNewProduct({ name: "", price: "" });
    setAddingPrice(false);
    await loadBundle();
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
          <>
            <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-2">
              {baselineSnapshot && (
                <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-2 text-xs text-slate-300">
                  Baseline last saved {new Date(baselineSnapshot.createdAt).toLocaleString()}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">
                  Slot setup
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeSlots.length < 32 && (
                    <button type="button" className="ui-button" onClick={handleInitSlots}>
                      Init 32
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-button"
                    onClick={() => setAddingPrice((prev) => !prev)}
                  >
                    {addingPrice ? "Cancel price" : "Add price"}
                  </button>
                </div>
              </div>

              {addingPrice && (
                <div className="rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                    New price
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[2fr,1fr,auto]">
                    <input
                      value={newProduct.name}
                      onChange={(event) =>
                        setNewProduct((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Name (optional)"
                      className="ui-field"
                    />
                    <input
                      value={newProduct.price}
                      onChange={(event) =>
                        setNewProduct((prev) => ({ ...prev, price: event.target.value }))
                      }
                      placeholder="Price"
                      inputMode="decimal"
                      className="ui-field"
                    />
                    <button type="button" className="ui-button" onClick={handleAddPrice}>
                      Save
                    </button>
                  </div>
                </div>
              )}

              {activeSlots.map((slot) => {
                const draft = slotDrafts[slot.id] ?? {
                  label: slot.label ?? "",
                  isActive: slot.isActive,
                  defaultProductId: slot.defaultProductId ?? "",
                };
                const baselineValue = baselineItems[slot.id] ?? "";
                const originalProductId = slot.defaultProductId ?? "";
                const priceChanged = (draft.defaultProductId || "") !== originalProductId;
                const priceConfirmed = priceConfirmations[slot.id] ?? true;
                const needsConfirm = priceChanged && !priceConfirmed;
                const slotIsBlank = isSlotBlank(draft, baselineValue);
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

                    <div className="mt-4 grid gap-3">
                      <input
                        value={draft.label}
                        onChange={(event) =>
                          setSlotDrafts((prev) => {
                            const current = prev[slot.id] ?? draft;
                            const next = {
                              ...prev,
                              [slot.id]: {
                                ...current,
                                label: event.target.value,
                              },
                            };
                            const nextDraft = next[slot.id];
                            if (isSlotBlank(nextDraft, baselineItems[slot.id] ?? "")) {
                              next[slot.id] = { ...nextDraft, isActive: false };
                            }
                            return next;
                          })
                        }
                        placeholder="Name (optional)"
                        className="ui-field"
                      />
                      <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                        <select
                          value={draft.defaultProductId}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSlotDrafts((prev) => {
                              const current = prev[slot.id] ?? draft;
                              const next = {
                                ...prev,
                                [slot.id]: {
                                  ...current,
                                  defaultProductId: nextValue,
                                },
                              };
                              const nextDraft = next[slot.id];
                              if (isSlotBlank(nextDraft, baselineItems[slot.id] ?? "")) {
                                next[slot.id] = { ...nextDraft, isActive: false };
                              }
                              return next;
                            });
                            setPriceConfirmations((prev) => ({
                              ...prev,
                              [slot.id]: nextValue === originalProductId,
                            }));
                          }}
                          className="ui-field"
                        >
                          <option value="">Select price</option>
                          {priceOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              ${option.price}
                            </option>
                          ))}
                        </select>
                        {priceChanged && (
                          <button
                            type="button"
                            className={`ui-button ${needsConfirm ? "ui-button-primary" : "ui-button-ghost"}`}
                            onClick={() =>
                              setPriceConfirmations((prev) => ({
                                ...prev,
                                [slot.id]: true,
                              }))
                            }
                          >
                            {needsConfirm ? "Confirm price" : "Price confirmed"}
                          </button>
                        )}
                      </div>
                      <input
                        value={baselineValue}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setBaselineItems((prev) => ({
                            ...prev,
                            [slot.id]: nextValue,
                          }));
                          setSlotDrafts((prev) => {
                            const current = prev[slot.id] ?? draft;
                            if (isSlotBlank(current, nextValue)) {
                              return {
                                ...prev,
                                [slot.id]: {
                                  ...current,
                                  isActive: false,
                                },
                              };
                            }
                            return prev;
                          });
                          baselineDirtyRef.current = true;
                        }}
                        placeholder="Baseline start ticket"
                        className="ui-field"
                        inputMode="numeric"
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={draft.isActive}
                          onChange={(event) =>
                            setSlotDrafts((prev) => {
                              const current = prev[slot.id] ?? draft;
                              const nextActive =
                                event.target.checked && !slotIsBlank;
                              return {
                                ...prev,
                                [slot.id]: {
                                  ...current,
                                  isActive: nextActive,
                                },
                              };
                            })
                          }
                        />
                        Active
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0b142b]/90 px-4 py-3 shadow-[0_-12px_30px_rgba(4,10,24,0.55)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-200">
                <span>
                  {dirtySlots.length || baselineDirty
                    ? `${dirtySlots.length} slot${dirtySlots.length === 1 ? "" : "s"} with changes`
                    : "All slot changes saved"}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="ui-button" onClick={handleSlotAdd}>
                    Add slot
                  </button>
                  <button
                    type="button"
                    className={`ui-button ${dirtySlots.length || baselineDirty ? "ui-button-primary" : "ui-button-ghost"}`}
                    onClick={handleSaveAllSlots}
                    disabled={(!dirtySlots.length && !baselineDirty) || savingAllSlots}
                  >
                    {savingAllSlots ? "Saving..." : "Save setup"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </IHModal>
  );
}
