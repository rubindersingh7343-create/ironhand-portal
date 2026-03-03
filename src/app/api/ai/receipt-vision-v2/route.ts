import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import { decodeReceiptBase64, runReceiptVisionV2 } from "@/lib/ai/receiptVisionV2";
import { maybeSaveDebugReceiptImages, receiptDocScanPreprocess } from "@/lib/images/receiptPreprocess";
import { getReceiptLabelTargetsForStore } from "@/lib/ai/receiptLabelTargets";

export const runtime = "nodejs";

const ENABLED = (process.env.RECEIPT_VISION_V2_ENABLED ?? "").toLowerCase() === "true";
// Safe default: only impacts the V2 endpoint (itself feature-flagged). Can be disabled via env.
const DOCSCAN = (process.env.RECEIPT_DOCSCAN_ENABLED ?? "true").toLowerCase() === "true";
// NOTE: Strict Structured Outputs (json_schema strict:true) is only guaranteed on supported model snapshots.
// Keep this configurable, but default to a snapshot known to support Structured Outputs well.
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-2024-08-06";

const DEBUG =
  process.env.DEBUG_RECEIPT_OCR === "true" ||
  process.env.NODE_ENV !== "production";
const DEBUG_IMAGES = process.env.DEBUG_RECEIPT_IMAGES === "true" && process.env.NODE_ENV !== "production";

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
    return NextResponse.json(
      { error: "OpenAI API key is not configured." },
      { status: 500 },
    );
  }

  if (!allowRequest(user.id)) {
    return NextResponse.json(
      { error: "Too many receipt scans. Try again in a minute." },
      { status: 429 },
    );
  }

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const imageBase64 = body?.image_base64;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "Missing image_base64." }, { status: 400 });
  }

  const requestedStoreId = typeof body?.store_id === "string" ? body.store_id : user.storeNumber;
  const storeId = typeof requestedStoreId === "string" ? requestedStoreId : null;
  if (storeId && !assertStoreAccess(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const approxBytes = estimateBytes(imageBase64);
  if (approxBytes > MAX_IMAGE_BYTES * 1.6) {
    // Preprocess will recompress, but a huge upload is a cost + memory risk.
    return NextResponse.json(
      { error: `Image too large. Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB.` },
      { status: 413 },
    );
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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const originalBuffer = decodeReceiptBase64(imageBase64);

    const score = (r: any) => {
      const fields = (Array.isArray(r?.extraction?.fields) ? r.extraction.fields : []) as any[];
      const anomalies = r?.extraction?.anomalies?.length ?? 0;
      const needs = r?.extraction?.needs_confirmation?.length ?? 0;
      const byKey = new Map<string, any>(fields.map((f: any) => [String(f?.key ?? ""), f]));
      const critical = ["gross", "beer", "liquor", "cigarettes"];
      const criticalScore = critical.reduce((acc, k) => {
        const f: any = byKey.get(k);
        if (!f || typeof f?.amount !== "number") return acc;
        return acc + Math.max(0, Math.min(1, Number(f.confidence ?? 0)));
      }, 0);
      const found = fields.filter((f: any) => typeof f?.amount === "number").length;
      const avgConf =
        found > 0
          ? fields
              .filter((f: any) => typeof f?.amount === "number")
              .reduce((acc: number, f: any) => acc + Math.max(0, Math.min(1, Number(f.confidence ?? 0))), 0) /
            found
          : 0;
      return criticalScore * 2 + avgConf * 1.5 - anomalies * 0.25 - needs * 0.15;
    };

    let chosen = "base";
    let result = await runReceiptVisionV2({
      client,
      model: MODEL,
      imageBase64,
      allowedKeys,
      labelByKey,
      matchMode,
      maxBytes: MAX_IMAGE_BYTES,
      debug: DEBUG,
    });

    if (DOCSCAN) {
      const docscan = await receiptDocScanPreprocess({
        imageBase64,
        maxBytes: MAX_IMAGE_BYTES,
        minWidth: 1600,
        maxWidth: 2200,
        thresholdValues: [170, 180],
      });

      const docscanPrepared = {
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

      // In prod: only pay for a second parse when the base result looks weak.
      const baseLooksWeak =
        (result.extraction.needs_confirmation ?? []).some((k) =>
          ["gross", "beer", "liquor", "cigarettes"].includes(String(k)),
        ) || (result.extraction.anomalies ?? []).some((a) => a.type === "WEIRD_NUMBER");

      const runDocscan = DEBUG || baseLooksWeak;

      let docscanResult: any | null = null;
      if (runDocscan) {
        docscanResult = await runReceiptVisionV2({
          client,
          model: MODEL,
          imageBase64,
          allowedKeys,
          labelByKey,
          matchMode,
          maxBytes: MAX_IMAGE_BYTES,
          debug: DEBUG,
          prepared: docscanPrepared,
        });
      }

      if (docscanResult) {
        const baseScore = score(result);
        const docScore = score(docscanResult);
        const better = docScore >= baseScore + 0.15 ? "docscan" : baseScore > docScore + 0.35 ? "base" : "docscan";
        if (better === "docscan") {
          chosen = "docscan";
          result = docscanResult;
        }

        if (DEBUG) {
          console.log("[receipt-v2:ab]", {
            user_id: user.id,
            request_id: result.meta.request_id,
            model: MODEL,
            chosen,
            baseScore,
            docScore,
            docscan_meta: docscan.best.meta,
            allowed_labels: Object.values(labelByKey ?? {}).slice(0, 24),
            label_match_mode: matchMode ?? null,
          });
        }

        await maybeSaveDebugReceiptImages({
          enabled: DEBUG_IMAGES,
          requestId: result.meta.request_id,
          original: originalBuffer,
          preprocessed: docscan.best.buffer,
          meta: { chosen, baseScore, docScore, docscan_meta: docscan.best.meta },
        });
      }
    }

    console.log("[receipt-v2]", {
      user_id: user.id,
      store_id: user.storeNumber ?? null,
      ms: Date.now() - startedAt,
      model: MODEL,
      passes: result.meta.passes,
      used_multipass: result.meta.used_multipass,
      confirm: result.extraction.needs_confirmation.length,
      anomalies: result.extraction.anomalies.length,
      image_out_bytes: result.meta.image.output_bytes,
      chosen,
    });

    return NextResponse.json(result);
  } catch (error) {
    const err = error as any;
    console.error("[receipt-v2] failed", {
      user_id: user.id,
      store_id: user.storeNumber ?? null,
      ms: Date.now() - startedAt,
      model: MODEL,
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });
    return NextResponse.json({ error: "Receipt scan failed." }, { status: 502 });
  }
}
