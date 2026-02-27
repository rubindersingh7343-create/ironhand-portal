import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import { reasonReceipt, type ReceiptReasonerRequest } from "@/lib/ai/reasoning/receipt_reasoner";

export const runtime = "nodejs";

const ENABLED = (process.env.REASONING_AI_ENABLED ?? "").toLowerCase() === "true";
const MODEL = process.env.OPENAI_REASONING_MODEL ?? "gpt-4o";

const MAX_IMAGE_BYTES = (() => {
  const parsed = Number(process.env.IH_REASONING_MAX_IMAGE_MB ?? "8");
  if (!Number.isFinite(parsed) || parsed <= 0) return 8 * 1024 * 1024;
  return Math.round(Math.min(12, Math.max(1, parsed)) * 1024 * 1024);
})();

const LIMIT_PER_MINUTE = (() => {
  const parsed = Number(process.env.IH_REASONING_RPM ?? "10");
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
  // base64 expands by ~4/3
  return Math.floor((raw.length * 3) / 4);
};

export async function POST(req: Request) {
  if (!ENABLED) {
    // Feature flagged: callers should fall back to the existing receipt parse flow.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

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
      { error: "Too many receipt parses. Try again in a minute." },
      { status: 429 },
    );
  }

  const startedAt = Date.now();
  const body = (await req.json().catch(() => null)) as ReceiptReasonerRequest | null;
  const imageBase64 = typeof body?.image_base64 === "string" ? body.image_base64 : "";
  if (!imageBase64) return NextResponse.json({ error: "Missing image_base64." }, { status: 400 });

  const approxBytes = estimateBytes(imageBase64);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image too large. Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB.` },
      { status: 413 },
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const result = await reasonReceipt({
      request: {
        ...(body ?? {}),
        image_base64: imageBase64,
        store_id: body?.store_id ?? user.storeNumber ?? null,
      },
      client,
      model: MODEL,
    });

    console.log("[reasoning-receipt]", {
      user_id: user.id,
      store_id: body?.store_id ?? user.storeNumber ?? null,
      ms: Date.now() - startedAt,
      passes: result.meta.passes,
      used_multipass: result.meta.used_multipass,
      confirmations: result.extraction.needs_confirmation.length,
      anomalies: result.extraction.anomalies.length,
      cached: result.meta.cached,
    });

    return NextResponse.json(result);
  } catch (error) {
    const err = error as any;
    console.error("[reasoning-receipt] failed", {
      user_id: user.id,
      store_id: body?.store_id ?? user.storeNumber ?? null,
      ms: Date.now() - startedAt,
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });
    // Caller should fall back to existing flow.
    return NextResponse.json({ error: "Receipt reasoning failed." }, { status: 502 });
  }
}
