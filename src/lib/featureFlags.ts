export const receiptDistanceGuideEnabled =
  (process.env.NEXT_PUBLIC_RECEIPT_DISTANCE_GUIDE_ENABLED ?? "false").toLowerCase() === "true";

export const receiptMultiPhotoEnabled =
  (process.env.NEXT_PUBLIC_RECEIPT_MULTIPHOTO_ENABLED ?? "false").toLowerCase() === "true";

