export type ShiftReceiptSalesFields = {
  gross: number | null;
  scr: number | null;
  lotto: number | null;
  liquor: number | null;
  beer: number | null;
  cigarettes: number | null;
  tobacco: number | null;
  gas: number | null;
  lotto_payout: number | null;
};

type ReceiptVisionField = {
  key: string;
  amount: number | null;
};

export function receiptVisionExtractionToSalesFields(
  fields: ReceiptVisionField[] | null | undefined,
): ShiftReceiptSalesFields {
  const byKey = new Map<string, number | null>();
  (fields ?? []).forEach((f) => {
    if (!f?.key) return;
    const amount = typeof f.amount === "number" && Number.isFinite(f.amount) ? f.amount : null;
    byKey.set(String(f.key), amount);
  });

  const get = (key: string) => (byKey.has(key) ? (byKey.get(key) ?? null) : null);

  return {
    gross: get("gross"),
    scr: get("scr"),
    lotto: get("lotto"),
    liquor: get("liquor"),
    beer: get("beer"),
    cigarettes: get("cigarettes"),
    tobacco: get("tobacco"),
    gas: get("gas"),
    lotto_payout: get("lotto_payout"),
  };
}

