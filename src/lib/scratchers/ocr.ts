export type ParsedScratcherLine = {
  raw: string;
  game: string;
  pack: string;
  roll: string;
  end: string | null;
  prefix: string; // `${game}-${pack}-${roll}`
};

const normalize = (value: string) =>
  String(value ?? "")
    .trim()
    .replace(/[^\d]+/g, " ")
    .trim();

const normalizeOcrText = (value: string) =>
  String(value ?? "")
    .toUpperCase()
    // Common OCR confusions on ticket ids.
    // This is intentionally a little aggressive because we only match digit-heavy patterns later.
    .replace(/[O]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[S]/g, "5")
    .replace(/[B]/g, "8")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Parse scratcher barcode/text lines like:
 * - "1692-1135314-0-020"
 * - "1692 1135314 0 020"
 *
 * Returns `null` when it doesn't look like a scratcher line.
 */
export function parseScratcherLine(input: string): ParsedScratcherLine | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const compact = normalize(raw);
  if (!compact) return null;
  const parts = compact.split(" ").filter(Boolean);

  // Common format: 4 digits, 6-8 digits, 1 digit, 2-3 digits (end ticket)
  let game = "";
  let pack = "";
  let roll = "";
  let end: string | null = null;

  // Prefer exact token boundaries.
  if (parts.length >= 3) {
    for (let i = 0; i + 2 < parts.length; i += 1) {
      const a = parts[i];
      const b = parts[i + 1];
      const c = parts[i + 2];
      const d = parts[i + 3];
      if (
        a?.length === 4 &&
        (b?.length === 6 || b?.length === 7 || b?.length === 8) &&
        c?.length === 1
      ) {
        game = a;
        pack = b;
        roll = c;
        if (typeof d === "string" && (d.length === 2 || d.length === 3)) {
          end = d;
        }
      }
    }
  }

  if (!game || !pack || !roll) return null;
  const prefix = `${game}-${pack}-${roll}`;
  return { raw, game, pack, roll, end, prefix };
}

export function extractScratcherEndTicket(input: string): string | null {
  const parsed = parseScratcherLine(input);
  if (parsed?.end) return parsed.end;
  const digits = normalize(input);
  if (!digits) return null;
  const parts = digits.split(" ").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return last.length === 2 || last.length === 3 ? last : null;
}

/**
 * Extract a scratcher ticket id from OCR text.
 *
 * We intentionally avoid barcode decoding for scratchers: we read the printed ticket id line
 * (ex: "1706-1054979-6-108") and normalize it into "GAME-PACK-ROLL-END".
 */
export function extractScratcherTicketIdFromOcrText(
  ocrText: string,
): ParsedScratcherLine | null {
  const normalized = normalizeOcrText(ocrText);
  if (!normalized) return null;

  // 1) Preferred: tokenized line in the OCR text (handles -, spaces, stray punctuation).
  const tokenPattern = /\b(\d{4})\D*(\d{6,8})\D*(\d{1})\D*(\d{2,3})\b/g;
  const tokenMatches = Array.from(normalized.matchAll(tokenPattern));
  for (const match of tokenMatches) {
    const a = match[1];
    const b = match[2];
    const c = match[3];
    const d = match[4];
    if (!a || !b || !c || !d) continue;
    const candidate = `${a}-${b}-${c}-${d}`;
    const parsed = parseScratcherLine(candidate);
    if (parsed?.end) return parsed;
  }

  // 2) Fallback: compact digits (some tickets print groups without separators).
  // Try plausible splits into 4 / (6..8) / 1 / (2..3).
  const compactCandidates = Array.from(normalized.matchAll(/\b\d{13,16}\b/g)).map(
    (m) => m[0],
  );
  for (const digits of compactCandidates) {
    const raw = String(digits);
    for (const packLen of [7, 6, 8]) {
      for (const endLen of [3, 2]) {
        const totalLen = 4 + packLen + 1 + endLen;
        if (raw.length !== totalLen) continue;
        const a = raw.slice(0, 4);
        const b = raw.slice(4, 4 + packLen);
        const c = raw.slice(4 + packLen, 4 + packLen + 1);
        const d = raw.slice(4 + packLen + 1);
        const candidate = `${a}-${b}-${c}-${d}`;
        const parsed = parseScratcherLine(candidate);
        if (parsed?.end) return parsed;
      }
    }
  }

  return null;
}
