"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";

type TabId =
  | "overview"
  | "stock"
  | "products"
  | "vendors"
  | "invoices"
  | "count"
  | "adjust";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "stock", label: "Stock" },
  { id: "products", label: "Products" },
  { id: "vendors", label: "Vendors" },
  { id: "invoices", label: "Invoices" },
  { id: "count", label: "Count" },
  { id: "adjust", label: "Adjust" },
];

type ParseResponse = {
  invoice_id: string;
  store_id: string;
  vendor_id: string | null;
  vendor_raw: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_cents: number | null;
  review_status: string;
  parse_status: string;
  raw_extracted_text: string;
  raw_model_output?: unknown;
  normalized: unknown;
  debug: unknown;
};

export default function OwnerInventorySection() {
  const ownerStore = useOwnerPortalStore();
  const storeId = ownerStore?.selectedStoreId ?? "";
  const storeLabel =
    ownerStore?.activeStore?.storeName ?? (storeId ? `Store ${storeId}` : "Select a store");

  const [tab, setTab] = useState<TabId>("invoices");
  const active = useMemo(() => TABS.find((t) => t.id === tab) ?? TABS[0], [tab]);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const [forceApplyReady, setForceApplyReady] = useState(false);

  const modelOrientation = (() => {
    const output = parsed?.raw_model_output as any;
    const v = typeof output?.orientation === "string" ? output.orientation : null;
    return v;
  })();

  const shouldReencode = (input: File) => {
    const type = (input.type || "").toLowerCase();
    if (type.includes("heic") || type.includes("heif")) return true;
    // Keep payload small/reliable on mobile + faster parse.
    if (input.size > 4_500_000) return true;
    // Prefer JPEG for predictable server preprocessing.
    if (type && type !== "image/jpeg" && type !== "image/jpg") return true;
    return false;
  };

  const loadBitmap = async (input: File): Promise<ImageBitmap | null> => {
    try {
      if ("createImageBitmap" in window) {
        return await createImageBitmap(input);
      }
    } catch {
      // fall through
    }
    return null;
  };

  const reencodeToJpeg = async (input: File): Promise<File> => {
    const bitmap = await loadBitmap(input);
    if (!bitmap) return input;

    const maxDim = 2000;
    const w = bitmap.width || 1;
    const h = bitmap.height || 1;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return input;
    ctx.drawImage(bitmap, 0, 0, outW, outH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) return input;
    const nameBase = (input.name || "invoice").replace(/\.[^.]+$/, "");
    return new File([blob], `${nameBase}.jpg`, { type: "image/jpeg" });
  };

  const parseInvoice = async () => {
    if (!storeId) {
      setError("Select a store first.");
      return;
    }
    if (!file) {
      setError("Choose an invoice image.");
      return;
    }
    setError(null);
    setBusy(true);
    setApplied(false);
    setForceApplyReady(false);
    try {
      const prepared = shouldReencode(file) ? await reencodeToJpeg(file) : file;
      const form = new FormData();
      form.set("storeId", storeId);
      form.set("file", prepared);
      const res = await fetch("/api/inventory/invoices/parse", { method: "POST", body: form });
      const text = await res.text();
      const data = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return {};
        }
      })();
      if (!res.ok) {
        const serverError = typeof data?.error === "string" ? data.error : "";
        const requestId =
          typeof data?.request_id === "string" ? data.request_id : "";
        const stage = typeof data?.stage === "string" ? data.stage : "";
        const snippet = !serverError && text ? text.slice(0, 180) : "";
        const message = serverError
          ? `${serverError}${stage ? ` (stage: ${stage})` : ""}${requestId ? ` (id: ${requestId})` : ""}`
          : `Parse failed (HTTP ${res.status}).${snippet ? ` ${snippet}` : ""}`;
        setError(message);
        return;
      }
      setParsed(data as ParseResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed.");
    } finally {
      setBusy(false);
    }
  };

  const applyInvoice = async () => {
    if (!parsed?.invoice_id) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/invoices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId, invoiceId: parsed.invoice_id, force: forceApplyReady }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && typeof data?.review_required_count === "number") {
          setForceApplyReady(true);
          setError(
            `This invoice has ${data.review_required_count} line item(s) flagged for review. Click Apply again to force apply.`,
          );
          return;
        }
        setError(data?.error ?? "Apply failed.");
        return;
      }
      setApplied(true);
      setForceApplyReady(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setBusy(false);
    }
  };

  const renderInvoices = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Parse vendor invoice</p>
        <p className="mt-2 text-sm text-slate-200">
          Upload a liquor/convenience invoice image. The parser uses the image directly (vision + reasoning) with an
          evidence-locked header pass + a dedicated line-item table pass, then returns raw extracted text, normalized
          fields, and debug match reasons.
        </p>
        <p className="mt-2 text-xs text-slate-400">Current store: {storeLabel}</p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="ui-field"
          />
          {file && (
            <span className="text-xs text-slate-400">
              {file.name || "invoice"} • {(file.size / 1024 / 1024).toFixed(1)}MB
            </span>
          )}
          <button type="button" className="ui-button ui-button-primary" disabled={busy} onClick={parseInvoice}>
            {busy ? "Parsing…" : "Parse"}
          </button>
          {parsed?.invoice_id && (
            <button
              type="button"
              className="ui-button"
              disabled={busy || applied}
              onClick={applyInvoice}
              title="Applies the invoice quantities to stock + creates transactions (via DB function)."
            >
              {applied
                ? "Applied"
                : busy
                  ? "Applying…"
                  : forceApplyReady
                    ? "Force apply"
                    : "Apply to inventory"}
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-rose-200">{error}</p>}
        {applied && <p className="mt-3 text-sm text-emerald-200">Applied to inventory.</p>}
      </div>

      {parsed && (
        <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4 space-y-3">
          <div className="flex flex-wrap gap-3 text-sm text-slate-100">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Vendor</p>
              <p>{parsed.vendor_raw ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Invoice #</p>
              <p>{parsed.invoice_number ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Date</p>
              <p>{parsed.invoice_date ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Total</p>
              <p>
                {typeof parsed.total_cents === "number" ? `$${(parsed.total_cents / 100).toFixed(2)}` : "—"}
              </p>
            </div>
            {modelOrientation && (
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Orientation</p>
                <p>{modelOrientation}</p>
              </div>
            )}
          </div>

          <details className="rounded-xl border border-white/10 bg-black/10 p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.22em] text-slate-300">
              Raw extracted text
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-200">{parsed.raw_extracted_text || "—"}</pre>
          </details>

          <details className="rounded-xl border border-white/10 bg-black/10 p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.22em] text-slate-300">
              Raw model output (debug)
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-200">
              {JSON.stringify(parsed.raw_model_output ?? null, null, 2)}
            </pre>
          </details>

          <details className="rounded-xl border border-white/10 bg-black/10 p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.22em] text-slate-300">
              Normalized output (debug)
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-200">
              {JSON.stringify(parsed.normalized, null, 2)}
            </pre>
          </details>

          <details className="rounded-xl border border-white/10 bg-black/10 p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.22em] text-slate-300">
              Match reasons (debug)
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-200">
              {JSON.stringify(parsed.debug, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );

  const renderPlaceholder = (label: string) => (
    <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-300">{label}</p>
      <p className="mt-2 text-sm text-slate-200">Coming soon.</p>
    </div>
  );

  return (
    <div className="ui-card space-y-4 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Inventory</p>
          <p className="mt-2 text-sm font-semibold text-slate-100">
            Stock, products, vendors, and invoices.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "ui-pill-primary px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition",
              tab === t.id
                ? "border-white/45 bg-white/10 text-white"
                : "border-white/15 bg-transparent text-slate-200 hover:border-white/35",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active.id === "invoices"
        ? renderInvoices()
        : renderPlaceholder(active.label)}
    </div>
  );
}
