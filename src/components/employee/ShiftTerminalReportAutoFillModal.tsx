"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import IHModal from "@/components/ui/IHModal";
import type { NrsTerminalReportJson } from "@/lib/receiptParsing/nrsTerminalReport";

type ParseResponse = {
  raw_text: string;
  normalized_text: string;
  parsed_json: NrsTerminalReportJson;
  confidence_score: number;
  missing_fields: string[];
  parse_version: string;
  used_llm_fallback: boolean;
};

type ScanState = "PREVIEW" | "CAPTURING" | "PROCESSING" | "REVIEW" | "ERROR";

export type ReceiptParseMeta = Pick<
  ParseResponse,
  | "raw_text"
  | "normalized_text"
  | "confidence_score"
  | "missing_fields"
  | "parse_version"
  | "used_llm_fallback"
>;

type Props = {
  isOpen: boolean;
  storeId: string;
  onClose: () => void;
  onApply: (parsed: NrsTerminalReportJson, imageDataUrl: string, meta: ReceiptParseMeta) => void;
};

const money = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(2);
};

const parseInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[$,]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function ShiftTerminalReportAutoFillModal({
  isOpen,
  storeId,
  onClose,
  onApply,
}: Props) {
  const [scanState, setScanState] = useState<ScanState>("PREVIEW");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [parse, setParse] = useState<ParseResponse | null>(null);
  const [working, setWorking] = useState<NrsTerminalReportJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setScanState("PREVIEW");
    setCapturedImage(null);
    setParse(null);
    setWorking(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    reset();
  }, [isOpen, reset]);

  const triggerCapture = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    setScanState("CAPTURING");
    input.click();
  }, []);

  const runParse = useCallback(
    async (imageDataUrl: string) => {
      requestAbortRef.current?.abort();
      const abort = new AbortController();
      requestAbortRef.current = abort;
      setError(null);
      setParse(null);
      setWorking(null);
      setScanState("PROCESSING");

      try {
        const response = await fetch("/api/receipt/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image_base64: imageDataUrl, storeId }),
          signal: abort.signal,
        });

        const payload = (await response.json().catch(() => ({}))) as any;
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to parse the receipt.");
        }

        const parsed = payload as ParseResponse;
        setParse(parsed);
        setWorking(parsed.parsed_json);
        setScanState("REVIEW");
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to parse the receipt.");
        setScanState("ERROR");
      }
    },
    [storeId],
  );

  const confidenceBadge = useMemo(() => {
    const score = parse?.confidence_score ?? 0;
    if (score >= 7) return { label: "High", cls: "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" };
    if (score >= 6) return { label: "OK", cls: "border-blue-300/40 bg-blue-500/10 text-blue-100" };
    return { label: "Low", cls: "border-amber-300/40 bg-amber-500/10 text-amber-100" };
  }, [parse?.confidence_score]);

  const updateField = (key: keyof Omit<NrsTerminalReportJson, "categories" | "meta">, value: string) => {
    setWorking((prev) => {
      if (!prev) return prev;
      const parsed = parseInput(value);
      return { ...prev, [key]: parsed };
    });
  };

  const updateMeta = (key: keyof NrsTerminalReportJson["meta"], value: string) => {
    setWorking((prev) => {
      if (!prev) return prev;
      return { ...prev, meta: { ...(prev.meta ?? {}), [key]: value } };
    });
  };

  const updateCategory = (key: string, value: string) => {
    setWorking((prev) => {
      if (!prev) return prev;
      const parsed = parseInput(value);
      const nextCats = { ...(prev.categories ?? {}) } as any;
      if (parsed === null) {
        delete nextCats[key];
      } else {
        nextCats[key] = parsed;
      }
      return {
        ...prev,
        ...(Object.keys(nextCats).length ? { categories: nextCats } : { categories: undefined }),
      };
    });
  };

  const canApply = Boolean(capturedImage && working);

  return (
    <IHModal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      allowOutsideClose
      labelledBy="nrs-receipt-scan-title"
      panelClassName="no-transform"
    >
      <div className="space-y-4 p-5 text-white">
        <div className="space-y-1">
          <p
            id="nrs-receipt-scan-title"
            className="text-xs uppercase tracking-[0.3em] text-slate-300"
          >
            Take Pic (Auto-Fill)
          </p>
          <p className="text-sm text-slate-200">
            Take a photo of the NRS “Terminal Reports” receipt. Review, edit, then apply to the shift report.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          {capturedImage ? (
            <img
              src={capturedImage}
              alt="Receipt capture"
              className="max-h-[52vh] w-full rounded-xl object-contain"
            />
          ) : (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-300">
              Take a clear photo of the full receipt (Terminal Report).
            </div>
          )}
        </div>

        {scanState === "PROCESSING" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <div className="ui-spinner" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-white">Parsing…</p>
                <p className="text-xs text-slate-300">Extracting text + matching fields.</p>
              </div>
            </div>
          </div>
        )}

        {scanState === "ERROR" && error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        {scanState === "REVIEW" && working && (
          <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-300">
                  Review & confirm
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  Tap any field to edit, then apply to your shift report.
                </p>
              </div>
              <span className={clsx("rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]", confidenceBadge.cls)}>
                {confidenceBadge.label}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0c152d] p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Sales</p>
                <div className="mt-3 grid gap-2">
                  <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
                    Gross Sales
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">$</span>
                      <input
                        value={money(working.gross_sales)}
                        onChange={(e) => updateField("gross_sales", e.target.value)}
                        inputMode="decimal"
                        className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                        placeholder="0.00"
                      />
                    </span>
                  </label>
                  <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
                    Net Sales
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">$</span>
                      <input
                        value={money(working.net_sales)}
                        onChange={(e) => updateField("net_sales", e.target.value)}
                        inputMode="decimal"
                        className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                        placeholder="0.00"
                      />
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#0c152d] p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Payments</p>
                <div className="mt-3 grid gap-2">
                  {(["cash", "check", "credit_debit"] as const).map((key) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-xs text-slate-300">
                      {key === "credit_debit" ? "Credit/Debit" : key.charAt(0).toUpperCase() + key.slice(1)}
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400">$</span>
                        <input
                          value={money(working[key])}
                          onChange={(e) => updateField(key, e.target.value)}
                          inputMode="decimal"
                          className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                          placeholder="0.00"
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0c152d] p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Taxes</p>
                <div className="mt-3 grid gap-2">
                  {([
                    ["taxable_sales", "Taxable Sales"],
                    ["tax_collected", "Tax"],
                    ["crv_fee", "CRV Fee"],
                    ["total_tax_and_fees", "Total Tax & Fees"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-xs text-slate-300">
                      {label}
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400">$</span>
                        <input
                          value={money(working[key])}
                          onChange={(e) => updateField(key, e.target.value)}
                          inputMode="decimal"
                          className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                          placeholder="0.00"
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#0c152d] p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Lotto & Scratchers</p>
                <div className="mt-3 grid gap-2">
                  {([
                    ["lotto_sales", "Lotto Sales"],
                    ["scratcher_sales", "Scratcher Sales"],
                    ["lotto_payout", "Lotto Redemption"],
                    ["scratcher_payout", "Scratcher Redemption"],
                    ["cashback_lottery", "Cashback (Lottery)"],
                    ["cashback_scratch", "Cashback (Scratch)"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-xs text-slate-300">
                      {label}
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400">$</span>
                        <input
                          value={money(working[key])}
                          onChange={(e) => updateField(key, e.target.value)}
                          inputMode="decimal"
                          className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                          placeholder="0.00"
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {working.categories && (
              <div className="rounded-2xl border border-white/10 bg-[#0c152d] p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Net Product Sales</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(working.categories).map(([key, value]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-xs text-slate-300">
                      {key.replace(/_/g, " ")}
                      <span className="flex items-center gap-2">
                        <span className="text-slate-400">$</span>
                        <input
                          value={money(value)}
                          onChange={(e) => updateCategory(key, e.target.value)}
                          inputMode="decimal"
                          className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                          placeholder="0.00"
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Meta</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {([
                  ["report_start", "Report start"],
                  ["report_end", "Report end"],
                  ["terminal_id", "Terminal ID"],
                  ["printed_at", "Printed at"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-2 text-xs text-slate-300">
                    {label}
                    <input
                      value={String((working.meta as any)?.[key] ?? "")}
                      onChange={(e) => updateMeta(key as any, e.target.value)}
                      className="rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                      placeholder="—"
                    />
                  </label>
                ))}
              </div>
              {parse?.missing_fields?.length ? (
                <p className="mt-3 text-xs text-slate-300">
                  Missing: {parse.missing_fields.slice(0, 8).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="ui-button ui-button-ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel (manual)
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ui-button ui-button-ghost"
              onClick={() => {
                reset();
                triggerCapture();
              }}
            >
              {capturedImage ? "Retake" : "Take photo"}
            </button>

            <button
              type="button"
              className="ui-button ui-button-primary disabled:opacity-60"
              disabled={!canApply}
              onClick={() => {
                if (!capturedImage || !working || !parse) return;
                const meta: ReceiptParseMeta = {
                  raw_text: parse.raw_text,
                  normalized_text: parse.normalized_text,
                  confidence_score: parse.confidence_score,
                  missing_fields: parse.missing_fields,
                  parse_version: parse.parse_version,
                  used_llm_fallback: parse.used_llm_fallback,
                };
                onApply(working, capturedImage, meta);
                reset();
                onClose();
              }}
            >
              Apply to shift report
            </button>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (!file) {
              setScanState("PREVIEW");
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = typeof reader.result === "string" ? reader.result : null;
              if (!dataUrl) {
                setError("Unable to read that photo.");
                setScanState("ERROR");
                return;
              }
              setCapturedImage(dataUrl);
              runParse(dataUrl);
            };
            reader.onerror = () => {
              setError("Unable to read that photo.");
              setScanState("ERROR");
            };
            reader.readAsDataURL(file);
          }}
        />
      </div>
    </IHModal>
  );
}

