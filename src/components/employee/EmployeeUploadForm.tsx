"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CombinedRecord,
  ReportItemConfig,
  SessionUser,
  ShiftSubmission,
} from "@/lib/types";
import { supabasePublic, publicBucket } from "@/lib/supabaseClient";
import clsx from "clsx";
import { getDefaultReportItems, normalizeReportItems } from "@/lib/reportConfig";
import EmployeeScratchersPanel from "@/components/scratchers/EmployeeScratchersPanel";

interface EmployeeUploadFormProps {
  user: SessionUser;
  className?: string;
}

const requiredFiles = [
  { id: "scratcherVideo", label: "Scratcher Count Video", accept: "video/*" },
  { id: "cashPhoto", label: "Cash Count Photo", accept: "image/*" },
  { id: "salesPhoto", label: "Sales Report Photo", accept: "image/*" },
];

export default function EmployeeUploadForm({
  user,
  className,
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
  const [invoiceStatus, setInvoiceStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [invoicePaid, setInvoicePaid] = useState(false);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState("");
  const [invoicePaymentAmount, setInvoicePaymentAmount] = useState("");
  const [invoiceCardLast4, setInvoiceCardLast4] = useState("");
  const [invoiceCheckNumber, setInvoiceCheckNumber] = useState("");
  const [invoiceAchLast4, setInvoiceAchLast4] = useState("");
  const [invoiceOtherDetails, setInvoiceOtherDetails] = useState("");
  const [savedCardLast4, setSavedCardLast4] = useState<string[]>([]);
  const [uploadingShift, setUploadingShift] = useState(false);
  const [scratcherFile, setScratcherFile] = useState<File | null>(null);
  const [reportConfig, setReportConfig] = useState<ReportItemConfig[]>(
    getDefaultReportItems(),
  );
  const [reportValues, setReportValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  const invoiceBanner = useMemo(() => {
    if (invoiceStatus === "success") {
      return "Invoice sent to manager and client.";
    }
    if (invoiceStatus === "error") {
      return invoiceMessage ?? "Invoice upload failed. Try again.";
    }
    return null;
  }, [invoiceMessage, invoiceStatus]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("ih-invoice-card-last4");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setSavedCardLast4(parsed.filter((entry) => typeof entry === "string"));
      }
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    if (!invoicePaid) {
      setInvoicePaymentMethod("");
      setInvoicePaymentAmount("");
      setInvoiceCardLast4("");
      setInvoiceCheckNumber("");
      setInvoiceAchLast4("");
      setInvoiceOtherDetails("");
    }
  }, [invoicePaid]);

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

    const scratcher = scratcherFile ?? formElement.scratcherVideo?.files?.[0];
    const cash = formElement.cashPhoto?.files?.[0];
    const sales = formElement.salesPhoto?.files?.[0];
    if (!scratcher || !cash || !sales) {
      setStatus("error");
      setErrorMessage("All three files are required.");
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
      { file: scratcher, label: "Scratcher Count Video", field: "scratcherVideo" },
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
      storeId: isOwner ? user.storeNumber : undefined,
      files: {
        scratcherVideo: {
          id: uploads[0].path,
          path: uploads[0].path,
          originalName: files[0].file.name,
          mimeType: files[0].file.type,
          size: files[0].file.size,
          label: files[0].label,
          kind: files[0].file.type.startsWith("video") ? "video" : "image",
        },
        cashPhoto: {
          id: uploads[1].path,
          path: uploads[1].path,
          originalName: files[1].file.name,
          mimeType: files[1].file.type,
          size: files[1].file.size,
          label: files[1].label,
          kind: "image",
        },
        salesPhoto: {
          id: uploads[2].path,
          path: uploads[2].path,
          originalName: files[2].file.name,
          mimeType: files[2].file.type,
          size: files[2].file.size,
          label: files[2].label,
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
    setScratcherFile(null);
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
                // iOS sometimes defaults to the front camera for video capture; force back camera.
                capture={file.id === "scratcherVideo" ? "environment" : undefined}
                className="mt-4 w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-300 file:mr-3 file:rounded-full file:border file:border-white/20 file:bg-white/5 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-100"
                onChange={(e) => {
                  if (file.id === "scratcherVideo") {
                    setScratcherFile(e.target.files?.[0] ?? null);
                  }
                }}
              />
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
          disabled={status === "sending" || uploadingShift}
          className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" || uploadingShift ? "Uploading..." : "Submit shift package"}
        </button>
      </form>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="mb-4 space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Invoices
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setInvoiceStatus("sending");
            setInvoiceMessage(null);
            const form = event.currentTarget;
            const formData = new FormData(form);
            formData.set("invoicePaid", invoicePaid ? "true" : "false");
            formData.set("invoiceDueDate", invoicePaid ? "" : invoiceDueDate);
            formData.set("invoicePaymentMethod", invoicePaid ? invoicePaymentMethod : "");
            formData.set("invoicePaymentAmount", invoicePaid ? invoicePaymentAmount : "");
            formData.set("invoicePaymentLast4", invoicePaid ? invoiceCardLast4 : "");
            formData.set("invoicePaymentCheckNumber", invoicePaid ? invoiceCheckNumber : "");
            formData.set("invoicePaymentAchLast4", invoicePaid ? invoiceAchLast4 : "");
            formData.set("invoicePaymentOther", invoicePaid ? invoiceOtherDetails : "");
            if (isOwner && user.storeNumber) {
              formData.set("storeId", user.storeNumber);
            }

            try {
              const response = await fetch("/api/invoices", {
                method: "POST",
                body: formData,
              });
              if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                setInvoiceStatus("error");
                setInvoiceMessage(
                  error?.error ?? "Unable to upload invoices right now.",
                );
                setTimeout(() => setInvoiceStatus("idle"), 6000);
                return;
              }
              form.reset();
              setInvoicePaid(false);
              setInvoiceDueDate("");
              setInvoicePaymentMethod("");
              setInvoicePaymentAmount("");
              setInvoiceCardLast4("");
              setInvoiceCheckNumber("");
              setInvoiceAchLast4("");
              setInvoiceOtherDetails("");
              if (invoicePaid && invoicePaymentMethod === "card" && invoiceCardLast4.length === 4) {
                const trimmed = invoiceCardLast4;
                setSavedCardLast4((prev) => {
                  const next = Array.from(new Set([trimmed, ...prev])).slice(0, 6);
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("ih-invoice-card-last4", JSON.stringify(next));
                  }
                  return next;
                });
              }
              setInvoiceStatus("success");
              setInvoiceMessage(null);
              setTimeout(() => setInvoiceStatus("idle"), 6000);
            } catch (error) {
              console.error(error);
              setInvoiceStatus("error");
              setInvoiceMessage("Network issue. Try again.");
              setTimeout(() => setInvoiceStatus("idle"), 6000);
            }
          }}
        >
          <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
            <div className="space-y-3">
              <label className="ui-label">Invoice files</label>
              <p className="text-xs text-slate-300">
                Attach clear photos or PDFs of invoices. You can select more than one.
              </p>
              <input
                required
                multiple
                type="file"
                name="invoiceFiles"
                accept="image/*,application/pdf"
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="space-y-3">
              <div className="grid gap-3">
                <div>
                  <label htmlFor="invoiceCompany" className="ui-label">
                    Company name
                  </label>
                  <input
                    id="invoiceCompany"
                    name="invoiceCompany"
                    required
                    placeholder="Enter company name"
                    className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="invoiceNumber" className="ui-label">
                    Invoice number
                  </label>
                  <input
                    id="invoiceNumber"
                    name="invoiceNumber"
                    required
                    placeholder="Enter invoice #"
                    className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="invoiceAmount" className="ui-label">
                    Total amount
                  </label>
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus-within:border-blue-400">
                    <span className="text-slate-300">$</span>
                    <input
                      id="invoiceAmount"
                      name="invoiceAmount"
                      required
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-300 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="ui-label">Payment status</label>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setInvoicePaid(false)}
                      className={clsx(
                        "rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]",
                        invoicePaid
                          ? "border-white/10 text-slate-400"
                          : "border-blue-400/60 text-blue-100",
                      )}
                    >
                      Due
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInvoicePaid(true);
                        setInvoiceDueDate("");
                      }}
                      className={clsx(
                        "rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]",
                        invoicePaid
                          ? "border-emerald-300/60 text-emerald-100"
                          : "border-white/10 text-slate-400",
                      )}
                    >
                      Paid
                    </button>
                  </div>
                </div>
                {!invoicePaid ? (
                  <div>
                    <label htmlFor="invoiceDueDate" className="ui-label">
                      Payment due date
                    </label>
                    <input
                      id="invoiceDueDate"
                      name="invoiceDueDate"
                      type="date"
                      required={!invoicePaid}
                      value={invoiceDueDate}
                      onChange={(event) => setInvoiceDueDate(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
                    <div>
                      <label htmlFor="invoicePaymentMethod" className="ui-label">
                        Payment method
                      </label>
                      <select
                        id="invoicePaymentMethod"
                        name="invoicePaymentMethod"
                        value={invoicePaymentMethod}
                        onChange={(event) => setInvoicePaymentMethod(event.target.value)}
                        required={invoicePaid}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                      >
                        <option value="">Select method</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="check">Check</option>
                        <option value="ach">ACH</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="invoicePaymentAmount" className="ui-label">
                        Payment amount
                      </label>
                      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus-within:border-blue-400">
                        <span className="text-slate-300">$</span>
                        <input
                          id="invoicePaymentAmount"
                          name="invoicePaymentAmount"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={invoicePaymentAmount}
                          onChange={(event) => setInvoicePaymentAmount(event.target.value)}
                          required={invoicePaid}
                          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-300 focus:outline-none"
                        />
                      </div>
                    </div>
                    {invoicePaymentMethod === "card" && (
                      <div className="space-y-2">
                        {savedCardLast4.length > 0 && (
                          <select
                            value=""
                            onChange={(event) => {
                              if (event.target.value) {
                                setInvoiceCardLast4(event.target.value);
                              }
                            }}
                            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                          >
                            <option value="">Use saved card</option>
                            {savedCardLast4.map((value) => (
                              <option key={value} value={value}>
                                Card ending {value}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          name="invoicePaymentLast4"
                          value={invoiceCardLast4}
                          onChange={(event) =>
                            setInvoiceCardLast4(event.target.value.replace(/\D/g, "").slice(0, 4))
                          }
                          placeholder="Card last 4 digits"
                          required={invoicePaid && invoicePaymentMethod === "card"}
                          className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                    )}
                    {invoicePaymentMethod === "check" && (
                      <input
                        name="invoicePaymentCheckNumber"
                        value={invoiceCheckNumber}
                        onChange={(event) => setInvoiceCheckNumber(event.target.value)}
                        placeholder="Check number"
                        required={invoicePaid && invoicePaymentMethod === "check"}
                        className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                      />
                    )}
                    {invoicePaymentMethod === "ach" && (
                      <input
                        name="invoicePaymentAchLast4"
                        value={invoiceAchLast4}
                        onChange={(event) =>
                          setInvoiceAchLast4(event.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                        placeholder="Account last 4 digits"
                        required={invoicePaid && invoicePaymentMethod === "ach"}
                        className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                      />
                    )}
                    {invoicePaymentMethod === "other" && (
                      <textarea
                        name="invoicePaymentOther"
                        value={invoiceOtherDetails}
                        onChange={(event) => setInvoiceOtherDetails(event.target.value)}
                        placeholder="Describe how it was paid"
                        required={invoicePaid && invoicePaymentMethod === "other"}
                        rows={3}
                        className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                      />
                    )}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="invoiceNotes" className="ui-label">
                  Notes (optional)
                </label>
                <textarea
                  id="invoiceNotes"
                  name="invoiceNotes"
                  rows={4}
                  placeholder="Add quick context or totals."
                  className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {invoiceBanner && (
            <div
              className={clsx(
                "rounded-xl px-4 py-3 text-sm",
                invoiceStatus === "success"
                  ? "bg-emerald-500/10 text-emerald-200"
                  : "bg-red-500/10 text-red-200",
              )}
            >
              {invoiceBanner}
            </div>
          )}

          <button
            type="submit"
            disabled={invoiceStatus === "sending"}
            className="w-full rounded-2xl bg-emerald-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {invoiceStatus === "sending" ? "Sending invoices…" : "Send invoices"}
          </button>
        </form>
      </div>

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
                submission.scratcherVideo,
                submission.cashPhoto,
                submission.salesPhoto,
              ].filter(Boolean);
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
