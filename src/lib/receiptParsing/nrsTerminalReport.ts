export type NrsTerminalReportCategoryTotals = Partial<{
  beer: number;
  liquor: number;
  wine: number;
  cigarettes: number;
  tobacco: number;
  grocery_tax: number;
  grocery_non_tax: number;
  soda: number;
  water_juice: number;
}>;

export type NrsTerminalReportMeta = Partial<{
  store_name: string;
  report_start: string;
  report_end: string;
  terminal_id: string;
  printed_at: string;
}>;

export type NrsTerminalReportJson = {
  gross_sales: number | null;
  net_sales: number | null;
  cash: number | null;
  check: number | null;
  credit_debit: number | null;
  taxable_sales: number | null;
  tax_collected: number | null;
  crv_fee: number | null;
  total_tax_and_fees: number | null;
  non_taxable_product_sales: number | null;
  non_taxable_other_sales: number | null;
  lotto_sales: number | null;
  scratcher_sales: number | null;
  lotto_payout: number | null;
  scratcher_payout: number | null;
  cashback_lottery: number | null;
  cashback_scratch: number | null;
  categories?: NrsTerminalReportCategoryTotals;
  meta: NrsTerminalReportMeta;
};

export type NrsTerminalReportParseResult = {
  parsed: NrsTerminalReportJson;
  original_text: string;
  normalized_text: string;
  confidence_score: number;
  evidence: Record<string, string>;
  missing_fields: string[];
};

const moneyTokenRe =
  /[-+]?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})|[-+]?\$?\d+(?:\.\d{2})/g;

const collapseSpaces = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeMoneyToken = (token: string) =>
  token.replace(/[$,]/g, "").trim();

export const parseMoney = (value: string): number | null => {
  const normalized = normalizeMoneyToken(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractMoneyTokens = (line: string): string[] => {
  const matches = line.match(moneyTokenRe);
  return matches ? matches.map((m) => m.trim()) : [];
};

const extractLastMoney = (line: string): number | null => {
  const tokens = extractMoneyTokens(line);
  if (!tokens.length) return null;
  return parseMoney(tokens[tokens.length - 1]) ?? null;
};

const findFirstMatch = (
  lines: string[],
  patterns: RegExp[],
): { index: number; line: string } | null => {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const re of patterns) {
      if (re.test(line)) return { index: i, line };
    }
  }
  return null;
};

type SectionKey =
  | "sales"
  | "cashbacks"
  | "taxes"
  | "other_info"
  | "net_product_sales"
  | "net_other_sales";

const SECTION_HEADERS: Record<SectionKey, RegExp[]> = {
  sales: [/^\s*sales\s*$/i],
  cashbacks: [/^\s*cashbacks?\s*$/i, /^\s*cash\s*backs?\s*$/i],
  taxes: [
    /taxes?\s*&\s*fees?\s*collection\s*summary/i,
    /taxes?\s*and\s*fees?\s*collection\s*summary/i,
  ],
  other_info: [/^\s*other\s+information\s*$/i],
  net_product_sales: [/^\s*net\s+product\s+sales\s*$/i],
  net_other_sales: [/^\s*net\s+other\s+sales\s*$/i],
};

const findSectionStarts = (lines: string[]) => {
  const starts: Partial<Record<SectionKey, number>> = {};
  (Object.keys(SECTION_HEADERS) as SectionKey[]).forEach((key) => {
    const hit = findFirstMatch(lines, SECTION_HEADERS[key]);
    if (hit) starts[key] = hit.index;
  });
  return starts;
};

const buildRanges = (
  lines: string[],
  starts: Partial<Record<SectionKey, number>>,
) => {
  const entries = (Object.entries(starts) as Array<[SectionKey, number]>)
    .filter(([, idx]) => typeof idx === "number")
    .sort((a, b) => a[1] - b[1]);

  const ranges: Record<SectionKey, { start: number; end: number }> = {
    sales: { start: 0, end: lines.length },
    cashbacks: { start: 0, end: lines.length },
    taxes: { start: 0, end: lines.length },
    other_info: { start: 0, end: lines.length },
    net_product_sales: { start: 0, end: lines.length },
    net_other_sales: { start: 0, end: lines.length },
  };

  for (let i = 0; i < entries.length; i += 1) {
    const [key, start] = entries[i];
    const nextStart = entries[i + 1]?.[1] ?? lines.length;
    ranges[key] = { start, end: nextStart };
  }

  return ranges;
};

const linesInRange = (
  lines: string[],
  range: { start: number; end: number } | null | undefined,
) => {
  if (!range) return lines;
  return lines.slice(range.start, range.end);
};

const findValueByLabel = (lines: string[], labelPatterns: RegExp[]) => {
  for (const line of lines) {
    for (const re of labelPatterns) {
      if (!re.test(line)) continue;
      const amount = extractLastMoney(line);
      if (amount !== null) return { amount, evidence: line };
    }
  }
  return { amount: null as number | null, evidence: "" };
};

