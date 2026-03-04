// Receipt-only feature flags.
// Keep these isolated from other portals/scanners (especially Scratchers).
//
// Note: client-side flags must be prefixed with NEXT_PUBLIC_ to be available in the browser bundle.

const isTrue = (value: string | undefined) => String(value ?? "").toLowerCase() === "true";

export const receiptRectOverlayV1 = isTrue(process.env.NEXT_PUBLIC_RECEIPT_RECT_OVERLAY_V1);
export const receiptParseBgV1 = isTrue(process.env.NEXT_PUBLIC_RECEIPT_PARSE_BG_V1);

