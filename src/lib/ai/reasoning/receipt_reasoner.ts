import crypto from "crypto";
import OpenAI from "openai";
import { normalizeImageBase64, tileImage } from "@/lib/receipts/parseReceipt";

export type ReceiptExtractionField = {
  key: string;
  label?: string;
  amount?: number | null;
  units?: number | null;
  confidence: number; // 0..1
  evidence?: { notes?: string };
};

export type ReceiptExtractionAnomaly = {
  type: "WEIRD_NUMBER" | "SUM_MISMATCH" | "DUPLICATE_FIELD" | "LOW_CONFIDENCE";
  message: string;
  related_key?: string;
};

export type ReceiptExtraction = {
  vendor?: string | null;
  date?: string | null;
  currency?: "USD";
  fields: ReceiptExtractionField[];
  anomalies: ReceiptExtractionAnomaly[];
  needs_confirmation: string[];
  reasoning_summary: string;
};

export type ReceiptReasonerStoreProfile = {
  store_name?: string;
  known_categories?: string[];
  mapping_preferences?: Record<string, string>;
};

export type ReceiptReasonerRequest = {
  image_base64: string;
  store_profile?: ReceiptReasonerStoreProfile;
  expected_fields?: string[];
  prior_text?: string | null;
  store_id?: string | null;
};

export type ReceiptReasonerMeta = {
  request_id: string;
  parse_version: string;
  used_multipass: boolean;
  passes: number;
  cached: boolean;
  total_latency_ms: number;
};

export type ReceiptReasonerResult = {
  extraction: ReceiptExtraction;
  meta: ReceiptReasonerMeta;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const PARSE_VERSION = "reasoning_receipt_v1";

const DEFAULT_ALLOWED_FIELDS = [
  "beer",
  "cigarettes",
  "liquor",
  "scratchers",
  "lotto",
  "tobacco",
  "gross",
  "net",
  "tax",
  "atm",
  "gas",
  "lotto_payout",
] as const;

const moneyLike = (n: number) => Number.isFinite(n) && Math.abs(n) <= 250000;

const hashBuffer = (buffer: Buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

type CacheEntry = { at: number; value: ReceiptReasonerResult };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const pruneCache = () => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.at > CACHE_TTL_MS) cache.delete(key);
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

const safeJson = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const schemaFor = (allowedKeys: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    currency: { type: "string", enum: ["USD"] },
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
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  notes: { anyOf: [{ type: "string" }, { type: "null" }] },
                },
                required: ["notes"],
              },
            ],
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
            enum: ["WEIRD_NUMBER", "SUM_MISMATCH", "DUPLICATE_FIELD", "LOW_CONFIDENCE"],
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
  required: [
    "vendor",
    "date",
    "currency",
    "fields",
    "anomalies",
    "needs_confirmation",
    "reasoning_summary",
  ],
});

const coerceExtraction = (raw: any, allowedKeys: string[]): ReceiptExtraction => {
  const byKey = new Map<string, ReceiptExtractionField>();
  const anomalies: ReceiptExtractionAnomaly[] = [];

  const fields: any[] = Array.isArray(raw?.fields) ? raw.fields : [];
  for (const f of fields) {
    const key = String(f?.key ?? "").trim();
    if (!key || !allowedKeys.includes(key)) continue;
    const amount = typeof f?.amount === "number" && Number.isFinite(f.amount) ? f.amount : null;
    const units = typeof f?.units === "number" && Number.isFinite(f.units) ? f.units : null;
    const confidence =
      typeof f?.confidence === "number" && Number.isFinite(f.confidence) ? clamp01(f.confidence) : 0;
    const evidenceNotes = typeof f?.evidence?.notes === "string" ? f.evidence.notes.trim() : "";

    const existing = byKey.get(key);
    if (existing) {
      anomalies.push({
        type: "DUPLICATE_FIELD",
        message: `Duplicate field for ${key}; using higher confidence value.`,
        related_key: key,
      });
      const existingScore = existing.confidence ?? 0;
      if (confidence > existingScore) {
        byKey.set(key, {
          key,
          label: typeof f?.label === "string" ? f.label : undefined,
          amount,
          units,
          confidence,
          evidence: evidenceNotes ? { notes: evidenceNotes } : undefined,
        });
      }
      continue;
    }

    byKey.set(key, {
      key,
      label: typeof f?.label === "string" ? f.label : undefined,
      amount,
      units,
      confidence,
      evidence: evidenceNotes ? { notes: evidenceNotes } : undefined,
    });
  }

  const normalizedFields = allowedKeys.map((key) => {
    const existing = byKey.get(key);
    return (
      existing ?? {
        key,
        confidence: 0,
        amount: null,
        units: null,
        label: null,
        evidence: null,
      }
    );
  });

  return {
    vendor: typeof raw?.vendor === "string" ? raw.vendor : null,
    date: typeof raw?.date === "string" ? raw.date : null,
    currency: "USD",
    fields: normalizedFields as ReceiptExtractionField[],
    anomalies,
    needs_confirmation: [],
    reasoning_summary: "",
  };
};