const findDateRange = (text: string) => {
  const re =
    /(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))\s+to\s+(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i;
  const match = text.match(re);
  if (!match) return { start: null, end: null };
  return { start: match[1], end: match[2] };
};

const categoryMatchers: Array<{
  key: keyof NrsTerminalReportCategoryTotals;
  patterns: RegExp[];
}> = [
  { key: "beer", patterns: [/^\s*beer\b/i] },
  { key: "liquor", patterns: [/^\s*liquor\b/i, /^\s*spirits?\b/i] },
  { key: "wine", patterns: [/^\s*wine\b/i] },
  { key: "cigarettes", patterns: [/^\s*cig(?:arettes?)?\b/i] },
  { key: "tobacco", patterns: [/^\s*tobacco\b/i] },
  { key: "grocery_tax", patterns: [/^\s*grocery\b.*\btax\b/i, /^\s*taxable\s+grocery\b/i] },
  { key: "grocery_non_tax", patterns: [/^\s*grocery\b.*\bnon\b.*\btax\b/i, /^\s*non[- ]?taxable\s+grocery\b/i] },
  { key: "soda", patterns: [/^\s*soda\b/i, /^\s*soft\s+drinks?\b/i] },
  { key: "water_juice", patterns: [/^\s*water\b/i, /^\s*juice\b/i, /^\s*water\s*\/\s*juice\b/i] },
];

const parseNetProductSalesCategories = (lines: string[]) => {
  const categories: NrsTerminalReportCategoryTotals = {};
  const evidence: Record<string, string> = {};

  for (const line of lines) {
    const amount = extractLastMoney(line);
    if (amount === null) continue;
    for (const matcher of categoryMatchers) {
      if (matcher.patterns.some((re) => re.test(line))) {
        if (categories[matcher.key] === undefined) {
          categories[matcher.key] = amount;
          evidence[`categories.${matcher.key}`] = line;
        }
      }
    }
  }

  return {
    categories: Object.keys(categories).length ? categories : undefined,
    evidence,
  };
};

const computeConfidence = (parsed: NrsTerminalReportJson, evidence: Record<string, string>) => {
  const required: Array<keyof NrsTerminalReportJson> = [
    "gross_sales",
    "net_sales",
    "cash",
    "credit_debit",
    "taxable_sales",
    "tax_collected",
    "scratcher_sales",
    "lotto_sales",
  ];
  let score = 0;
  required.forEach((key) => {
    if (typeof parsed[key] === "number") score += 1;
  });
  // Small bump if we found date range / meta.
  if (parsed.meta.report_start && parsed.meta.report_end) score += 1;
  // But keep the published requirement scoring stable: cap at required length.
  score = Math.min(score, required.length);
  const missing = required.filter((k) => typeof parsed[k] !== "number").map(String);
  return { score, missing };
};

