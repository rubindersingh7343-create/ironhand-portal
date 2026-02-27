import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSessionUser } from "@/lib/auth";
import {
  normalizeImageBase64,
  tileImage,
} from "@/lib/receipts/parseReceipt";
import {
  parseMoney,
  parseNrsTerminalReport,
  type NrsTerminalReportJson,
} from "@/lib/receiptParsing/nrsTerminalReport";

export const runtime = "nodejs";

const OCR_MODEL = process.env.OPENAI_RECEIPT_OCR_MODEL ?? "gpt-4o-mini";
const FILL_MODEL = process.env.OPENAI_RECEIPT_FILL_MODEL ?? "gpt-5-mini";
const PARSE_VERSION = "nrs_terminal_report_v1";
const CONFIDENCE_THRESHOLD = 6;
const REQUIRED_KEYS: Array<keyof NrsTerminalReportJson> = [
  "gross_sales",
  "net_sales",
  "cash",
  "credit_debit",
  "taxable_sales",
  "tax_collected",
  "scratcher_sales",
  "lotto_sales",
];

const scoreParsed = (parsed: NrsTerminalReportJson) => {
  const missing = REQUIRED_KEYS.filter((key) => typeof parsed[key] !== "number").map(String);
  const score = Math.max(0, REQUIRED_KEYS.length - missing.length);
  return {
    confidence_score: Math.min(score, REQUIRED_KEYS.length),
    missing_fields: missing,
  };
};

const extractOutputText = (response: any) => {
  if (response?.output_text) return response.output_text as string;
  const output = response?.output ?? [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    for (const content of item?.content ?? []) {
      if (content?.text) return content.text as string;
    }
  }
  return "";
};

const safeJson = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
};

const normalizeText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

async function ocrReceiptText(args: {
  client: OpenAI;
  model: string;
  dataUrl: string;
}) {
  const response = await args.client.responses.create({
    model: args.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an OCR engine. Extract text from receipts.\n" +
              "Rules:\n" +
              "- Output ONLY the raw text.\n" +
              "- Preserve line breaks.\n" +
              "- Do NOT add commentary.\n" +
              "- Do NOT hallucinate missing characters.\n",
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Extract all visible text." },
          { type: "input_image", image_url: args.dataUrl, detail: "high" },
        ],
      },
    ],
  });
  return extractOutputText(response).trim();
}

function applyFillPatch(base: NrsTerminalReportJson, patch: any) {
  if (!patch || typeof patch !== "object") return base;

  const next: NrsTerminalReportJson = { ...base, meta: { ...(base.meta ?? {}) } };

  const numericKeys: Array<keyof NrsTerminalReportJson> = [
    "gross_sales",
    "net_sales",
    "cash",
    "check",
    "credit_debit",
    "taxable_sales",
    "tax_collected",
    "crv_fee",
    "total_tax_and_fees",
    "non_taxable_product_sales",
    "non_taxable_other_sales",
    "lotto_sales",
    "scratcher_sales",
    "lotto_payout",
    "scratcher_payout",
    "cashback_lottery",
    "cashback_scratch",
  ];

  numericKeys.forEach((key) => {
    const candidate = (patch as any)[key];
    if (candidate === null || candidate === undefined) return;
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      (next as any)[key] = candidate;
      return;
    }
    if (typeof candidate === "string") {
      const parsed = parseMoney(candidate);
      if (parsed !== null) (next as any)[key] = parsed;
    }
  });

  if (patch?.meta && typeof patch.meta === "object") {
    ["store_name", "report_start", "report_end", "terminal_id", "printed_at"].forEach(
      (key) => {
        const val = patch.meta[key];
        if (typeof val === "string" && val.trim()) (next.meta as any)[key] = val.trim();
      },
    );
  }

  if (patch?.categories && typeof patch.categories === "object") {
    const allowed = [
      "beer",
      "liquor",
      "wine",
      "cigarettes",
      "tobacco",
      "grocery_tax",
      "grocery_non_tax",
      "soda",
      "water_juice",
    ];
    const baseCats = { ...(base.categories ?? {}) };
    allowed.forEach((key) => {
      const val = patch.categories[key];
      if (val === null || val === undefined) return;
      if (typeof val === "number" && Number.isFinite(val)) (baseCats as any)[key] = val;
      if (typeof val === "string") {
        const parsed = parseMoney(val);
        if (parsed !== null) (baseCats as any)[key] = parsed;
      }
    });
    if (Object.keys(baseCats).length) next.categories = baseCats;
  }

  return next;
}

