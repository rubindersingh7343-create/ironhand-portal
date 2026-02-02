"use client";

import { useEffect, useMemo, useState } from "react";
import type { CombinedRecord, InvestigationStatus, SessionUser, ShiftReport } from "@/lib/types";
import InvestigationCaseModal from "@/components/client/InvestigationCaseModal";
import SurveillanceInvestigateModal from "@/components/client/SurveillanceInvestigateModal";
import FullDayInvestigationModal from "@/components/client/FullDayInvestigationModal";

type StoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type ShiftItem = {
  investigation: {
    id: string;
    status: InvestigationStatus;
    updatedAt?: string;
  };
  report: ShiftReport & { investigationStatus?: InvestigationStatus };
};

type SurveillanceItem = {
  investigation: {
    id: string;
    status: InvestigationStatus;
    updatedAt?: string;
  };
  record: CombinedRecord;
};

type OpenItem =
  | { kind: "shift"; id: string; updatedAt: string; storeId: string; status: InvestigationStatus; report: ShiftReport }
  | { kind: "full"; id: string; updatedAt: string; storeId: string; status: InvestigationStatus; record: CombinedRecord }
  | { kind: "surveillance"; id: string; updatedAt: string; storeId: string; status: InvestigationStatus; record: CombinedRecord };

const kindLabel: Record<OpenItem["kind"], string> = {
  shift: "Shift",
  full: "Full Day",
  surveillance: "Surveillance",
};

const formatDate = (value?: string) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
};

const formatShiftDate = (value?: string) => {
  if (!value) return "--";
  return value;
};

