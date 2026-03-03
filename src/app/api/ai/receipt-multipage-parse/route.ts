import { NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";
import { getSessionUser } from "@/lib/auth";
import { receiptDocScanPreprocess } from "@/lib/images/receiptPreprocess";
import { runReceiptVisionV2 } from "@/lib/ai/receiptVisionV2";
import { mergeReceiptVisionV2Pages } from "@/lib/ai/receiptMultipage";
import { getReceiptLabelTargetsForStore } from "@/lib/ai/receiptLabelTargets";

export const runtime = "nodejs";

const ENABLED =
  (process.env.RECEIPT_MULTIPHOTO_ENABLED ?? "").toLowerCase() === "true" &&
  (process.env.RECEIPT_VISION_V2_ENABLED ?? "").toLowerCase() === "true";

// NOTE: Strict Structured Outputs (json_schema strict:true) is only guaranteed on supported model snapshots.
// Keep this configurable, but default to a snapshot known to support Structured Outputs well.
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-2024-08-06";
const DOCSCAN = (process.env.RECEIPT_DOCSCAN_ENABLED ?? "true").toLowerCase() === "true";

const MAX_IMAGE_BYTES = (() => {
  const parsed = Number(process.env.IH_RECEIPT_V2_MAX_IMAGE_MB ?? "8");
  if (!Number.isFinite(parsed) || parsed <= 0) return 8 * 1024 * 1024;
  return Math.round(Math.min(10, Math.max(2, parsed)) * 1024 * 1024);
})();

const LIMIT_PER_MINUTE = (() => {
  const parsed = Number(process.env.IH_RECEIPT_V2_RPM ?? "10");
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
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

const estimateBytes = (dataUrlOrBase64: string) => {
  const raw = dataUrlOrBase64.startsWith("data:")
    ? dataUrlOrBase64.slice(dataUrlOrBase64.indexOf(",") + 1)
    : dataUrlOrBase64;
  return Math.floor((raw.length * 3) / 4);
};

function assertStoreAccess(user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) {
  if (!user) return false;
  if (user.role === "client") return (user.storeIds ?? []).includes(storeId);
  if (user.role === "employee") return user.storeNumber === storeId;
  return false;
}

export async function POST(req: Request) {
  if (!ENABLED) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
  }
  if (!allowRequest(user.id)) {
    return NextResponse.json({ error: "Too many receipt scans. Try again in a minute." }, { status: 429 });
  }

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const pages = Array.isArray(body?.image_pages) ? body.image_pages : null;
  if (!pages || pages.length === 0) {
    return NextResponse.json({ error: "Missing image_pages." }, { status: 400 });
  }
  if (pages.length > 6) {
    return NextResponse.json({ error: "Too many pages (max 6)." }, { status: 400 });
  }

  const requestedStoreId =
    typeof body?.store_id === "string" ? body.store_id : user.storeNumber;
  const storeId = typeof requestedStoreId === "string" ? requestedStoreId : null;
  if (storeId && !assertStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // STRICT LABEL MATCHING: only allow fields explicitly enabled in owner report settings.
  const targets = storeId ? await getReceiptLabelTargetsForStore(storeId) : null;
  const allowedKeys = targets?.allowedKeys?.length
    ? targets.allowedKeys
    : Array.isArray(body?.expected_fields)
      ? (body.expected_fields as any[]).map((k) => String(k)).filter(Boolean)
      : undefined;
  const labelByKey = targets?.labelByKey ?? undefined;
  const matchMode = targets?.matchMode ?? undefined;

  const totalApprox = pages.reduce((acc: number, p: any) => acc + (typeof p === "string" ? estimateBytes(p) : 0), 0);
  // Keep request size bounded (Vercel body limits). Prefer close-up captures.
  if (totalApprox > Math.round(MAX_IMAGE_BYTES * 1.35)) {
    return NextResponse.json(
      { error: `Pages too large. Please capture closer sections (max ~${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB total).` },
      { status: 413 },
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const request_id = crypto.randomUUID();

  try {
    const results: any[] = [];
    // Concurrency limit 2 to avoid spiky OpenAI usage.
    let next = 0;
    const workerCount = Math.min(2, pages.length);
    const workers = new Array(workerCount).fill(null).map(async () => {
      while (true) {
        const idx = next++;
        if (idx >= pages.length) return;
        const page = pages[idx];
        if (typeof page !== "string") continue;

        let prepared: any | undefined;
        if (DOCSCAN) {
          const docscan = await receiptDocScanPreprocess({
            imageBase64: page,
            maxBytes: MAX_IMAGE_BYTES,
            minWidth: 1600,
            maxWidth: 2200,
            thresholdValues: [170, 180],
          });
          prepared = {
            dataUrl: docscan.best.dataUrl,
            buffer: docscan.best.buffer,
            meta: {
              input_bytes: docscan.best.meta.input_bytes,
              output_bytes: docscan.best.meta.output_bytes,
              width: docscan.best.meta.width,
              height: docscan.best.meta.height,
              format: docscan.best.meta.format,
              orientation: docscan.best.meta.orientation,
            },
          };
        }

        const pageResult = await runReceiptVisionV2({
          client,
          model: MODEL,
          imageBase64: page,
          allowedKeys,
          labelByKey,
          matchMode,
          maxBytes: MAX_IMAGE_BYTES,
          debug: false,
          prepared,
        });
        results[idx] = pageResult;
      }
    });

    await Promise.all(workers);
    const compact = results.filter(Boolean);
    if (compact.length === 0) throw new Error("No pages parsed.");

    const merged = mergeReceiptVisionV2Pages({ model: MODEL, pages: compact, startedAt });

    console.log("[receipt-multipage]", {
      user_id: user.id,
      store_id: user.storeNumber ?? null,
      request_id,
      pages: compact.length,
      ms: Date.now() - startedAt,
      model: MODEL,
      confirm: merged.extraction.needs_confirmation.length,
      anomalies: merged.extraction.anomalies.length,
      allowed_labels: Object.values(labelByKey ?? {}).slice(0, 24),
      label_match_mode: matchMode ?? null,
    });

    return NextResponse.json({
      ...merged,
      meta: {
        ...merged.meta,
        request_id,
      },
    });
  } catch (error) {
    const err = error as any;
    console.error("[receipt-multipage] failed", {
      user_id: user.id,
      store_id: user.storeNumber ?? null,
      request_id,
      ms: Date.now() - startedAt,
      model: MODEL,
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });

    return NextResponse.json(
      { error: "Receipt scan failed." },
      { status: 502 },
    );
  }
}