export function parseNrsTerminalReport(rawText: string): NrsTerminalReportParseResult {
  const original_text = String(rawText ?? "");
  const normalized_text = original_text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => collapseSpaces(line))
    .filter((line) => line.length > 0)
    .join("\n");

  const lines = normalized_text.split("\n");
  const sectionStarts = findSectionStarts(lines);
  const ranges = buildRanges(lines, sectionStarts);

  const salesLines = linesInRange(lines, ranges.sales);
  const cashbacksLines = linesInRange(lines, ranges.cashbacks);
  const taxesLines = linesInRange(lines, ranges.taxes);
  const otherInfoLines = linesInRange(lines, ranges.other_info);
  const netOtherLines = linesInRange(lines, ranges.net_other_sales);
  const netProductLines = linesInRange(lines, ranges.net_product_sales);

  const evidence: Record<string, string> = {};

  // Meta
  const meta: NrsTerminalReportMeta = {};
  const range = findDateRange(normalized_text);
  if (range.start && range.end) {
    meta.report_start = range.start;
    meta.report_end = range.end;
  }

  for (const line of lines.slice(0, 20)) {
    const terminal =
      line.match(/\bterminal\s*id\s*[:#]?\s*([a-z0-9\-]+)/i) ??
      line.match(/\bterminal\s*#\s*([a-z0-9\-]+)/i);
    if (terminal?.[1] && !meta.terminal_id) meta.terminal_id = terminal[1];
    const printed = line.match(/\bprinted\s*(?:at)?\s*[:#]?\s*(.+)$/i);
    if (printed?.[1] && !meta.printed_at) meta.printed_at = printed[1].trim();
    const store = line.match(/\bstore\s*[:#]?\s*(.+)$/i);
    if (store?.[1] && !meta.store_name) meta.store_name = store[1].trim();
  }

  const grossSales = findValueByLabel(salesLines, [/\bgross\s+sales\b/i]);
  evidence.gross_sales = grossSales.evidence;

  const netSales = findValueByLabel(lines, [/\bnet\s+sales\b/i]);
  evidence.net_sales = netSales.evidence;

  const cash = findValueByLabel(salesLines, [/^\s*cash\b/i]);
  evidence.cash = cash.evidence;

  const check = findValueByLabel(salesLines, [/^\s*check\b/i]);
  evidence.check = check.evidence;

  const creditDebit = findValueByLabel(salesLines, [/\bcredit\s*\/\s*debit\b/i, /\bcredit\s+debit\b/i]);
  evidence.credit_debit = creditDebit.evidence;

  const totalTaxFees = findValueByLabel(salesLines, [/\btotal\s+tax\s+and\s+fees\b/i]);
  evidence.total_tax_and_fees = totalTaxFees.evidence;

  const nonTaxableProduct = findValueByLabel(salesLines, [/\bnon[- ]?taxable\s+product\s+sale?s?\b/i]);
  evidence.non_taxable_product_sales = nonTaxableProduct.evidence;

  const nonTaxableOther = findValueByLabel(salesLines, [/\bnon[- ]?taxable\s+other\s+sales?\b/i]);
  evidence.non_taxable_other_sales = nonTaxableOther.evidence;

  // Taxes section (preferred)
  const taxableSalesTaxes = findValueByLabel(taxesLines, [/\btaxable\s+sales\b/i]);
  const taxCollected = findValueByLabel(taxesLines, [/\btax\s*\(tax\)\b/i, /^\s*tax\b/i]);
  const crvFee = findValueByLabel(taxesLines, [/\bcrv\s*\(fee\)\b/i, /\bcrv\b/i]);
  evidence.taxable_sales = taxableSalesTaxes.evidence;
  evidence.tax_collected = taxCollected.evidence;
  evidence.crv_fee = crvFee.evidence;

  // If taxes section missing, fallback to "Taxable Product Sales"
  let taxableSales = taxableSalesTaxes.amount;
  if (taxableSales === null) {
    const taxableProductSales = findValueByLabel(salesLines, [/\btaxable\s+product\s+sales?\b/i]);
    taxableSales = taxableProductSales.amount;
    if (taxableProductSales.evidence) evidence.taxable_sales = taxableProductSales.evidence;
  }

  const lotteryRedemption = findValueByLabel(otherInfoLines, [/\blottery\s+redemption\b/i]);
  evidence.lotto_payout = lotteryRedemption.evidence;
  const scratchRedemption = findValueByLabel(otherInfoLines, [/\bscratch\s+off\s+redemption\b/i, /\bscratch\s+redemption\b/i]);
  evidence.scratcher_payout = scratchRedemption.evidence;

  const cashbackLottery = findValueByLabel(cashbacksLines, [/\bcash\s+back\s+from\s+lottery\b/i]);
  evidence.cashback_lottery = cashbackLottery.evidence;
  const cashbackScratch = findValueByLabel(cashbacksLines, [/\bcash\s+back\s+from\s+scratch\b/i]);
  evidence.cashback_scratch = cashbackScratch.evidence;

  const netOtherLotto = findValueByLabel(netOtherLines, [/^\s*lotto\b/i]);
  evidence.lotto_sales = netOtherLotto.evidence;
  const netOtherScr = findValueByLabel(netOtherLines, [/^\s*scratchers?\b/i]);
  evidence.scratcher_sales = netOtherScr.evidence;

  const { categories, evidence: categoryEvidence } =
    parseNetProductSalesCategories(netProductLines);
  Object.assign(evidence, categoryEvidence);

  const parsed: NrsTerminalReportJson = {
    gross_sales: grossSales.amount,
    net_sales: netSales.amount,
    cash: cash.amount,
    check: check.amount,
    credit_debit: creditDebit.amount,
    taxable_sales: taxableSales,
    tax_collected: taxCollected.amount,
    crv_fee: crvFee.amount,
    total_tax_and_fees: totalTaxFees.amount,
    non_taxable_product_sales: nonTaxableProduct.amount,
    non_taxable_other_sales: nonTaxableOther.amount,
    lotto_sales: netOtherLotto.amount,
    scratcher_sales: netOtherScr.amount,
    lotto_payout: lotteryRedemption.amount,
    scratcher_payout: scratchRedemption.amount,
    cashback_lottery: cashbackLottery.amount,
    cashback_scratch: cashbackScratch.amount,
    ...(categories ? { categories } : {}),
    meta,
  };

  const confidence = computeConfidence(parsed, evidence);

  // Add missing evidence keys for consistency.
  Object.keys(parsed).forEach((key) => {
    if (key === "meta" || key === "categories") return;
    if (!evidence[key]) evidence[key] = "";
  });

  return {
    parsed,
    original_text,
    normalized_text,
    confidence_score: confidence.score,
    evidence,
    missing_fields: confidence.missing,
  };
}
