"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

type InvoiceUploadCardProps = {
  storeId?: string;
  storeLabel?: string;
  className?: string;
};

type InvoiceDuePreset = "custom" | "1w" | "2w" | "3w" | "1m";

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatLocalDateInput = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[index]}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMonthsClamped = (date: Date, months: number) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const nextMonthIndex = month + months;
  const targetYear = year + Math.floor(nextMonthIndex / 12);
  const targetMonth = ((nextMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(targetYear, targetMonth, clampedDay);
};

export default function InvoiceUploadCard({
  storeId,
  storeLabel,
  className,
}: InvoiceUploadCardProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);

  const [invoiceStatus, setInvoiceStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [invoicePaid, setInvoicePaid] = useState(false);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceDuePreset, setInvoiceDuePreset] =
    useState<InvoiceDuePreset>("custom");
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState("");
  const [invoicePaymentAmount, setInvoicePaymentAmount] = useState("");
  const [invoiceCardLast4, setInvoiceCardLast4] = useState("");
  const [invoiceCheckNumber, setInvoiceCheckNumber] = useState("");
  const [invoiceAchLast4, setInvoiceAchLast4] = useState("");
  const [invoiceOtherDetails, setInvoiceOtherDetails] = useState("");
  const [savedCardLast4, setSavedCardLast4] = useState<string[]>([]);

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
    } else {
      setInvoiceDuePreset("custom");
    }
  }, [invoicePaid]);

  const invoiceBanner = useMemo(() => {
    if (invoiceStatus === "success") {
      return "Invoice sent to manager and client.";
    }
    if (invoiceStatus === "error") {
      return invoiceMessage ?? "Invoice upload failed. Try again.";
    }
    return null;
  }, [invoiceMessage, invoiceStatus]);

  const applyDuePreset = (preset: InvoiceDuePreset) => {
    setInvoiceDuePreset(preset);
    if (preset === "custom") return;
    const today = new Date();
    const target =
      preset === "1w"
        ? addDays(today, 7)
        : preset === "2w"
          ? addDays(today, 14)
          : preset === "3w"
            ? addDays(today, 21)
            : addMonthsClamped(today, 1);
    setInvoiceDueDate(formatLocalDateInput(target));
  };

  const appendInvoiceFiles = (files: File[]) => {
    if (!files.length) return;
    setInvoiceFiles((prev) => {
      const next = [...prev];
      files.forEach((file) => {
        if (!file || !file.name || file.size <= 0) return;
        const isDuplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!isDuplicate) next.push(file);
      });
      return next;
    });
  };

  return (
    <div
      className={clsx("rounded-3xl border border-white/10 bg-white/5 p-5", className)}
    >
      <div className="mb-4 space-y-1">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
          Invoices
        </p>
        {storeLabel ? (
          <p className="text-xs text-slate-400">Uploading for {storeLabel}</p>
        ) : null}
      </div>

      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setInvoiceStatus("sending");
          setInvoiceMessage(null);
          const form = event.currentTarget;
          const formData = new FormData(form);
          formData.delete("invoiceFiles");
          formData.set("invoicePaid", invoicePaid ? "true" : "false");
          formData.set("invoiceDueDate", invoicePaid ? "" : invoiceDueDate);
          formData.set("invoicePaymentMethod", invoicePaid ? invoicePaymentMethod : "");
          formData.set("invoicePaymentAmount", invoicePaid ? invoicePaymentAmount : "");
          formData.set("invoicePaymentLast4", invoicePaid ? invoiceCardLast4 : "");
          formData.set("invoicePaymentCheckNumber", invoicePaid ? invoiceCheckNumber : "");
          formData.set("invoicePaymentAchLast4", invoicePaid ? invoiceAchLast4 : "");
          formData.set("invoicePaymentOther", invoicePaid ? invoiceOtherDetails : "");
          if (storeId) {
            formData.set("storeId", storeId);
          }

          try {
            if (invoiceFiles.length === 0) {
              setInvoiceStatus("error");
              setInvoiceMessage("Attach at least one invoice page (photo or PDF).");
              setTimeout(() => setInvoiceStatus("idle"), 6000);
              return;
            }
            invoiceFiles.forEach((file) => {
              formData.append("invoiceFiles", file, file.name);
            });

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
            setInvoiceFiles([]);
            setInvoicePaid(false);
            setInvoiceDueDate("");
            setInvoicePaymentMethod("");
            setInvoicePaymentAmount("");
            setInvoiceCardLast4("");
            setInvoiceCheckNumber("");
            setInvoiceAchLast4("");
            setInvoiceOtherDetails("");
            if (
              invoicePaid &&
              invoicePaymentMethod === "card" &&
              invoiceCardLast4.length === 4
            ) {
              const trimmed = invoiceCardLast4;
              setSavedCardLast4((prev) => {
                const next = Array.from(new Set([trimmed, ...prev])).slice(0, 6);
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(
                    "ih-invoice-card-last4",
                    JSON.stringify(next),
                  );
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
              Add each invoice page (photo or PDF). On iPhone/iPad, use{" "}
              <span className="font-semibold text-slate-100">Add photo page</span>{" "}
              to capture multiple pages one at a time.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="ui-button--slim ui-pill-primary"
                disabled={invoiceStatus === "sending"}
                onClick={() => cameraInputRef.current?.click()}
              >
                Add photo page
              </button>
              <button
                type="button"
                className="ui-button--slim ui-pill-secondary"
                disabled={invoiceStatus === "sending"}
                onClick={() => pickerInputRef.current?.click()}
              >
                Add from library / PDF
              </button>
              {invoiceFiles.length ? (
                <span className="text-xs text-slate-300">
                  {invoiceFiles.length} page{invoiceFiles.length === 1 ? "" : "s"} added
                </span>
              ) : null}
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                appendInvoiceFiles(files);
                event.target.value = "";
              }}
            />

            <input
              ref={pickerInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                appendInvoiceFiles(files);
                event.target.value = "";
              }}
            />

            {invoiceFiles.length ? (
              <div className="space-y-2">
                {invoiceFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-white/10 bg-[#0c1329] px-4 py-3 text-sm text-slate-200"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white break-words text-wrap">
                        {file.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatBytes(file.size)}{" "}
                        {file.type ? `· ${file.type}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ui-button--slim ui-pill-danger"
                      onClick={() =>
                        setInvoiceFiles((prev) =>
                          prev.filter((_, idx) => idx !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-[#0c1329] px-4 py-3 text-xs text-slate-400">
                No pages added yet.
              </div>
            )}
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
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        { id: "1w", label: "1 week" },
                        { id: "2w", label: "2 weeks" },
                        { id: "3w", label: "3 weeks" },
                        { id: "1m", label: "1 month" },
                        { id: "custom", label: "Custom" },
                      ] as const
                    ).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyDuePreset(preset.id)}
                        className={clsx(
                          "rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]",
                          invoiceDuePreset === preset.id
                            ? "border-blue-400/60 text-blue-100"
                            : "border-white/10 text-slate-400",
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <input
                    id="invoiceDueDate"
                    name="invoiceDueDate"
                    type="date"
                    required={!invoicePaid}
                    value={invoiceDueDate}
                    onChange={(event) => {
                      setInvoiceDueDate(event.target.value);
                      setInvoiceDuePreset("custom");
                    }}
                    className="invoice-date w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
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
                          setInvoiceCardLast4(
                            event.target.value.replace(/\\D/g, "").slice(0, 4),
                          )
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
                        setInvoiceAchLast4(
                          event.target.value.replace(/\\D/g, "").slice(0, 4),
                        )
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
  );
}
