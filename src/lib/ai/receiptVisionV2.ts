import crypto from "crypto";
import OpenAI from "openai";
import sharp from "sharp";

export type ReceiptVisionV2Field = {
  key: string;
  label: string | null;
  amount: number | null;
  units: number | null;
  confidence: number; // 0..1
  evidence: { note: string | null };
};

export type ReceiptVisionV2Anomaly = {
  type:
    | "WEIRD_NUMBER"
    | "LOW_CONFIDENCE"
    | "SUM_MISMATCH"
    | "DUPLICATE_FIELD"
    | "MISSING_FIELD";
  message: string;
  related_key: string | null;
};

export type ReceiptVisionV2Extraction = {
  vendor: string | null;
  date: string | null;
  fields: ReceiptVisionV2Field[];
  anomalies: ReceiptVisionV2Anomaly[];
  needs_confirmation: string[];
  reasoning_summary: string;
};

export type ReceiptVisionV2Result = {
  extraction: ReceiptVisionV2Extraction;
  meta: {
    request_id: string;
    model: string;
    passes: number;
    used_multipass: boolean;
    total_latency_ms: number;
    bytes_sent: number;
    image: {
      input_bytes: number;
      output_bytes: number;
      width: number;
      height: number;
      format: string;
      orientation: number | null;
    };
    usage?: any;
  };
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const DEFAULT_KEYS = [
  "beer",
  "cigarettes",
  "liquor",
  "scratchers",
  "lotto",
  "tobacco",
  "gas",
  "gross",
  "net",
  "tax",
  "atm",
  "lotto_payout",
] as const;

const CRITICAL_KEYS = ["gross", "beer", "liquor", "cigarettes"] as const;

const moneyLike = (value: number) => Number.isFinite(value) && value >= 0 && value <= 250000;

const safeJson = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

const schemaFor = (allowedKeys: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: allowedKeys },
          label: { anyOf: [{ type: "string" }, { type: "null" }] },
          amount: { anyOf: [{ type: "number" }, { type: "null" }] },
          units: { anyOf: [{ type: "number" }, { type: "null" }] },
          confidence: { type: "number" },
          evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              note: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
            required: ["note"],
          },
        },
        required: ["key", "label", "amount", "units", "confidence", "evidence"],
      },
    },
    anomalies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["WEIRD_NUMBER", "LOW_CONFIDENCE", "SUM_MISMATCH", "DUPLICATE_FIELD", "MISSING_FIELD"],
          },
          message: { type: "string" },
          related_key: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["type", "message", "related_key"],
      },
    },
    needs_confirmation: { type: "array", items: { type: "string", enum: allowedKeys } },
    reasoning_summary: { type: "string" },
  },
  required: ["vendor", "date", "fields", "anomalies", "needs_confirmation", "reasoning_summary"],
});

export type ReceiptVisionV2PreprocessResult = {
  dataUrl: string;
  buffer: Buffer;
  meta: {
    input_bytes: number;
    output_bytes: number;
    width: number;
    height: number;
    format: string;
    orientation: number | null;
  };
};

export const decodeReceiptBase64 = (imageBase64: string) => {
  if (imageBase64.startsWith("data:")) {
    const match = imageBase64.match(/^data:(.+?);base64,(.*)$/);
    const base64 = match?.[2] ?? "";
    return Buffer.from(base64, "base64");
  }
  return Buffer.from(imageBase64, "base64");
};

