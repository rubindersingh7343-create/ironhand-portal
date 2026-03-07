export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function normalizeName(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseMoneyToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const text = String(value).replace(/[^0-9.]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function parseNumberLoose(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeUnitToken(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["cs", "case", "cases", "c/s", "c"].includes(raw)) return "case";
  if (["pk", "pack", "packs", "pck", "pks"].includes(raw)) return "pack";
  if (["ea", "each", "unit", "units", "btl", "bottle", "bottles", "can", "cans"].includes(raw)) {
    return "each";
  }
  return raw;
}

export function parsePackUnits(packInfo: string | null | undefined): number | null {
  const raw = String(packInfo ?? "").toUpperCase();
  if (!raw) return null;
  // Common formats: "12/750ML", "24X16.9OZ", "6 PK", "30/12OZ"
  const m1 = raw.match(/\b(\d{1,3})\s*[/X]\s*\d/);
  if (m1) {
    const n = Number(m1[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m2 = raw.match(/\b(\d{1,3})\s*(?:PK|PACK)\b/);
  if (m2) {
    const n = Number(m2[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function scoreTextMatch(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const aTokens = new Set(na.split(" ").filter(Boolean));
  const bTokens = new Set(nb.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  aTokens.forEach((t) => {
    if (bTokens.has(t)) overlap += 1;
  });
  const denom = Math.max(aTokens.size, bTokens.size);
  const jaccard = overlap / denom;

  // Slight boost for matching number tokens (sizes, counts).
  const numToken = (t: string) => /\d/.test(t);
  const aNums = Array.from(aTokens).filter(numToken);
  const bNums = new Set(Array.from(bTokens).filter(numToken));
  const numOverlap = aNums.filter((t) => bNums.has(t)).length;
  const numBoost = Math.min(0.18, numOverlap * 0.06);

  return clamp01(jaccard * 0.82 + numBoost);
}

