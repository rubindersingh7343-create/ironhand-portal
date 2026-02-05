"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type {
  ScratcherPackEvent,
  ScratcherProduct,
  ScratcherShiftSnapshot,
  ScratcherShiftSnapshotItem,
  ScratcherSlot,
  SessionUser,
  StoredFile,
} from "@/lib/types";
import ScratchersLogbookModal from "@/components/scratchers/ScratchersLogbookModal";
import FileViewer from "@/components/records/FileViewer";

interface SlotBundle {
  slots: ScratcherSlot[];
  packs: Array<{ id: string; slotId: string; productId: string; status: string }>;
  products: ScratcherProduct[];
  baseline?: {
    snapshot: ScratcherShiftSnapshot;
    items: ScratcherShiftSnapshotItem[];
  } | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function EmployeeScratchersPanel({ user }: { user: SessionUser }) {
  const [bundle, setBundle] = useState<SlotBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ScratcherPackEvent[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [shiftReportId, setShiftReportId] = useState<string | null>(null);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationSlotId, setActivationSlotId] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnPackId, setReturnPackId] = useState<string | null>(null);
  const [returnReceipt, setReturnReceipt] = useState<File | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [logbookOpen, setLogbookOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventPackId, setEventPackId] = useState<string | null>(null);
  const [eventType, setEventType] = useState<"note" | "return_receipt">("note");
  const [eventNote, setEventNote] = useState("");
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);
  const [endValues, setEndValues] = useState<Record<string, string>>({});
  const [activationData, setActivationData] = useState({
    productId: "",
    packCode: "",
    startTicket: "",
    receipt: null as File | null,
  });
  const [rolloverSlots, setRolloverSlots] = useState<
    Array<{ slotId: string; slotNumber: number }>
  >([]);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBundle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/scratchers/slots?store_id=${encodeURIComponent(user.storeNumber)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load scratchers.");
      }
      setBundle({
        slots: Array.isArray(data.slots) ? data.slots : [],
        packs: Array.isArray(data.packs) ? data.packs : [],
        products: Array.isArray(data.products) ? data.products : [],
        baseline: data.baseline ?? null,
      });
      const eventsRes = await fetch(
        `/api/scratchers/packs/events?store_id=${encodeURIComponent(user.storeNumber)}`,
        { cache: "no-store" },
      );
      const eventsData = await eventsRes.json().catch(() => ({}));
      setEvents(Array.isArray(eventsData.events) ? eventsData.events : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load scratchers.",
      );
    } finally {
      setLoading(false);
    }
  }, [user.storeNumber]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  const productMap = useMemo(
    () => new Map((bundle?.products ?? []).map((item) => [item.id, item])),
    [bundle?.products],
  );
  const packMap = useMemo(
    () => new Map((bundle?.packs ?? []).map((pack) => [pack.id, pack])),
    [bundle?.packs],
  );
  const baselineMap = useMemo(
    () =>
      new Map(
        (bundle?.baseline?.items ?? []).map((item) => [item.slotId, item]),
      ),
    [bundle?.baseline?.items],
  );

  const visibleSlots = useMemo(() => {
    const slots = bundle?.slots ?? [];
    return showInactive ? slots : slots.filter((slot) => slot.isActive);
  }, [bundle?.slots, showInactive]);

  const openActivationForSlot = (slotId: string) => {
    const slot = bundle?.slots?.find((entry) => entry.id === slotId);
    const defaultProductId = slot?.defaultProductId ?? "";
    setActivationSlotId(slotId);
    setActivationData({
      productId: defaultProductId,
      packCode: "",
      startTicket: "",
      receipt: null,
    });
    setActivationOpen(true);
  };

  const openReturnForPack = (packId: string) => {
    setReturnPackId(packId);
    setReturnReceipt(null);
    setReturnNote("");
    setReturnOpen(true);
  };

  const handleSnapshotSubmit = async (
    type: "start" | "end",
    values: Record<string, string>,
  ) => {
    setNotice(null);
    const items = visibleSlots
      .map((slot) => ({
        slotId: slot.id,
        ticketValue: values[slot.id] ?? "",
      }))
      .filter((item) => item.ticketValue.trim().length > 0);

    if (!items.length) {
      setNotice("Enter ticket numbers for at least one slot.");
      return;
    }

    const response = await fetch(`/api/scratchers/snapshots/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: user.storeNumber,
        date: todayIso(),
        items,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data?.rolloverSlots && Array.isArray(data.rolloverSlots)) {
        setRolloverSlots(data.rolloverSlots);
        setNotice(
          "Pack rollover detected. Activate a new pack for the flagged slots.",
        );
      } else {
        setNotice(data?.error ?? "Unable to save snapshot.");
      }
      return;
    }

    if (data?.shiftReportId) {
      setShiftReportId(data.shiftReportId);
    }
    setNotice(type === "start" ? "Start snapshot saved." : "End snapshot saved.");
    setRolloverSlots([]);
    await loadBundle();
  };

  const handleActivatePack = async () => {
    if (!activationSlotId) return;
    if (!activationData.productId) {
      setNotice("Select a scratcher product.");
      return;
    }
    if (!activationData.packCode.trim()) {
      setNotice("Pack code is required.");
      return;
    }
    if (!activationData.startTicket) {
      setNotice("Enter the pack start ticket number.");
      return;
    }
    if (!activationData.receipt) {
      setNotice("Activation receipt photo is required.");
      return;
    }

    const formData = new FormData();
    formData.append("storeId", user.storeNumber);
    formData.append("slotId", activationSlotId);
    formData.append("productId", activationData.productId);
    formData.append("packCode", activationData.packCode);
    formData.append("startTicket", activationData.startTicket);
    formData.append("receipt", activationData.receipt);

    const response = await fetch("/api/scratchers/packs/activate", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to activate pack.");
      return;
    }

    setNotice("Pack activated.");
    setActivationOpen(false);
    setRolloverSlots((prev) => prev.filter((slot) => slot.slotId !== activationSlotId));
    await loadBundle();
  };

  const handleReturnPack = async () => {
    if (!returnPackId) return;
    if (!returnReceipt) {
      setNotice("Return receipt photo is required.");
      return;
    }
    const formData = new FormData();
    formData.append("storeId", user.storeNumber);
    formData.append("packId", returnPackId);
    formData.append("note", returnNote);
    formData.append("receipt", returnReceipt);
    const response = await fetch("/api/scratchers/packs/return", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to return pack.");
      return;
    }
    setNotice("Pack returned.");
    setReturnOpen(false);
    await loadBundle();
  };

  const openReceipt = useCallback(async (fileId?: string | null) => {
    if (!fileId) return;
    const response = await fetch(
      `/api/scratchers/files?id=${encodeURIComponent(fileId)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    setActiveFile(data.file ?? null);
  }, []);

  const openEventModal = (options: { packId: string; type: "note" | "return_receipt" }) => {
    setEventPackId(options.packId);
    setEventType(options.type);
    setEventNote("");
    setEventFile(null);
    setEventOpen(true);
  };

  const submitEvent = useCallback(async () => {
    if (!eventPackId) return;
    if (eventType === "return_receipt" && !eventFile) return;
    const formData = new FormData();
    formData.append("packId", eventPackId);
    formData.append("eventType", eventType);
    formData.append("note", eventNote);
    if (eventFile) {
      formData.append("file", eventFile);
    }
    const response = await fetch("/api/scratchers/packs/events", {
      method: "POST",
      body: formData,
    });
    if (response.ok) {
      setEventOpen(false);
      setEventNote("");
      setEventFile(null);
      await loadBundle();
    }
  }, [eventFile, eventNote, eventPackId, eventType, loadBundle]);

  const packSizeForPrice = (price?: number | null) => {
    if (!Number.isFinite(price)) return null;
    const normalized = Number(Number(price).toFixed(2));
    if (normalized === 40 || normalized === 30 || normalized === 25 || normalized === 20) {
      return 30;
    }
    if (normalized === 10) return 50;
    if (normalized === 5) return 80;
    if (normalized === 3 || normalized === 2) return 100;
    if (normalized === 1) return 240;
    return null;
  };

  const computedEndTicket = useMemo(() => {
    const product = productMap.get(activationData.productId);
    const size = packSizeForPrice(product?.price);
    if (!size) return "";
    const startValue = Number.parseInt(activationData.startTicket.trim(), 10);
    if (!Number.isFinite(startValue)) return "";
    const endValue = startValue + size - 1;
    return `${endValue}`.padStart(
      activationData.startTicket.trim().length || 1,
      "0",
    );
  }, [activationData.productId, activationData.startTicket, productMap]);

  const productOptions = useMemo(() => {
    const seen = new Set<number>();
    return (bundle?.products ?? [])
      .filter((product) => product.isActive && product.price > 0)
      .filter((product) => {
        if (seen.has(product.price)) return false;
        seen.add(product.price);
        return true;
      })
      .sort((a, b) => a.price - b.price);
  }, [bundle?.products]);

  return (
    <section className="ui-card space-y-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Scratchers (Anti-Theft)
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Slot snapshots
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            Enter end-of-shift ticket numbers. Start snapshot is set by owner/manager.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLogbookOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
            aria-label="Open scratcher logbook"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {notice}
        </div>
      )}
      {rolloverSlots.length > 0 && (
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Pack rollover detected in slots {rolloverSlots.map((slot) => slot.slotNumber || "?").join(", ")}. Activate a new pack before submitting the end snapshot.
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-200">
            End snapshot
          </h4>
          <p className="text-xs text-slate-300">
            Enter the ending ticket number for each active slot.
          </p>
        </div>
        <div className="mt-4 grid gap-3">
          {visibleSlots.map((slot) => (
            <label key={slot.id} className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Slot {slot.slotNumber}</span>
              <input
                type="text"
                inputMode="numeric"
                value={endValues[slot.id] ?? ""}
                onChange={(event) =>
                  setEndValues((prev) => ({
                    ...prev,
                    [slot.id]: event.target.value,
                  }))
                }
                className="ui-field"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="ui-button ui-button-primary"
            onClick={() => handleSnapshotSubmit("end", endValues)}
          >
            Save end snapshot
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          Show inactive slots
        </label>
        <span className="text-slate-400">Shift report ID: {shiftReportId ?? "—"}</span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-300">Loading scratcher slots…</div>
      ) : error ? (
        <div className="text-sm text-rose-200">{error}</div>
      ) : visibleSlots.length === 0 ? (
        <div className="text-sm text-slate-300">
          No scratcher slots are configured yet. Ask a manager to initialize slots.
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleSlots.map((slot) => {
            const packId = slot.activePackId ?? null;
            const pack = packId ? packMap.get(packId) : null;
            const baselineItem = baselineMap.get(slot.id);
            const baselineProduct = slot.defaultProductId
              ? productMap.get(slot.defaultProductId)
              : null;
            const baselineActive = !pack && Boolean(baselineItem);
            const needsActivation = rolloverSlots.some(
              (entry) => entry.slotId === slot.id,
            );
            const product = pack
              ? productMap.get(pack.productId)
              : baselineActive
                ? baselineProduct
                : null;
            const label =
              product?.name ?? (baselineActive ? "Baseline pack" : "No active pack");
            const price = product
              ? `$${product.price}`
              : baselineActive
                ? "Price not set"
                : "—";
            const statusLabel =
              pack?.status === "active"
                ? "active"
                : needsActivation
                  ? "activation needed"
                  : baselineActive
                    ? "baseline"
                    : "inactive";
            return (
              <div key={slot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Slot {slot.slotNumber}
                    </p>
                    <p className="text-xs text-slate-300">
                      {label} {price !== "—" ? `• ${price}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200">
                      {statusLabel}
                    </span>
                    {pack?.status === "active" ? (
                      <button
                        type="button"
                        className="ui-button ui-button-ghost"
                        onClick={() => openReturnForPack(pack.id)}
                      >
                        Return pack
                      </button>
                    ) : !baselineActive || needsActivation ? (
                      <button
                        type="button"
                        className={`ui-button ${needsActivation ? "ui-button-primary" : "ui-button-ghost"}`}
                        onClick={() => openActivationForSlot(slot.id)}
                      >
                        Activate pack
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <IHModal isOpen={activationOpen} onClose={() => setActivationOpen(false)} allowOutsideClose>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Activate new pack</h3>
          <p className="text-sm text-slate-300">
            Select the product for this slot and attach the activation receipt.
          </p>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span>Scratcher product</span>
            <select
              value={activationData.productId}
              onChange={(event) =>
                setActivationData((prev) => ({
                  ...prev,
                  productId: event.target.value,
                }))
              }
              className="ui-field"
            >
              <option value="">Select product</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  ${product.price}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Pack code</span>
              <input
                type="text"
                value={activationData.packCode}
                onChange={(event) =>
                  setActivationData((prev) => ({
                    ...prev,
                    packCode: event.target.value,
                  }))
                }
                className="ui-field"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Start ticket</span>
              <input
                type="text"
                inputMode="numeric"
                value={activationData.startTicket}
                onChange={(event) =>
                  setActivationData((prev) => ({
                    ...prev,
                    startTicket: event.target.value,
                  }))
                }
                className="ui-field"
              />
            </label>
            <div className="flex flex-col gap-2 text-sm text-slate-200">
              <span>End ticket (auto)</span>
              <div className="ui-field flex items-center justify-between text-slate-100">
                {computedEndTicket || "—"}
              </div>
            </div>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Receipt photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setActivationData((prev) => ({
                    ...prev,
                    receipt: event.target.files?.[0] ?? null,
                  }))
                }
                className="ui-field"
              />
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="ui-button" onClick={() => setActivationOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="ui-button ui-button-primary"
              onClick={handleActivatePack}
            >
              Activate pack
            </button>
          </div>
        </div>
      </IHModal>

      <IHModal isOpen={returnOpen} onClose={() => setReturnOpen(false)} allowOutsideClose>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Return pack</h3>
          <p className="text-sm text-slate-300">
            Upload the return receipt when a pack is pulled from the rack.
          </p>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span>Return note (optional)</span>
            <input
              type="text"
              value={returnNote}
              onChange={(event) => setReturnNote(event.target.value)}
              className="ui-field"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span>Return receipt photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setReturnReceipt(event.target.files?.[0] ?? null)}
              className="ui-field"
            />
          </label>
          <div className="flex justify-end gap-3">
            <button type="button" className="ui-button" onClick={() => setReturnOpen(false)}>
              Cancel
            </button>
            <button type="button" className="ui-button ui-button-primary" onClick={handleReturnPack}>
              Return pack
            </button>
          </div>
        </div>
      </IHModal>

      <ScratchersLogbookModal
        isOpen={logbookOpen}
        onClose={() => setLogbookOpen(false)}
        events={events}
        onViewReceipt={openReceipt}
        onAddNote={(packId) => openEventModal({ packId, type: "note" })}
        onAddPickupReceipt={(packId) =>
          openEventModal({ packId, type: "return_receipt" })
        }
      />

      {eventOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="ui-card w-full max-w-md space-y-4 text-white">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">
              {eventType === "return_receipt" ? "Pickup receipt" : "Pack note"}
            </p>
            <textarea
              value={eventNote}
              onChange={(event) => setEventNote(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
              placeholder="Add context"
            />
            <input
              type="file"
              onChange={(event) => setEventFile(event.target.files?.[0] ?? null)}
              className="text-sm text-slate-200"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="ui-button ui-button-ghost"
                onClick={() => setEventOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="ui-button" onClick={submitEvent}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {activeFile && (
        <FileViewer file={activeFile} onClose={() => setActiveFile(null)} />
      )}
    </section>
  );
}