export async function preprocessReceiptImageV2(args: {
  imageBase64: string;
  maxBytes: number;
  minWidth: number;
  jpegQuality: number;
}): Promise<ReceiptVisionV2PreprocessResult> {
  const inputBuffer = decodeReceiptBase64(args.imageBase64);
  const input_bytes = inputBuffer.byteLength;

  let image = sharp(inputBuffer, { failOnError: false });
  const meta = await image.metadata();
  const orientation = typeof meta.orientation === "number" ? meta.orientation : null;

  image = image.rotate(); // applies EXIF orientation

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const targetWidth = width > 0 && width < args.minWidth ? Math.min(2200, Math.max(args.minWidth, width * 2)) : width;

  if (width && targetWidth && targetWidth !== width) {
    image = image.resize({ width: Math.round(targetWidth), withoutEnlargement: false });
  }

  // Gentle enhancement: improve text readability (avoid heavy-handed filters).
  image = image
    .modulate({ brightness: 1.03, saturation: 1.0 })
    .linear(1.08, -8) // small contrast bump
    .sharpen({ sigma: 0.8, m1: 0.7, m2: 0.7 });

  // Try to stay under maxBytes with quality adjustments (up to a few steps).
  let quality = Math.max(70, Math.min(92, Math.round(args.jpegQuality)));
  let out = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
  for (let i = 0; i < 4 && out.byteLength > args.maxBytes; i += 1) {
    quality = Math.max(55, quality - 8);
    out = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  const outMeta = await sharp(out).metadata();
  const finalWidth = outMeta.width ?? 0;
  const finalHeight = outMeta.height ?? 0;
  const format = outMeta.format ?? meta.format ?? "jpeg";

  return {
    dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
    buffer: out,
    meta: {
      input_bytes,
      output_bytes: out.byteLength,
      width: finalWidth || width,
      height: finalHeight || height,
      format: String(format),
      orientation,
    },
  };
}

export async function sliceHorizontalStrips(args: {
  buffer: Buffer;
  strips: number;
  overlapPct: number; // 0..0.5
}): Promise<string[]> {
  const img = sharp(args.buffer);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return [];

  const strips = Math.max(3, Math.min(6, Math.round(args.strips)));
  const overlap = Math.max(0, Math.min(0.35, args.overlapPct));
  const baseH = Math.ceil(height / strips);
  const overlapPx = Math.floor(baseH * overlap);
  const dataUrls: string[] = [];

  for (let i = 0; i < strips; i += 1) {
    const start = Math.max(0, i * baseH - (i === 0 ? 0 : overlapPx));
    const end = Math.min(height, (i + 1) * baseH + (i === strips - 1 ? 0 : overlapPx));
    const h = Math.max(1, end - start);
    const tile = await sharp(args.buffer)
      .extract({ left: 0, top: start, width, height: h })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    dataUrls.push(`data:image/jpeg;base64,${tile.toString("base64")}`);
  }

  return dataUrls;
}

export function validateReceiptExtractionV2(extraction: ReceiptVisionV2Extraction): ReceiptVisionV2Extraction {
  const anomalies: ReceiptVisionV2Anomaly[] = [...(extraction.anomalies ?? [])];
  const needs = new Set<string>(extraction.needs_confirmation ?? []);

  const byKey = new Map<string, ReceiptVisionV2Field>();
  for (const field of extraction.fields ?? []) {
    byKey.set(field.key, field);
    if (typeof field.amount !== "number") continue;

    if (!moneyLike(field.amount)) {
      anomalies.push({
        type: "WEIRD_NUMBER",
        message: `Amount for ${field.key} is not money-like.`,
        related_key: field.key,
      });
      needs.add(field.key);
      continue;
    }

    // Reject/flag stray integers (ChatGPT "does the right thing" by ignoring these).
    const isIntegerish = Number.isInteger(field.amount);
    if (isIntegerish && field.amount >= 1000 && !["gross", "net"].includes(field.key)) {
      anomalies.push({
        type: "WEIRD_NUMBER",
        message: `Integer-looking amount for ${field.key} (${field.amount}). Please confirm.`,
        related_key: field.key,
      });
      needs.add(field.key);
    }

    if (field.amount > 9999 && !["gross", "net"].includes(field.key)) {
      anomalies.push({
        type: "WEIRD_NUMBER",
        message: `Unusually high amount for ${field.key} (${field.amount.toFixed(2)}).`,
        related_key: field.key,
      });
      needs.add(field.key);
    }

    if (field.confidence < 0.8 && field.amount !== null) {
      anomalies.push({
        type: "LOW_CONFIDENCE",
        message: `Low confidence for ${field.key}.`,
        related_key: field.key,
      });
      needs.add(field.key);
    }
  }

  // Missing critical fields are a confirmation need.
  for (const key of CRITICAL_KEYS) {
    const amt = byKey.get(key)?.amount;
    if (typeof amt !== "number") {
      anomalies.push({
        type: "MISSING_FIELD",
        message: `Missing ${key}.`,
        related_key: key,
      });
      needs.add(key);
    }
  }

  // Optional sum sanity (only if we have gross).
  const gross = byKey.get("gross")?.amount ?? null;
  if (typeof gross === "number" && gross > 0) {
    const deptKeys = ["beer", "liquor", "cigarettes", "tobacco", "gas", "scratchers", "lotto"];
    const deptSum = deptKeys.reduce((acc, k) => {
      const amt = byKey.get(k)?.amount;
      return acc + (typeof amt === "number" ? amt : 0);
    }, 0);
    if (deptSum > 0) {
      const mismatchPct = Math.abs(deptSum - gross) / Math.max(0.01, gross);
      if (mismatchPct > 0.05 && deptSum > gross * 1.15) {
        anomalies.push({
          type: "SUM_MISMATCH",
          message: `Departments (${deptSum.toFixed(2)}) don't reconcile with gross (${gross.toFixed(2)}).`,
          related_key: "gross",
        });
        deptKeys.forEach((k) => needs.add(k));
      }
    }
  }

  const dedupedAnomalies = Array.from(
    new Map(anomalies.map((a) => [`${a.type}:${a.related_key ?? ""}:${a.message}`, a])).values(),
  ).slice(0, 30);

  const needsList = Array.from(needs).filter(Boolean);
  const summary =
    needsList.length === 0
      ? "Parsed receipt with high confidence."
      : `Parsed receipt. Please confirm: ${needsList.slice(0, 6).join(", ")}${needsList.length > 6 ? "…" : ""}.`;

  return {
    ...extraction,
    anomalies: dedupedAnomalies,
    needs_confirmation: needsList,
    reasoning_summary: extraction.reasoning_summary?.trim() ? extraction.reasoning_summary : summary,
  };
}

export function mergeExtractionsV2(
  base: ReceiptVisionV2Extraction,
  tiles: ReceiptVisionV2Extraction[],
): ReceiptVisionV2Extraction {
  const all = [base, ...tiles];
  const allowed = Array.from(new Set(all.flatMap((x) => x.fields.map((f) => f.key))));
  const anomalies: ReceiptVisionV2Anomaly[] = [...(base.anomalies ?? [])];

  const bestByKey = new Map<string, ReceiptVisionV2Field>();
  for (const key of allowed) {
    const candidates = all
      .flatMap((x) => x.fields)
      .filter((f) => f.key === key && typeof f.amount === "number")
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const best = candidates[0];
    if (best) bestByKey.set(key, best);

    const distinct = Array.from(
      new Set(candidates.map((c) => Number((c.amount ?? 0).toFixed(2)))),
    );
    if (distinct.length > 1) {
      const min = Math.min(...distinct);
      const max = Math.max(...distinct);
      const deltaPct = Math.abs(max - min) / Math.max(0.01, Math.abs(min));
      if (deltaPct > 0.03) {
        anomalies.push({
          type: "DUPLICATE_FIELD",
          message: `Conflicting values for ${key} across passes.`,
          related_key: key,
        });
      }
    }
  }

  const merged: ReceiptVisionV2Extraction = {
    vendor: base.vendor ?? tiles.find((t) => t.vendor)?.vendor ?? null,
    date: base.date ?? tiles.find((t) => t.date)?.date ?? null,
    fields: allowed.map((key) => {
      const best = bestByKey.get(key);
      return (
        best ?? {
          key,
          label: null,
          amount: null,
          units: null,
          confidence: 0,
          evidence: { note: null },
        }
      );
    }),
    anomalies,
    needs_confirmation: [],
    reasoning_summary: "",
  };

  return validateReceiptExtractionV2(merged);
}

const shouldUseMultiPass = (extraction: ReceiptVisionV2Extraction) => {
  if ((extraction.needs_confirmation ?? []).some((k) => CRITICAL_KEYS.includes(k as any))) return true;
  const hasAnomaly = (extraction.anomalies ?? []).some((a) => a.type === "WEIRD_NUMBER" || a.type === "SUM_MISMATCH");
  if (hasAnomaly) return true;
  const criticalLow = extraction.fields.some(
    (f) => CRITICAL_KEYS.includes(f.key as any) && (typeof f.amount !== "number" || f.confidence < 0.8),
  );
  return criticalLow;
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>) => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
};

