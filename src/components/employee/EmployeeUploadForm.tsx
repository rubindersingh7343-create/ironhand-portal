"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CombinedRecord,
  ReportItemConfig,
  SessionUser,
  ShiftSubmission,
} from "@/lib/types";
import type { StoredFile } from "@/lib/types";
import { supabasePublic, publicBucket } from "@/lib/supabaseClient";
import clsx from "clsx";
import { getDefaultReportItems, normalizeReportItems } from "@/lib/reportConfig";
import EmployeeScratchersPanel from "@/components/scratchers/EmployeeScratchersPanel";
import InvoiceUploadCard from "@/components/invoices/InvoiceUploadCard";
import ShiftReceiptScanModal, {
  type ShiftReceiptSalesFields,
} from "@/components/employee/ShiftReceiptScanModal";
import ShiftReceiptMultiPageScanModal from "@/components/employee/ShiftReceiptMultiPageScanModal";
import ShiftTerminalReportAutoFillModal, {
  type ReceiptParseMeta,
} from "@/components/employee/ShiftTerminalReportAutoFillModal";
import type { NrsTerminalReportJson } from "@/lib/receiptParsing/nrsTerminalReport";
import { receiptMultiPhotoEnabled } from "@/lib/featureFlags";
import { receiptParseBgV1 } from "@/lib/receipt/receiptFeatureFlags";
import { receiptVisionExtractionToSalesFields } from "@/lib/receipt/receiptVisionToSalesFields";

interface EmployeeUploadFormProps {
  user: SessionUser;
  className?: string;
  showInvoiceUpload?: boolean;
}

const requiredFiles = [
  { id: "cashPhoto", label: "Cash Count Photo", accept: "image/*" },
];