async function fillMissingWithLlm(args: {
  client: OpenAI;
  model: string;
  rawText: string;
  missingKeys: string[];
}) {
  if (!args.missingKeys.length) return null;

  const response = await args.client.responses.create({
    model: args.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You extract numbers from receipt OCR text.\n" +
              "Return STRICT JSON only. No prose.\n" +
              "Only include keys the user requests.\n" +
              "Use numbers (not strings) where possible, or null.\n",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Receipt OCR text:\n${args.rawText}\n\n` +
              `Fill ONLY these keys:\n${args.missingKeys.join(", ")}\n\n` +
              "Schema (subset):\n" +
              "{\n" +
              '  \"gross_sales\": number|null,\n' +
              '  \"net_sales\": number|null,\n' +
              '  \"cash\": number|null,\n' +
              '  \"check\": number|null,\n' +
              '  \"credit_debit\": number|null,\n' +
              '  \"taxable_sales\": number|null,\n' +
              '  \"tax_collected\": number|null,\n' +
              '  \"crv_fee\": number|null,\n' +
              '  \"total_tax_and_fees\": number|null,\n' +
              '  \"non_taxable_product_sales\": number|null,\n' +
              '  \"non_taxable_other_sales\": number|null,\n' +
              '  \"lotto_sales\": number|null,\n' +
              '  \"scratcher_sales\": number|null,\n' +
              '  \"lotto_payout\": number|null,\n' +
              '  \"scratcher_payout\": number|null,\n' +
              '  \"cashback_lottery\": number|null,\n' +
              '  \"cashback_scratch\": number|null,\n' +
              '  \"categories\": {beer, liquor, wine, cigarettes, tobacco, grocery_tax, grocery_non_tax, soda, water_juice} (numbers|null),\n' +
              '  \"meta\": {store_name, report_start, report_end, terminal_id, printed_at} (strings|null)\n' +
              "}\n",
          },
        ],
      },
    ],
  });

  const text = extractOutputText(response).trim();
  return safeJson(text);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const imageBase64 = body?.image_base64 as string | undefined;
  const storeId =
    typeof body?.storeId === "string" && body.storeId.trim()
      ? body.storeId.trim()
      : user.storeNumber;

  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "Missing image_base64." }, { status: 400 });
  }

  const startedAt = Date.now();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const { dataUrl, buffer } = await normalizeImageBase64(imageBase64);

    let rawText = await ocrReceiptText({ client, model: OCR_MODEL, dataUrl });
    rawText = rawText.trim();

    // If OCR seems empty, try tiled OCR.
    if (rawText.length < 80) {
      const tiles = await tileImage(buffer, 4);
      const tileTexts = await Promise.all(
        tiles.map((tile) => ocrReceiptText({ client, model: OCR_MODEL, dataUrl: tile })),
      );
      rawText = tileTexts.filter(Boolean).join("\n").trim();
    }

    const normalizedText = normalizeText(rawText);
    const baseParse = parseNrsTerminalReport(rawText);

    let finalParsed = baseParse.parsed;
    let usedLlmFallback = false;

    if (baseParse.confidence_score < CONFIDENCE_THRESHOLD) {
      usedLlmFallback = true;
      const patch = await fillMissingWithLlm({
        client,
        model: FILL_MODEL,
        rawText: normalizedText.slice(0, 20000),
        missingKeys: baseParse.missing_fields,
      });
      finalParsed = applyFillPatch(baseParse.parsed, patch);
    }

    const scored = scoreParsed(finalParsed);

    const responsePayload = {
      raw_text: rawText,
      normalized_text: normalizedText,
      parsed_json: finalParsed,
      confidence_score: scored.confidence_score,
      missing_fields: scored.missing_fields,
      parse_version: PARSE_VERSION,
      used_llm_fallback: usedLlmFallback,
    };

    console.log("[receipt-parse:nrs]", {
      user_id: user.id,
      store_id: storeId,
      ms: Date.now() - startedAt,
      confidence: responsePayload.confidence_score,
      used_llm_fallback: usedLlmFallback,
      missing: responsePayload.missing_fields.length,
      raw_len: rawText.length,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    const err = error as any;
    console.error("[receipt-parse:nrs] failed", {
      user_id: user.id,
      store_id: storeId,
      ms: Date.now() - startedAt,
      message: err?.message ?? "Unknown error",
      status: err?.status,
      code: err?.code,
      type: err?.type,
    });
    return NextResponse.json(
      { error: "Receipt parsing failed. Please retake the photo and try again." },
      { status: 502 },
    );
  }
}
