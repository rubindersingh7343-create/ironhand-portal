import { describe, expect, test } from "vitest";
import {
  mergeExtractionsV2,
  validateReceiptExtractionV2,
  type ReceiptVisionV2Extraction,
} from "@/lib/ai/receiptVisionV2";

const make = (fields: Array<{ key: string; amount: number | null; confidence: number }>): ReceiptVisionV2Extraction => ({
  vendor: "NRS",
  date: "2026-02-27",
  fields: fields.map((f) => ({
    key: f.key,
    label: f.key,
    amount: f.amount,
    units: null,
    confidence: f.confidence,
    evidence: { note: "line" },
  })),
  anomalies: [],
  needs_confirmation: [],
  reasoning_summary: "",
});

describe("validateReceiptExtractionV2", () => {
  test("flags stray integers like 4211", () => {
    const validated = validateReceiptExtractionV2(
      make([
        { key: "gross", amount: 15118.22, confidence: 0.9 },
        { key: "cigarettes", amount: 4211, confidence: 0.92 },
      ]),
    );
    expect(validated.needs_confirmation).toContain("cigarettes");
    expect(validated.anomalies.some((a) => a.type === "WEIRD_NUMBER")).toBe(true);
  });
});

describe("mergeExtractionsV2", () => {
  test("chooses higher confidence per key", () => {
    const base = validateReceiptExtractionV2(
      make([
        { key: "beer", amount: 20, confidence: 0.4 },
        { key: "gross", amount: 1000, confidence: 0.9 },
      ]),
    );
    const tile = validateReceiptExtractionV2(
      make([{ key: "beer", amount: 22.5, confidence: 0.86 }]),
    );
    const merged = mergeExtractionsV2(base, [tile]);
    const beer = merged.fields.find((f) => f.key === "beer");
    expect(beer?.amount).toBe(22.5);
    expect(beer?.confidence).toBeGreaterThan(0.8);
  });
});

