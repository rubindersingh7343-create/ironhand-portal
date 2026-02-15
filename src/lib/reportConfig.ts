import type { CashFormulaConfig, ReportItemConfig } from "@/lib/types";

type ReportItemDefinition = {
  key: ReportItemConfig["key"];
  label: string;
};

export const CASH_FORMULA_META_KEY = "__cash_formula__";
export const DEFAULT_CASH_FORMULA: CashFormulaConfig = {
  baseKey: "gross",
  subtractKeys: ["lottoPo", "atm"],
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
  { key: "cash", label: "Cash" },
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
  const cleaned = (items ?? []).filter(
    (item) => item?.key !== CASH_FORMULA_META_KEY,
  );
  if (!cleaned.length) return getDefaultReportItems();
  const normalized = cleaned
    .map((item) => ({
      key: item.key,
      label: item.label?.trim() || item.key,
      enabled: item.enabled ?? true,
      marginPercent:
        item.marginPercent === undefined ? null : item.marginPercent,
      isCustom: item.isCustom ?? item.key.startsWith("custom-"),
    }))
    .filter((item) => item.label.trim());

  const byKey = new Map(normalized.map((item) => [item.key, item]));
  const merged: ReportItemConfig[] = BASE_REPORT_ITEMS.map((definition) => {
    const existing = byKey.get(definition.key);
    if (existing) return existing;
    return {
      key: definition.key,
      label: definition.label,
      enabled: true,
      marginPercent: null,
      isCustom: false,
    };
  });

  const baseKeys = new Set(BASE_REPORT_ITEMS.map((item) => item.key));
  normalized.forEach((item) => {
    if (!baseKeys.has(item.key)) merged.push(item);
  });

  return merged;
}

const parseCashFormula = (raw: unknown): Partial<CashFormulaConfig> | null => {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<CashFormulaConfig>;
  const subtractKeys = Array.isArray(candidate.subtractKeys)
    ? candidate.subtractKeys.filter((key): key is string => typeof key === "string")
    : [];
  return {
    baseKey: typeof candidate.baseKey === "string" ? candidate.baseKey : undefined,
    subtractKeys,
  };
};

export function normalizeCashFormula(
  formula: Partial<CashFormulaConfig> | null | undefined,
  items: ReportItemConfig[],
): CashFormulaConfig {
  const keys = new Set(items.map((item) => item.key));
  const formulaProvided = Boolean(formula);
  const baseKeyCandidate = formulaProvided ? formula?.baseKey : undefined;
  const baseKey = baseKeyCandidate && keys.has(baseKeyCandidate)
    ? baseKeyCandidate
    : DEFAULT_CASH_FORMULA.baseKey;
  const subtractSource = formulaProvided
    ? formula?.subtractKeys ?? []
    : DEFAULT_CASH_FORMULA.subtractKeys;
  const subtractKeys = subtractSource.filter(
    (key) => key !== baseKey && keys.has(key),
  );
  return { baseKey, subtractKeys };
}

export function splitReportConfigItems(
  items?: ReportItemConfig[] | null,
): { items: ReportItemConfig[]; cashFormula: CashFormulaConfig } {
  const metaItem = (items ?? []).find((item) => item.key === CASH_FORMULA_META_KEY);
  let parsedFormula: Partial<CashFormulaConfig> | null = null;
  if (metaItem?.label) {
    try {
      const decoded = JSON.parse(metaItem.label);
      parsedFormula = parseCashFormula(decoded?.cashFormula ?? decoded);
    } catch {
      parsedFormula = null;
    }
  }
  const normalizedItems = normalizeReportItems(items);
  return {
    items: normalizedItems,
    cashFormula: normalizeCashFormula(parsedFormula, normalizedItems),
  };
}

export function attachCashFormulaToItems(
  items: ReportItemConfig[],
  cashFormula?: CashFormulaConfig | null,
): ReportItemConfig[] {
  const normalizedItems = normalizeReportItems(items);
  const normalizedFormula = normalizeCashFormula(cashFormula, normalizedItems);
  const metaItem: ReportItemConfig = {
    key: CASH_FORMULA_META_KEY,
    label: JSON.stringify({ cashFormula: normalizedFormula }),
    enabled: false,
    marginPercent: null,
    isCustom: true,
  };
  return [...normalizedItems, metaItem];
}