export default function OpenInvestigationsSection({ user }: { user: SessionUser }) {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [shiftItems, setShiftItems] = useState<ShiftItem[]>([]);
  const [fullDayItems, setFullDayItems] = useState<CombinedRecord[]>([]);
  const [surveillanceItems, setSurveillanceItems] = useState<SurveillanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<ShiftReport | null>(null);
  const [activeFull, setActiveFull] = useState<CombinedRecord | null>(null);
  const [activeSurveillance, setActiveSurveillance] = useState<CombinedRecord | null>(null);
  const [fullDayStatus, setFullDayStatus] = useState<Record<string, "default" | "investigating" | "resolved">>({});
  const hasSurveillanceInvestigationAPI = true;
  const hasManagerAssigned = useMemo(
    () => stores.some((store) => store.hasManager),
    [stores],
  );
  const hasSurveillanceAssigned = useMemo(
    () => stores.some((store) => store.hasSurveillance),
    [stores],
  );
  const managerOnly = hasManagerAssigned && !hasSurveillanceAssigned;
  const surveillanceOnly = hasSurveillanceAssigned && !hasManagerAssigned;

  useEffect(() => {
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        const nextStores = Array.isArray(data.stores) ? data.stores : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        setStores(nextStores.length ? nextStores : fallback);
      } catch (error) {
        console.error("Failed to load stores", error);
      }
    };
    loadStores();
  }, [user.storeNumber]);

  const storeNameFor = (storeId: string) =>
    stores.find((store) => store.storeId === storeId)?.storeName ??
    `Store ${storeId}`;

  const loadInvestigations = async (silent = false) => {
    try {
      if (!silent && !initialized) setLoading(true);
      const response = await fetch("/api/owner/open-investigations", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load investigations.");
      }
      setShiftItems(Array.isArray(data.shift) ? data.shift : []);
      setFullDayItems(Array.isArray(data.fullDay) ? data.fullDay : []);
      setSurveillanceItems(Array.isArray(data.surveillance) ? data.surveillance : []);
      setMessage(null);
    } catch (error) {
      console.error("Failed to load investigations", error);
      setMessage(
        error instanceof Error ? error.message : "Unable to load investigations.",
      );
      setShiftItems([]);
      setFullDayItems([]);
      setSurveillanceItems([]);
    } finally {
      if (!silent && !initialized) setLoading(false);
      setInitialized(true);
    }
  };

  useEffect(() => {
    loadInvestigations();
    const interval = window.setInterval(() => loadInvestigations(true), 20000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadInvestigations(true);
      }
    };
    const handleFocus = () => {
      loadInvestigations(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const handleShiftInvestigate = async (
    report: ShiftReport,
    status: InvestigationStatus,
    reason?: string,
    threadPayload?: string,
  ) => {
    try {
      const response = await fetch("/api/owner/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: report.storeId,
          date: report.date,
          shift_report_id: report.id,
          status,
          notes: reason,
          thread: threadPayload,
        }),
      });
      if (!response.ok) return;
      await loadInvestigations();
    } catch (error) {
      console.error("Failed to update investigation", error);
    }
  };

  const items = useMemo<OpenItem[]>(() => {
    const shifts: OpenItem[] = shiftItems.map((item) => ({
      kind: "shift",
      id: item.investigation.id,
      updatedAt: item.investigation.updatedAt ?? item.report.updatedAt ?? new Date().toISOString(),
      storeId: item.report.storeId,
      status: item.investigation.status ?? "sent",
      report: item.report,
    }));
    const fulls: OpenItem[] = fullDayItems.map((record) => ({
      kind: "full",
      id: record.id,
      updatedAt: record.createdAt,
      storeId: record.storeNumber,
      status: "sent",
      record,
    }));
    const surs: OpenItem[] = surveillanceItems.map((item) => ({
      kind: "surveillance",
      id: item.investigation.id,
      updatedAt: item.investigation.updatedAt ?? item.record.createdAt,
      storeId: item.record.storeNumber,
      status: item.investigation.status ?? "sent",
      record: item.record,
    }));
    const combined = [...shifts, ...fulls, ...surs].filter((item) => {
      if (managerOnly) return item.kind !== "surveillance";
      if (surveillanceOnly) return item.kind === "surveillance";
      return true;
    });
    return combined.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [shiftItems, fullDayItems, surveillanceItems, managerOnly, surveillanceOnly]);

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-slate-300">
          Open Investigations
        </h2>
      </div>

      <div className="scroll-clip rounded-2xl border border-white/10 bg-[#0f1a33]">
        <div className="space-y-2 px-4 py-4 md:px-5">
          {loading && items.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`open-invest-${index}`} className="ui-skeleton h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400">
              {message ?? "No open investigations right now."}
            </p>
          ) : (
            items.map((item) => {
              const storeName = storeNameFor(item.storeId);
              const dateLabel =
                item.kind === "shift"
                  ? formatShiftDate(item.report.date)
                  : item.kind === "full"
                    ? formatDate(item.record.createdAt)
                    : formatDate(item.record.createdAt);
              const title =
                item.kind === "shift"
                  ? item.report.employeeName ?? storeName
                  : item.kind === "full"
                    ? storeName
                    : item.record.surveillanceLabel ?? "Surveillance";
              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                        {kindLabel[item.kind]}
                      </span>
                      <span className="text-xs text-slate-400">{dateLabel}</span>
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-white">
                      {title}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {storeName}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.kind === "shift") setActiveShift(item.report);
                        if (item.kind === "full") setActiveFull(item.record);
                        if (item.kind === "surveillance")
                          setActiveSurveillance(item.record);
                      }}
                      className="ui-btn-compact rounded-full border border-white/20 text-slate-200 transition hover:border-white/40"
                    >
                      Open
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {activeShift && (
        <InvestigationCaseModal
          report={{
            ...activeShift,
            investigationStatus: "in_progress",
          }}
          onClose={() => setActiveShift(null)}
          onSubmit={handleShiftInvestigate}
        />
      )}

      {activeFull && (
        <FullDayInvestigationModal
          report={activeFull}
          storeName={storeNameFor(activeFull.storeNumber)}
          defaultStatus={fullDayStatus[activeFull.id] ?? "investigating"}
          onClose={() => setActiveFull(null)}
          onStatusChange={(id, status) => {
            setFullDayStatus((prev) => ({ ...prev, [id]: status }));
            if (status === "resolved") {
              loadInvestigations();
            }
          }}
        />
      )}

      {activeSurveillance && (
        <SurveillanceInvestigateModal
          report={activeSurveillance}
          storeName={storeNameFor(activeSurveillance.storeNumber)}
          hasInvestigationAPI={hasSurveillanceInvestigationAPI}
          onPreview={() => {}}
          onClose={() => setActiveSurveillance(null)}
        />
      )}
    </section>
  );
}
