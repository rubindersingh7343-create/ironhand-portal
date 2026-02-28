import { describe, expect, test } from "vitest";
import sharp from "sharp";
import { receiptDocScanPreprocess } from "@/lib/images/receiptPreprocess";

describe("receiptDocScanPreprocess", () => {
  test("returns a jpeg dataUrl and meta", async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400">
        <rect width="100%" height="100%" fill="white"/>
        <text x="60" y="120" font-size="52" font-family="Arial" fill="black">NRS TERMINAL REPORT</text>
        <text x="60" y="220" font-size="44" font-family="Arial" fill="black">Beer $22.50</text>
        <text x="60" y="290" font-size="44" font-family="Arial" fill="black">Gross Sales $1000.00</text>
      </svg>
    `;
    const png = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

    const { best, variants } = await receiptDocScanPreprocess({
      imageBase64: dataUrl,
      maxBytes: 2 * 1024 * 1024,
      minWidth: 1600,
      maxWidth: 2200,
      thresholdValues: [170],
    });

    expect(best.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(best.meta.output_bytes).toBeGreaterThan(10_000);
    expect(best.meta.width).toBeGreaterThanOrEqual(1400);
    expect(variants.length).toBeGreaterThanOrEqual(1);
  });
});

