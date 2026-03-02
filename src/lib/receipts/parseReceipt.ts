import OpenAI from "openai";
import sharp from "sharp";

export type ReceiptCategoryKey =
  | "gross"
  | "scr"
  | "lotto"
  | "liquor"
  | "beer"
  | "cigarettes"
  | "tobacco"
  | "gas"
  | "lotto_payout";

export type ReceiptCategory = {
  key: ReceiptCategoryKey;
  label: string;
  amount: number | null;
  confidence: number;
  evidence_text: string;
};

export type ReceiptUnknownLine = {
  text: string;
  amount: number | null;
  confidence: number;
};

export type ReceiptParseResult = {
  vendor: string | null;
  date: string | null;
  categories: ReceiptCategory[];
  unknown_lines: ReceiptUnknownLine[];
  notes: string[];
};

export const RECEIPT_CATEGORY_META: Array<{ key: ReceiptCategoryKey; label: string }> =
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
  ];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const coerceAmount = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[$,]/g, "");
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const sanitizeAmount = (value: number | null) => {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  if (value >= 100000) return null;
  return value;
};

const likelyOutlier = (value: number, peers: number[]) => {
  if (!peers.length) return false;
  const sorted = [...peers].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const median = Number.isFinite(mid) ? mid : 0;
  if (median <= 0) return value > 5000;
  return value > Math.max(5000, median * 25);
};

const buildSchema = () => ({
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: {
      anyOf: [
        { type: "string", description: "Date if visible. Prefer YYYY-MM-DD." },
        { type: "null" },
      ],
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: {
            type: "string",
            enum: RECEIPT_CATEGORY_META.map((c) => c.key),
          },
          label: { type: "string" },
          amount: { anyOf: [{ type: "number" }, { type: "null" }] },
          confidence: { type: "number" },
          evidence_text: { type: "string" },
        },
        required: ["key", "label", "amount", "confidence", "evidence_text"],
      },
    },
    unknown_lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          amount: { anyOf: [{ type: "number" }, { type: "null" }] },
          confidence: { type: "number" },
        },
        required: ["text", "amount", "confidence"],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["vendor", "date", "categories", "unknown_lines", "notes"],
});

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
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export type ParseMode = "full" | "tile";

export async function normalizeImageBase64(imageBase64: string): Promise<{
  dataUrl: string;
  buffer: Buffer;
}> {
  if (imageBase64.startsWith("data:")) {
    const match = imageBase64.match(/^data:(.+?);base64,(.*)$/);
    const base64 = match?.[2] ?? "";
    const buffer = Buffer.from(base64, "base64");
    return { dataUrl: imageBase64, buffer };
  }
  const buffer = Buffer.from(imageBase64, "base64");
  let mime = "image/jpeg";
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.format === "png") mime = "image/png";
    if (meta.format === "webp") mime = "image/webp";
    if (meta.format === "jpeg") mime = "image/jpeg";
  } catch {
    mime = "image/jpeg";
  }
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  return { dataUrl, buffer };
}

export async function tileImage(
  buffer: Buffer,
  tiles: number,
): Promise<string[]> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return [];

  const tileCount = Math.max(3, Math.min(5, tiles));
  const sliceHeight = Math.floor(height / tileCount);
  const dataUrls: string[] = [];

  for (let i = 0; i < tileCount; i += 1) {
    const top = i * sliceHeight;
    const h = i === tileCount - 1 ? height - top : sliceHeight;
    const tile = await sharp(buffer)
      .extract({ left: 0, top, width, height: h })
      .jpeg({ quality: 85 })
      .toBuffer();
    dataUrls.push(`data:image/jpeg;base64,${tile.toString("base64")}`);
  }
  return dataUrls;
}

export async function callOpenAIReceiptParse(args: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  mode: ParseMode;
}): Promise<ReceiptParseResult> {
  const { client, model, dataUrl, mode } = args;
  const isTile = mode === "tile";
  const system =
    "You read retail POS receipts. Extract department totals and return STRICT JSON only. No extra keys.";
  const user = isTile
    ? "This image is a horizontal slice of a receipt. Extract any department totals visible in this slice. Only include categories you see evidence for. If unsure, set amount null and lower confidence."
    : "Extract department totals from this receipt. Only return amounts you can directly support from the visible text. Never guess missing totals.";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `${user}\n\n` +
              "Rules:\n" +
              "- Amounts are USD.\n" +
              "- Provide evidence_text: copy the exact line(s) from the receipt that support the amount.\n" +
              "- confidence is 0..1.\n" +
              "- If evidence_text is empty, confidence must be < 0.6.\n" +
              "- If you see Cash/ATM/Card, ignore them.\n",
          },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "receipt_parse",
        strict: true,
        schema: buildSchema(),
      },
    },
  });

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText) as ReceiptParseResult | null;

  const base: ReceiptParseResult = {
    vendor: parsed?.vendor ?? null,
    date: parsed?.date ?? null,
    categories: Array.isArray(parsed?.categories) ? parsed!.categories : [],
    unknown_lines: Array.isArray(parsed?.unknown_lines) ? parsed!.unknown_lines : [],
    notes: Array.isArray(parsed?.notes) ? parsed!.notes : [],
  };

  return base;
}