export default function EmployeeUploadForm({
  user,
  className,
  showInvoiceUpload = true,
}: EmployeeUploadFormProps) {
  const isOwner = user.role === "client";
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storeLabel, setStoreLabel] = useState<string>(
    user.storeName ?? `Store ${user.storeNumber}`,
  );
  const [recentUploads, setRecentUploads] = useState<ShiftSubmission[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<CombinedRecord[]>([]);
  const [recentStatus, setRecentStatus] = useState<"idle" | "loading" | "error">(
    "loading",
  );
  const [recentError, setRecentError] = useState<string | null>(null);
  const [uploadingShift, setUploadingShift] = useState(false);
  const [hoursDate, setHoursDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [hoursStartTime, setHoursStartTime] = useState("");
  const [hoursEndTime, setHoursEndTime] = useState("");
  const [hoursBreakMinutes, setHoursBreakMinutes] = useState<number>(0);
  const [reportConfig, setReportConfig] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );
  const [reportValues, setReportValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [receiptScanOpen, setReceiptScanOpen] = useState(false);
  const [receiptMultiScanOpen, setReceiptMultiScanOpen] = useState(false);
  const [terminalScanOpen, setTerminalScanOpen] = useState(false);
  const [receiptAutofillKeys, setReceiptAutofillKeys] = useState<string[]>([]);
  const [receiptAutofillConfirmed, setReceiptAutofillConfirmed] = useState(true);
  const [receiptPhotoDataUrl, setReceiptPhotoDataUrl] = useState<string | null>(
    null,
  );
  const [receiptParseMeta, setReceiptParseMeta] = useState<ReceiptParseMeta | null>(
    null,
  );
  const [receiptParsedJson, setReceiptParsedJson] = useState<NrsTerminalReportJson | null>(
    null,
  );
  const [receiptBgStatus, setReceiptBgStatus] = useState<
    "idle" | "parsing" | "done" | "error"
  >("idle");
  const [receiptBgError, setReceiptBgError] = useState<string | null>(null);
  const receiptBgInFlightRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadStore = async () => {
      try {
        const response = await fetch("/api/stores/all", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        const found = (data.stores ?? []).find(
          (store: { storeId: string; storeName?: string }) =>
            store.storeId === user.storeNumber,
        );
        if (found?.storeName) {
          setStoreLabel(found.storeName);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    };
    loadStore();
    return () => controller.abort();
  }, [user.storeName, user.storeNumber]);

  useEffect(() => {
    const controller = new AbortController();
    const loadConfig = async () => {
      try {
        const response = await fetch(
          `/api/report-config?storeId=${encodeURIComponent(user.storeNumber)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        const normalized = normalizeReportItems(data.items);
        setReportConfig(normalized);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load report config", error);
        }
      }
    };
    loadConfig();
    return () => controller.abort();
  }, [user.storeNumber]);

  useEffect(() => {
    setReportValues((prev) => {
      const next = { ...prev };
      reportConfig.forEach((item) => {
        if (!item.isCustom && next[item.key] === undefined) {
          next[item.key] = "";
        }
      });
      return next;
    });
    setCustomValues((prev) => {
      const next = { ...prev };
      reportConfig.forEach((item) => {
        if (item.isCustom && next[item.key] === undefined) {
          next[item.key] = "";
        }
      });
      return next;
    });
  }, [reportConfig]);

  const message = useMemo(() => {
    if (status === "success") {
      return "Thanks! Your end-of-shift documentation is saved.";
    }
    if (status === "error") {
      return errorMessage ?? "Upload failed. Try again.";
    }
    return null;
  }, [status, errorMessage]);

  const receiptAutofillKeySet = useMemo(
    () => new Set(receiptAutofillKeys),
    [receiptAutofillKeys],
  );

  const receiptNeedsConfirm =
    receiptAutofillKeys.length > 0 && !receiptAutofillConfirmed;

  const receiptNeedsPhoto = !receiptPhotoDataUrl;

  const cashFieldEnabled = useMemo(() => {
    const cashItem = reportConfig.find((item) => item.key === "cash");
    return cashItem ? Boolean(cashItem.enabled) : true;
  }, [reportConfig]);

  const cashNeedsEntry =
    cashFieldEnabled && !String(reportValues.cash ?? "").trim();

  const toNumber = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const applyReceiptScan = useCallback((result: ShiftReceiptSalesFields) => {
    const format = (value: number | null) =>
      value === null || !Number.isFinite(value) ? null : value.toFixed(2);

    const updates: Array<[string, string]> = [];
    const gross = format(result.gross);
    const scr = format(result.scr);
    const lotto = format(result.lotto);
    const liquor = format(result.liquor);
    const beer = format(result.beer);
    const cig = format(result.cigarettes);
    const tobacco = format(result.tobacco);
    const gas = format(result.gas);
    const lottoPo = format(result.lotto_payout);

    if (gross !== null) updates.push(["gross", gross]);
    if (scr !== null) updates.push(["scr", scr]);
    if (lotto !== null) updates.push(["lotto", lotto]);
    if (liquor !== null) updates.push(["liquor", liquor]);
    if (beer !== null) updates.push(["beer", beer]);
    if (cig !== null) updates.push(["cig", cig]);
    if (tobacco !== null) updates.push(["tobacco", tobacco]);
    if (gas !== null) updates.push(["gas", gas]);
    if (lottoPo !== null) updates.push(["lottoPo", lottoPo]);

    if (updates.length === 0) {
      setReceiptAutofillKeys([]);
      setReceiptAutofillConfirmed(true);
      return;
    }

    setReportValues((prev) => {
      const next = { ...prev };
      for (const [key, value] of updates) {
        // Sales-only: never touch cash/atm/deposit.
        if (key === "cash" || key === "atm" || key === "deposit") continue;
        next[key] = value;
      }
      return next;
    });

    setReceiptAutofillKeys(updates.map(([key]) => key));
    setReceiptAutofillConfirmed(false);
  }, []);

  const startReceiptParseInBackground = useCallback(
    async (pages: string[]) => {
      if (!receiptParseBgV1) return;
      if (!pages || pages.length === 0) return;
      if (receiptBgInFlightRef.current) return;
      receiptBgInFlightRef.current = true;
      setReceiptBgStatus("parsing");
      setReceiptBgError(null);
      try {
        const response = await fetch("/api/ai/receipt-multipage-parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            image_pages: pages.slice(0, 6),
            store_id: user.storeNumber,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as any;
        if (!response.ok) throw new Error(payload?.error ?? "Receipt scan failed.");
        const extraction = payload?.extraction;
        const sales = receiptVisionExtractionToSalesFields(extraction?.fields);
        applyReceiptScan(sales);
        setReceiptBgStatus("done");
      } catch (err) {
        console.error("receipt background parse failed", err);
        setReceiptBgStatus("error");
        setReceiptBgError(err instanceof Error ? err.message : "Receipt scan failed.");
      } finally {
        receiptBgInFlightRef.current = false;
      }
    },
    [applyReceiptScan, user.storeNumber],
  );

  const applyTerminalReceiptScan = useCallback((result: NrsTerminalReportJson) => {
    const format = (value: number | null) =>
      value === null || !Number.isFinite(value) ? null : value.toFixed(2);

    const updates: Array<[string, string]> = [];
    const gross = format(result.gross_sales);
    const scr = format(result.scratcher_sales);
    const lotto = format(result.lotto_sales);
    const lottoPo = format(result.lotto_payout);
    const cash = format(result.cash);

    const liquor = format(result.categories?.liquor ?? null);
    const beer = format(result.categories?.beer ?? null);
    const cig = format(result.categories?.cigarettes ?? null);
    const tobacco = format(result.categories?.tobacco ?? null);

    if (gross !== null) updates.push(["gross", gross]);
    if (scr !== null) updates.push(["scr", scr]);
    if (lotto !== null) updates.push(["lotto", lotto]);
    if (liquor !== null) updates.push(["liquor", liquor]);
    if (beer !== null) updates.push(["beer", beer]);
    if (cig !== null) updates.push(["cig", cig]);
    if (tobacco !== null) updates.push(["tobacco", tobacco]);
    if (lottoPo !== null) updates.push(["lottoPo", lottoPo]);
    if (cash !== null) updates.push(["cash", cash]);

    if (updates.length === 0) {
      setReceiptAutofillKeys([]);
      setReceiptAutofillConfirmed(true);
      return;
    }

    setReportValues((prev) => {
      const next = { ...prev };
      for (const [key, value] of updates) {
        next[key] = value;
      }
      return next;
    });

    setReceiptAutofillKeys(updates.map(([key]) => key));
    // The terminal report flow already includes a review/confirm step in the modal.
    setReceiptAutofillConfirmed(true);
  }, []);

  const hoursPreview = useMemo(() => {
    const toMinutes = (value: string) => {
      const [h, m] = value.split(":").map((part) => Number(part));
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    };
    const start = toMinutes(hoursStartTime);
    const end = toMinutes(hoursEndTime);
    if (start === null || end === null) return null;
    const rawMinutes = end - start - Math.max(0, Number(hoursBreakMinutes) || 0);
    if (rawMinutes <= 0) return null;
    return Number((rawMinutes / 60).toFixed(2));
  }, [hoursBreakMinutes, hoursEndTime, hoursStartTime]);

  const standardItems = useMemo(
    () => reportConfig.filter((item) => !item.isCustom && item.enabled),
    [reportConfig],
  );
  const customItems = useMemo(
    () => reportConfig.filter((item) => item.isCustom && item.enabled),
    [reportConfig],
  );

  const inputOrder = useMemo(
    () => [...standardItems, ...customItems].map((item) => item.key),
    [standardItems, customItems],
  );

  const jumpClick = useCallback(
    (currentKey: string) => {
      const currentIndex = inputOrder.indexOf(currentKey);
      if (currentIndex === -1) return;
      const nextKey = inputOrder[currentIndex + 1];
      if (!nextKey) {
        inputRefs.current[currentKey]?.blur();
        return;
      }
      const nextEl = inputRefs.current[nextKey];
      if (nextEl) {
        requestAnimationFrame(() => {
          nextEl.focus();
          nextEl.select();
        });
      }
    },
    [inputOrder],
  );

  const onReportFieldChange = useCallback(
    (field: ReportItemConfig, nextValue: string) => {
      if (field.isCustom) {
        setCustomValues((prev) => ({ ...prev, [field.key]: nextValue }));
        return;
      }
      setReportValues((prev) => ({ ...prev, [field.key]: nextValue }));
      if (receiptAutofillKeySet.has(field.key)) {
        setReceiptAutofillConfirmed(false);
      }
    },
    [receiptAutofillKeySet],
  );

  const fetchRecentUploads = useCallback(async () => {
    setRecentStatus("loading");
    setRecentError(null);
    try {
      const recentUrl = new URL("/api/employee/recent", window.location.origin);
      recentUrl.searchParams.set("days", "3");
      if (isOwner && user.storeNumber) {
        recentUrl.searchParams.set("storeId", user.storeNumber);
      }
      const response = await fetch(recentUrl.toString(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load recent uploads.");
      }
      const data = await response.json();
      setRecentUploads(data.submissions ?? []);
      setRecentInvoices(data.invoices ?? []);
      setRecentStatus("idle");
    } catch (error) {
      console.error(error);
      setRecentStatus("error");
      setRecentError(
        error instanceof Error
          ? error.message
          : "Unable to load recent uploads.",
      );
    }
  }, [isOwner, user.storeNumber]);

  useEffect(() => {
    fetchRecentUploads();
  }, [fetchRecentUploads]);

  const recentItems = useMemo(() => {
    const shiftItems = recentUploads.map((submission) => ({
      type: "shift" as const,
      id: submission.id,
      createdAt: submission.createdAt,
      submission,
    }));
    const invoiceItems = recentInvoices.map((record) => ({
      type: "invoice" as const,
      id: record.id,
      createdAt: record.createdAt,
      record,
    }));
    return [...shiftItems, ...invoiceItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [recentInvoices, recentUploads]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    setUploadingShift(true);

    const formElement = event.currentTarget;
    if (!formElement) {
      setStatus("error");
      setErrorMessage("Unable to access the form element.");
      setUploadingShift(false);
      return;
    }

    const isEmployee = user.role === "employee";
    const breakMinutes = Math.max(0, Number(hoursBreakMinutes) || 0);
    if (isEmployee) {
      if (!hoursDate || !hoursStartTime || !hoursEndTime) {
        setStatus("error");
        setErrorMessage("Please fill out Hours check-in (date, start time, end time).");
        setUploadingShift(false);
        return;
      }
      if (hoursPreview === null) {
        setStatus("error");
        setErrorMessage("Hours check-in time range looks invalid.");
        setUploadingShift(false);
        return;
      }
    }

    if (cashFieldEnabled && !String(reportValues.cash ?? "").trim()) {
      setStatus("error");
      setErrorMessage("Enter the cash amount.");
      setUploadingShift(false);
      return;
    }

    let endSnapshotItems: Array<{ slotId: string; ticketValue: string }> | null = null;
    if (isEmployee) {
      try {
        const keyForDate = (value: string) =>
          `ih:scratchers:endSnapshot:${user.storeNumber}:${value}`;
        const today = new Date().toISOString().slice(0, 10);
        const primaryKey = keyForDate(hoursDate);
        const fallbackKey = keyForDate(today);
        const raw = localStorage.getItem(primaryKey) ?? localStorage.getItem(fallbackKey);
        const saved = raw ? (JSON.parse(raw) as Record<string, string>) : {};

        const slotsRes = await fetch(
          `/api/scratchers/slots?store_id=${encodeURIComponent(user.storeNumber)}`,
          { cache: "no-store" },
        );
        const slotsData = await slotsRes.json().catch(() => ({}));
        const slots = Array.isArray(slotsData.slots) ? slotsData.slots : [];
        const packs = Array.isArray(slotsData.packs) ? slotsData.packs : [];
        const packById = new Map(packs.map((pack: any) => [pack.id, pack]));
        const activeSlots = slots.filter((slot: any) => {
          if (!slot?.isActive) return false;
          const pack = slot?.activePackId
            ? (packById.get(slot.activePackId) as any)
            : null;
          return Boolean(pack && pack.status === "active");
        });

        const missing = activeSlots.filter(
          (slot: any) => !String(saved?.[slot.id] ?? "").trim(),
        );
        if (missing.length) {
          const missingSlots = missing
            .map((slot: any) => slot?.slotNumber ?? "?")
            .join(", ");
          throw new Error(
            `Missing scratcher end ticket numbers for slots: ${missingSlots}. Fill them in Scratchers before submitting.`,
          );
        }

        endSnapshotItems = activeSlots.map((slot: any) => ({
          slotId: String(slot.id),
          ticketValue: String(saved?.[slot.id] ?? "").trim(),
        }));
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to read scratcher end ticket numbers.",
        );
        setUploadingShift(false);
        return;
      }
    }

    const cash = formElement.cashPhoto?.files?.[0] as File | undefined;
    if (!cash) {
      setStatus("error");
      setErrorMessage("Please upload a Cash Count Photo.");
      setUploadingShift(false);
      return;
    }

    if (!receiptPhotoDataUrl) {
      setStatus("error");
      setErrorMessage("Scan the receipt to attach the sales report photo.");
      setUploadingShift(false);
      return;
    }

    const dataUrlToFile = async (dataUrl: string, filename: string) => {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], filename, {
        type: blob.type || "image/jpeg",
      });
    };

    const dateForName = isEmployee
      ? hoursDate
      : new Date().toISOString().slice(0, 10);
    let sales: File;
    try {
      sales = await dataUrlToFile(
        receiptPhotoDataUrl,
        `sales-report-${user.storeNumber}-${dateForName}.jpg`,
      );
    } catch {
      setStatus("error");
      setErrorMessage("Unable to attach the receipt photo. Please rescan.");
      setUploadingShift(false);
      return;
    }

    if (!supabasePublic) {
      setStatus("error");
      setErrorMessage("Upload client is not configured.");
      setUploadingShift(false);
      return;
    }

    const files = [
      { file: cash, label: "Cash Count Photo", field: "cashPhoto" },
      { file: sales, label: "Sales Report Photo", field: "salesPhoto" },
    ];

    try {
      // Request signed upload URLs
      const signResponse = await fetch("/api/uploads/signed-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map(({ file }) => ({
            name: file.name,
            folder: "shift",
          })),
        }),
      });
      const signed = await signResponse.json().catch(() => ({}));
      if (!signResponse.ok) {
        throw new Error(
          signed?.error ?? "Unable to get upload URLs. Try again shortly.",
        );
      }

      const uploads = Array.isArray(signed.uploads) ? signed.uploads : [];
      if (uploads.length !== files.length) {
        throw new Error("Upload signing mismatch. Please retry.");
      }

      // Upload directly to Supabase storage using signed URLs
      for (let i = 0; i < files.length; i += 1) {
        const { file } = files[i];
        const { path, token } = uploads[i];
        const { error: uploadError } = await supabasePublic.storage
          .from(publicBucket)
          .uploadToSignedUrl(path, token, file, {
            contentType: file.type || "application/octet-stream",
          });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      uploads[i].file = file;
    }

    const reportFields = standardItems.reduce<Record<string, string>>(
      (acc, item) => {
        acc[item.key] = reportValues[item.key] ?? "";
        return acc;
      },
      {},
    );
    const customFields = customItems
      .map((item) => ({
        label: item.label.trim(),
        amount: customValues[item.key] ?? "",
      }))
      .filter((field) => field.label);

    // Build metadata and submit JSON payload
    const payload = {
      shiftNotes: formElement.shiftNotes?.value ?? "",
      reportFields,
      customFields,
      receiptParse:
        receiptParseMeta && receiptParsedJson
          ? {
              ...receiptParseMeta,
              parsed_json: receiptParsedJson,
            }
          : null,
      storeId: isOwner ? user.storeNumber : undefined,
      hours: isEmployee
        ? {
            date: hoursDate,
            startTime: hoursStartTime,
            endTime: hoursEndTime,
            breakMinutes,
          }
        : undefined,
      scratcherEndSnapshot: isEmployee
        ? {
            date: hoursDate,
            items: endSnapshotItems ?? [],
          }
        : undefined,
      files: {
        cashPhoto: {
          id: uploads[0].path,
          path: uploads[0].path,
          originalName: files[0].file.name,
          mimeType: files[0].file.type,
          size: files[0].file.size,
          label: files[0].label,
          kind: "image",
        },
        salesPhoto: {
          id: uploads[1].path,
          path: uploads[1].path,
          originalName: files[1].file.name,
          mimeType: files[1].file.type,
          size: files[1].file.size,
          label: files[1].label,
          kind: "image",
        },
      },
    };

    const submitResponse = await fetch("/api/shift-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const submitData = await submitResponse.json().catch(() => ({}));
    if (!submitResponse.ok) {
      throw new Error(
        submitData?.error ?? "Unable to save shift right now. Try again.",
      );
    }

    formElement.reset();
    if (isEmployee) {
      setHoursDate(new Date().toISOString().slice(0, 10));
      setHoursStartTime("");
      setHoursEndTime("");
      setHoursBreakMinutes(0);
    }
    setReportValues(() => {
      const next: Record<string, string> = {};
      reportConfig.forEach((item) => {
        if (!item.isCustom && item.enabled) {
          next[item.key] = "";
        }
      });
      return next;
    });
    setCustomValues(() => {
      const next: Record<string, string> = {};
      reportConfig.forEach((item) => {
        if (item.isCustom && item.enabled) {
          next[item.key] = "";
        }
      });
      return next;
    });
    setReceiptAutofillKeys([]);
    setReceiptAutofillConfirmed(true);
    setReceiptPhotoDataUrl(null);
    setReceiptParseMeta(null);
    setReceiptParsedJson(null);
    setStatus("success");
    fetchRecentUploads();
    setTimeout(() => setStatus("idle"), 6000);
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Upload failed. Try again.";
    setErrorMessage(message);
    setStatus("error");
    setTimeout(() => setStatus("idle"), 6000);
  } finally {
    setUploadingShift(false);
  }
};

  return (
    <section
      className={clsx("ui-card space-y-6 text-white", className)}
    >
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-100">
          {user.name}
        </p>
        {isOwner && user.storeNumber && (
          <p className="text-xs text-slate-400">
            Uploading for {user.storeName ?? `Store ${user.storeNumber}`}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Shift report totals
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Enter the totals from your receipt and end-of-shift counts.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {receiptMultiPhotoEnabled && (
              <button
                type="button"
                className="ui-button ui-button-primary"
                onClick={() => setReceiptMultiScanOpen(true)}
              >
                Scan Receipt (Recommended)
              </button>
            )}
            <button
              type="button"
              className="ui-button ui-button-ghost"
              onClick={() => setReceiptScanOpen(true)}
            >
              Scan receipt
            </button>
            <button
              type="button"
              className="ui-button ui-button-primary"
              onClick={() => setTerminalScanOpen(true)}
            >
              Take Pic (Auto-Fill)
            </button>
            {receiptAutofillKeys.length > 0 && (
              <>
                <button
                  type="button"
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition",
                    receiptAutofillConfirmed
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300"
                      : "border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300",
                  )}
                  onClick={() => setReceiptAutofillConfirmed(true)}
                >
                  {receiptAutofillConfirmed ? "Receipt confirmed" : "Confirm receipt scan"}
                </button>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-200 underline-offset-2 hover:underline"
                  onClick={() => {
                    setReceiptAutofillKeys([]);
                    setReceiptAutofillConfirmed(true);
                  }}
                >
                  Clear highlight
                </button>
              </>
            )}
          </div>
          {receiptNeedsConfirm && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              Confirm the scanned totals to enable upload.
            </p>
          )}
          {receiptNeedsPhoto && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              Scan receipt to attach the sales report photo.
            </p>
          )}
          {receiptBgStatus === "parsing" && (
            <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
              Parsing receipt in background… you can continue with Scratchers.
            </div>
          )}
          {receiptBgStatus === "done" && (
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-950">
              Receipt ready — review and confirm the highlighted totals.
            </div>
          )}
          {receiptBgStatus === "error" && receiptBgError && (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-950">
              Receipt scan failed in background: {receiptBgError}
            </div>
          )}
        </div>
        <div
          className={clsx(
            "grid gap-3",
            isOwner
              ? "grid-cols-2 sm:grid-cols-3"
              : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {[...standardItems, ...customItems]
            .filter((field) => field.key !== "cash")
            .map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="ui-label">{field.label}</label>
              <div
                className={clsx(
                  "flex items-center gap-2 rounded-2xl border bg-[#111a32] px-3 py-2.5 text-sm text-slate-100 focus-within:border-blue-400 sm:px-4 sm:py-3",
                  receiptAutofillKeySet.has(field.key) && !field.isCustom
                    ? receiptAutofillConfirmed
                      ? "border-emerald-300/40 ring-1 ring-emerald-300/20"
                      : "border-amber-300/40 ring-1 ring-amber-300/20"
                    : "border-white/10",
                )}
              >
                <span className="text-slate-300">$</span>
                <input
                  ref={(el) => {
                    inputRefs.current[field.key] = el;
                  }}
                  value={
                    field.isCustom
                      ? (customValues[field.key] ?? "")
                      : (reportValues[field.key] ?? "")
                  }
                  onChange={(event) => {
                    onReportFieldChange(field, event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      jumpClick(field.key);
                    }
                  }}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-300 focus:outline-none"
                />
              </div>
            </div>
          ))}
        </div>

        <div data-ih-section="scratchers">
          <EmployeeScratchersPanel user={user} />
        </div>

        {user.role === "employee" && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                  Hours check-in
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Submitted with your shift package.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                {hoursPreview === null ? "—" : `${hoursPreview.toFixed(2)} hrs`}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Date
                <input
                  type="date"
                  className="ui-field mt-2 w-full"
                  value={hoursDate}
                  onChange={(event) => setHoursDate(event.target.value)}
                  required
                />
              </label>
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Break minutes
                <input
                  type="number"
                  min={0}
                  className="ui-field mt-2 w-full"
                  value={hoursBreakMinutes}
                  onChange={(event) =>
                    setHoursBreakMinutes(Number(event.target.value || 0))
                  }
                />
              </label>
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Start time
                <input
                  type="time"
                  className="ui-field mt-2 w-full"
                  value={hoursStartTime}
                  onChange={(event) => setHoursStartTime(event.target.value)}
                  required
                />
              </label>
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                End time
                <input
                  type="time"
                  className="ui-field mt-2 w-full"
                  value={hoursEndTime}
                  onChange={(event) => setHoursEndTime(event.target.value)}
                  required
                />
              </label>
            </div>
          </div>
        )}

        <div>
          <label
            htmlFor="shiftNotes"
            className="ui-label mb-2 block"
          >
            Shift notes (optional)
          </label>
          <textarea
            id="shiftNotes"
            name="shiftNotes"
            rows={3}
            placeholder="Call out issues, payouts, deliveries, or other context"
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {requiredFiles.map((file) => (
            <label
              key={file.id}
              className="flex h-full w-full min-w-0 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-dashed border-white/15 bg-[#121f3e] p-4 text-sm !text-white transition hover:border-blue-400"
              style={{ color: "#fff", WebkitTextFillColor: "#fff" } as any}
            >
              <span
                className="font-semibold !text-white"
                style={{ color: "#fff", WebkitTextFillColor: "#fff" } as any}
              >
                {file.label}
              </span>
              <span
                className="mt-2 text-xs !text-slate-200"
                style={{ color: "#e2e8f0", WebkitTextFillColor: "#e2e8f0" } as any}
              >
                Upload {file.accept.startsWith("video") ? "video" : "photo"}
              </span>
              <input
                required
                type="file"
                accept={file.accept}
                name={file.id}
                className="mt-4 w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs !text-slate-200 file:mr-3 file:rounded-full file:border file:border-white/20 file:bg-white/5 file:px-3 file:py-1 file:text-xs file:font-semibold file:!text-white"
                style={{ color: "#e2e8f0", WebkitTextFillColor: "#e2e8f0" } as any}
                onChange={() => {}}
              />
              <div className="mt-4 space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] !text-slate-200/80">
                  Cash amount
                </span>
                <div
                  className={clsx(
                    "flex items-center gap-2 rounded-2xl border bg-[#111a32] px-3 py-2.5 text-sm text-slate-100 focus-within:border-blue-400",
                    cashNeedsEntry
                      ? "border-amber-300/40 ring-1 ring-amber-300/20"
                      : "border-white/10",
                  )}
                >
                  <span className="text-slate-300">$</span>
                  <input
                    value={reportValues.cash ?? ""}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setReportValues((prev) => ({ ...prev, cash: nextValue }));
                    }}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-300 focus:outline-none"
                  />
                </div>
                {cashNeedsEntry && (
                  <p className="text-xs text-amber-200">
                    Enter cash to enable upload.
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        {message && (
          <div
            className={clsx(
              "rounded-xl px-4 py-3 text-sm",
              status === "success"
                ? "bg-emerald-500/10 text-emerald-200"
                : "bg-red-500/10 text-red-200",
            )}
          >
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={
            status === "sending" ||
            uploadingShift ||
            receiptNeedsConfirm ||
            receiptNeedsPhoto ||
            cashNeedsEntry
          }
          className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70 disabled:text-white disabled:[-webkit-text-fill-color:#fff]"
        >
          {status === "sending" || uploadingShift
            ? "Uploading..."
            : receiptNeedsConfirm || receiptNeedsPhoto || cashNeedsEntry
              ? "Finish required steps to submit"
              : "Submit shift package"}
        </button>
      </form>

      <ShiftReceiptScanModal
        isOpen={receiptScanOpen}
        storeId={user.storeNumber}
        onClose={() => setReceiptScanOpen(false)}
        onApply={(result, imageDataUrl) => {
          setReceiptPhotoDataUrl(imageDataUrl);
          applyReceiptScan(result);
        }}
      />

      <ShiftReceiptMultiPageScanModal
        isOpen={receiptMultiScanOpen}
        storeId={user.storeNumber}
        onClose={() => setReceiptMultiScanOpen(false)}
        onFallbackSingle={() => {
          setReceiptMultiScanOpen(false);
          setReceiptScanOpen(true);
        }}
        onBackgroundStart={({ pages, stitchedImageDataUrl }) => {
          setReceiptPhotoDataUrl(stitchedImageDataUrl);
          void startReceiptParseInBackground(pages);
          // Nudge the user toward the next step (Scratchers) without changing Scratchers logic.
          window.setTimeout(() => {
            const anchor = document.querySelector("[data-ih-section='scratchers']");
            anchor?.scrollIntoView?.({ behavior: "smooth", block: "start" });
          }, 50);
        }}
        onApply={(result, stitchedImageDataUrl) => {
          setReceiptPhotoDataUrl(stitchedImageDataUrl);
          applyReceiptScan(result);
        }}
      />

      <ShiftTerminalReportAutoFillModal
        isOpen={terminalScanOpen}
        storeId={user.storeNumber}
        onClose={() => setTerminalScanOpen(false)}
        onApply={(parsed, imageDataUrl, meta) => {
          setReceiptPhotoDataUrl(imageDataUrl);
          setReceiptParseMeta(meta);
          setReceiptParsedJson(parsed);
          applyTerminalReceiptScan(parsed);
        }}
      />

      {showInvoiceUpload && (
        <InvoiceUploadCard storeId={isOwner ? user.storeNumber : undefined} />
      )}

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Recent uploads
            </p>
            <h3 className="text-lg font-semibold text-white">
              Last 3 days · {storeLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={fetchRecentUploads}
            className="text-xs font-semibold text-blue-300 underline-offset-2 hover:underline"
          >
            Refresh
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-200">
          {recentStatus === "loading" && (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={`recent-upload-skeleton-${index}`}
                  className="rounded-2xl border border-white/10 bg-[#0c1329] p-4"
                >
                  <div className="ui-skeleton h-4 w-40" />
                  <div className="mt-2 ui-skeleton h-3 w-32" />
                  <div className="mt-3 ui-skeleton h-10 w-full" />
                </div>
              ))}
            </div>
          )}
          {recentStatus === "error" && (
            <p className="text-red-300">{recentError}</p>
          )}
          {recentStatus === "idle" && recentItems.length === 0 && (
            <p className="text-slate-300">
              No uploads from the past three days yet.
            </p>
          )}
          {recentItems.map((item) => {
            if (item.type === "shift") {
              const submission = item.submission;
              const attachments = [
                ...(submission.scratcherPhotos ?? []),
                submission.scratcherVideo,
                submission.cashPhoto,
                submission.salesPhoto,
              ].filter((file): file is StoredFile => Boolean(file));
              return (
                <div
                  key={`shift-${submission.id}`}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        {new Date(submission.createdAt).toLocaleString()}
                      </p>
                      {submission.shiftNotes && (
                        <p className="text-xs text-slate-300">
                          Notes: {submission.shiftNotes}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
                      Shift
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {attachments.map((file) => {
                      const proxyUrl = `/api/uploads/proxy?path=${encodeURIComponent(
                        file.path ?? file.id,
                      )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
                        file.originalName ?? file.label ?? "file",
                      )}`;
                      return (
                        <a
                          key={file.id}
                          href={proxyUrl}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-blue-200 transition hover:border-blue-400 hover:text-blue-100"
                        >
                          <p className="font-semibold text-white">
                            {file.label ?? "Attachment"}
                          </p>
                          <p className="truncate text-[11px] text-slate-300">
                            {file.originalName}
                          </p>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const record = item.record;
            return (
              <div
                key={`invoice-${record.id}`}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">
                      {new Date(record.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-300">
                      Invoice {record.invoiceNumber ?? "—"}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
                    Invoice
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {record.attachments.map((file) => {
                    const proxyUrl = `/api/uploads/proxy?path=${encodeURIComponent(
                      file.path ?? file.id,
                    )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
                      file.originalName ?? file.label ?? "file",
                    )}`;
                    return (
                      <a
                        key={file.id}
                        href={proxyUrl}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-blue-200 transition hover:border-blue-400 hover:text-blue-100"
                      >
                        <p className="font-semibold text-white">
                          {record.invoiceCompany ||
                            file.label ||
                            file.originalName ||
                            "Invoice file"}
                        </p>
                        <p className="truncate text-[11px] text-slate-300">
                          {file.originalName}
                        </p>
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