export function validateReceiptExtraction(extraction: ReceiptExtraction) {
  const anomalies: ReceiptExtractionAnomaly[] = [...(extraction.anomalies ?? [])];
  const needs = new Set<string>(extraction.needs_confirmation ?? []);

  const byKey = new Map<string, ReceiptExtractionField>();
  for (const field of extraction.fields ?? []) {
    byKey.set(field.key, field);
    const amount = field.amount;
    if (typeof amount !== "number") continue;
    if (!moneyLike(amount)) {
      anomalies.push({
        type: "WEIRD_NUMBER",
        message: `Amount for ${field.key} is not money-like.`,
        related_key: field.key,
      });
      needs.add(field.key);
      continue;
    }
    if (
      Number.isInteger(amount) &&
      amount >= 1000 &&
      !["gross", "net"].includes(field.key)
    ) {
      anomalies.push({
        type: "WEIRD_NUMBER",
        message: `Integer-looking amount for ${field.key} (${amount}). Please confirm.`,
        related_key: field.key,
      });
      needs.add(field.key);
    }
    if (amount > 10000 && !["gross", "net"].includes(field.key)) {
      anomalies.push({
        type: "WEIRD_NUMBER",
        message: `Unusually high amount for ${field.key} (${amount.toFixed(2)}).`,
        related_key: field.key,
      });
      needs.add(field.key);
    }
    if (field.confidence < 0.75 && amount !== null) {
      anomalies.push({
        type: "LOW_CONFIDENCE",
        message: `Low confidence for ${field.key}.`,
        related_key: field.key,
      });
      needs.add(field.key);
    }
  }

  const gross = byKey.get("gross")?.amount ?? null;
  if (typeof gross === "number" && gross > 0) {
    const deptKeys = [
      "beer",
      "liquor",
      "cigarettes",
      "tobacco",
      "gas",
      "scratchers",
      "lotto",
    ];
    const deptSum = deptKeys.reduce((acc, key) => {
      const amt = byKey.get(key)?.amount;
      return acc + (typeof amt === "number" ? amt : 0);
    }, 0);
    if (deptSum > 0 && deptSum > gross * 1.25) {
      anomalies.push({
        type: "SUM_MISMATCH",
        message: `Departments (${deptSum.toFixed(2)}) exceed gross (${gross.toFixed(2)}).`,
        related_key: "gross",
      });
      deptKeys.forEach((k) => needs.add(k));
    }
  }

  const dedupedAnomalies = Array.from(
    new Map(
      anomalies.map((a) => [`${a.type}:${a.related_key ?? ""}:${a.message}`, a]),
    ).values(),
  ).slice(0, 30);

  const needsList = Array.from(needs).filter(Boolean);
  const summary =
    needsList.length === 0
      ? "Parsed receipt with high confidence."
      : `Parsed receipt. Please confirm: ${needsList.slice(0, 6).join(", ")}${
          needsList.length > 6 ? "…" : ""
        }.`;

  return {
    ...extraction,
    anomalies: dedupedAnomalies,
    needs_confirmation: needsList,
    reasoning_summary: summary,
  } satisfies ReceiptExtraction;
}

