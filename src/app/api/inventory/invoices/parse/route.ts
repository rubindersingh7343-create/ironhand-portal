import { NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import sharp from "sharp";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runInventoryInvoiceVision } from "@/lib/inventory/ai/invoiceVision";
import {
  normalizeName,
  normalizeUnitToken,
  parseMoneyToCents,
  parseNumberLoose,
  parsePackUnits,
  scoreTextMatch,
  clamp01,
} from "@/lib/inventory/normalize";

export const runtime = "nodejs";

const MODEL =
  process.env.OPENAI_INVENTORY_INVOICE_MODEL ??
  process.env.OPENAI_VISION_MODEL ??
  "gpt-4o-2024-08-06";

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "uploads";

const MAX_IMAGE_BYTES = (() => {
  const parsed = Number(process.env.IH_INVENTORY_INVOICE_MAX_IMAGE_MB ?? "8");
  if (!Number.isFinite(parsed) || parsed <= 0) return 8 * 1024 * 1024;
  return Math.round(Math.min(12, Math.max(2, parsed)) * 1024 * 1024);
})();

const LIMIT_PER_MINUTE = (() => {
  const parsed = Number(process.env.IH_INVENTORY_INVOICE_RPM ?? "12");
  if (!Number.isFinite(parsed) || parsed <= 0) return 12;
  return Math.round(Math.min(30, Math.max(2, parsed)));
})();

type WindowEntry = { at: number; count: number };
const windows = new Map<string, WindowEntry>();

const allowRequest = (userId: string) => {
  const now = Date.now();
  const entry = windows.get(userId);
  if (!entry || now - entry.at > 60_000) {
    windows.set(userId, { at: now, count: 1 });
    return true;
  }
  if (entry.count >= LIMIT_PER_MINUTE) return false;
  entry.count += 1;
  return true;
};

function assertStoreAccess(user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) {
  if (!user) return false;
  if (user.role === "client") return (user.storeIds ?? []).includes(storeId);
  if (user.role === "employee") return user.storeNumber === storeId;
  // Managers can access their own store or HQ-linked stores (best-effort).
  if (user.role === "ironhand") return (user.storeIds ?? [user.storeNumber]).includes(storeId);
  return false;
}

async function preprocessImageForVision(buffer: Buffer) {
  // Keep it reasonably sized for latency/cost while staying legible for invoices.
  const img = sharp(buffer, { failOnError: false }).rotate();
  const meta = await img.metadata().catch(() => ({} as any));
  const width = typeof meta?.width === "number" ? meta.width : null;
  const resizeWidth = width && width > 2200 ? 2200 : width && width < 1200 ? 1200 : undefined;
  const processed = await img
    .resize(resizeWidth ? { width: resizeWidth } : undefined)
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buffer: processed, mime: "image/jpeg" as const };
}

async function uploadInvoiceFile(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  storeId: string;
  file: File;
}) {
  const buf = Buffer.from(await args.file.arrayBuffer());
  const ext = (() => {
    const name = args.file.name || "";
    const m = name.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/);
    return m?.[1] ?? "jpg";
  })();
  const id = crypto.randomUUID();
  const key = `inventory/invoices/${args.storeId}/${id}.${ext}`;
  const mime = args.file.type || "application/octet-stream";
  const { error } = await args.supabase!.storage.from(SUPABASE_BUCKET).upload(key, buf, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { key: `/${key}`, mime, size: args.file.size };
}