export async function callOpenAIReceiptVisionV2(args: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  allowedKeys: string[];
  categoriesText: string;
  passHint: string;
}) {
  const schema = schemaFor(args.allowedKeys);
  const response = await args.client.responses.create({
    model: args.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You extract receipt category totals and units.\n" +
              "Do not guess. If unsure, set amount null and confidence low.\n" +
              "Ignore random integers not paired with money patterns; treat them as anomalies.\n" +
              "Output must match the JSON schema exactly.\n",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Categories to extract:\n${args.categoriesText}\n\n` +
              `Pass: ${args.passHint}\n` +
              "Return amounts in dollars. If you cannot support a value from visible text, leave it null.",
          },
          { type: "input_image", image_url: args.dataUrl, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "receipt_extraction_v2",
        strict: true,
        schema,
      },
    },
  });

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText) as any;
  if (!parsed) throw new Error("ReceiptVisionV2: invalid JSON output.");
  return { parsed, usage: (response as any)?.usage ?? null };
}

export async function runReceiptVisionV2(args: {
  client: OpenAI;
  model: string;
  imageBase64: string;
  allowedKeys?: string[];
  maxBytes: number;
  debug?: boolean;
  prepared?: ReceiptVisionV2PreprocessResult;
}) : Promise<ReceiptVisionV2Result> {
  const request_id = crypto.randomUUID();
  const startedAt = Date.now();
  const allowedKeys = (args.allowedKeys?.length ? args.allowedKeys : Array.from(DEFAULT_KEYS)).map(String);

  const preprocess =
    args.prepared ??
    (await preprocessReceiptImageV2({
      imageBase64: args.imageBase64,
      maxBytes: args.maxBytes,
      minWidth: 1600,
      jpegQuality: 85,
    }));

  const categoriesText = allowedKeys
    .map((k) => `- ${k}`)
    .join("\n");

  if (args.debug) {
    console.log("[receipt-v2:image]", {
      request_id,
      model: args.model,
      ...preprocess.meta,
    });
  }

  const pass1Raw = await callOpenAIReceiptVisionV2({
    client: args.client,
    model: args.model,
    dataUrl: preprocess.dataUrl,
    allowedKeys,
    categoriesText,
    passHint: "Whole image",
  });

  const base: ReceiptVisionV2Extraction = {
    vendor: typeof pass1Raw.parsed?.vendor === "string" ? pass1Raw.parsed.vendor : null,
    date: typeof pass1Raw.parsed?.date === "string" ? pass1Raw.parsed.date : null,
    fields: Array.isArray(pass1Raw.parsed?.fields) ? pass1Raw.parsed.fields : [],
    anomalies: Array.isArray(pass1Raw.parsed?.anomalies) ? pass1Raw.parsed.anomalies : [],
    needs_confirmation: Array.isArray(pass1Raw.parsed?.needs_confirmation) ? pass1Raw.parsed.needs_confirmation : [],
    reasoning_summary: typeof pass1Raw.parsed?.reasoning_summary === "string" ? pass1Raw.parsed.reasoning_summary : "",
  };
  const pass1 = validateReceiptExtractionV2(base);

  let final = pass1;
  let used_multipass = false;
  let passes = 1;
  const usage = pass1Raw.usage ? [pass1Raw.usage] : [];

  if (shouldUseMultiPass(pass1)) {
    used_multipass = true;
    const strips = await sliceHorizontalStrips({ buffer: preprocess.buffer, strips: 5, overlapPct: 0.12 });
    const limited = strips.slice(0, 6);

    const tileExtractions = await mapLimit(limited, 2, async (tile, idx) => {
      const res = await callOpenAIReceiptVisionV2({
        client: args.client,
        model: args.model,
        dataUrl: tile,
        allowedKeys,
        categoriesText,
        passHint: `Strip ${idx + 1} (overlap)`,
      });
      passes += 1;
      if (res.usage) usage.push(res.usage);
      const ex: ReceiptVisionV2Extraction = {
        vendor: typeof res.parsed?.vendor === "string" ? res.parsed.vendor : null,
        date: typeof res.parsed?.date === "string" ? res.parsed.date : null,
        fields: Array.isArray(res.parsed?.fields) ? res.parsed.fields : [],
        anomalies: Array.isArray(res.parsed?.anomalies) ? res.parsed.anomalies : [],
        needs_confirmation: Array.isArray(res.parsed?.needs_confirmation) ? res.parsed.needs_confirmation : [],
        reasoning_summary: typeof res.parsed?.reasoning_summary === "string" ? res.parsed.reasoning_summary : "",
      };
      return validateReceiptExtractionV2(ex);
    });

    final = mergeExtractionsV2(pass1, tileExtractions);
  }

  const bytes_sent = preprocess.meta.output_bytes;

  return {
    extraction: final,
    meta: {
      request_id,
      model: args.model,
      passes,
      used_multipass,
      total_latency_ms: Date.now() - startedAt,
      bytes_sent,
      image: preprocess.meta,
      ...(usage.length ? { usage } : {}),
    },
  };
}
