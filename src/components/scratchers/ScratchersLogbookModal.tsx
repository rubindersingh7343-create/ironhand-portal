"use client";

import { useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { ScratcherPackEvent } from "@/lib/types";

type ScratchersLogbookModalProps = {
  isOpen: boolean;
  onClose: () => void;
  events: ScratcherPackEvent[];
  onViewReceipt: (fileId?: string | null) => void;
  onAddNote: (packId: string) => void;
  onAddPickupReceipt: (packId: string) => void;
};

const formatEventType = (eventType: ScratcherPackEvent["eventType"]) => {
  switch (eventType) {
    case "return_receipt":
      return "Pickup receipt";
    case "returned":
      return "Returned pack";
    case "activated":
      return "Activated pack";
    case "ended":
      return "Ended pack";
    case "correction":
      return "Correction";
    default:
      return "Note";
  }
};

const InvestigateIcon = () => (
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
);

export default function ScratchersLogbookModal({
  isOpen,
  onClose,
  events,
  onViewReceipt,
  onAddNote,
  onAddPickupReceipt,
}: ScratchersLogbookModalProps) {
  const [selectedEvent, setSelectedEvent] = useState<ScratcherPackEvent | null>(null);

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [events],
  );

  const returnedEvents = useMemo(
    () => sortedEvents.filter((event) => event.eventType === "returned"),
    [sortedEvents],
  );

  return (
    <IHModal isOpen={isOpen} onClose={onClose} allowOutsideClose panelClassName="max-w-3xl">
      <div className="flex max-h-[80vh] flex-col gap-4 text-white">
        <div className="pr-10">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Scratchers logbook
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Activations & Returns
          </h3>
        </div>

        <div className="grid gap-4 overflow-y-auto pr-2 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
                Returned packs
              </p>
              {returnedEvents.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No returned packs yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {returnedEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                    >
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                          Pack {event.packId.slice(0, 6)}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedEvent(event)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
                        aria-label="Investigate return"
                      >
                        <InvestigateIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
                Activity log
              </p>
              {sortedEvents.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No activity logged.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {sortedEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200"
                    >
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                          {formatEventType(event.eventType)}
                        </p>
                        <p className="text-xs text-slate-300">
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedEvent(event)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
                        aria-label="Investigate event"
                      >
                        <InvestigateIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
              Investigate
            </p>
            {!selectedEvent ? (
              <p className="mt-3 text-sm text-slate-400">
                Select an entry to review receipts or add notes.
              </p>
            ) : (
              <div className="mt-3 space-y-3 text-sm text-slate-200">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  {formatEventType(selectedEvent.eventType)}
                </p>
                <p>Pack {selectedEvent.packId.slice(0, 8)}</p>
                <p className="text-xs text-slate-300">
                  {new Date(selectedEvent.createdAt).toLocaleString()}
                </p>
                {selectedEvent.note && (
                  <div className="rounded-xl border border-white/10 bg-[#0f1a33] px-3 py-2 text-xs text-slate-200">
                    {selectedEvent.note}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {selectedEvent.fileId && (
                    <button
                      type="button"
                      className="ui-button ui-button-ghost"
                      onClick={() => onViewReceipt(selectedEvent.fileId)}
                    >
                      View receipt
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-button ui-button-ghost"
                    onClick={() => onAddNote(selectedEvent.packId)}
                  >
                    Add note
                  </button>
                  {selectedEvent.eventType === "returned" && (
                    <button
                      type="button"
                      className="ui-button"
                      onClick={() => onAddPickupReceipt(selectedEvent.packId)}
                    >
                      Add pickup receipt
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </IHModal>
  );
}