export function mergeMultiPassResults(
  base: ReceiptExtraction,
  others: ReceiptExtraction[],
) {
  const mergedByKey = new Map<string, ReceiptExtractionField>();
  const anomalies: ReceiptExtractionAnomaly[] = [...(base.anomalies ?? [])];

  const candidates = [base, ...others];
  const keys = Array.from(
    new Set(
      candidates.flatMap((c) => (c.fields ?? []).map((f) => f.key)).filter(Boolean),
    ),
  );

  for (const key of keys) {
    const rows = candidates
      .flatMap((c) => c.fields ?? [])
      .filter((f) => f.key === key && typeof f.amount === "number");
    if (!rows.length) continue;

    const best = rows.reduce((acc, cur) => (cur.confidence > acc.confidence ? cur : acc), rows[0]);
    const distinct = new Map<number, ReceiptExtractionField>();
    rows.forEach((r) => {
      if (typeof r.amount === "number") distinct.set(Number(r.amount.toFixed(2)), r);
    });
    if (distinct.size > 1) {
      const amounts = Array.from(distinct.keys()).sort((a, b) => a - b);
      const min = amounts[0];
      const max = amounts[amounts.length - 1];
      const denom = Math.max(0.01, Math.abs(min));
      const deltaPct = Math.abs(max - min) / denom;
      if (deltaPct > 0.03) {
        anomalies.push({
          type: "DUPLICATE_FIELD",
          message: `Conflicting values for ${key} across passes.`,
          related_key: key,
        });
      }
    }

    mergedByKey.set(key, best);
  }

  const merged: ReceiptExtraction = {
    vendor: base.vendor ?? others.find((o) => o.vendor)?.vendor ?? null,
    date: base.date ?? others.find((o) => o.date)?.date ?? null,
    currency: "USD",
    fields: Array.from(mergedByKey.values()),
    anomalies,
    needs_confirmation: [],
    reasoning_summary: "",
  };

  return validateReceiptExtraction(merged);
}

const buildReasoningPayload = (args: {
  allowedKeys: string[];
  storeProfile?: ReceiptReasonerStoreProfile;
  expectedFields?: string[];
  priorText?: string | null;
  passHint: string;
}) => {
  const store = args.storeProfile?.store_name?.trim()
    ? `Store: ${args.storeProfile.store_name.trim()}\n`
    : "";
  const expected = args.expectedFields?.length
    ? `Expected fields: ${args.expectedFields.join(", ")}\n`
    : "";
  const priorText = args.priorText?.trim() ? `Prior extracted text:\n${args.priorText.trim()}\n` : "";
  return (
    "You are a receipt extraction engine.\n" +
    "Output MUST match the JSON schema. Do not add extra keys.\n" +
    "Only set an amount when you have direct evidence from the image text.\n" +
    "If unsure, set amount null and lower confidence.\n" +
    "confidence is 0..1.\n" +
    "Evidence: put the supporting receipt line in evidence.notes when possible.\n" +
    store +
    expected +
    priorText +
    `Pass hint: ${args.passHint}\n` +
    `Allowed keys: ${args.allowedKeys.join(", ")}\n`
  );
};

const REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT ?? "").trim();
const reasoningOpts = () => {
  if (!REASONING_EFFORT) return undefined;
  // Best-effort: don't assume models support it; the SDK will ignore unknown fields only if supported.
  return { effort: REASONING_EFFORT } as any;
};

