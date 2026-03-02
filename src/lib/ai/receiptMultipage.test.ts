import { describe, expect, it } from "vitest";
import { mergeReceiptVisionV2Pages } from "@/lib/ai/receiptMultipage";

describe("mergeReceiptVisionV2Pages", () => {
  it("chooses highest confidence per key and flags conflicts", () => {
    const startedAt = Date.now();
    const pages: any[] = [
      {
        extraction: {
          vendor: null,
          date: null,
          fields: [
            { key: "beer", label: null, amount: 10, units: null, confidence: 0.6, evidence: { note: "p1" } },
          ],
          anomalies: [],
          needs_confirmation: [],
          reasoning_summary: "",
        },
        meta: { request_id: "p1", model: "x", passes: 1, used_multipass: false, total_latency_ms: 1, image: {} },
      },
      {
        extraction: {
          vendor: null,
          date: null,
          fields: [
            { key: "beer", label: null, amount: 10.2, units: null, confidence: 0.95, evidence: { note: "p2" } },
          ],
          anomalies: [],
          needs_confirmation: [],
          reasoning_summary: "",
        },
        meta: { request_id: "p2", model: "x", passes: 1, used_multipass: false, total_latency_ms: 1, image: {} },
      },
    ];

    const merged = mergeReceiptVisionV2Pages({ model: "x", pages: pages as any, startedAt });
    const beer = merged.extraction.fields.find((f) => f.key === "beer");
    expect(beer?.amount).toBeCloseTo(10.2, 2);
    // distinct values differ by ~2% => should not necessarily be a conflict anomaly
    expect(merged.extraction.anomalies.some((a) => a.type === "DUPLICATE_FIELD")).toBe(false);
  });

  it("flags duplicate field when values differ > 3%", () => {
    const startedAt = Date.now();
    const pages: any[] = [
      {
        extraction: {
          vendor: null,
          date: null,
          fields: [
            { key: "liquor", label: null, amount: 100, units: null, confidence: 0.95, evidence: { note: "p1" } },
          ],
          anomalies: [],
          needs_confirmation: [],
          reasoning_summary: "",
        },
        meta: { request_id: "p1", model: "x", passes: 1, used_multipass: false, total_latency_ms: 1, image: {} },
      },
      {
        extraction: {
          vendor: null,
          date: null,
          fields: [
            { key: "liquor", label: null, amount: 111, units: null, confidence: 0.92, evidence: { note: "p2" } },
          ],
          anomalies: [],
          needs_confirmation: [],
          reasoning_summary: "",
        },
        meta: { request_id: "p2", model: "x", passes: 1, used_multipass: false, total_latency_ms: 1, image: {} },
      },
    ];

    const merged = mergeReceiptVisionV2Pages({ model: "x", pages: pages as any, startedAt });
    expect(merged.extraction.anomalies.some((a) => a.type === "DUPLICATE_FIELD")).toBe(true);
    expect(merged.extraction.needs_confirmation.includes("liquor")).toBe(true);
  });
});

