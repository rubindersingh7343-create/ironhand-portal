"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ScratcherPackEvent,
  ScratcherShiftCalculation,
  SessionUser,
  StoredFile,
} from "@/lib/types";
import ScratchersAdminPanel from "@/components/scratchers/ScratchersAdminPanel";
import ScratchersLogbookModal from "@/components/scratchers/ScratchersLogbookModal";
import FileViewer from "@/components/records/FileViewer";

interface StoreSummary {
  storeId: string;
  storeName?: string;
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

export default function ManagerScratchersPanel({ user }: { user: SessionUser }) {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [storeId, setStoreId] = useState(user.storeNumber);
  const [discrepancies, setDiscrepancies] = useState<ScratcherShiftCalculation[]>([]);
  const [events, setEvents] = useState<ScratcherPackEvent[]>([]);
  const [calculations, setCalculations] = useState<ScratcherShiftCalculation[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventPackId, setEventPackId] = useState<string | null>(null);
  const [eventNote, setEventNote] = useState("");
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [eventType, setEventType] = useState<"note" | "return_receipt">("note");
  const [logbookOpen, setLogbookOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load stores");
        const data = await response.json().catch(() => ({}));
        const nextStores = Array.isArray(data.stores) ? data.stores : [];
        setStores(nextStores);
        if (
          nextStores.length &&
          !nextStores.some((store: StoreSummary) => store.storeId === storeId)
        ) {
          setStoreId(nextStores[0]?.storeId ?? storeId);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
      }
    };
    loadStores();
    return () => controller.abort();
  }, [storeId]);

  const loadData = useCallback(async () => {
    if (!storeId) return;
    setStatus("loading");
    try {
      const [discrepancyRes, eventRes, calcRes] = await Promise.all([
        fetch(`/api/scratchers/discrepancies?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/scratchers/packs/events?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/scratchers/calculations?store_id=${encodeURIComponent(storeId)}`, {
          cache: "no-store",
        }),
      ]);
      const discrepancyData = await discrepancyRes.json().catch(() => ({}));
      const eventData = await eventRes.json().catch(() => ({}));
      const calcData = await calcRes.json().catch(() => ({}));
      setDiscrepancies(
        Array.isArray(discrepancyData.discrepancies)
          ? discrepancyData.discrepancies
          : [],
      );
      setEvents(Array.isArray(eventData.events) ? eventData.events : []);
      setCalculations(
        Array.isArray(calcData.calculations) ? calcData.calculations : [],
      );
      setStatus("idle");
    } catch (error) {
      console.error("Failed to load scratcher data", error);
      setStatus("error");
    }
  }, [storeId]);

  const openReceipt = useCallback(async (fileId?: string | null) => {
    if (!fileId) return;
    const response = await fetch(
      `/api/scratchers/files?id=${encodeURIComponent(fileId)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    setActiveFile(data.file ?? null);
  }, []);

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
      await loadData();
    }
  }, [eventFile, eventNote, eventPackId, eventType, loadData]);

  const openEventModal = (options: {
    packId: string;
    type: "note" | "return_receipt";
  }) => {
    setEventPackId(options.packId);
    setEventType(options.type);
    setEventNote("");
    setEventFile(null);
    setEventOpen(true);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [events],
  );

  const sortedCalculations = useMemo(
    () =>
      [...calculations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [calculations],
  );

  return (
    <section className="ui-card text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Scratchers (Anti-Theft)
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Discrepancies
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="ui-field appearance-none pr-8"
          >
            {stores.map((store) => (
              <option key={store.storeId} value={store.storeId}>
                {store.storeName ?? `Store ${store.storeId}`}
              </option>
            ))}
          </select>
          <button type="button" className="ui-button" onClick={loadData}>
            Refresh
          </button>
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
          <button
            type="button"
            className="ui-button ui-button-ghost"
            onClick={() => setSetupOpen(true)}
          >
            Manage scratchers
          </button>
        </div>
      </div>

      {status === "error" && (
        <p className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
          Unable to load scratcher data. Try again.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
            Flagged shifts
          </p>
          {status === "loading" ? (
            <p className="mt-3 text-sm text-slate-400">Loading discrepancies…</p>
          ) : discrepancies.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No scratcher discrepancies for this store.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {discrepancies.map((calc) => (
                <div
                  key={calc.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Shift {calc.shiftReportId.slice(0, 8)}
                    </p>
                    <p className="mt-1 text-sm text-slate-200">
                      Expected {formatMoney(calc.expectedTotalValue)} · Reported{" "}
                      {formatMoney(calc.reportedScrValue ?? 0)}
                    </p>
                    {calc.flags?.length ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Flags: {calc.flags.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Variance
                    </p>
                    <p className="ui-tabular text-sm text-white">
                      {formatMoney(calc.varianceValue)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
            Recent calculations
          </p>
          {status === "loading" ? (
            <p className="mt-3 text-sm text-slate-400">Loading calculations…</p>
          ) : sortedCalculations.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No scratcher calculations yet.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {sortedCalculations.slice(0, 6).map((calc) => (
                <div
                  key={calc.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Shift {calc.shiftReportId.slice(0, 8)}
                    </p>
                    <p className="mt-1 text-sm text-slate-200">
                      Expected {formatMoney(calc.expectedTotalValue)} · Reported{" "}
                      {formatMoney(calc.reportedScrValue ?? 0)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Variance
                    </p>
                    <p className="ui-tabular text-sm text-white">
                      {formatMoney(calc.varianceValue)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      <ScratchersAdminPanel
        storeId={storeId}
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onRefresh={loadData}
      />

      <ScratchersLogbookModal
        isOpen={logbookOpen}
        onClose={() => setLogbookOpen(false)}
        events={sortedEvents}
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
