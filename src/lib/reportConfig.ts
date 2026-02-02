import type { ReportItemConfig } from "@/lib/types";

type ReportItemDefinition = {
  key: ReportItemConfig["key"];
  label: string;
};

const BASE_REPORT_ITEMS: ReportItemDefinition[] = [
  { key: "gross", label: "Gross" },
  { key: "scr", label: "Scr" },
  { key: "lotto", label: "Lotto" },
  { key: "liquor", label: "Liquor" },
  { key: "beer", label: "Beer" },
  { key: "cig", label: "Cig" },
  { key: "tobacco", label: "Tobacco" },
  { key: "gas", label: "Gas" },
  { key: "atm", label: "ATM" },
  { key: "lottoPo", label: "Lotto P/O" },
  { key: "deposit", label: "Deposit" },
];

export function getDefaultReportItems(): ReportItemConfig[] {
  return BASE_REPORT_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    enabled: true,
    marginPercent: null,
    isCustom: false,
  }));
}

export function normalizeReportItems(
  items?: ReportItemConfig[] | null,
): ReportItemConfig[] {
  if (!items || !items.length) return getDefaultReportItems();
  return items
    .map((item) => ({
      key: item.key,
      label: item.label?.trim() || item.key,
      enabled: item.enabled ?? true,
      marginPercent:
        item.marginPercent === undefined ? null : item.marginPercent,
      isCustom: item.isCustom ?? item.key.startsWith("custom-"),
    }))
    .filter((item) => item.label.trim());
}