async function callReasonerOnce(args: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  allowedKeys: string[];
  storeProfile?: ReceiptReasonerStoreProfile;
  expectedFields?: string[];
  priorText?: string | null;
  passHint: string;
}) {
  const schema = schemaFor(args.allowedKeys);
  const instructions = buildReasoningPayload({
    allowedKeys: args.allowedKeys,
    storeProfile: args.storeProfile,
    expectedFields: args.expectedFields,
    priorText: args.priorText,
    passHint: args.passHint,
  });

  const tools = [
    {
      type: "function",
      name: "get_expected_fields",
      description: "Returns the list of receipt fields the app cares about.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  ] as any[];

  const create = async (input: any) => {
    return args.client.responses.create({
      model: args.model,
      instructions,
      input,
      tools,
      // If tools are called, we'll handle them in a follow-up request.
      text: {
        format: {
          type: "json_schema",
          name: "receipt_extraction",
          strict: true,
          schema,
        },
      },
      ...(reasoningOpts() ? { reasoning: reasoningOpts() } : {}),
    });
  };

  const baseInput = [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Extract receipt totals." },
        { type: "input_image", image_url: args.dataUrl, detail: "high" },
      ],
    },
  ];

  let response = await create(baseInput);

  for (let turn = 0; turn < 3; turn += 1) {
    const calls =
      (response as any)?.output?.filter?.((item: any) => item?.type === "function_call") ?? [];
    if (!calls.length) break;

    const toolOutputs: any[] = [];
    for (const call of calls) {
      const name = String(call?.name ?? "");
      const callId = String(call?.call_id ?? "");
      if (name === "get_expected_fields") {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ expected_fields: args.allowedKeys }),
        });
      } else {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ error: "unknown_tool" }),
        });
      }
    }

    response = await create(toolOutputs);
  }

  const outputText = extractOutputText(response).trim();
  const parsed = safeJson(outputText);
  if (!parsed) throw new Error("Reasoning receipt: invalid JSON output.");
  return parsed;
}

const shouldMultiPass = (extraction: ReceiptExtraction) => {
  if ((extraction.needs_confirmation ?? []).length > 0) return true;
  const hasWeird = (extraction.anomalies ?? []).some((a) => a.type === "WEIRD_NUMBER");
  if (hasWeird) return true;
  const low = (extraction.fields ?? []).some(
    (f) => typeof f.amount === "number" && f.confidence < 0.75,
  );
  return low;
};

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
) => {
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

export async function reasonReceipt(args: {
  request: ReceiptReasonerRequest;
  client: OpenAI;
  model: string;
}) {
  const startedAt = Date.now();
  pruneCache();

  const request_id = crypto.randomUUID();

  const { dataUrl, buffer } = await normalizeImageBase64(args.request.image_base64);
  const allowedKeys = Array.isArray(args.request.expected_fields) && args.request.expected_fields.length
    ? Array.from(new Set(args.request.expected_fields.map((k) => String(k).trim()).filter(Boolean)))
    : Array.from(DEFAULT_ALLOWED_FIELDS);

  const hash = hashBuffer(buffer);
  const cached = cache.get(hash);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return {
      extraction: cached.value.extraction,
      meta: {
        ...cached.value.meta,
        request_id,
        cached: true,
        total_latency_ms: Date.now() - startedAt,
      },
    } satisfies ReceiptReasonerResult;
  }

  const raw1 = await callReasonerOnce({
    client: args.client,
    model: args.model,
    dataUrl,
    allowedKeys,
    storeProfile: args.request.store_profile,
    expectedFields: args.request.expected_fields,
    priorText: args.request.prior_text ?? null,
    passHint: "Whole image (pass 1).",
  });

  const pass1 = validateReceiptExtraction(coerceExtraction(raw1, allowedKeys));

  let final = pass1;
  let used_multipass = false;
  let passes = 1;

  if (shouldMultiPass(pass1)) {
    used_multipass = true;
    const tiles = await tileImage(buffer, 5);
    const strips = tiles.slice(0, 6);

    const tileExtractions = await mapLimit(strips, 2, async (tile, idx) => {
      const raw = await callReasonerOnce({
        client: args.client,
        model: args.model,
        dataUrl: tile,
        allowedKeys,
        storeProfile: args.request.store_profile,
        expectedFields: args.request.expected_fields,
        priorText: args.request.prior_text ?? null,
        passHint: `Horizontal strip pass ${idx + 2}.`,
      });
      passes += 1;
      return validateReceiptExtraction(coerceExtraction(raw, allowedKeys));
    });

    final = mergeMultiPassResults(pass1, tileExtractions);
  }

  const result: ReceiptReasonerResult = {
    extraction: final,
    meta: {
      request_id,
      parse_version: PARSE_VERSION,
      used_multipass,
      passes,
      cached: false,
      total_latency_ms: Date.now() - startedAt,
    },
  };

  cache.set(hash, { at: Date.now(), value: result });
  return result;
}

