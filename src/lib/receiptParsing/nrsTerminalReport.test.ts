import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseNrsTerminalReport } from "@/lib/receiptParsing/nrsTerminalReport";

const fixture = (name: string) =>
  readFileSync(
    path.join(__dirname, "__fixtures__", name),
    "utf8",
  );

describe("parseNrsTerminalReport", () => {
  it("extracts core fields from a full terminal report", () => {
    const raw = fixture("nrs_terminal_report_1.txt");
    const result = parseNrsTerminalReport(raw);
    expect(result.confidence_score).toBeGreaterThanOrEqual(6);
    expect(result.parsed.gross_sales).toBeCloseTo(11050.22, 2);
    expect(result.parsed.net_sales).toBeCloseTo(9500.35, 2);
    expect(result.parsed.cash).toBeCloseTo(2100, 2);
    expect(result.parsed.credit_debit).toBeCloseTo(8900.22, 2);
    expect(result.parsed.taxable_sales).toBeCloseTo(9970.25, 2);
    expect(result.parsed.tax_collected).toBeCloseTo(898.77, 2);
    expect(result.parsed.crv_fee).toBeCloseTo(15, 2);
    expect(result.parsed.lotto_sales).toBeCloseTo(500, 2);
    expect(result.parsed.scratcher_sales).toBeCloseTo(700, 2);
    expect(result.parsed.lotto_payout).toBeCloseTo(1200, 2);
    expect(result.parsed.scratcher_payout).toBeCloseTo(350, 2);
    expect(result.parsed.cashback_lottery).toBeCloseTo(40, 2);
    expect(result.parsed.cashback_scratch).toBeCloseTo(20, 2);
    expect(result.parsed.categories?.liquor).toBeCloseTo(610.55, 2);
    expect(result.parsed.categories?.beer).toBeCloseTo(420.1, 2);
    expect(result.parsed.categories?.cigarettes).toBeCloseTo(315.5, 2);
    expect(result.parsed.meta.report_start).toContain("02/26/2026");
    expect(result.parsed.meta.report_end).toContain("02/27/2026");
  });

  it("falls back to sales section taxable product sales when taxes summary is missing", () => {
    const raw = fixture("nrs_terminal_report_2.txt");
    const result = parseNrsTerminalReport(raw);
    expect(result.parsed.taxable_sales).toBeCloseTo(5000, 2);
    expect(result.parsed.tax_collected).toBeNull();
    expect(result.parsed.gross_sales).toBeCloseTo(5625, 2);
    expect(result.parsed.net_sales).toBeCloseTo(4950, 2);
    expect(result.parsed.categories?.liquor).toBeCloseTo(700, 2);
    expect(result.parsed.categories?.cigarettes).toBeCloseTo(125, 2);
    expect(result.parsed.meta.terminal_id).toBe("T-09");
    expect(result.parsed.meta.printed_at).toContain("02/15/2026");
  });

  it("handles compact formats + commas and maps net other sales", () => {
    const raw = fixture("nrs_terminal_report_3.txt");
    const result = parseNrsTerminalReport(raw);
    expect(result.parsed.gross_sales).toBeCloseTo(2345.67, 2);
    expect(result.parsed.net_sales).toBeCloseTo(2145.67, 2);
    expect(result.parsed.check).toBeCloseTo(25, 2);
    expect(result.parsed.lotto_sales).toBeCloseTo(1000, 2);
    expect(result.parsed.scratcher_sales).toBeCloseTo(102.48, 2);
    expect(result.parsed.tax_collected).toBeCloseTo(195, 2);
  });
});