async function ensureVendor(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  storeId: string;
  vendorName: string;
}) {
  const normalized = normalizeName(args.vendorName);
  if (!normalized) return null;
  const { data: existing } = await args.supabase!
    .from("inventory_vendors")
    .select("id,display_name,normalized_name,canonical_name")
    .eq("store_id", args.storeId)
    .eq("normalized_name", normalized)
    .maybeSingle();
  if (existing?.id) {
    return { id: existing.id, action: "matched" as const, reason: "Exact normalized_name match." };
  }
  const payload = {
    id: crypto.randomUUID(),
    store_id: args.storeId,
    canonical_name: args.vendorName.trim(),
    display_name: args.vendorName.trim(),
    normalized_name: normalized,
    aliases: [] as string[],
    typical_delivery_days: [] as string[],
    delivery_frequency: null as string | null,
    lead_time_days: null as number | null,
    notes: null as string | null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await args.supabase!.from("inventory_vendors").insert(payload as any);
  if (error) throw new Error(`Failed to create vendor: ${error.message}`);
  return { id: payload.id, action: "created" as const, reason: "No vendor match; created new vendor." };
}

async function listProducts(args: { supabase: ReturnType<typeof getSupabaseAdmin>; storeId: string }) {
  const { data, error } = await args.supabase!
    .from("inventory_products")
    .select("id,name,normalized_name,upc,sku,units_per_case,units_per_pack,base_unit,unit_type,size,brand")
    .eq("store_id", args.storeId)
    .limit(2500);
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return (data ?? []) as any[];
}

async function ensureProduct(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  storeId: string;
  name: string;
  upc?: string | null;
  sku?: string | null;
  unitsPerCase?: number | null;
  unitsPerPack?: number | null;
  brand?: string | null;
  size?: string | null;
  unitType?: string | null;
}) {
  const normalized = normalizeName(args.name);
  if (!normalized) return null;
  const query = args.supabase!
    .from("inventory_products")
    .select("id,name,normalized_name,upc,sku,units_per_case,units_per_pack,base_unit")
    .eq("store_id", args.storeId);

  if (args.upc) {
    const { data: byUpc } = await query.eq("upc", String(args.upc).trim()).maybeSingle();
    if (byUpc?.id) return { id: byUpc.id, action: "matched" as const, reason: "UPC match." };
  }

  const { data: existing } = await query.eq("normalized_name", normalized).maybeSingle();
  if (existing?.id) return { id: existing.id, action: "matched" as const, reason: "Exact normalized_name match." };

  const payload = {
    id: crypto.randomUUID(),
    store_id: args.storeId,
    name: args.name.trim().slice(0, 180),
    normalized_name: normalized,
    base_unit: "each",
    brand: args.brand ?? null,
    size: args.size ?? null,
    unit_type: args.unitType ?? null,
    upc: args.upc ? String(args.upc).trim() : null,
    sku: args.sku ? String(args.sku).trim() : null,
    units_per_case: typeof args.unitsPerCase === "number" ? args.unitsPerCase : null,
    units_per_pack: typeof args.unitsPerPack === "number" ? args.unitsPerPack : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await args.supabase!.from("inventory_products").insert(payload as any);
  if (error) throw new Error(`Failed to create product: ${error.message}`);

  // Best-effort initialize stock row.
  await args.supabase!
    .from("inventory_stocks")
    .upsert({ store_id: args.storeId, product_id: payload.id }, { onConflict: "store_id,product_id" } as any);

  return { id: payload.id, action: "created" as const, reason: "No product match; created new product." };
}

function computeNormalizedUnits(args: {
  quantity: number | null;
  quantityText: string | null;
  unitText: string | null;
  packInfo: string | null;
  unitsPerCase: number | null;
  unitsPerPack: number | null;
}) {
  const qty = typeof args.quantity === "number" && Number.isFinite(args.quantity)
    ? args.quantity
    : parseNumberLoose(args.quantityText);
  const unit = normalizeUnitToken(args.unitText);
  const packUnits = parsePackUnits(args.packInfo);
  const unitsPerCase = args.unitsPerCase ?? packUnits;
  const unitsPerPack = args.unitsPerPack;

  if (!qty || qty <= 0) {
    return { units: null as number | null, reviewRequired: true, reason: "Missing/invalid quantity." };
  }

  if (unit === "case") {
    if (!unitsPerCase || unitsPerCase <= 0) {
      return { units: null, reviewRequired: true, reason: "Unit=case but units_per_case missing." };
    }
    return { units: qty * unitsPerCase, reviewRequired: false, reason: `case × ${unitsPerCase}` };
  }
  if (unit === "pack") {
    if (!unitsPerPack || unitsPerPack <= 0) {
      return { units: null, reviewRequired: true, reason: "Unit=pack but units_per_pack missing." };
    }
    return { units: qty * unitsPerPack, reviewRequired: false, reason: `pack × ${unitsPerPack}` };
  }

  return { units: qty, reviewRequired: false, reason: unit ? `unit=${unit}` : "default=each" };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["employee", "client", "ironhand"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin is not configured." }, { status: 500 });
  }

  if (!allowRequest(user.id)) {
    return NextResponse.json(
      { error: "Too many inventory invoice parses. Try again in a minute." },
      { status: 429 },
    );
  }

  const form = await request.formData().catch(() => null);
  const storeId = String(form?.get("storeId") ?? "").trim() || user.storeNumber;
  const file = form?.get("file");
  if (!storeId) return NextResponse.json({ error: "Store is required." }, { status: 400 });
  if (!assertStoreAccess(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image invoices are supported right now." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES * 1.5) {
    return NextResponse.json(
      { error: `Image too large. Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB.` },
      { status: 413 },
    );
  }

  const startedAt = Date.now();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const uploaded = await uploadInvoiceFile({ supabase, storeId, file });
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const prepared = await preprocessImageForVision(rawBuffer);
    const dataUrl = `data:${prepared.mime};base64,${prepared.buffer.toString("base64")}`;

    // Fast pass then reliability pass.
    const low = await runInventoryInvoiceVision({ client, model: MODEL, dataUrl, detail: "low" });
    const lowHasLines = Array.isArray(low.parsed.line_items) && low.parsed.line_items.length > 0;
    const lowHasVendor = Boolean(low.parsed.vendor?.name);
    const vision = lowHasLines && lowHasVendor
      ? { ...low, detail: "low" as const }
      : { ...(await runInventoryInvoiceVision({ client, model: MODEL, dataUrl, detail: "high" })), detail: "high" as const };

    const vendorRaw = String(vision.parsed.vendor?.name ?? "").trim() || null;
    const vendorDebug = vendorRaw
      ? await ensureVendor({ supabase, storeId, vendorName: vendorRaw })
      : null;

    const products = await listProducts({ supabase, storeId });

    const lineDebug: any[] = [];
    const lineRows: any[] = [];

    for (const [index, line] of (vision.parsed.line_items ?? []).entries()) {
      const rawDescription = String(line?.description ?? "").trim();
      if (!rawDescription) continue;

      const lineUpc = line?.upc ? String(line.upc).replace(/[^\d]/g, "").slice(0, 14) : null;
      const lineSku = line?.sku ? String(line.sku).trim() : null;

      const candidateScores = products
        .map((p: any) => {
          const upcMatch = lineUpc && p.upc && String(p.upc).replace(/[^\d]/g, "") === lineUpc ? 1 : 0;
          const skuMatch = lineSku && p.sku && String(p.sku).trim() === lineSku ? 0.95 : 0;
          const nameScore = scoreTextMatch(rawDescription, p.name ?? p.normalized_name ?? "");
          const score = Math.max(upcMatch, skuMatch, nameScore);
          return { product_id: p.id, name: p.name, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

      const chosen = candidateScores[0] ?? null;
      const matched =
        chosen && chosen.score >= 0.72
          ? { id: chosen.product_id, action: "matched" as const, reason: `score=${chosen.score.toFixed(2)}` }
          : null;

      const unitsPerCase = typeof line?.units_per_case === "number" ? line.units_per_case : null;
      const unitsPerPack = typeof line?.units_per_pack === "number" ? line.units_per_pack : null;

      const ensured = matched
        ? matched
        : await ensureProduct({
            supabase,
            storeId,
            name: rawDescription,
            upc: lineUpc,
            sku: lineSku,
            unitsPerCase,
            unitsPerPack,
            unitType: normalizeUnitToken(line?.unit) ?? null,
          });

      const normalizedQty = computeNormalizedUnits({
        quantity: typeof line?.quantity === "number" ? line.quantity : null,
        quantityText: line?.quantity_text ?? null,
        unitText: line?.unit ?? null,
        packInfo: line?.pack_info ?? null,
        unitsPerCase: unitsPerCase ?? null,
        unitsPerPack: unitsPerPack ?? null,
      });

      const unitCostCents = parseMoneyToCents(line?.unit_cost);
      const lineTotalCents = parseMoneyToCents(line?.line_total);
      const extractionConfidence = clamp01(Number(line?.confidence ?? 0));

      const needsReview =
        normalizedQty.reviewRequired ||
        !ensured?.id ||
        extractionConfidence < 0.55 ||
        (matched ? chosen?.score < 0.78 : false);

      lineDebug.push({
        index,
        description: rawDescription,
        chosen_product_id: ensured?.id ?? null,
        product_match: {
          created_or_matched: ensured?.action ?? "unknown",
          reason: ensured?.reason ?? "no product",
          candidates: candidateScores,
        },
        quantity_normalization: normalizedQty,
      });

      lineRows.push({
        id: crypto.randomUUID(),
        store_id: storeId,
        invoice_id: null as string | null, // filled after invoice insert
        raw_description: rawDescription,
        raw_quantity_text: line?.quantity_text ?? null,
        raw_unit_text: line?.unit ?? null,
        quantity: normalizedQty.units,
        unit_cost_cents: unitCostCents,
        line_total_cents: lineTotalCents,
        matched_product_id: ensured?.id ?? null,
        match_confidence: matched ? chosen?.score ?? null : null,
        review_required: Boolean(needsReview),
        metadata: {
          pack_info: line?.pack_info ?? null,
          units_per_case: unitsPerCase,
          units_per_pack: unitsPerPack,
          extraction_confidence: extractionConfidence,
          evidence: Array.isArray(line?.evidence) ? line.evidence : [],
          quantity_reason: normalizedQty.reason,
          upc: lineUpc,
          sku: lineSku,
        },
      });
    }

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = vision.parsed.invoice?.number ? String(vision.parsed.invoice.number).trim() : null;
    const invoiceDate = vision.parsed.invoice?.date ? String(vision.parsed.invoice.date).trim() : null;
    const totalCents = parseMoneyToCents(vision.parsed.totals?.total);

    const parsedJson = {
      model: {
        detail: vision.detail,
        output_text: vision.outputText,
        parsed: vision.parsed,
      },
      normalized: {
        store_id: storeId,
        vendor_raw: vendorRaw,
        vendor_id: vendorDebug?.id ?? null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        total_cents: totalCents,
        line_items_count: lineRows.length,
      },
      debug: {
        vendor_choice: vendorDebug,
        line_items: lineDebug,
      },
    };

    const { error: invErr } = await supabase.from("inventory_invoices").insert({
      id: invoiceId,
      store_id: storeId,
      file_url: uploaded.key,
      file_mime: uploaded.mime,
      bucket: SUPABASE_BUCKET,
      vendor_id: vendorDebug?.id ?? null,
      vendor_raw: vendorRaw,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      total_cents: totalCents,
      raw_ocr_text: vision.parsed.extracted_text ?? null,
      parsed_json: parsedJson as any,
      parse_status: "parsed",
      review_status: "needs_review",
      updated_at: new Date().toISOString(),
    } as any);
    if (invErr) throw new Error(`Failed to insert inventory invoice: ${invErr.message}`);

    const finalLineRows = lineRows.map((row) => ({ ...row, invoice_id: invoiceId }));
    if (finalLineRows.length) {
      const { error: linesErr } = await supabase.from("inventory_invoice_line_items").insert(finalLineRows as any);
      if (linesErr) throw new Error(`Failed to insert line items: ${linesErr.message}`);
    }

    const ms = Date.now() - startedAt;
    console.log("[inventory-invoice-parse]", { user_id: user.id, store_id: storeId, ms, lines: finalLineRows.length });

    return NextResponse.json({
      invoice_id: invoiceId,
      store_id: storeId,
      vendor_id: vendorDebug?.id ?? null,
      vendor_raw: vendorRaw,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      total_cents: totalCents,
      review_status: "needs_review",
      parse_status: "parsed",
      raw_extracted_text: vision.parsed.extracted_text ?? "",
      raw_model_output: {
        detail: vision.detail,
        output_text: vision.outputText,
        parsed: vision.parsed,
      },
      normalized: parsedJson.normalized,
      debug: parsedJson.debug,
    });
  } catch (error) {
    const err = error as any;
    console.error("[inventory-invoice-parse] failed", {
      user_id: user.id,
      store_id: user.storeNumber,
      ms: Date.now() - startedAt,
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });
    return NextResponse.json(
      { error: "Inventory invoice parsing failed. Please try again." },
      { status: 502 },
    );
  }
}
