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

  // Common format: 4 digits, 6-7 digits, 1 digit, 2-3 digits (end ticket)
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
        (b?.length === 6 || b?.length === 7) &&
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

