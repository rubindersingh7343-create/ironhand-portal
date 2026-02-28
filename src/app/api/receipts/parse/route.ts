import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import sharp from "sharp";
import {
  callOpenAIReceiptParse,
  isLowConfidence,
  mergeReceiptParses,
  normalizeImageBase64,
  postProcessReceiptParse,
  tileImage,
} from "@/lib/receipts/parseReceipt";

export const runtime = "nodejs";

const RECEIPT_MODEL = process.env.OPENAI_RECEIPT_MODEL ?? "gpt-4o";
const DEBUG =
  process.env.DEBUG_RECEIPT_OCR === "true" ||
  process.env.NODE_ENV !== "production";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const imageBase64 = body?.image_base64 as string | undefined;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "Missing image_base64." }, { status: 400 });
  }

  const startedAt = Date.now();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const { dataUrl, buffer } = await normalizeImageBase64(imageBase64);
    if (DEBUG) {
      try {
        const meta = await sharp(buffer, { failOnError: false }).metadata();
        console.log("[receipt-parse:debug]", {
          user_id: user.id,
          store_id: user.storeNumber,
          model: RECEIPT_MODEL,
          input_bytes: buffer.byteLength,
          format: meta.format ?? null,
          width: meta.width ?? null,
          height: meta.height ?? null,
          orientation: meta.orientation ?? null,
        });
      } catch {
        // ignore
      }
    }

    const fullRaw = await callOpenAIReceiptParse({
      client,
      model: RECEIPT_MODEL,
      dataUrl,
      mode: "full",
    });
    const full = postProcessReceiptParse(fullRaw);

    let final = full;
    let usedFallback = false;

    if (isLowConfidence(full)) {
      usedFallback = true;
      const tiles = await tileImage(buffer, 4);
      const tileResults = await Promise.all(
        tiles.map(async (tile) => {
          const raw = await callOpenAIReceiptParse({
            client,
            model: RECEIPT_MODEL,
            dataUrl: tile,
            mode: "tile",
          });
          return postProcessReceiptParse(raw);
        }),
      );
      final = postProcessReceiptParse(mergeReceiptParses(full, tileResults));
      final.notes = Array.from(
        new Set([
          ...final.notes,
          "Fallback used: scanned receipt in zoomed slices to improve accuracy.",
        ]),
      );
    }

    console.log("[receipt-parse]", {
      user_id: user.id,
      store_id: user.storeNumber,
      ms: Date.now() - startedAt,
      usedFallback,
      lowConfidence: isLowConfidence(final),
    });

    return NextResponse.json(final);
  } catch (error) {
    const err = error as any;
    console.error("[receipt-parse] failed", {
      user_id: user.id,
      store_id: user.storeNumber,
      ms: Date.now() - startedAt,
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });
    return NextResponse.json(
      { error: "Receipt parsing failed. Please try again." },
      { status: 502 },
    );
  }
}
