"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import IHModal from "@/components/ui/IHModal";

type ScanState = "PREVIEW" | "CAPTURING" | "PROCESSING" | "RESULT" | "ERROR";

type ReceiptCategoryKey =
  | "gross"
  | "scr"
  | "lotto"
  | "liquor"
  | "beer"
  | "cigarettes"
  | "tobacco"
  | "gas"
  | "lotto_payout";

type ReceiptParseCategory = {
  key: ReceiptCategoryKey;
  label: string;
  amount: number | null;
  confidence: number;
  evidence_text: string;
};

type ReceiptParseUnknownLine = {
  text: string;
  amount: number | null;
  confidence: number;
};

type ReceiptParseResult = {
  vendor: string | null;
  date: string | null;
  categories: ReceiptParseCategory[];
  unknown_lines: ReceiptParseUnknownLine[];
  notes: string[];
};

type ReasoningReceiptResponse = {
  extraction: {
    vendor?: string | null;
    date?: string | null;
    currency?: "USD";
    fields: Array<{
      key: string;
      label?: string | null;
      amount?: number | null;
      units?: number | null;
      confidence: number;
      evidence?: { notes?: string | null } | null;
    }>;
    anomalies: Array<{ type: string; message: string; related_key?: string | null }>;
    needs_confirmation: string[];
    reasoning_summary: string;
  };
  meta: {
    request_id: string;
    parse_version: string;
    used_multipass: boolean;
    passes: number;
    cached: boolean;
    total_latency_ms: number;
  };
};

type ReceiptVisionV2Response = {
  extraction: {
    vendor: string | null;
    date: string | null;
    fields: Array<{
      key: string;
      label: string | null;
      amount: number | null;
      units: number | null;
      confidence: number;
      evidence: { note: string | null };
    }>;
    anomalies: Array<{ type: string; message: string; related_key: string | null }>;
    needs_confirmation: string[];
    reasoning_summary: string;
  };
  meta: {
    request_id: string;
    model: string;
    passes: number;
    used_multipass: boolean;
    total_latency_ms: number;
  };
};

export type ShiftReceiptSalesFields = {
  gross: number | null;
  scr: number | null;
  lotto: number | null;
  liquor: number | null;
  beer: number | null;
  cigarettes: number | null;
  tobacco: number | null;
  gas: number | null;
  lotto_payout: number | null;
};

type ShiftReceiptScanModalProps = {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  onApply: (result: ShiftReceiptSalesFields, imageDataUrl: string) => void;
};

const money = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
};

const hasAnyValue = (result: ShiftReceiptSalesFields | null) => {
  if (!result) return false;
  return Object.values(result).some((value) => typeof value === "number");
};

