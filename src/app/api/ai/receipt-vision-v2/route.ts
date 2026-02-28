import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import { runReceiptVisionV2 } from "@/lib/ai/receiptVisionV2";

export const runtime = "nodejs";

const ENABLED = (process.env.RECEIPT_VISION_V2_ENABLED ?? "").toLowerCase() === "true";
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";

const DEBUG =
  process.env.DEBUG_RECEIPT_OCR === "true" ||
  process.env.NODE_ENV !== "production";

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

  const approxBytes = estimateBytes(imageBase64);
  if (approxBytes > MAX_IMAGE_BYTES * 1.6) {
    // Preprocess will recompress, but a huge upload is a cost + memory risk.
    return NextResponse.json(
      { error: `Image too large. Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB.` },
      { status: 413 },
    );
  }

  const allowedKeys = Array.isArray(body?.expected_fields)
    ? (body.expected_fields as any[]).map((k) => String(k)).filter(Boolean)
    : undefined;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const result = await runReceiptVisionV2({
      client,
      model: MODEL,
      imageBase64,
      allowedKeys,
      maxBytes: MAX_IMAGE_BYTES,
      debug: DEBUG,
    });

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

