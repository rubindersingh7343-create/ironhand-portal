import crypto from "crypto";
import type { ReceiptVisionV2Extraction, ReceiptVisionV2Result } from "@/lib/ai/receiptVisionV2";
import { mergeExtractionsV2 } from "@/lib/ai/receiptVisionV2";

export type ReceiptVisionV2MultipageResult = {
  extraction: ReceiptVisionV2Extraction;
  meta: {
    request_id: string;
    model: string;
    pages: number;
    per_page: Array<Pick<ReceiptVisionV2Result["meta"], "passes" | "used_multipass">>;
    total_latency_ms: number;
  };
};

export function mergeReceiptVisionV2Pages(args: {
  model: string;
  pages: ReceiptVisionV2Result[];
  startedAt: number;
}): ReceiptVisionV2MultipageResult {
  const request_id = crypto.randomUUID();
  const first = args.pages[0];
  if (!first) {
    return {
      extraction: {
        vendor: null,
        date: null,
        fields: [],
        anomalies: [
          { type: "MISSING_FIELD", message: "No pages provided.", related_key: null },
        ],
        needs_confirmation: ["gross"],
        reasoning_summary: "No receipt pages provided.",
      },
      meta: {
        request_id,
        model: args.model,
        pages: 0,
        per_page: [],
        total_latency_ms: Date.now() - args.startedAt,
      },
    };
  }

  const merged = mergeExtractionsV2(
    first.extraction,
    args.pages.slice(1).map((p) => p.extraction),
  );

  return {
    extraction: merged,
    meta: {
      request_id,
      model: args.model,
      pages: args.pages.length,
      per_page: args.pages.map((p) => ({
        passes: p.meta.passes,
        used_multipass: p.meta.used_multipass,
      })),
      total_latency_ms: Date.now() - args.startedAt,
    },
  };
}