export default function ShiftReceiptScanModal({
  isOpen,
  onClose,
  storeId,
  onApply,
}: ShiftReceiptScanModalProps) {
  const [scanState, setScanState] = useState<ScanState>("PREVIEW");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ReceiptParseResult | null>(null);
  const [rows, setRows] = useState<ReceiptParseCategory[]>([]);
  const [needsConfirmKeys, setNeedsConfirmKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const runOcrRef = useRef<(imageDataUrl: string) => void>(() => {});

  const reset = useCallback(() => {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setScanState("PREVIEW");
    setCapturedImage(null);
    setParseResult(null);
    setRows([]);
    setNeedsConfirmKeys(new Set());
    setError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Fresh start each time the modal opens.
    reset();
  }, [isOpen, reset]);

  const triggerCapture = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    setScanState("CAPTURING");
    // Must be a direct user gesture on iOS.
    input.click();
  }, []);

  const canDocScan = useMemo(() => {
    const Cap =
      (typeof window !== "undefined" && (window as any).Capacitor) || null;
    if (!Cap?.isNativePlatform?.()) return false;
    const platform = Cap?.getPlatform?.() ?? Cap?.platform ?? null;
    if (platform !== "ios") return false;
    const plugin = Cap?.Plugins?.ReceiptDocScanner;
    return typeof plugin?.scan === "function";
  }, [isOpen]);

  const triggerDocScan = useCallback(async () => {
    const Cap =
      (typeof window !== "undefined" && (window as any).Capacitor) || null;
    const plugin = Cap?.Plugins?.ReceiptDocScanner;
    if (!Cap?.isNativePlatform?.() || typeof plugin?.scan !== "function") {
      triggerCapture();
      return;
    }

    setError(null);
    setScanState("CAPTURING");
    try {
      const res = (await plugin.scan()) as any;
      const dataUrl = res?.imageDataUrl;
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        throw new Error("No scan returned.");
      }
      setCapturedImage(dataUrl);
      runOcrRef.current(dataUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");
      // User cancelling the scanner isn't an error state; just go back.
      if (message.toLowerCase().includes("cancel")) {
        setScanState("PREVIEW");
        return;
      }
      console.error("Receipt doc scan failed", err);
      setError("Unable to scan the receipt. Try taking a photo instead.");
      setScanState("ERROR");
    }
  }, [triggerCapture]);

  const runOcr = useCallback(
    async (imageDataUrl: string) => {
      requestAbortRef.current?.abort();
      const abort = new AbortController();
      requestAbortRef.current = abort;
      setError(null);
      setParseResult(null);
      setRows([]);
      setNeedsConfirmKeys(new Set());
      setScanState("PROCESSING");

      try {
        // Prefer Receipt Vision V2 when enabled; then reasoning; then legacy parse.
        let parsed: ReceiptParseResult | null = null;
        let needsConfirm = new Set<string>();

        const expectedFields = categoryOptions.map((c) => c.key);

        const v2Response = await fetch("/api/ai/receipt-vision-v2", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            image_base64: imageDataUrl,
            expected_fields: expectedFields,
            store_id: storeId,
          }),
          signal: abort.signal,
        }).catch(() => null);

        if (v2Response && v2Response.ok) {
          const payload = (await v2Response.json().catch(() => null)) as ReceiptVisionV2Response | null;
          const extraction = payload?.extraction;
          if (extraction && Array.isArray(extraction.fields)) {
            const byKey = new Map<string, any>();
            extraction.fields.forEach((f) => {
              if (!f?.key) return;
              byKey.set(String(f.key), f);
            });
            needsConfirm = new Set(
              Array.isArray(extraction.needs_confirmation)
                ? extraction.needs_confirmation.map(String)
                : [],
            );

            const categories: ReceiptParseCategory[] = categoryOptions.map((c) => {
              const field = byKey.get(c.key);
              return {
                key: c.key,
                label: c.label,
                amount:
                  typeof field?.amount === "number" && Number.isFinite(field.amount)
                    ? field.amount
                    : null,
                confidence:
                  typeof field?.confidence === "number" && Number.isFinite(field.confidence)
                    ? field.confidence
                    : 0,
                evidence_text:
                  typeof field?.evidence?.note === "string" ? field.evidence.note : "",
              };
            });

            parsed = {
              vendor: extraction.vendor,
              date: extraction.date,
              categories,
              unknown_lines: [],
              notes: [
                extraction.reasoning_summary || "Receipt parsed (Vision V2).",
                ...(extraction.anomalies ?? []).map((a) => String(a?.message ?? "")).filter(Boolean),
              ].filter(Boolean),
            };
          }
        }

        const reasoningResponse = await fetch("/api/ai/receipt-reason", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            image_base64: imageDataUrl,
            store_id: storeId,
            expected_fields: expectedFields,
          }),
          signal: abort.signal,
        }).catch(() => null);

        if (!parsed && reasoningResponse && reasoningResponse.ok) {
          const payload = (await reasoningResponse.json().catch(() => null)) as
            | ReasoningReceiptResponse
            | null;
          const extraction = payload?.extraction;
          if (extraction && Array.isArray(extraction.fields)) {
            const byKey = new Map<string, any>();
            extraction.fields.forEach((f) => {
              if (!f?.key) return;
              byKey.set(String(f.key), f);
            });
            needsConfirm = new Set(
              Array.isArray(extraction.needs_confirmation)
                ? extraction.needs_confirmation.map(String)
                : [],
            );

            const categories: ReceiptParseCategory[] = categoryOptions.map((c) => {
              const field = byKey.get(c.key);
              return {
                key: c.key,
                label: c.label,
                amount:
                  typeof field?.amount === "number" && Number.isFinite(field.amount)
                    ? field.amount
                    : null,
                confidence:
                  typeof field?.confidence === "number" && Number.isFinite(field.confidence)
                    ? field.confidence
                    : 0,
                evidence_text:
                  typeof field?.evidence?.notes === "string" ? field.evidence.notes : "",
              };
            });

            parsed = {
              vendor: typeof extraction.vendor === "string" ? extraction.vendor : null,
              date: typeof extraction.date === "string" ? extraction.date : null,
              categories,
              unknown_lines: [],
              notes: [
                extraction.reasoning_summary || "Receipt parsed with reasoning layer.",
                ...(extraction.anomalies ?? []).map((a) => String(a?.message ?? "")).filter(Boolean),
              ].filter(Boolean),
            };
          }
        }

        if (!parsed) {
          const response = await fetch("/api/receipts/parse", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ image_base64: imageDataUrl, storeId }),
            signal: abort.signal,
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error ?? "Unable to read receipt.");
          }

          parsed = payload as ReceiptParseResult;
        }

        const nextRows = Array.isArray(parsed?.categories) ? parsed.categories : [];
        setParseResult(parsed);
        setRows(nextRows);
        setNeedsConfirmKeys(needsConfirm);
        setScanState("RESULT");
      } catch (err) {
        if (abort.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Unable to read receipt.";
        setError(message);
        setScanState("ERROR");
      }
    },
    [storeId],
  );

  useEffect(() => {
    runOcrRef.current = (imageDataUrl: string) => {
      void runOcr(imageDataUrl);
    };
  }, [runOcr]);

  const categoryOptions = useMemo(
    () =>
      [
        { key: "gross", label: "Gross Sales" },
        { key: "scr", label: "Scratchers" },
        { key: "lotto", label: "Lotto" },
        { key: "liquor", label: "Liquor" },
        { key: "beer", label: "Beer" },
        { key: "cigarettes", label: "Cigarettes" },
        { key: "tobacco", label: "Tobacco" },
        { key: "gas", label: "Gas" },
        { key: "lotto_payout", label: "Lotto Payout" },
      ] as Array<{ key: ReceiptCategoryKey; label: string }>,
    [],
  );

  const labelForKey = useCallback(
    (key: ReceiptCategoryKey) =>
      categoryOptions.find((c) => c.key === key)?.label ?? key,
    [categoryOptions],
  );

  const confidenceBadge = (value: number) => {
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
    if (pct >= 80) return { label: `${pct}%`, cls: "bg-emerald-500/10 text-emerald-100 border-emerald-300/40" };
    if (pct >= 60) return { label: `${pct}%`, cls: "bg-blue-500/10 text-blue-100 border-blue-300/40" };
    return { label: `${pct}%`, cls: "bg-amber-500/10 text-amber-100 border-amber-300/40" };
  };

  return (
    <IHModal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      allowOutsideClose
      labelledBy="receipt-scan-title"
      panelClassName="no-transform"
    >
      <div className="space-y-4 p-5 text-white">
        <div className="space-y-1">
          <p
            id="receipt-scan-title"
            className="text-xs uppercase tracking-[0.3em] text-slate-300"
          >
            Scan Receipt
          </p>
          <p className="text-sm text-slate-200">
            This will auto-fill sales totals only. It will not touch cash, ATM, or
            deposit fields.
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
              Take a clear photo of the receipt totals.
            </div>
          )}
        </div>

        {scanState === "PROCESSING" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <div className="ui-spinner" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Reading receipt…
                </p>
                <p className="text-xs text-slate-300">
                  This usually takes a few seconds.
                </p>
              </div>
            </div>
          </div>
        )}

        {scanState === "ERROR" && error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        {scanState === "RESULT" && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-300">
                  Review extracted values
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  Confirm or edit before applying to the shift report.
                </p>
              </div>
              <div
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  rows.some((r) => typeof r.amount === "number")
                    ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                    : "border-amber-300/40 bg-amber-500/10 text-amber-100",
                )}
              >
                {rows.some((r) => typeof r.amount === "number") ? "Ready" : "No totals found"}
              </div>
            </div>

            {needsConfirmKeys.size > 0 && (
              <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Needs confirmation: {Array.from(needsConfirmKeys).slice(0, 8).join(", ")}
                {needsConfirmKeys.size > 8 ? "…" : ""}
              </div>
            )}

            {(parseResult?.vendor || parseResult?.date) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                {parseResult.vendor && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {parseResult.vendor}
                  </span>
                )}
                {parseResult.date && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {parseResult.date}
                  </span>
                )}
              </div>
            )}

            <div className="space-y-2">
              {rows.map((row, index) => {
                const badge = confidenceBadge(row.confidence);
                const low = row.confidence < 0.6 || !row.evidence_text?.trim();
                const needsConfirm = needsConfirmKeys.has(row.key);
                return (
                  <div
                    key={`${row.key}-${index}`}
                    className={clsx(
                      "rounded-2xl border bg-[#0c152d] p-3",
                      needsConfirm
                        ? "border-amber-300/60 bg-amber-500/5"
                        : low
                          ? "border-amber-300/40"
                          : "border-white/10",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <select
                          value={row.key}
                          onChange={(event) => {
                            const nextKey = event.target.value as ReceiptCategoryKey;
                            setRows((prev) => {
                              const next = [...prev];
                              const from = next[index];
                              const toIndex = next.findIndex((r, i) => i !== index && r.key === nextKey);
                              if (toIndex >= 0) {
                                // swap keys to keep uniqueness
                                const to = next[toIndex];
                                next[index] = { ...from, key: nextKey, label: labelForKey(nextKey) };
                                next[toIndex] = { ...to, key: from.key, label: labelForKey(from.key) };
                                return next;
                              }
                              next[index] = { ...from, key: nextKey, label: labelForKey(nextKey) };
                              return next;
                            });
                          }}
                          className="max-w-[170px] rounded-xl border border-white/10 bg-[#111a32] px-2.5 py-2 text-xs font-semibold text-white focus:border-blue-400 focus:outline-none"
                        >
                          {categoryOptions.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <span className={clsx("rounded-full border px-2.5 py-1 text-[11px] font-semibold", badge.cls)}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">$</span>
                        <input
                          value={
                            typeof row.amount === "number" && Number.isFinite(row.amount)
                              ? row.amount.toFixed(2)
                              : ""
                          }
                          onChange={(event) => {
                            const nextText = event.target.value;
                            const normalized = nextText.replace(/[$,]/g, "").trim();
                            const parsed = normalized ? Number(normalized) : NaN;
                            setRows((prev) => {
                              const next = [...prev];
                              const current = next[index];
                              next[index] = {
                                ...current,
                                amount: Number.isFinite(parsed) ? parsed : null,
                                confidence: 1,
                                evidence_text: current.evidence_text?.trim()
                                  ? current.evidence_text
                                  : "(edited)",
                              };
                              return next;
                            });
                          }}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    {row.evidence_text?.trim() && (
                      <p className="mt-2 text-xs text-slate-300">
                        Evidence: <span className="text-slate-200">{row.evidence_text}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {Array.isArray(parseResult?.notes) && parseResult!.notes.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
                <p className="font-semibold text-white">Notes</p>
                <div className="mt-2 space-y-1">
                  {parseResult!.notes.slice(0, 6).map((note, idx) => (
                    <p key={`note-${idx}`} className="text-slate-200">
                      • {note}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(parseResult?.unknown_lines) &&
              parseResult!.unknown_lines.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/10 p-3 text-xs text-slate-200">
                  <p className="font-semibold text-white">Unmapped lines</p>
                  <div className="mt-2 space-y-1">
                    {parseResult!.unknown_lines.slice(0, 6).map((line, idx) => (
                      <p key={`unknown-${idx}`} className="text-slate-300">
                        {line.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="ui-button ui-button-ghost"
            onClick={() => {
              // "Manual mode" fallback: just close and keep manual entry.
              reset();
              onClose();
            }}
          >
            Enter manually
          </button>

          <div className="flex items-center gap-2">
            {canDocScan && (
              <button
                type="button"
                className="ui-button ui-button-primary"
                onClick={() => {
                  reset();
                  triggerDocScan();
                }}
              >
                {capturedImage ? "Rescan receipt" : "Scan receipt (recommended)"}
              </button>
            )}

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
              disabled={scanState !== "RESULT" || rows.length === 0 || !capturedImage}
              onClick={() => {
                if (!capturedImage) return;
                const byKey = new Map<ReceiptCategoryKey, number | null>();
                rows.forEach((row) => byKey.set(row.key, row.amount ?? null));
                const result: ShiftReceiptSalesFields = {
                  gross: byKey.get("gross") ?? null,
                  scr: byKey.get("scr") ?? null,
                  lotto: byKey.get("lotto") ?? null,
                  liquor: byKey.get("liquor") ?? null,
                  beer: byKey.get("beer") ?? null,
                  cigarettes: byKey.get("cigarettes") ?? null,
                  tobacco: byKey.get("tobacco") ?? null,
                  gas: byKey.get("gas") ?? null,
                  lotto_payout: byKey.get("lotto_payout") ?? null,
                };
                onApply(result, capturedImage);
                reset();
                onClose();
              }}
            >
              Apply to form
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
              const dataUrl =
                typeof reader.result === "string" ? reader.result : null;
              if (!dataUrl) {
                setError("Unable to read that photo.");
                setScanState("ERROR");
                return;
              }
              setCapturedImage(dataUrl);
              runOcr(dataUrl);
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
