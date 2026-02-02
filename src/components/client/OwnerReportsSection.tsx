"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReportItemConfig, SessionUser } from "@/lib/types";
import ShiftReportsPanel from "@/components/client/ShiftReportsPanel";
import FullDayReportsPanel from "@/components/client/FullDayReportsPanel";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import {
  getDefaultReportItems,
  normalizeReportItems,
} from "@/lib/reportConfig";
import IHModal from "@/components/ui/IHModal";

type ReportTab = "shift" | "full";

export default function OwnerReportsSection({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<ReportTab>("shift");
  const [setupOpen, setSetupOpen] = useState(false);
  const ownerStore = useOwnerPortalStore();
  const activeStoreId = ownerStore?.selectedStoreId ?? user.storeNumber;
  const storeOptions = ownerStore?.stores ?? [];
  const [configItems, setConfigItems] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );
  const [workingItems, setWorkingItems] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );
  const labelDraftsRef = useRef<Record<string, string>>({});
  const marginDraftsRef = useRef<Record<string, string>>({});
  const [configVersion, setConfigVersion] = useState(0);
  const [configStatus, setConfigStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [copyFromStoreId, setCopyFromStoreId] = useState("");

  const activeStoreLabel =
    storeOptions.find((store) => store.storeId === activeStoreId)?.storeName ??
    (activeStoreId ? `Store ${activeStoreId}` : "Select store");

  const loadConfig = useCallback(
    async (storeId: string) => {
      if (!storeId) return;
      try {
        const response = await fetch(
          `/api/report-config?storeId=${encodeURIComponent(storeId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        const normalized = normalizeReportItems(data.items);
        setConfigItems(normalized);
        setWorkingItems(normalized);
        labelDraftsRef.current = {};
        marginDraftsRef.current = {};
        normalized.forEach((item) => {
          labelDraftsRef.current[item.key] = item.label;
          marginDraftsRef.current[item.key] =
            item.marginPercent === null || item.marginPercent === undefined
              ? ""
              : String(item.marginPercent);
        });
        setConfigVersion((prev) => prev + 1);
      } catch (error) {
        console.error("Failed to load report setup", error);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeStoreId) return;
    loadConfig(activeStoreId);
  }, [activeStoreId, loadConfig]);

  useEffect(() => {
    if (!setupOpen) return;
    setWorkingItems(configItems);
    labelDraftsRef.current = {};
    marginDraftsRef.current = {};
    configItems.forEach((item) => {
      labelDraftsRef.current[item.key] = item.label;
      marginDraftsRef.current[item.key] =
        item.marginPercent === null || item.marginPercent === undefined
          ? ""
          : String(item.marginPercent);
    });
    setConfigVersion((prev) => prev + 1);
  }, [setupOpen, configItems]);

  const parseMargin = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const updateItem = useCallback((key: string, changes: Partial<ReportItemConfig>) => {
    setWorkingItems((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, ...changes } : item,
      ),
    );
  }, []);

  const addCustomItem = useCallback(() => {
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    labelDraftsRef.current[`custom-${id}`] = "";
    marginDraftsRef.current[`custom-${id}`] = "";
    setWorkingItems((prev) => [
      ...prev,
      {
        key: `custom-${id}`,
        label: "",
        enabled: true,
        marginPercent: null,
        isCustom: true,
      },
    ]);
  }, []);

  const removeCustomItem = useCallback((key: string) => {
    delete labelDraftsRef.current[key];
    delete marginDraftsRef.current[key];
    setWorkingItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const saveConfig = useCallback(async () => {
    if (!activeStoreId) return;
    setConfigStatus("saving");
    try {
      const preparedItems = workingItems.map((item) => {
        const nextLabel = item.isCustom
          ? (labelDraftsRef.current[item.key] ?? item.label).trim()
          : item.label;
        const rawMargin = marginDraftsRef.current[item.key];
        const nextMargin =
          rawMargin === undefined ? item.marginPercent : parseMargin(rawMargin);
        return {
          ...item,
          label: nextLabel,
          marginPercent: nextMargin,
        };
      });
      const response = await fetch("/api/report-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          items: preparedItems,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to save report setup.");
      }
      const normalized = normalizeReportItems(
        data.config?.items ?? preparedItems,
      );
      setConfigItems(normalized);
      setWorkingItems(normalized);
      labelDraftsRef.current = {};
      marginDraftsRef.current = {};
      normalized.forEach((item) => {
        labelDraftsRef.current[item.key] = item.label;
        marginDraftsRef.current[item.key] =
          item.marginPercent === null || item.marginPercent === undefined
            ? ""
            : String(item.marginPercent);
      });
      setConfigVersion((prev) => prev + 1);
      setConfigStatus("saved");
      setTimeout(() => setConfigStatus("idle"), 2000);
    } catch (error) {
      console.error("Failed to save report setup", error);
      setConfigStatus("error");
      setTimeout(() => setConfigStatus("idle"), 2000);
    }
  }, [activeStoreId, workingItems, parseMargin]);

  const copyOptions = useMemo(
    () =>
      storeOptions.filter((store) => store.storeId !== activeStoreId),
    [activeStoreId, storeOptions],
  );

  return (
    <section className="ui-card text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-slate-300">
          Reports
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="ui-tabs">
            <button
              type="button"
              onClick={() => setActiveTab("shift")}
              className={`ui-tab ${activeTab === "shift" ? "ui-tab--active" : ""}`}
            >
              Shift Reports
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("full")}
              className={`ui-tab ${activeTab === "full" ? "ui-tab--active" : ""}`}
            >
              Full Day Reports
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            aria-label="Report setup"
            title="Report setup"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-white/40"
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
              <path d="M4 7h10" />
              <path d="M4 17h10" />
              <path d="M18 7h2" />
              <path d="M18 17h2" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="16" cy="17" r="2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className={activeTab === "shift" ? "" : "hidden"}>
          <ShiftReportsPanel
            user={user}
            embedded
            reportConfigVersion={configVersion}
          />
        </div>
        <div className={activeTab === "full" ? "" : "hidden"}>
          <FullDayReportsPanel
            user={user}
            embedded
            reportConfigVersion={configVersion}
          />
        </div>
      </div>

      <IHModal
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        allowOutsideClose
        panelClassName="no-transform flex max-h-[85vh] w-[min(700px,92vw)] flex-col overflow-hidden"
      >
        <div
          className="max-h-[85vh] overflow-y-auto overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="border-b border-white/10 px-6 py-4">
            <p className="text-xs uppercase tracking-[0.26em] text-slate-400">
              Report setup
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              {activeStoreLabel}
            </h3>
          </div>
          <div className="space-y-4 px-6 py-5 text-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              {copyOptions.length > 0 && (
                <>
                  <select
                    value={copyFromStoreId}
                    onChange={(event) => setCopyFromStoreId(event.target.value)}
                    className="rounded-full border border-white/10 bg-[#111a32] px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="">Copy setup from...</option>
                    {copyOptions.map((store) => (
                      <option key={store.storeId} value={store.storeId}>
                        {store.storeName ?? `Store ${store.storeId}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!copyFromStoreId) return;
                      loadConfig(copyFromStoreId);
                    }}
                    className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-white/40"
                  >
                    Use setup
                  </button>
                </>
              )}
            </div>
            <p className="text-sm text-slate-300">
              Pick which items show up for this store and optionally add profit margins
              to calculate net sales.
            </p>
            <div className="space-y-2">
              {workingItems.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex min-w-[160px] flex-1 items-center gap-2">
                    <input
                      key={`${item.key}-label-${configVersion}`}
                      defaultValue={labelDraftsRef.current[item.key] ?? item.label}
                        onInput={(event) => {
                          labelDraftsRef.current[item.key] =
                            (event.target as HTMLInputElement).value;
                        }}
                        placeholder={item.isCustom ? "Custom item label" : "Label"}
                      className="w-full rounded-full border border-white/10 bg-[#111a32] px-3 py-2 text-xs font-semibold text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) =>
                        updateItem(item.key, { enabled: event.target.checked })
                      }
                    />
                    Include
                  </label>
                    <label className="flex flex-1 items-center gap-2 rounded-full border border-white/10 bg-[#111a32] px-3 py-2 text-xs text-slate-100">
                      <span className="text-slate-400">Margin %</span>
                      <input
                        key={`${item.key}-margin-${configVersion}`}
                        defaultValue={
                          marginDraftsRef.current[item.key] ??
                          (item.marginPercent ?? "")
                        }
                        onInput={(event) => {
                          marginDraftsRef.current[item.key] =
                            (event.target as HTMLInputElement).value;
                        }}
                        inputMode="decimal"
                        placeholder="--"
                        className="w-16 bg-transparent text-right text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                      />
                    </label>
                    {item.isCustom && (
                      <button
                        type="button"
                        onClick={() => removeCustomItem(item.key)}
                        className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-white/40"
                      >
                        Delete
                      </button>
                    )}
                    {!item.isCustom && (
                      <button
                        type="button"
                        onClick={() => removeCustomItem(item.key)}
                        className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-white/40"
                      >
                        Delete
                      </button>
                    )}
                  </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={addCustomItem}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-white/40"
              >
                Add item
              </button>
              <button
                type="button"
                onClick={saveConfig}
                className="rounded-full bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-400"
              >
                {configStatus === "saving" ? "Saving..." : "Save setup"}
              </button>
              {configStatus === "saved" && (
                <span className="text-xs text-emerald-300">Saved.</span>
              )}
              {configStatus === "error" && (
                <span className="text-xs text-rose-300">
                  Unable to save setup.
                </span>
              )}
            </div>
          </div>
        </div>
      </IHModal>
    </section>
  );
}
