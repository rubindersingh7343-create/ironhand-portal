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
import IHModal from "@/components/ui/IHModal";
import InvoiceUploadCard from "@/components/invoices/InvoiceUploadCard";

interface EmployeeUploadFormProps {
  user: SessionUser;
  className?: string;
  showInvoiceUpload?: boolean;
}

const requiredFiles = [
  { id: "cashPhoto", label: "Cash Count Photo", accept: "image/*" },
  { id: "salesPhoto", label: "Sales Report Photo", accept: "image/*" },
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
  const [scratcherRowPhotos, setScratcherRowPhotos] = useState<Array<File | null>>(
    () => Array.from({ length: 2 }).map(() => null),
  );
  const [scratcherRowPreviewUrls, setScratcherRowPreviewUrls] = useState<
    Array<string | null>
  >(() => Array.from({ length: 2 }).map(() => null));
  const [scratcherCaptureOpen, setScratcherCaptureOpen] = useState(false);
  const [scratcherCaptureRow, setScratcherCaptureRow] = useState<number>(0);
  const [scratcherPreviewUrl, setScratcherPreviewUrl] = useState<string | null>(
    null,
  );
  const [scratcherTempFile, setScratcherTempFile] = useState<File | null>(null);
  const scratcherCaptureInputRef = useRef<HTMLInputElement | null>(null);
  const scratcherTempUrlRef = useRef<string | null>(null);
  const scratcherRowPreviewUrlsRef = useRef<Array<string | null>>(
    Array.from({ length: 2 }).map(() => null),
  );
  const [reportConfig, setReportConfig] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );
  const [reportValues, setReportValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const scratcherCapturedCount = useMemo(
    () => scratcherRowPhotos.filter(Boolean).length,
    [scratcherRowPhotos],
  );
  const scratcherFirstMissingRow = useMemo(() => {
    const idx = scratcherRowPhotos.findIndex((file) => !file);
    return idx >= 0 ? idx : 0;
  }, [scratcherRowPhotos]);

  useEffect(() => {
    return () => {
      if (scratcherTempUrlRef.current) {
        URL.revokeObjectURL(scratcherTempUrlRef.current);
        scratcherTempUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    scratcherRowPreviewUrlsRef.current = scratcherRowPreviewUrls;
  }, [scratcherRowPreviewUrls]);

  useEffect(() => {
    return () => {
      scratcherRowPreviewUrlsRef.current.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const resetScratcherTemp = useCallback(() => {
    setScratcherTempFile(null);
    if (scratcherTempUrlRef.current) {
      URL.revokeObjectURL(scratcherTempUrlRef.current);
      scratcherTempUrlRef.current = null;
    }
    setScratcherPreviewUrl(null);
  }, []);

  const closeScratcherCapture = useCallback(() => {
    resetScratcherTemp();
    setScratcherCaptureOpen(false);
  }, [resetScratcherTemp]);

  const openScratcherCapture = useCallback(
    (row: number) => {
      resetScratcherTemp();
      setScratcherCaptureRow(row);
      setScratcherCaptureOpen(true);
    },
    [resetScratcherTemp],
  );

  const triggerScratcherCamera = () => {
    const input = scratcherCaptureInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

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

  const toNumber = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const cashTotal = useMemo(() => {
    const gross = toNumber(reportValues.gross ?? "");
    const lottoPo = toNumber(reportValues.lottoPo ?? "");
    const atm = toNumber(reportValues.atm ?? "");
    return gross - lottoPo - atm;
  }, [reportValues.gross, reportValues.lottoPo, reportValues.atm, toNumber]);

  const storeTotal = useMemo(() => {
    const gross = toNumber(reportValues.gross ?? "");
    const scr = toNumber(reportValues.scr ?? "");
    const lotto = toNumber(reportValues.lotto ?? "");
    return gross - (scr + lotto);
  }, [reportValues.gross, reportValues.lotto, reportValues.scr, toNumber]);

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
        const activeSlots = slots.filter((slot: any) => slot?.isActive);

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

    const cash = formElement.cashPhoto?.files?.[0];
    const sales = formElement.salesPhoto?.files?.[0];
    const scratcherPhotos = scratcherRowPhotos.filter(
      (file): file is File => Boolean(file),
    );
    if (scratcherPhotos.length !== 2 || !cash || !sales) {
      setStatus("error");
      setErrorMessage(
        "Please upload 2 scratcher photos (rows 1-4 and 5-8), plus cash + sales photos.",
      );
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
      ...scratcherPhotos.map((file, index) => ({
        file,
        label: index === 0 ? "Scratcher Rows 1-4" : "Scratcher Rows 5-8",
        field: `scratcherRow${index + 1}`,
      })),
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
    const scratcherPhotosMeta = uploads
      .slice(0, 2)
      .map((upload: any, index: number) => ({
        id: upload.path,
        path: upload.path,
        originalName: files[index].file.name,
        mimeType: files[index].file.type,
        size: files[index].file.size,
        label: files[index].label,
        kind: "image" as const,
      }));
    const payload = {
      shiftNotes: formElement.shiftNotes?.value ?? "",
      reportFields,
      customFields,
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
        scratcherPhotos: scratcherPhotosMeta,
        cashPhoto: {
          id: uploads[2].path,
          path: uploads[2].path,
          originalName: files[2].file.name,
          mimeType: files[2].file.type,
          size: files[2].file.size,
          label: files[2].label,
          kind: "image",
        },
        salesPhoto: {
          id: uploads[3].path,
          path: uploads[3].path,
          originalName: files[3].file.name,
          mimeType: files[3].file.type,
          size: files[3].file.size,
          label: files[3].label,
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
    setScratcherRowPhotos(Array.from({ length: 2 }).map(() => null));
    setScratcherRowPreviewUrls((prev) => {
      prev.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      return Array.from({ length: 2 }).map(() => null);
    });
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
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {standardItems.map((field) => (
            <div key={field.key} className="space-y-2">
              <label className="ui-label">{field.label}</label>
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus-within:border-blue-400">
                <span className="text-slate-300">$</span>
                <input
                  ref={(el) => {
                    inputRefs.current[field.key] = el;
                  }}
                  value={reportValues[field.key] ?? ""}
                  onChange={(event) =>
                    setReportValues((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }))
                  }
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Cash
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              ${cashTotal.toFixed(2)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0f1a33] px-4 py-3 text-sm text-slate-200">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Store
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              ${storeTotal.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
              Custom fields
            </p>
          </div>
          {customItems.length === 0 ? (
            <p className="text-sm text-slate-400">
              No store-specific items configured yet.
            </p>
          ) : (
            <div className="space-y-3">
              {customItems.map((field) => (
                <div key={field.key} className="grid gap-3 sm:grid-cols-[2fr,1fr]">
                  <div className="flex items-center rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100">
                    {field.label}
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus-within:border-blue-400">
                    <span className="text-slate-300">$</span>
                    <input
                      ref={(el) => {
                        inputRefs.current[field.key] = el;
                      }}
                      value={customValues[field.key] ?? ""}
                      onChange={(event) =>
                        setCustomValues((prev) => ({
                          ...prev,
                          [field.key]: event.target.value,
                        }))
                      }
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
          )}
        </div>

        <EmployeeScratchersPanel user={user} />

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

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Scratcher Count
              </p>
              <h3 className="mt-1 text-lg font-semibold text-white">
                2 photos (rows 1-4 and 5-8)
              </h3>
              <p className="mt-1 text-sm text-slate-300">
                Take two clear photos: first for rows 1-4 (slots 1-16), then rows 5-8 (slots 17-32).
              </p>
            </div>
            <button
              type="button"
              className="ui-button"
              onClick={() => {
                const done = scratcherCapturedCount === 2;
                const row = done ? 0 : scratcherFirstMissingRow;
                openScratcherCapture(row);
                if (!done) {
                  // Must be triggered directly from a user gesture on iOS.
                  triggerScratcherCamera();
                }
              }}
            >
              {scratcherCapturedCount === 0
                ? "Start photos"
                : scratcherCapturedCount === 2
                  ? "Review photos"
                  : `Continue (${scratcherCapturedCount}/2)`}
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => {
              const hasPhoto = Boolean(scratcherRowPhotos[index]);
              return (
                <button
                  key={`scratcher-row-chip-${index}`}
                  type="button"
                  onClick={() => {
                    const hasPhoto = Boolean(scratcherRowPhotos[index]);
                    openScratcherCapture(index);
                    if (!hasPhoto) {
                      // If it's missing, jump straight into capture.
                      triggerScratcherCamera();
                    }
                  }}
                  className={clsx(
                    "rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition",
                    hasPhoto
                      ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/70"
                      : "border-white/15 bg-white/5 text-slate-200 hover:border-white/40",
                  )}
                >
                  {index === 0 ? "Rows 1-4" : "Rows 5-8"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {requiredFiles.map((file) => (
            <label
              key={file.id}
              className="flex h-full w-full min-w-0 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-dashed border-white/15 bg-[#121f3e] p-4 text-sm text-slate-200 transition hover:border-blue-400"
            >
              <span className="font-semibold text-white">{file.label}</span>
              <span className="mt-2 text-xs text-slate-400">
                Upload {file.accept.startsWith("video") ? "video" : "photo"}
              </span>
              <input
                required
                type="file"
                accept={file.accept}
                name={file.id}
                className="mt-4 w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-300 file:mr-3 file:rounded-full file:border file:border-white/20 file:bg-white/5 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-100"
                onChange={() => {}}
              />
            </label>
          ))}
        </div>

        <input
          ref={scratcherCaptureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          // iOS Safari/Capacitor can block programmatic clicks on `display:none` inputs.
          // Keep it visually hidden but still in the layout tree.
          className="sr-only"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            if (!next) return;
            if (scratcherTempUrlRef.current) {
              URL.revokeObjectURL(scratcherTempUrlRef.current);
              scratcherTempUrlRef.current = null;
            }
            const url = URL.createObjectURL(next);
            scratcherTempUrlRef.current = url;

            const row = scratcherCaptureRow;
            const nextPhotos = [...scratcherRowPhotos];
            nextPhotos[row] = next;
            setScratcherRowPhotos(nextPhotos);

            setScratcherRowPreviewUrls((prev) => {
              const nextUrls = [...prev];
              if (nextUrls[row]) URL.revokeObjectURL(nextUrls[row] as string);
              nextUrls[row] = url;
              return nextUrls;
            });

            setScratcherTempFile(null);
            setScratcherPreviewUrl(null);
            scratcherTempUrlRef.current = null; // ownership moved to scratcherRowPreviewUrls

            const nextMissing = nextPhotos.findIndex(
              (file, index) => index > row && !file,
            );
            const fallback = nextPhotos.findIndex((file) => !file);
            const done = fallback < 0;
            if (done) {
              setScratcherCaptureOpen(false);
              return;
            }
            const nextRow = nextMissing >= 0 ? nextMissing : fallback;
            setScratcherCaptureRow(nextRow);
            triggerScratcherCamera();

            event.currentTarget.value = "";
          }}
        />

        <IHModal
          isOpen={scratcherCaptureOpen}
          onClose={closeScratcherCapture}
          allowOutsideClose
          panelClassName="no-transform"
          labelledBy="scratcher-capture-title"
        >
          <div className="space-y-4 p-5">
            <div>
              <p
                id="scratcher-capture-title"
                className="text-xs uppercase tracking-[0.3em] text-slate-300"
              >
                Scratcher photo
              </p>
              <p className="mt-2 text-sm text-slate-200">
                Photo <span className="font-semibold">{scratcherCaptureRow + 1}</span> of{" "}
                <span className="font-semibold">2</span> ·{" "}
                <span className="font-semibold">
                  {scratcherCaptureRow === 0 ? "Rows 1-4" : "Rows 5-8"}
                </span>{" "}
                (slots {scratcherCaptureRow === 0 ? "1-16" : "17-32"})
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => {
                const hasPhoto = Boolean(scratcherRowPhotos[index]);
                const active = index === scratcherCaptureRow;
                return (
                  <button
                    key={`scratcher-row-select-${index}`}
                    type="button"
                    onClick={() => {
                      setScratcherCaptureRow(index);
                      resetScratcherTemp();
                    }}
                    className={clsx(
                      "rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition",
                      active
                        ? "border-blue-400/60 bg-blue-500/10 text-blue-100"
                        : hasPhoto
                          ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/70"
                          : "border-white/15 bg-white/5 text-slate-200 hover:border-white/40",
                    )}
                  >
                    {index === 0 ? "Rows 1-4" : "Rows 5-8"}
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              {scratcherPreviewUrl ? (
                // Preview freshly captured photo (before confirming)
                <img
                  src={scratcherPreviewUrl}
                  alt={`Scratcher photo ${scratcherCaptureRow + 1}`}
                  className="w-full rounded-xl object-contain"
                />
              ) : scratcherRowPreviewUrls[scratcherCaptureRow] ? (
                <img
                  src={scratcherRowPreviewUrls[scratcherCaptureRow] as string}
                  alt={`Scratcher photo ${scratcherCaptureRow + 1}`}
                  className="w-full rounded-xl object-contain"
                />
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-300">
                  No photo yet. Tap “Take photo”.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  resetScratcherTemp();
                  triggerScratcherCamera();
                }}
                className="ui-button ui-button-ghost"
              >
                {scratcherRowPhotos[scratcherCaptureRow] || scratcherTempFile
                  ? "Retake"
                  : "Take photo"}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!scratcherTempFile}
                  onClick={() => {
                    if (!scratcherTempFile || !scratcherPreviewUrl) return;
                    const row = scratcherCaptureRow;
                    const tempFile = scratcherTempFile;
                    const tempUrl = scratcherPreviewUrl;

                    const nextPhotos = [...scratcherRowPhotos];
                    nextPhotos[row] = tempFile;
                    setScratcherRowPhotos(nextPhotos);

                    setScratcherRowPreviewUrls((prev) => {
                      const next = [...prev];
                      if (next[row]) URL.revokeObjectURL(next[row] as string);
                      next[row] = tempUrl;
                      return next;
                    });

                    setScratcherTempFile(null);
                    setScratcherPreviewUrl(null);
                    scratcherTempUrlRef.current = null; // ownership moved to scratcherRowPreviewUrls

                    const nextMissing = nextPhotos.findIndex(
                      (file, index) => index > row && !file,
                    );
                    const fallback = nextPhotos.findIndex((file) => !file);
                    const done = fallback < 0;
                    if (done) {
                      setScratcherCaptureOpen(false);
                      return;
                    }
                    const nextRow = nextMissing >= 0 ? nextMissing : fallback;
                    setScratcherCaptureRow(nextRow);
                    // Convenience: once confirmed, immediately open camera for the next row.
                    triggerScratcherCamera();
                  }}
                  className="ui-button ui-button-primary disabled:opacity-60"
                >
                  Looks good
                </button>
              </div>
            </div>
          </div>
        </IHModal>

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
          disabled={status === "sending" || uploadingShift}
          className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" || uploadingShift ? "Uploading..." : "Submit shift package"}
        </button>
      </form>

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
