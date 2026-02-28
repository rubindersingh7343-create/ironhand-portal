import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export type ReceiptDocScanMeta = {
  input_bytes: number;
  output_bytes: number;
  width: number;
  height: number;
  format: string;
  orientation: number | null;
  threshold_used: number | null;
  trim_applied: boolean;
  variant: "grayscale" | "threshold";
};

export type ReceiptDocScanResult = {
  dataUrl: string;
  buffer: Buffer;
  meta: ReceiptDocScanMeta;
};

const decodeBase64 = (imageBase64: string) => {
  if (imageBase64.startsWith("data:")) {
    const match = imageBase64.match(/^data:(.+?);base64,(.*)$/);
    const base64 = match?.[2] ?? "";
    return Buffer.from(base64, "base64");
  }
  return Buffer.from(imageBase64, "base64");
};

const safeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const scoreByStats = (stats: sharp.Stats) => {
  const c = stats.channels?.[0];
  const mean = safeNumber(c?.mean) ?? 0;
  const stdev = safeNumber(c?.stdev) ?? 0;
  // Prefer higher contrast; avoid extreme mean (all-white/all-black).
  const meanPenalty = Math.abs(mean - 128) * 0.5;
  return stdev - meanPenalty;
};

const tryTrim = async (buffer: Buffer) => {
  try {
    // Trim near-background margins. This is best-effort and may fail on some receipts.
    const trimmed = await sharp(buffer, { failOnError: false })
      .trim({ threshold: 10 })
      .toBuffer();
    // If trim barely changed size, keep original to avoid accidental cropping.
    if (trimmed.byteLength < buffer.byteLength * 0.92) return { buffer: trimmed, applied: true };
  } catch {
    // ignore
  }
  return { buffer, applied: false };
};

const encodeJpegUnderLimit = async (image: sharp.Sharp, maxBytes: number) => {
  let quality = 85;
  let out = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
  for (let i = 0; i < 5 && out.byteLength > maxBytes; i += 1) {
    quality = Math.max(55, quality - 7);
    out = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  return out;
};

export async function receiptDocScanPreprocess(args: {
  imageBase64: string;
  maxBytes: number;
  minWidth: number;
  maxWidth: number;
  thresholdValues?: number[];
}): Promise<{ best: ReceiptDocScanResult; variants: ReceiptDocScanResult[] }> {
  const inputBuffer = decodeBase64(args.imageBase64);
  const input_bytes = inputBuffer.byteLength;

  const base = sharp(inputBuffer, { failOnError: false });
  const meta = await base.metadata();
  const orientation = safeNumber(meta.orientation);

  const originalWidth = meta.width ?? 0;
  const targetWidth =
    originalWidth > 0
      ? Math.min(
          args.maxWidth,
          Math.max(args.minWidth, originalWidth < args.minWidth ? Math.round(originalWidth * 2) : originalWidth),
        )
      : args.minWidth;

  const baseEnhanced = sharp(inputBuffer, { failOnError: false })
    .rotate()
    .resize({ width: targetWidth, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8, m1: 0.7, m2: 0.7 });

  const grayscaleBuf = await encodeJpegUnderLimit(baseEnhanced, args.maxBytes);
  const grayscaleMeta = await sharp(grayscaleBuf, { failOnError: false }).metadata();
  const grayscaleStats = await sharp(grayscaleBuf, { failOnError: false }).stats();

  const trimmedGray = await tryTrim(grayscaleBuf);
  const grayFinalBuf = trimmedGray.buffer;
  const grayFinalMeta = await sharp(grayFinalBuf, { failOnError: false }).metadata();

  const grayscaleVariant: ReceiptDocScanResult = {
    dataUrl: `data:image/jpeg;base64,${grayFinalBuf.toString("base64")}`,
    buffer: grayFinalBuf,
    meta: {
      input_bytes,
      output_bytes: grayFinalBuf.byteLength,
      width: grayFinalMeta.width ?? grayscaleMeta.width ?? targetWidth,
      height: grayFinalMeta.height ?? grayscaleMeta.height ?? 0,
      format: String(grayFinalMeta.format ?? "jpeg"),
      orientation,
      threshold_used: null,
      trim_applied: trimmedGray.applied,
      variant: "grayscale",
    },
  };

  const thresholds = (args.thresholdValues?.length ? args.thresholdValues : [170, 180]).slice(0, 4);
  const thresholdVariants: ReceiptDocScanResult[] = [];

  for (const thr of thresholds) {
    const thresholded = sharp(grayscaleBuf, { failOnError: false }).threshold(thr, { grayscale: true });
    const thrBuf = await encodeJpegUnderLimit(thresholded, args.maxBytes);
    const thrStats = await sharp(thrBuf, { failOnError: false }).stats();
    const trimmedThr = await tryTrim(thrBuf);
    const thrFinalBuf = trimmedThr.buffer;
    const thrFinalMeta = await sharp(thrFinalBuf, { failOnError: false }).metadata();
    thresholdVariants.push({
      dataUrl: `data:image/jpeg;base64,${thrFinalBuf.toString("base64")}`,
      buffer: thrFinalBuf,
      meta: {
        input_bytes,
        output_bytes: thrFinalBuf.byteLength,
        width: thrFinalMeta.width ?? targetWidth,
        height: thrFinalMeta.height ?? 0,
        format: String(thrFinalMeta.format ?? "jpeg"),
        orientation,
        threshold_used: thr,
        trim_applied: trimmedThr.applied,
        variant: "threshold",
      },
    });

    // Filter out clearly-bad thresholds (e.g., mostly white / mostly black).
    const mean = safeNumber(thrStats.channels?.[0]?.mean) ?? 128;
    const stdev = safeNumber(thrStats.channels?.[0]?.stdev) ?? 0;
    if (stdev < 18 && (mean < 45 || mean > 210)) {
      // likely washed out; keep but it will score low
    }
  }

  const variants = [grayscaleVariant, ...thresholdVariants];
  const grayScore = scoreByStats(grayscaleStats);
  const scored = await Promise.all(
    variants.map(async (v) => {
      const s = await sharp(v.buffer, { failOnError: false }).stats();
      return { v, score: v.meta.variant === "grayscale" ? grayScore : scoreByStats(s) };
    }),
  );

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.v ?? grayscaleVariant;

  return { best, variants };
}

export async function maybeSaveDebugReceiptImages(args: {
  enabled: boolean;
  requestId: string;
  original: Buffer;
  preprocessed: Buffer;
  meta: any;
}) {
  if (!args.enabled) return;
  try {
    const dir = path.join(process.cwd(), ".debug", "receipt_images");
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(dir, `${args.requestId}_orig.jpg`), args.original),
      fs.writeFile(path.join(dir, `${args.requestId}_docscan.jpg`), args.preprocessed),
      fs.writeFile(
        path.join(dir, `${args.requestId}_meta.json`),
        JSON.stringify(args.meta ?? {}, null, 2),
      ),
    ]);
  } catch {
    // Ignore: local dev only, and may be read-only in some envs.
  }
}