export function postProcessReceiptParse(
  raw: ReceiptParseResult,
): ReceiptParseResult {
  const notes = [...(raw.notes ?? [])];

  const canonical = new Map(RECEIPT_CATEGORY_META.map((c) => [c.key, c.label]));
  const byKey = new Map<ReceiptCategoryKey, ReceiptCategory>();

  for (const row of raw.categories ?? []) {
    if (!canonical.has(row.key)) continue;
    const amount = sanitizeAmount(coerceAmount(row.amount));
    let confidence = clamp01(
      typeof row.confidence === "number" ? row.confidence : 0,
    );
    const evidence = String(row.evidence_text ?? "").trim();
    if (!evidence) {
      confidence = Math.min(confidence, 0.49);
      notes.push(`Missing evidence for ${canonical.get(row.key)}.`);
    }
    if (confidence < 0.6) {
      notes.push(`Low confidence for ${canonical.get(row.key)}.`);
    }
    if (amount === null && coerceAmount(row.amount) !== null) {
      notes.push(`Discarded invalid amount for ${canonical.get(row.key)}.`);
      confidence = Math.min(confidence, 0.49);
    }
    byKey.set(row.key, {
      key: row.key,
      label: canonical.get(row.key) ?? row.label,
      amount,
      confidence,
      evidence_text: evidence,
    });
  }

  // Ensure every category is present (missing => null), so UI can be consistent.
  const categories: ReceiptCategory[] = RECEIPT_CATEGORY_META.map((c) => {
    const existing = byKey.get(c.key);
    return (
      existing ?? {
        key: c.key,
        label: c.label,
        amount: null,
        confidence: 0,
        evidence_text: "",
      }
    );
  });

  const numeric = categories
    .map((c) => c.amount)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const peers = numeric.filter((v) => v > 0);

  for (const cat of categories) {
    if (typeof cat.amount !== "number") continue;
    if (likelyOutlier(cat.amount, peers.filter((v) => v !== cat.amount))) {
      cat.confidence = Math.min(cat.confidence, 0.45);
      notes.push(
        `Outlier amount for ${cat.label}. Please review (${cat.amount.toFixed(
          2,
        )}).`,
      );
    }
  }

  // Gross sanity vs sum of departments
  const gross = categories.find((c) => c.key === "gross")?.amount ?? null;
  const deptSumKeys: ReceiptCategoryKey[] = [
    "scr",
    "lotto",
    "liquor",
    "beer",
    "cigarettes",
    "tobacco",
    "gas",
  ];
  const deptSum = deptSumKeys.reduce((acc, key) => {
    const amt = categories.find((c) => c.key === key)?.amount ?? null;
    return acc + (typeof amt === "number" ? amt : 0);
  }, 0);
  if (typeof gross === "number" && gross > 0 && deptSum > gross * 1.2) {
    notes.push(
      `Department totals (${deptSum.toFixed(
        2,
      )}) exceed gross (${gross.toFixed(2)}). Marking lower confidence.`,
    );
    for (const cat of categories) {
      if (deptSumKeys.includes(cat.key) && typeof cat.amount === "number") {
        cat.confidence = Math.min(cat.confidence, 0.5);
      }
    }
  }

  const unknown_lines: ReceiptUnknownLine[] = (raw.unknown_lines ?? []).map(
    (line) => ({
      text: String(line.text ?? "").trim(),
      amount: sanitizeAmount(coerceAmount(line.amount)),
      confidence: clamp01(typeof line.confidence === "number" ? line.confidence : 0),
    }),
  );

  return {
    vendor: raw.vendor ? String(raw.vendor) : null,
    date: raw.date ? String(raw.date) : null,
    categories,
    unknown_lines: unknown_lines.filter((l) => l.text),
    notes: Array.from(new Set(notes.filter(Boolean))).slice(0, 20),
  };
}

export function isLowConfidence(result: ReceiptParseResult): boolean {
  const cats = result.categories ?? [];
  const meaningful = cats.filter((c) => typeof c.amount === "number");
  if (!meaningful.length) return true;
  const low = meaningful.filter((c) => c.confidence < 0.6).length;
  return low / meaningful.length > 0.35;
}

export function mergeReceiptParses(
  base: ReceiptParseResult,
  tiles: ReceiptParseResult[],
): ReceiptParseResult {
  const notes = [...(base.notes ?? [])];
  const bestByKey = new Map<ReceiptCategoryKey, ReceiptCategory>();

  const candidates = [base, ...tiles];
  for (const { key, label } of RECEIPT_CATEGORY_META) {
    let best: ReceiptCategory | null = null;
    for (const cand of candidates) {
      const row = (cand.categories ?? []).find((c) => c.key === key);
      if (!row) continue;
      if (row.amount === null) continue;
      if (!row.evidence_text?.trim()) continue;
      if (!best || row.confidence > best.confidence) best = row;
    }
    bestByKey.set(
      key,
      best ?? {
        key,
        label,
        amount: null,
        confidence: 0,
        evidence_text: "",
      },
    );
  }

  const merged: ReceiptParseResult = {
    vendor: base.vendor ?? tiles.find((t) => t.vendor)?.vendor ?? null,
    date: base.date ?? tiles.find((t) => t.date)?.date ?? null,
    categories: RECEIPT_CATEGORY_META.map((c) => bestByKey.get(c.key)!),
    unknown_lines: [],
    notes,
  };

  const unknown = new Map<string, ReceiptUnknownLine>();
  for (const cand of candidates) {
    for (const line of cand.unknown_lines ?? []) {
      const text = String(line.text ?? "").trim();
      if (!text) continue;
      const key = `${text}:${String(line.amount ?? "")}`;
      const existing = unknown.get(key);
      if (!existing || line.confidence > existing.confidence) {
        unknown.set(key, line);
      }
    }
  }
  merged.unknown_lines = Array.from(unknown.values()).slice(0, 25);
  merged.notes = Array.from(new Set(notes)).slice(0, 20);
  return merged;
}

