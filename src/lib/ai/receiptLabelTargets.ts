import { getStoreReportConfig } from "@/lib/dataStore";
import { normalizeReportItems } from "@/lib/reportConfig";

export type ReceiptLabelMatchMode = "exact" | "normalized";

export type ReceiptLabelTargets = {
  storeId: string;
  allowedKeys: string[]; // receipt-vision keys (stable internal ids)
  allowedLabels: string[]; // exact label strings from owner settings
  labelByKey: Record<string, string>; // receipt-key -> label
  matchMode: ReceiptLabelMatchMode;
};

// Map store report config keys -> receipt vision keys used by the scanner/AI.
// This lets owners configure labels once (in report settings) while the receipt scanner
// still fills the same underlying shift report fields.
const REPORT_KEY_TO_RECEIPT_KEY: Record<string, string> = {
  gross: "gross",
  scr: "scr",
  lotto: "lotto",
  liquor: "liquor",
  beer: "beer",
  cig: "cigarettes",
  tobacco: "tobacco",
  gas: "gas",
  atm: "atm",
  lottoPo: "lotto_payout",
};

export const getReceiptLabelMatchMode = (): ReceiptLabelMatchMode => {
  const raw = (process.env.IH_RECEIPT_LABEL_MATCH_MODE ?? "normalized").toLowerCase();
  return raw === "exact" ? "exact" : "normalized";
};

export async function getReceiptLabelTargetsForStore(storeId: string): Promise<ReceiptLabelTargets | null> {
  if (!storeId) return null;
  const config = await getStoreReportConfig(storeId);
  const items = normalizeReportItems(config?.items);

  const labelByKey: Record<string, string> = {};
  for (const item of items) {
    if (!item?.enabled) continue;
    const receiptKey = REPORT_KEY_TO_RECEIPT_KEY[String(item.key)] ?? null;
    if (!receiptKey) continue;
    const label = String(item.label ?? "").trim();
    if (!label) continue;
    labelByKey[receiptKey] = label;
  }

  const allowedKeys = Object.keys(labelByKey);
  if (!allowedKeys.length) return null;

  const allowedLabels = Array.from(new Set(Object.values(labelByKey).map((l) => l.trim()).filter(Boolean)));

  return {
    storeId,
    allowedKeys,
    allowedLabels,
    labelByKey,
    matchMode: getReceiptLabelMatchMode(),
  };
}

