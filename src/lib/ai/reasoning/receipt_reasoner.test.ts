import { describe, expect, test } from "vitest";
import {
  mergeMultiPassResults,
  validateReceiptExtraction,
  type ReceiptExtraction,
} from "@/lib/ai/reasoning/receipt_reasoner";

const make = (fields: Array<{ key: string; amount: number | null; confidence: number }>): ReceiptExtraction => ({
  vendor: "NRS",
  date: "2026-02-27",
  currency: "USD",
  fields: fields.map((f) => ({ ...f, evidence: { notes: "line" } })),
  anomalies: [],
  needs_confirmation: [],
  reasoning_summary: "",
});

describe("validateReceiptExtraction", () => {
  test("flags weird integer-looking line items", () => {
    const validated = validateReceiptExtraction(
      make([
        { key: "gross", amount: 15211.0, confidence: 0.92 },
        { key: "cigarettes", amount: 4211, confidence: 0.88 },
      ]),
    );
    expect(validated.needs_confirmation).toContain("cigarettes");
    expect(validated.anomalies.some((a) => a.type === "WEIRD_NUMBER")).toBe(true);
  });

  test("flags low confidence fields", () => {
    const validated = validateReceiptExtraction(
      make([
        { key: "gross", amount: 1200.5, confidence: 0.9 },
        { key: "beer", amount: 55.25, confidence: 0.5 },
      ]),
    );
    expect(validated.needs_confirmation).toContain("beer");
    expect(validated.anomalies.some((a) => a.type === "LOW_CONFIDENCE")).toBe(true);
  });
});

describe("mergeMultiPassResults", () => {
  test("prefers higher-confidence value per key", () => {
    const base = validateReceiptExtraction(
      make([
        { key: "gross", amount: 1000, confidence: 0.9 },
        { key: "beer", amount: 20, confidence: 0.4 },
      ]),
    );
    const tile = validateReceiptExtraction(
      make([
        { key: "beer", amount: 22.5, confidence: 0.86 },
      ]),
    );
    const merged = mergeMultiPassResults(base, [tile]);
    const beer = merged.fields.find((f) => f.key === "beer");
    expect(beer?.amount).toBe(22.5);
    expect(beer?.confidence).toBeGreaterThan(0.8);
  });
});

